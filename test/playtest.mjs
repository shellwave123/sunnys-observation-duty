// Automated browser playtest for Sunny's Observation Duty.
// Serves dist/ via `vite preview`, drives headless Chrome via playwright-core,
// and checks: screens/flow, rendering, movement, timer, flashlight tracking,
// valid + invalid reports, cooldown, restart reset, pause/resume,
// CCTV monitor (5 cams, N/B/digits, zoom, subject report), the stare
// (builds on-feed, breaks on look-away, kills at the limit), subject hunt
// -> hide to survive / exposed gets caught, FPS. Fails (exit 1) on any
// failed check or page error.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const shots = 'test/shots';
fs.mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(proc, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('preview server never came up');
    await sleep(300);
  }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), shell: true, stdio: 'ignore',
});

let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

  const g = (expr) => page.evaluate(`(() => { const g = window.__game; return (${expr}); })()`);
  const vis = (id) => page.evaluate((i) => !document.getElementById(i).classList.contains('hidden'), id);
  // Poll a game-side expression. Used instead of fixed sleeps so the suite
  // passes on slow software renderers too (it asserts progress, not speed).
  const waitFor = async (expr, timeout = 15000) => {
    try {
      await page.waitForFunction(`(() => { const g = window.__game; return (${expr}); })()`, null, { timeout, polling: 100 });
      return true;
    } catch { return false; }
  };

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await sleep(1000);

  // 1. Title screen + controls panel
  check('title screen visible', await vis('title-screen'));
  check('title controls panel present', (await page.locator('#title-screen .controls-grid').count()) === 1);
  check('title best-night line present', ((await page.locator('#title-best').innerText()) ?? '').length > 0);
  await page.screenshot({ path: `${shots}/01-title.png` });

  // 2. Flow: title -> night card -> playing
  await page.click('#start-btn');
  check('night card visible', await vis('nightcard-screen'));
  await page.screenshot({ path: `${shots}/02-nightcard.png` });
  await page.click('#begin-btn');
  await sleep(800);
  check('HUD visible, phase=playing',
    (await vis('hud')) && (await g(`g.gameState.phase`)) === 'playing',
    await g(`g.gameState.phase`));
  // suppress random spawns for deterministic mechanics tests
  await page.evaluate(() => { const g = window.__game; g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999; g.scare.calm(); });
  await page.screenshot({ path: `${shots}/03-playing.png` });

  // 3. WebGL actually rendering. Render the scene directly once so
  // renderer.info reflects scene geometry, and read it in the SAME
  // evaluate (a rAF frame between round-trips would reset the counters).
  const info = await g(`(() => { g.renderer.render(g.scene, g.camera);
    return { tris: g.renderer.info.render.triangles, calls: g.renderer.info.render.calls }; })()`);
  check('webgl draws scene', info.tris > 500 && info.calls > 5, `triangles=${info.tris} calls=${info.calls}`);

  // 4. WASD movement
  const p0 = await g(`({x:g.player.pos.x, z:g.player.pos.z})`);
  await page.keyboard.down('KeyW');
  const movedOk = await waitFor(`Math.hypot(g.player.pos.x - ${p0.x}, g.player.pos.z - ${p0.z}) > 0.5`, 12000);
  await page.keyboard.up('KeyW');
  const p1 = await g(`({x:g.player.pos.x, z:g.player.pos.z})`);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('WASD movement moves player', movedOk, `moved=${moved.toFixed(2)}m`);

  // 4b. Collision: walk at the desk/chair, must be blocked by the furniture
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.2, 1.6, 1.2); g.player.yaw = 0; g.player.pitch = 0; g.player.update(0);
  });
  await page.keyboard.down('KeyW');
  await sleep(4000);
  await page.keyboard.up('KeyW');
  const cz = await g(`g.player.pos.z`);
  check('furniture collision blocks player', cz > -1.75 && cz < -0.6,
    `z=${cz.toFixed(2)} blocked (desk face -2.05, chair front -0.88)`);

  // 4c. Post-processing chain present
  check('bloom composer active', await g(`!!g.composer && g.composer.passes.length === 3`));

  // 5. Shift timer advances
  const t0 = await g(`g.gameState.elapsed`);
  const timerOk = await waitFor(`g.gameState.elapsed - ${t0} > 0.5`, 12000);
  check('shift timer advances', timerOk, `+${((await g(`g.gameState.elapsed`)) - t0).toFixed(2)}s`);

  // 6. Flashlight follows camera
  const flD = await g(`g.flashlight.spot.position.distanceTo(g.camera.position)`);
  const flOn = await g(`g.flashlight.on && g.renderer.info ? g.flashlight.spot.intensity : 0`);
  check('flashlight attached to camera + on', flD < 0.05 && flOn > 1, `dist=${flD.toFixed(3)} intensity=${Number(flOn).toFixed(1)}`);

  // 7. VALID report: force-spawn a known, solid anomaly, walk up, aim, press R
  // (forced id keeps this deterministic — a random pool can hand us the flat
  //  shadow blob on the floor, which is a miserable thing to aim at)
  await page.evaluate(() => {
    const g = window.__game;
    g.flashlight.on = true; g.flashlight.battery = 100;
    g.anomalies.trySpawn(0, 1, 'extra-object');
    const a = g.anomalies.active[0];
    if (!a) return;
    const t = a.def.targets[0];
    const c = new g.THREE.Box3().setFromObject(t).getCenter(new g.THREE.Vector3());
    const dir = new g.THREE.Vector3(0, 1.2, 0.5).sub(c); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const pos = c.clone().add(dir.multiplyScalar(2.5)); pos.y = 1.6;
    pos.x = Math.max(-4.2, Math.min(4.2, pos.x));
    pos.z = Math.max(-3.2, Math.min(3.4, pos.z));
    g.player.pos.copy(pos);
    const d = c.clone().sub(pos);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    g.player.update(0);
  });
  await sleep(400); // let frames run so flashlight + ray align
  const rep0 = await g(`g.gameState.reports`);
  await page.keyboard.press('KeyR');
  const cd = await g(`g.reportCooldown`); // read immediately
  const rep1 = await g(`g.gameState.reports`);
  check('R logs aimed valid anomaly', rep1 === rep0 + 1, `reports ${rep0}->${rep1}`);

  // 8. Cooldown blocks immediate second R (must be pressed BEFORE the
  // screenshot — screenshots are slow enough to expire the cooldown)
  await page.keyboard.press('KeyR');
  await sleep(200);
  const unchanged = (await g(`g.gameState.reports`)) === rep1;
  check('1.5s cooldown blocks spam', cd > 0 && unchanged, `cooldown at press=${Number(cd).toFixed(2)}s`);
  await page.screenshot({ path: `${shots}/04-valid-report.png` });
  const cooledOk = await waitFor(`g.reportCooldown === 0`);
  check('cooldown expires', cooledOk);

  // 9. FALSE report: aim at bare front wall (no tags there) — only warns now
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(0, 1.6, 0); g.player.yaw = Math.PI; g.player.pitch = 0; g.player.update(0);
  });
  await sleep(300);
  await page.keyboard.press('KeyR');
  await waitFor(`g.reportCooldown === 0`);
  const falseToast = await page.locator('#toast').innerText();
  check('R at nothing only warns (no strikes)', (await g(`g.gameState.phase`)) === 'playing'
    && (await g(`g.gameState.strikes`)) === undefined && falseToast.includes('FALSE REPORT'), falseToast);
  await page.screenshot({ path: `${shots}/05-false-report.png` });

  // 10. (removed: strikes are gone — the subject is the only way to lose)

  // 11. Restart resets ALL state (via the pause-menu restart path)
  await page.keyboard.press('Escape'); await sleep(300);
  check('Esc pauses + menu shows (pre-restart)', (await g(`g.gameState.phase`)) === 'paused' && await vis('pause-screen'));
  await page.evaluate(() => { window.__game.player.pos.set(4, 1.6, 3); }); // move away first
  await page.click('#restart-btn');
  await sleep(600);
  const st = await g(`({phase:g.gameState.phase, reports:g.gameState.reports, missed:g.gameState.missed, subs:g.gameState.monstersLogged, elapsed:g.gameState.elapsed, active:g.anomalies.active.length, batt:g.flashlight.battery, px:g.player.pos.x, pz:g.player.pos.z, yaw:g.player.yaw, keys:Object.keys(g.player.keys).length})`);
  const resetOk = st.phase === 'playing' && st.reports === 0 && st.missed === 0 && st.subs === 0
    && st.elapsed < 3 && st.active === 0 && st.batt > 90 // battery drains live; just needs a full-ish reset
    && Math.abs(st.px) < 0.01 && Math.abs(st.pz - 2.8) < 0.01 && st.yaw === 0 && st.keys === 0;
  check('restart resets all state', resetOk, JSON.stringify(st));
  await page.evaluate(() => { const g = window.__game; g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999; g.scare.calm(); });

  // 12. Pause menu via Esc
  await page.keyboard.press('Escape');
  await sleep(300);
  const paused = (await g(`g.gameState.phase`)) === 'paused' && await vis('pause-screen');
  check('Esc pauses + menu shows', paused);
  await page.screenshot({ path: `${shots}/07-pause.png` });
  const e0 = await g(`g.gameState.elapsed`);
  await sleep(700);
  const frozen = (await g(`g.gameState.elapsed`)) === e0;
  check('timers frozen while paused', frozen);
  // R during pause does nothing
  const rBefore = await g(`g.gameState.reports`);
  await page.keyboard.press('KeyR');
  await sleep(200);
  check('input ignored while paused', (await g(`g.gameState.reports`)) === rBefore);
  // resume via button
  await page.click('#resume-btn');
  await sleep(400);
  check('resume returns to playing', (await g(`g.gameState.phase`)) === 'playing' && !(await vis('pause-screen')));
  // pause restart path
  await page.keyboard.press('Escape'); await sleep(200);
  await page.click('#restart-btn'); await sleep(400);
  check('pause-menu restart works', (await g(`g.gameState.phase`)) === 'playing'
    && (await g(`g.gameState.reports`)) === 0 && (await g(`g.gameState.monstersLogged`)) === 0);

  // 16. CCTV + subject layer (runs before the fps/zero-error checks)
  // 16a. Five stations exist
  const camNames = await g(`g.stations.map(s => s.camNo + ' ' + s.name)`);
  check('five CCTV stations', (await g(`g.stations.length`)) === 5, camNames.join(' | '));

  // 16a2. Every remote room is actually lit — a point light near the ceiling
  // plus a lifted-surface term, so no feed is a black rectangle.
  const lightInfo = await page.evaluate(() => {
    const g = window.__game;
    return g.stations.slice(1).map((s) => ({
      id: s.id,
      key: s.light ? +s.light.intensity.toFixed(2) : 0,
      fill: s.fill ? +s.fill.intensity.toFixed(2) : 0,
      shellLift: s.group?.children?.[0]?.material?.emissiveIntensity ?? 0,
    }));
  });
  check('CCTV rooms are lit', lightInfo.every((r) => r.key > 5 && r.fill > 1 && r.shellLift >= 0.3),
    JSON.stringify(lightInfo));

  // 16a3. Sample the actual graded centre pixel of a live feed, so a
  // regression back to a black rectangle fails here instead of in play.
  const grade = await page.evaluate(() => {
    const g = window.__game;
    g.monitor.select(2); // storage room
    g.monitor.render();
    const gl = g.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.floor(gl.drawingBufferWidth / 2),
      Math.floor(gl.drawingBufferHeight / 2),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
    );
    g.monitor.select(0);
    return { r: px[0], g: px[1], b: px[2], w: g.renderer.domElement.width };
  });
  check('CCTV feed is bright, not black', grade.r > 55 && grade.g > 55 && grade.b > 55,
    `centre pixel rgb(${grade.r},${grade.g},${grade.b}) @${grade.w}px`);

  // 16b. Sit at the monitor with E (walk to the desk first)
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.yaw = 0; g.player.pitch = 0; g.player.update(0);
  });
  await page.keyboard.press('KeyE');
  await sleep(300);
  check('E opens the monitor at the desk',
    (await g(`g.monitor.open`)) === true && (await g(`g.player.mode`)) === 'desk' && await vis('cctv'));

  // 16c. N cycles, B goes back, digits select
  const ix0 = await g(`g.monitor.state.index`);
  await page.keyboard.press('KeyN'); await sleep(200);
  const ix1 = await g(`g.monitor.state.index`);
  await page.keyboard.press('KeyB'); await sleep(200);
  const ixBack = await g(`g.monitor.state.index`);
  await page.keyboard.press('Digit4'); await sleep(200);
  const ix4 = await g(`g.monitor.state.index`);
  check('N/B/digits switch cameras', ix1 === (ix0 + 1) % 5 && ixBack === ix0 && ix4 === 3,
    `${ix0}->${ix1}->${ixBack}->digit4=${ix4}`);

  // 16d. Wheel zooms the feed
  const z0 = await g(`g.monitor.zoom`);
  await page.mouse.wheel(0, -240); await sleep(200);
  const z1 = await g(`g.monitor.zoom`);
  const zoomLabel = await page.locator('#cctv-zoom').innerText();
  check('wheel zooms the feed', z1 > z0 && zoomLabel.includes('x1.5'), `x${z0}->x${z1} label=${zoomLabel}`);

  // 16e. R on an EMPTY feed only warns (strikes are gone)
  await page.keyboard.press('Digit2'); await sleep(150);
  await page.keyboard.press('KeyR');
  await waitFor(`g.reportCooldown === 0`);
  const emptyToast = await page.locator('#toast').innerText();
  check('R on empty feed only warns', (await g(`g.gameState.phase`)) === 'playing'
    && emptyToast.includes('FALSE REPORT'), emptyToast);
  const cooled = await g(`g.reportCooldown`);
  check('monitor cooldown expires', cooled === 0);

  // 16f. Spawn the subject on CAM 03, freeze it center-frame, zoom, report it
  await page.keyboard.press('Digit3'); await sleep(150);
  await page.evaluate(() => {
    const g = window.__game;
    g.gameState.nextMonsterIn = 9999; g.gameState.monsterTimer = 0;
    g.debug.stareLimit = 999; // don't let the lock build during the logging test
    const st = g.stations[2];
    g.monster.spawn(2, st.patrol, 120);
    g.monster.stare = 999; // freeze the walk cycle
    g.monitor.state.zoomIx = 3; g.monitor.refreshDom(); // x3 zoom
  });
  let seen = false;
  for (const t of [0.3, 0.4, 0.5]) {
    seen = await page.evaluate((tt) => {
      const g = window.__game;
      const st = g.stations[2];
      const p = st.camPos.clone().lerp(st.lookAt, tt); p.y = 1.0;
      g.monster.fig.position.copy(p);
      return g.monitor.inspect().visible;
    }, t);
    if (seen) break;
  }
  check('subject inspectable on the feed (zoomed)', seen);
  const repB = await g(`g.gameState.reports`);
  const monB = await g(`g.gameState.monstersLogged`);
  await page.keyboard.press('KeyR');
  await waitFor(`g.reportCooldown === 0`);
  check('R logs the subject on the feed',
    (await g(`g.gameState.reports`)) === repB + 1 && (await g(`g.gameState.monstersLogged`)) === monB + 1
    && (await g(`g.monster.state`)) === 'idle');

  // 16f2. The stare builds while you watch, breaks when you look away
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.stareLimit = 3;
    const st = g.stations[2];
    g.monster.spawn(2, st.patrol, 120);
    g.monster.stare = 999;
    const p = st.camPos.clone().lerp(st.lookAt, 0.4); p.y = 1.0;
    g.monster.fig.position.copy(p);
    g.monitor.state.zoomIx = 3; g.monitor.refreshDom();
  });
  const stareBuilds = await waitFor(`g.stareT > 1.6`, 15000); // past the 0.45-dread warning line
  const stareWarnShown = await vis('stare-warn');
  check('stare builds while you watch', stareBuilds && stareWarnShown, `stareT=${await g(`g.stareT`)}`);
  check('eyes burn as it locks on', (await g(`g.monster.dread`)) > 0.3);
  await page.keyboard.press('KeyN'); await sleep(200); // look away to CAM 04
  const stareBreaks = await waitFor(`g.stareT === 0`, 15000);
  check('looking away breaks the stare', stareBreaks && !(await vis('stare-warn')));

  // 16f3. A full locked stare kills (limit scaled down for the test)
  await page.keyboard.press('Digit3'); await sleep(150);
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.stareLimit = 1.2;
    g.monitor.state.zoomIx = 3; g.monitor.refreshDom();
  });
  const stareKill = await waitFor(`g.gameState.phase === 'gameover'`, 20000);
  const stareReason = await page.locator('#lose-reason').innerText();
  check('locked stare kills you', stareKill && stareReason.includes('stared back'), stareReason);
  await page.screenshot({ path: `${shots}/06-gameover.png` });

  // 16f4. Retry after a stare death resets the lock
  await page.click('#retry-btn');
  await sleep(600);
  const rst = await g(`({mstate:g.monster.state, mon:g.monitor.open, stare:g.stareT, dread:g.monster.dread, feedDread:g.monitor.dread, warnHidden:document.getElementById('stare-warn').classList.contains('hidden')})`);
  check('retry resets the stare lock',
    rst.mstate === 'idle' && rst.mon === false && rst.stare === 0 && rst.dread === 0 && rst.feedDread === 0 && rst.warnHidden,
    JSON.stringify(rst));
  await page.evaluate(() => { const g = window.__game; g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999; g.debug.stareLimit = 10; g.scare.calm(); });

  // 16g. Ignored subject comes for the door; it yanks you out of the monitor
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.stations[1];
    g.monster.spawn(1, st.patrol, 0.3); // expires almost immediately
  });
  const huntOk = await waitFor(`g.monster.state === 'hunting'`, 20000);
  check('unlogged subject starts the hunt', huntOk && await vis('door-warn'));
  const lampHex = await g(`g.refs.lampLight.color.getHex()`);
  check('hunt turns the room red + beam fears',
    lampHex === 0xff2a1a && (await g(`g.flashlight.fear`)) === 1, 'lamp=0x' + lampHex.toString(16));
  check('hunt yanks you out of the monitor', (await g(`g.monitor.open`)) === false);
  const doorOpen = await waitFor(`Math.abs(g.refs.doorPivot.rotation.y) > 0.5`, 10000);
  check('office door swings open', doorOpen);

  // 16h. H hides under the desk; outlasting the hunt survives
  // (run back to the desk first — hiding only works near it)
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.update(0);
  });
  await page.keyboard.press('KeyH');
  await sleep(300);
  check('H hides under the desk', (await g(`g.player.mode`)) === 'hide' && await vis('hiding'));
  await page.evaluate(() => { window.__game.monster.huntT = 0.3; }); // fast-forward the countdown
  const survOk = await waitFor(`g.gameState.huntsSurvived === 1`, 15000);
  const lampWarm = await g(`g.refs.lampLight.color.getHex()`);
  check('hiding outlasts the hunt',
    survOk && (await g(`g.gameState.phase`)) === 'playing' && Math.abs(await g(`g.refs.doorPivot.rotation.y`)) < 0.05
    && lampWarm === 0xffd9a0 && (await g(`g.flashlight.fear`)) === 0, 'lamp=0x' + lampWarm.toString(16));

  // 16i. Exposed when it arrives = caught (jumpscare -> game over)
  await page.keyboard.press('KeyH'); await sleep(200); // come back out
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.stations[3];
    g.monster.spawn(3, st.patrol, 0.3);
  });
  await waitFor(`g.monster.state === 'hunting'`, 20000);
  await page.evaluate(() => { window.__game.monster.huntT = 0.3; });
  const caughtOk = await waitFor(`g.gameState.phase === 'gameover'`, 20000);
  const reason = await page.locator('#lose-reason').innerText();
  check('exposed player is caught at the door', caughtOk && reason.includes('found you'), reason);

  // 16j. Retry after a hunt resets the monster layer
  await page.click('#retry-btn');
  await sleep(600);
  const mst = await g(`({mstate:g.monster.state, mon:g.monitor.open, door:g.refs.doorPivot.rotation.y, hunts:g.gameState.huntsSurvived, subs:g.gameState.monstersLogged})`);
  check('retry resets the hunt layer',
    mst.mstate === 'idle' && mst.mon === false && Math.abs(mst.door) < 0.01 && mst.hunts === 0 && mst.subs === 0,
    JSON.stringify(mst));
  await page.evaluate(() => { const g = window.__game; g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999; g.scare.calm(); });

  // 16k. Ambient horror: glimpses, blackouts, lightning, whispers
  // 16k1. A glimpse puts the subject IN the office — flashlight + R logs it
  await page.evaluate(() => {
    const g = window.__game;
    g.flashlight.on = true; g.flashlight.battery = 100;
    g.scare.trigger('glimpse', { seconds: 60, spot: 0 });
    g.player.pos.set(-1.5, 1.6, -1.3); g.player.update(0); // settle collision first
    const c = new g.THREE.Box3().setFromObject(g.monster.fig).getCenter(new g.THREE.Vector3());
    const d = c.clone().sub(g.player.pos);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    g.player.update(0);
  });
  await sleep(400);
  check('glimpse appears in the office', (await g(`g.scare.glimpseActive`)) === true);
  const repG0 = await g(`g.gameState.reports`);
  const monG0 = await g(`g.gameState.monstersLogged`);
  await page.keyboard.press('KeyR');
  await waitFor(`g.reportCooldown === 0`);
  check('R logs the office glimpse',
    (await g(`g.gameState.reports`)) === repG0 + 1 && (await g(`g.gameState.monstersLogged`)) === monG0 + 1
    && (await g(`g.scare.glimpseActive`)) === false);

  // 16k2. An unreported glimpse vanishes on its own
  await page.evaluate(() => { window.__game.scare.trigger('glimpse', { seconds: 0.3, spot: 1 }); });
  const goneOk = await waitFor(`!g.scare.glimpseActive`, 10000);
  check('glimpse vanishes if ignored', goneOk && (await g(`g.monster.fig.visible`)) === false);

  // 16k3. Lights-out kills the lamp, then it comes back
  await page.evaluate(() => { window.__game.scare.trigger('lightsout', { seconds: 0.3 }); });
  await sleep(200);
  const darkOk = (await g(`g.refs.lampLight.intensity`)) === 0;
  const backOk = await waitFor(`g.refs.lampLight.intensity > 4`, 10000);
  check('lights-out blacks out + restores the lamp', darkOk && backOk);

  // 16k4. Lightning flashes through the window, then settles
  await page.evaluate(() => { window.__game.scare.trigger('lightning'); });
  let peak = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(150);
    peak = Math.max(peak, await g(`g.storm.intensity`));
    if (peak > 3) break;
  }
  const calmSky = await waitFor(`g.storm.intensity === 0`, 10000);
  check('lightning flashes + fades', peak > 3 && calmSky, `peak=${peak.toFixed(1)}`);

  // 16k5. A whisper shudders the camera
  await page.evaluate(() => { window.__game.scare.trigger('whisper'); });
  const shudder = await g(`Math.abs(g.scare.consumeShudder(0.05)) > 0`);
  check('whisper shudders the camera', shudder);

  // 16k6. Full soundboard: every cue runs clean (caught by zero-errors below)
  const board = await page.evaluate(() => {
    const a = window.__game.audio;
    const missing = ['bang', 'approach', 'chairScrape', 'shutter', 'riser', 'powerDown',
      'powerUp', 'staticBurst', 'knock', 'sting', 'whisper', 'thunder', 'heartbeat',
      'scream', 'doorCreak', 'slam', 'camSwitch', 'chime', 'buzz'].filter((k) => typeof a[k] !== 'function');
    for (const k of ['bang', 'approach', 'chairScrape', 'shutter', 'riser', 'powerDown',
      'powerUp', 'staticBurst', 'knock']) {
      try { a[k](); } catch (e) { return { ok: false, failed: k }; }
    }
    a.setRain(0.5);
    const lvl = a.getRainLevel();
    a.setRain(0.07);
    a.startHum(); a.stopHum();
    return { ok: missing.length === 0 && lvl === 0.5, missing };
  });
  check('soundboard complete + clean', board.ok, JSON.stringify(board));

  // 16k7. The hunt beats on the door the whole way in
  await page.evaluate(() => {
    const g = window.__game;
    g.audio.bang = ((orig) => (...a) => { g.__bangs = (g.__bangs || 0) + 1; return orig(...a); })(g.audio.bang);
    const st = g.stations[1];
    g.monster.spawn(1, st.patrol, 0.3);
  });
  await waitFor(`g.monster.state === 'hunting'`, 20000);
  await sleep(5000);
  const bangs = await g(`g.__bangs || 0`);
  check('hunt bangs on the door', bangs >= 1, `${bangs} impacts`);
  await page.evaluate(() => { window.__game.monster.huntT = 0.3; });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.update(0);
  });
  await page.keyboard.press('KeyH');
  await waitFor(`g.gameState.huntsSurvived === 1`, 15000);

  // 16k6. Landing on an occupied feed bursts static + the dread vignette
  // creeps in while it locks on
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.stations[1];
    g.monster.spawn(1, st.patrol, 300);
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.update(0);
  });
  await page.keyboard.press('KeyE'); // sit (CAM 01)
  await sleep(200);
  await page.keyboard.press('Digit2'); // switch to the occupied hallway feed
  await sleep(200);
  check('occupied feed bursts static', (await g(`g.monitor.state.staticT`)) > 0);
  await page.evaluate(() => {
    const g = window.__game;
    g.monster.stare = 999;
    g.monitor.state.zoomIx = 3; g.monitor.refreshDom();
  });
  let framed = false;
  for (const t of [0.3, 0.4, 0.5]) {
    framed = await page.evaluate((tt) => {
      const g = window.__game;
      const st = g.stations[1];
      const p = st.camPos.clone().lerp(st.lookAt, tt); p.y = 1.0;
      g.monster.fig.position.copy(p);
      return g.monitor.inspect().visible;
    }, t);
    if (framed) break;
  }
  check('subject framed for the dread test', framed);
  await sleep(2500);
  const dreadOp = parseFloat(await page.locator('#dread').evaluate((el) => el.style.opacity || '0'));
  check('dread vignette closes in on a lock', dreadOp > 0, `opacity=${dreadOp}`);
  await page.evaluate(() => { window.__game.monster.reset(); }); // stand down

  // 16k7. Standing up sometimes leaves it standing where you sat
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.behindChance = 1;
    g.debug.lastBehindScare = -999;
  });
  await page.keyboard.press('KeyE'); // stand up (toggles monitor off)
  await sleep(300);
  check('ambush behind your chair', (await g(`g.scare.glimpseActive`)) === true);
  await page.evaluate(() => { window.__game.debug.behindChance = 0; });
  const ambushGone = await waitFor(`!g.scare.glimpseActive`, 15000);
  check('ambush slips away', ambushGone);

  // 16k8. A doomed subject rattles the door before coming
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.stations[3];
    g.monster.spawn(3, st.patrol, 7);
  });
  const warned = await waitFor(`g.monster.warnedHunt === true`, 20000);
  const rattleToast = await page.locator('#toast').innerText();
  check('door rattles before the hunt', warned && rattleToast.includes('RATTLING'), rattleToast);
  // The warning is the assertion; fast-forward the remaining dwell so this
  // timing check does not depend on wall-clock frame rate.
  await page.evaluate(() => { window.__game.monster.dwell = 0.2; });
  const preHunt = await waitFor(`g.monster.state === 'hunting'`, 20000);
  check('rattled subject still comes', preHunt);
  await page.evaluate(() => { window.__game.monster.huntT = 0.3; }); // don't linger: hide now
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.update(0);
  });
  await page.keyboard.press('KeyH');
  await waitFor(`g.gameState.huntsSurvived === 1`, 15000);

  // 13. Framerate (headless SwiftShader is a lower bound; real GPUs are far faster)
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const start = performance.now();
    const tick = () => { n++; if (performance.now() - start < 2000) requestAnimationFrame(tick); else res(n / 2); };
    requestAnimationFrame(tick);
  }));
  check('render loop alive (fps sampled)', fps > 5,
    `${fps.toFixed(0)} fps headless-sw · auto-quality tier ${await g(`g.quality.tier`)} (${await g(`g.quality.label()`)})`);

  // 12b. First-person hand: it exists, it draws, and it animates.
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(0, 1.6, 2.0); g.player.yaw = 0; g.player.pitch = 0;
    g.player.setMode('walk'); g.hand.sync();
    g.monitor.close(); g.gameState.phase = 'playing';
  });
  await sleep(400);
  const handInfo = await page.evaluate(() => {
    const g = window.__game;
    let meshes = 0;
    g.hand.scene.traverse((o) => { if (o.isMesh) meshes++; });
    return {
      meshes,
      visible: g.hand.visible,
      z: +g.hand.rig.position.z.toFixed(3),
      x: +g.hand.rig.position.x.toFixed(3),
      inScene: g.scene.children.includes(g.hand.scene),
    };
  });
  check('first-person hand exists and renders', handInfo.meshes >= 12
    && handInfo.visible && !handInfo.inScene,
    `${handInfo.meshes} meshes · rig(${handInfo.x},${handInfo.z}) · outside world scene=${!handInfo.inScene}`);

  // Two hands, one per side, each a single rounded rectangle with no digits.
  const hands = await page.evaluate(() => {
    const g = window.__game;
    const t = g.hand.hands;
    const out = t.map((h) => {
      // The torch hangs off the right palm, so exclude its subtree before
      // counting the hand itself.
      const torchParts = new Set();
      if (h.torch) h.torch.traverse((o) => torchParts.add(o));

      let blocks = 0, geoType = '', verts = 0;
      h.palm.traverse((o) => {
        if (!o.isMesh || torchParts.has(o)) return;
        blocks++;
        geoType = o.geometry.type;
        verts = o.geometry.attributes.position.count;
      });

      let curved = 0;
      h.root.traverse((o) => {
        if (!o.isMesh || torchParts.has(o)) return;
        const p = o.geometry.type;
        if (p === 'SphereGeometry' || p === 'CapsuleGeometry' || p === 'TorusGeometry') curved++;
      });
      return {
        side: h.side,
        rootX: +h.root.position.x.toFixed(3),
        fingers: h.fingers.length,
        hasThumb: !!h.thumbBase,
        palmMeshes: blocks,
        geoType,
        // A plain box has 24 verts; the rounded slab must be far denser.
        verts,
        curvedParts: curved,
      };
    });
    return { out, hasTorch: t.some((h) => !!h.torch) };
  });
  check('two hands, one rounded rectangle each, no fingers',
    hands.out.length === 2
    && hands.out.every((h) => h.fingers === 0 && !h.hasThumb
      && h.palmMeshes === 1 && h.geoType === 'ExtrudeGeometry'
      && h.verts > 100 && h.curvedParts === 0)
    && Math.sign(hands.out[0].rootX) !== Math.sign(hands.out[1].rootX)
    && hands.hasTorch,
    JSON.stringify(hands.out));

  // Looking down brings both hands up into frame.
  const look = await page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    g.player.pitch = -1.0; g.player.yaw = 0;
    const y0 = g.hand.hands.map((h) => h.root.position.y);
    let n = 0;
    const tick = () => {
      if (++n < 10) requestAnimationFrame(tick);
      else res({ y0, y1: g.hand.hands.map((h) => +h.root.position.y.toFixed(3)), look: +g.hand.lookDown.toFixed(2) });
    };
    requestAnimationFrame(tick);
  }));
  check('looking down raises both hands', look.look > 0.5 && look.y1[0] > look.y0[0] && look.y1[1] > look.y0[1],
    `lookDown=${look.look} y ${look.y0.map((v) => v.toFixed(3))} -> ${look.y1}`);

