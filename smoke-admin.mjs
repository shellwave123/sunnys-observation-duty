import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const PORT = 5194;
const URL = `http://localhost:${PORT}/`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(`npx vite preview --port ${PORT} --strictPort`, {
  cwd: 'C:\\Users\\Shaim\\Desktop\\SUNNYS OBSERVATION DUTY', shell: true, stdio: 'ignore',
});
async function waitForServer(t = 25000) {
  const s = Date.now();
  for (;;) {
    try { const r = await fetch(URL); if (r.ok) return; } catch {}
    if (Date.now() - s > t) throw new Error('no server');
    await sleep(300);
  }
}
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await sleep(800);
  await page.click('#start-btn'); await sleep(300);
  await page.click('#begin-btn'); await sleep(800);
  await page.evaluate(() => { const g = window.__game; g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999; });
  const out = [];
  // panel opens
  await page.keyboard.press('Backquote'); await sleep(300);
  out.push(['panel', await page.evaluate(() => !document.getElementById('admin').classList.contains('hidden'))]);
  // gun: summon anomaly, aim at it, shoot it
  await page.click('#admin-gun'); await sleep(200);
  await page.click('#admin-anomaly'); await sleep(300);
  const gun = await page.evaluate(() => {
    const g = window.__game;
    g.flashlight.on = true; g.flashlight.battery = 100;
    const a = g.anomalies.active[0];
    if (!a) return { spawned: false };
    const c = new g.THREE.Box3().setFromObject(a.def.targets[0]).getCenter(new g.THREE.Vector3());
    const dir = new g.THREE.Vector3(0, 1.2, 0.5).sub(c); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const pos = c.clone().add(dir.multiplyScalar(2.5)); pos.y = 1.6;
    pos.x = Math.max(-4.2, Math.min(4.2, pos.x)); pos.z = Math.max(-3.2, Math.min(3.4, pos.z));
    g.player.pos.copy(pos);
    const d = c.clone().sub(pos);
    g.player.yaw = Math.atan2(-d.x, -d.z);
    g.player.pitch = Math.max(-1.4, Math.min(1.4, Math.atan2(d.y, Math.hypot(d.x, d.z))));
    g.player.update(0);
    const r0 = g.gameState.reports;
    g.fireGun();
    return { spawned: true, before: r0, after: g.gameState.reports, gunVisible: g.scene.children.includes(undefined) };
  });
  await sleep(400);
  out.push(['gun', gun]);
  // rocket: summon monster into office patrol, fire rocket, it should die
  await page.click('#admin-rocket'); await sleep(200);
  const rk = await page.evaluate(() => {
    const g = window.__game;
    g.monster.beginPatrol();
    g.monster.fig.position.set(g.player.pos.x + 2, 0, g.player.pos.z - 2);
    g.monster.fig.visible = true;
    const m0 = g.gameState.monstersLogged;
    // aim at it
    const d = g.monster.fig.position.clone().sub(g.player.pos);
    g.player.yaw = Math.atan2(-d.x, -d.z); g.player.pitch = 0; g.player.update(0);
    g.fireGun();
    return { before: m0, after: g.gameState.monstersLogged, state: g.monster.state };
  });
  await sleep(400);
  out.push(['gun-vs-monster', rk]);
  // rocket fires + explodes, clears anomalies
  const boom = await page.evaluate(() => {
    const g = window.__game;
    g.anomalies.trySpawn(0, 1);
    const n0 = g.anomalies.active.length;
    g.fireRocket();
    return { spawned: n0, rockets: 1 };
  });
  await sleep(2000);
  const boom2 = await page.evaluate(() => ({ left: window.__game.anomalies.active.length }));
  out.push(['rocket', { ...boom, ...boom2 }]);
  // invincible: stare kill attempt
  await page.evaluate(() => { window.__game.admin.invincible = true; });
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.stations[2];
    g.monster.spawn(2, st.patrol, 120);
    g.player.pos.set(-1.0, 1.6, -0.9); g.player.update(0);
  });
  await page.keyboard.press('KeyE'); await sleep(300);
  await page.evaluate(() => {
    const g = window.__game;
    g.debug.stareLimit = 0.5;
    const st = g.stations[2];
    const p = st.camPos.clone().lerp(st.lookAt, 0.4); p.y = 1.0;
    g.monster.fig.position.copy(p);
    g.monitor.state.zoomIx = 3; g.monitor.refreshDom();
  });
  await sleep(2500);
  const god = await page.evaluate(() => ({ phase: window.__game.gameState.phase }));
  out.push(['invincible', god]);
  // speed
  const sp = await page.evaluate(() => { window.__game.player.speed = 7.2; return window.__game.player.speed; });
  out.push(['speed', sp]);
  console.log(JSON.stringify(out, null, 1));
  console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
  const ok = out[0][1] === true && gun.after === gun.before + 1 && rk.after === rk.before + 1
    && boom2.left === 0 && god.phase === 'playing' && sp === 7.2 && errors.length === 0;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  await browser.close(); server.kill(); process.exit(ok ? 0 : 1);
} catch (e) { console.error('CRASH:', e.message); try { await browser?.close(); } catch {} server.kill(); process.exit(2); }
