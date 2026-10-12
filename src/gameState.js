export const GamePhase = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover', WIN: 'win', NIGHTCARD: 'nightcard' };
const BEST_KEY = 'sunnys-observation-duty-best-night';
export function loadBestNight() { try { const v = parseInt(localStorage.getItem(BEST_KEY), 10); return Number.isFinite(v) && v >= 1 ? v : 1; } catch { return 1; } }
export function saveBestNight(night) { try { const best = Math.max(loadBestNight(), night); localStorage.setItem(BEST_KEY, String(best)); } catch { } }
export function nightConfig(night) {
  const n = Math.max(1, night);
  const spawnBase = Math.max(10, 40 - (n - 1) * 6);
  return {
    night: n,
    spawnMin: spawnBase - 2,
    spawnMax: spawnBase + 4,
    firstSpawnIn: n === 1 ? 10 : 6,
    maxActive: n < 3 ? 1 : 2,
    subtleChance: n === 1 ? 0 : n === 2 ? 0.35 : 0.65,
    durationScale: Math.max(0.75, 1.4 - (n - 1) * 0.15),
    monsterFirstIn: n === 1 ? 26 : 16,
    monsterSpawnMin: Math.max(22, 62 - (n - 1) * 12),
    monsterSpawnMax: Math.max(28, 76 - (n - 1) * 12),
    monsterDwell: Math.max(13, 26 - (n - 1) * 4),
    eventMin: Math.max(30, 72 - (n - 1) * 10),
    eventMax: Math.max(48, 90 - (n - 1) * 10),
    stormMin: 25,
    stormMax: 55,
  };
}
export function nightBlurb(night) {
  if (night === 1) return 'Quiet night. Obvious disturbances, one at a time. It is already inside.';
  if (night === 2) return 'Things get stranger. Some changes are subtler. Do not watch it too long. The power may falter.';
  if (night === 3) return 'Two disturbances can strike at once now. It knows you watch the cameras.';
  return 'The room is restless. Subtle lies everywhere. Ten seconds of its stare is death.';
}
export const gameState = {
  phase: GamePhase.TITLE, night: 1, bestNight: loadBestNight(), shiftLength: 300,
  elapsed: 0, reports: 0, missed: 0, spawnTimer: 0, nextSpawnIn: 8, flashlightOn: true,
  monsterTimer: 0, nextMonsterIn: 26, monstersLogged: 0, huntsSurvived: 0, huntsFaced: 0,
  powerOut: false, powerFixed: false, powerEventTriggered: false,
  // Outage objective: every room behind the power room holds one fuse panel.
  // The main breaker only takes the wing circuits, so the whole route has to be
  // walked before the lights come back. Progress lives here, not on the refs,
  // so a restart always starts with dark rooms again.
  circuitsFixed: [], circuitProgress: 0, circuitTarget: 2.6, circuitFixing: false, activeCircuit: null,
  mp: false,
  p2: { x: 0, z: 1.5, yaw: 0, moving: false },
};
export function resetGame(night = 1) {
  const cfg = nightConfig(night);
  gameState.phase = GamePhase.PLAYING;
  gameState.night = cfg.night;
  gameState.elapsed = 0; gameState.reports = 0; gameState.missed = 0;
  gameState.spawnTimer = 0; gameState.nextSpawnIn = cfg.firstSpawnIn;
  gameState.monsterTimer = 0; gameState.nextMonsterIn = cfg.monsterFirstIn;
  gameState.monstersLogged = 0; gameState.huntsSurvived = 0; gameState.huntsFaced = 0;
  gameState.powerOut = false; gameState.powerFixed = false; gameState.powerEventTriggered = false;
  gameState.circuitsFixed = []; gameState.circuitProgress = 0; gameState.circuitFixing = false;
  gameState.circuitTarget = 2.6; gameState.activeCircuit = null;
}
export function shiftTimeLabel() {
  const t = Math.min(gameState.elapsed / gameState.shiftLength, 1);
  const totalMinutes = t * 6 * 60;
  const hour = Math.floor(totalMinutes / 60);
  const min = Math.floor(totalMinutes % 60);
  const displayHour = hour === 0 ? 12 : hour;
  return `${displayHour}:${String(min).padStart(2, '0')} AM`;
}
