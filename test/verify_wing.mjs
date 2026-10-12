// Targeted checks for the extended fuse wing: two new CCTV rooms on the route
// to the power supply, the extra circuit panels + hiding lockers, every divider
// gap walkable, and the stalker switching to HUNT the moment you reach the
// electrical room. Serves dist/ via `vite preview`.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const PORT = 5207;
const URL = `http://localhost:${PORT}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try { const res = await fetch(URL); if (res.ok) return; } catch {}
    if (Date.now() - start > timeoutMs) throw new Error('preview server never came up');
    await sleep(300);
  }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), shell: true, stdio: 'ignore',
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox',
      // deterministic mic for the voice-chat checks: a fake device, auto-allowed
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.context().grantPermissions(['microphone']).catch(() => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const g = (expr) => page.evaluate(`(() => { const g = window.__game; return (${expr}); })()`);
  const waitFor = async (expr, timeout = 15000) => {
    try {
      await page.waitForFunction(`(() => { const g = window.__game; return (${expr}); })()`, null, { timeout, polling: 100 });
      return true;
    } catch { return false; }
  };

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await sleep(600);

  // --- Layout: two new rooms on the cam rotation, on the path to the breaker
  const cams = await g(`g.stations.map(s => s.name)`);
  check('8 camera stations', cams.length === 8, cams.join(' | '));
  check('archive room has a feed', cams.includes('ARCHIVE ROOM'));
  check('pump room has a feed', cams.includes('PUMP ROOM'));
  const roomIds = await g(`g.refs.wingRooms.map(r => r.id)`);
  check('6 chained wing rooms', roomIds.length === 6, roomIds.join(' > '));
  const breakerZ = await g(`g.refs.breakerPos.z`);
  check('breaker is past the new rooms', breakerZ < -49, `breaker z=${breakerZ.toFixed(1)}`);
  const doors = await g(`g.refs.wingDoors.length`);
  check('7 dividers with door gaps', doors === 7, String(doors));
  const panels = await g(`g.refs.panels.length`);
  check('7 circuit panels (6 wing + main)', panels === 7, String(panels));
  const lockers = await g(`g.refs.lockerPos.length`);
  check('17 hiding lockers', lockers === 17, String(lockers));

  // --- Start a co-op shift, jump straight into the night-2 outage
  await page.click('#start-mp-btn');
  await page.click('#begin-btn');
  await sleep(700);
  await page.evaluate(() => {
    const g = window.__game;
    g.gameState.night = 2;
    g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999;
    g.scare.calm?.();
    g.gameState.elapsed = 90.1;   // trips the power event next frame
  });
  const outage = await waitFor(`g.gameState.powerOut`);
  check('power outage triggers on night 2', outage);

  // --- Co-op voice chat: the HUD chip, the panel, and a real WebRTC call
  check('co-op run shows the VOICE chip',
    await page.evaluate(() => !document.getElementById('voice').classList.contains('hidden')));
  await page.keyboard.press('KeyV');
  await sleep(150);
  check('V opens the voice panel', await g(`g.voiceOpen`));
  check('voice panel is on screen',
    await page.evaluate(() => !document.getElementById('voice-panel').classList.contains('hidden')));
  check('opening the panel does not pause the shift',
    await g(`g.gameState.phase === g.GamePhase.PLAYING`), await g(`g.gameState.phase`));

  // Two independent chats in one page, wired to each other through the same
  // copy/paste codes two real players would use.
  const loop = await page.evaluate(async () => {
    const mk = window.__game.createVoiceChat;
    const A = mk(), B = mk();
    await A.enableMic(); await B.enableMic();
    const offer = await A.createInvite();
    const reply = offer ? await B.joinInvite(offer) : '';
    if (reply) await A.acceptReply(reply);
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !(A.state.link === 'live' && B.state.link === 'live')) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const out = { offer: offer.length, reply: reply.length, a: A.state.link, b: B.state.link, micA: A.state.mic, micB: B.state.mic };
    A.stop(); B.stop();
    return out;
  });
  check('invite and reply codes are produced', loop.offer > 100 && loop.reply > 100,
    `offer=${loop.offer} reply=${loop.reply}`);
  check('two players pair into a live voice call', loop.a === 'live' && loop.b === 'live',
    `A=${loop.a} B=${loop.b}`);
  check('both microphones come up', loop.micA === 'on' && loop.micB === 'on',
    `A=${loop.micA} B=${loop.micB}`);

  await page.keyboard.press('KeyM');
  await sleep(120);
  check('M mutes the microphone', await g(`g.voice.state.muted`));
  await page.keyboard.press('KeyM');
  await sleep(120);
  check('M unmutes it again', !(await g(`g.voice.state.muted`)));
  await page.keyboard.press('KeyV');
  await sleep(150);
  check('V closes the voice panel', !(await g(`g.voiceOpen`)));
  check('the shift is still running', await g(`g.gameState.phase === g.GamePhase.PLAYING`));
  await page.keyboard.press('KeyV');
  await sleep(100);
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Esc closes the panel before anything else',
    !(await g(`g.voiceOpen`)) && await g(`g.gameState.phase === g.GamePhase.PLAYING`));

  // --- Every divider gap is walkable: drop the player on each doorway centre
  // and let a frame of collision resolve run. A wall in the gap shoves them
  // sideways; a real doorway leaves them standing on the mark.
  const gapResults = await page.evaluate(async () => {
    const g = window.__game;
    const out = [];
    for (const d of g.refs.wingDoors) {
      g.player.pos.set(d.x, 1.6, d.z);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const dx = g.player.pos.x - d.x, dz = g.player.pos.z - d.z;
      out.push({ z: d.z, err: Math.hypot(dx, dz) });
    }
    return out;
  });
  for (const r of gapResults) {
    check(`doorway gap walkable at z=${r.z}`, r.err < 0.45, `pushed ${r.err.toFixed(2)}m`);
  }

  // --- The whole route: the player can actually walk out to the power supply
  const routeOk = await page.evaluate(async () => {
    const g = window.__game;
    const stops = [[3.6, -17], [3.6, -22.5], [5.6, -27.5], [5.6, -32.5], [4.0, -37.5], [3.6, -43], [3.6, -47], [3.5, -49]];
    for (const [x, z] of stops) {
      g.player.pos.set(x, 1.6, z);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (Math.hypot(g.player.pos.x - x, g.player.pos.z - z) > 1.2) {
        return { ok: false, at: [x, z], got: [g.player.pos.x, g.player.pos.z] };
      }
    }
    return { ok: true, z: g.player.pos.z };
  });
  check('route from the wing to the power supply is open', routeOk.ok,
    routeOk.ok ? `reached z=${routeOk.z.toFixed(1)}` : JSON.stringify(routeOk));

  // --- Standing at the power supply flips the stalker into HUNT mode
  const huntOn = await waitFor(`g.stalkHunt === true`, 8000);
  check('monster hunts when you reach the power supply', huntOn, `stalkHunt=${await g('g.stalkHunt')}`);
  check('it is out there with you', await g(`g.monster.stalker === true`));

  // --- Hiding in the archive-room locker still works mid-hunt
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.refs.lockerPos[12];      // archive room locker
    // stand beside it (inside the room), not inside its collider
    g.player.pos.set(p.x + Math.sign(3.5 - p.x), 1.6, p.z);
  });
  await sleep(150);
  await page.keyboard.press('KeyH');
  await sleep(200);
  check('hiding in a wing locker works', (await g(`g.player.mode`)) === 'hide', await g(`g.player.mode`));
  await page.keyboard.press('KeyH');

  // --- Cams: digit keys select the new feeds
  await page.evaluate(() => { const g = window.__game; g.player.pos.set(-1.2, 1.6, -2.2); });
  await page.keyboard.press('KeyE'); // sit at the monitor
  await sleep(300);
  check('monitor opens at the desk', await g(`g.monitor.open`));
  await page.keyboard.press('Digit6');
  await sleep(150);
  check('Digit6 selects a cam', (await g(`g.monitor.state.index`)) === 5, String(await g(`g.monitor.state.index`)));
  await page.keyboard.press('Digit8');
  await sleep(150);
  const idx8 = await g(`g.monitor.state.index`);
  check('Digit8 selects the electrical room cam', idx8 === 7, String(idx8));
  check('last cam is the electrical room', (await g(`g.monitor.station.name`)) === 'ELECTRICAL ROOM');

  // --- The outage stalker is the Backrooms void body: wire spine, white face
  const voidInfo = await g(`(() => {
    const v = g.monster.voidFig;
    const box = new g.THREE.Box3().setFromObject(v);
    let whites = 0, boxes = 0;
    v.traverse((o) => {
      if (o.material && o.material.color && o.material.color.getHex() === 0xffffff) {
        whites++;
        if (o.geometry?.type === 'BoxGeometry') boxes++;   // 14 teeth + 8 claws
      }
    });
    return { stalk: g.monster.stalker, visible: v.visible, figHidden: !g.monster.fig.visible,
             h: box.max.y - box.min.y, whites, boxes };
  })()`);
  check('stalker walks as the void body', voidInfo.stalk && voidInfo.visible && voidInfo.figHidden);
  check('void body stands ~2.7m tall', voidInfo.h > 2.5 && voidInfo.h < 2.95, `h=${voidInfo.h.toFixed(2)}m`);
  check('white grin, teeth, eyes and claws are modelled', voidInfo.whites >= 25 && voidInfo.boxes === 22,
    `${voidInfo.whites} white parts, ${voidInfo.boxes} tooth/claw boxes`);

  // --- ...and the catch pins its face to the lens
  await g(`(() => { g.monster.beginScare(g.camera, true); g.monster.stalker = false; })()`);
  const lunge0 = await g(`(() => {
    const v = g.monster.voidFig;
    return { voidScare: g.monster.scareFig === v, vis: v.visible, figOff: !g.monster.fig.visible,
             d: Math.hypot(v.position.x - g.camera.position.x, v.position.z - g.camera.position.z),
             dy: v.position.y - (g.camera.position.y - 2.45) };
  })()`);
  check('the void body takes the lens', lunge0.voidScare && lunge0.vis && lunge0.figOff);
  check('it starts 0.78m in front, face at eye level',
    Math.abs(lunge0.d - 0.78) < 0.12 && Math.abs(lunge0.dy) < 0.12,
    `d=${lunge0.d.toFixed(2)}m dy=${lunge0.dy.toFixed(2)}m`);
  await sleep(400);
  const lunge1 = await g(`(() => {
    const v = g.monster.voidFig;
    return Math.hypot(v.position.x - g.camera.position.x, v.position.z - g.camera.position.z);
  })()`);
  check('it keeps lunging closer', lunge1 < lunge0.d, `${lunge0.d.toFixed(2)}m -> ${lunge1.toFixed(2)}m`);

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' · '));
} catch (e) {
  check('script ran to completion', false, String(e));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
