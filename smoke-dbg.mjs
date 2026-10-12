import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const PORT = 5193;
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
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await sleep(800);
  await page.click('#start-btn'); await sleep(300);
  await page.click('#begin-btn'); await sleep(800);
  const d = await page.evaluate(() => {
    const g = window.__game;
    g.gameState.nextSpawnIn = 9999; g.gameState.nextMonsterIn = 9999;
    g.admin.gun = true;
    g.monster.beginPatrol();
    g.player.pos.set(0, 1.6, 2.0);
    g.monster.fig.position.set(0, 0, -1.0); // 3m dead ahead (-z)
    g.monster.fig.visible = true;
    const dx = 0 - 0, dz = -1.0 - 2.0;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = 0; g.player.update(0);
    // manual ray debug
    const rc = new g.THREE.Raycaster();
    rc.setFromCamera(new g.THREE.Vector2(0, 0), g.camera);
    rc.far = 40;
    const hits = rc.intersectObjects([g.monster.fig], true);
    const m0 = g.gameState.monstersLogged;
    g.fireGun();
    return { hits: hits.length, d0: hits[0] ? +hits[0].distance.toFixed(2) : -1,
      camY: +g.camera.position.y.toFixed(2), before: m0, after: g.gameState.monstersLogged,
      state: g.monster.state };
  });
  console.log(JSON.stringify(d));
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close(); server.kill(); process.exit(0);
} catch (e) { console.error('CRASH:', e.message); try { await browser?.close(); } catch {} server.kill(); process.exit(2); }