// it punches forward on a report press, then settles back
  const punch = await page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    const before = g.hand.hands.map((h) => h.root.position.z);
    g.hand.punch(1.0);
    let deepest = before.slice();
    let n = 0;
    const tick = () => {
      g.hand.hands.forEach((h, i) => {
        deepest[i] = Math.min(deepest[i], h.root.position.z); // pressed away
      });
      if (++n < 8) requestAnimationFrame(tick);
      else res({
        before: before.map((v) => +v.toFixed(3)),
        deepest: deepest.map((v) => +v.toFixed(3)),
      });
    };
    requestAnimationFrame(tick);
  }));
  check('both hands punch on report',
    punch.deepest.every((d, i) => d < punch.before[i] - 0.015),
    `z ${punch.before} -> ${punch.deepest}`);

  // and they react to a head turn (look lag) plus walk bob.
  // The sway is a transient excursion, so sample the *extreme*, not the max.
  // The left hand is a mirrored copy, so its excursion is the opposite sign.
  const anim = await page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    const rx0 = g.hand.hands.map((h) => h.root.rotation.y);
    g.player.yaw = 1.2; g.player.pitch = -0.5; g.player.speedNow = 2.4;
    let n = 0;
    const ext = rx0.slice();
    const tick = () => {
      g.hand.hands.forEach((h, i) => {
        ext[i] = h.side > 0 ? Math.min(ext[i], h.root.rotation.y)
          : Math.max(ext[i], h.root.rotation.y);
      });
      if (++n < 10) requestAnimationFrame(tick);
      else res({ rx0: rx0.map((v) => +v.toFixed(3)), ext: ext.map((v) => +v.toFixed(3)) });
    };
    requestAnimationFrame(tick);
  }));
  check('hands sway with the look and the walk',
    anim.ext[0] < anim.rx0[0] - 0.03 && anim.ext[1] > anim.rx0[1] + 0.03,
    `rotY ${anim.rx0} -> ${anim.ext} (R down, L up: mirrored)`);

  // clenching (grabbing the desk during a hunt) curls the whole R15 mitten
  const clench = await page.evaluate(() => new Promise((res) => {
    const g = window.__game;
    const before = g.hand.hands.map((h) => h.palm.rotation.x);
    g.hand.setClench(1);
    let n = 0;
    const tick = () => {
      if (++n < 10) requestAnimationFrame(tick);
      else {
        const rx = g.hand.hands.map((h) => +h.palm.rotation.x.toFixed(3));
        const ry = g.hand.hands.map((h) => +h.palm.rotation.y.toFixed(3));
        g.hand.setClench(0);
        res({ before: before.map((v) => +v.toFixed(3)), rx, ry });
      }
    };
    requestAnimationFrame(tick);
  }));
  check('clenching curls the block hand into a fist',
    clench.rx.every((v, i) => v > clench.before[i] + 0.4) && clench.ry.every((v) => Math.abs(v) > 0.05),
    JSON.stringify(clench));

  // the hand hides while you're seated at the monitor
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.yaw = 0; g.player.update(0);
  });
  await page.keyboard.press('KeyE');
  await sleep(300);
  check('hand tucks away at the monitor', (await g(`g.hand.visible`)) === false
    && (await g(`g.monitor.open`)) === true);
  await page.keyboard.press('Escape'); await sleep(250);

  // 14. Best-night persistence
  const best = await page.evaluate(() => localStorage.getItem('sunnys-observation-duty-best-night'));
  check('best night saved to localStorage', best !== null && Number(best) >= 1, `best=${best}`);

  // 15. No page errors / console errors
  check('zero page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await browser.close();
  server.kill();
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  console.error('PLAYTEST CRASH:', err);
  try { await browser?.close(); } catch {}
  server.kill();
  process.exit(2);
}
