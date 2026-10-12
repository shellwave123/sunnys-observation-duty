import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const PORT = 5195;
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
  // trigger the eating jumpscare mid-frame and capture it
  await page.evaluate(() => { window.__game.monster.beginScare(window.__game.camera); });
  await sleep(500);
  await page.screenshot({ path: 'test/shots/scare-eat.png' });
  const st = await page.evaluate(() => {
    const g = window.__game;
    const jaw = new g.THREE.Vector3();
    g.monster.r.jaw.getWorldPosition(jaw);
    return { scaring: g.monster.scaring, jawToCam: +jaw.distanceTo(g.camera.position).toFixed(2) };
  });
  console.log('scare:', JSON.stringify(st));
  await sleep(1200); // let it finish -> game over
  const end = await page.evaluate(() => window.__game.gameState.phase);
  console.log('end phase:', end);
  console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
  const ok = st.scaring && st.jawToCam < 0.6 && end === 'gameover' && errors.length === 0;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  await browser.close(); server.kill(); process.exit(ok ? 0 : 1);
} catch (e) { console.error('CRASH:', e.message); try { await browser?.close(); } catch {} server.kill(); process.exit(2); }
