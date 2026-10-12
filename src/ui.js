import { gameState, shiftTimeLabel, nightBlurb } from './gameState.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['title-screen', 'nightcard-screen', 'gameover-screen', 'win-screen'];

export function showToast(msg, kind = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = ''; }, 1800);
}

export function updateHUD(battery, activeCount) {
  $('clock').textContent = '🕛 ' + shiftTimeLabel();
  $('night').textContent = `NIGHT ${gameState.night}`;
  $('battery-fill').style.width = `${battery}%`;
  $('battery-fill').style.background = battery > 40 ? '#7CFC00' : battery > 15 ? '#ffb300' : '#ff3b3b';
  $('reports').textContent = `LOGGED: ${gameState.reports}`;
  const m = $('monsters');
  if (m) m.textContent = `👁 SUBJECTS: ${gameState.monstersLogged}`;
  $('active-count').textContent = `ACTIVE: ${activeCount}`;
}

export function showScreen(name) {
  for (const s of SCREENS) {
    $(s).classList.toggle('hidden', s !== name);
  }
  $('hud').classList.toggle('hidden', name !== null);
}

export function hideScreens() {
  for (const s of SCREENS) $(s).classList.add('hidden');
  $('hud').classList.remove('hidden');
}

/** Fill in the "NIGHT X" title card and show it. */
export function showNightCard(night, bestNight, cfg) {
  $('nightcard-title').textContent = `🌙 NIGHT ${night}`;
  $('nightcard-blurb').textContent = nightBlurb(night);
  $('nightcard-detail').textContent =
    `Disturbance every ~${Math.round((cfg.spawnMin + cfg.spawnMax) / 2)}s · up to ${cfg.maxActive} at once` +
    (cfg.subtleChance > 0 ? ` · subtle changes likely` : ` · obvious changes only`);
  $('nightcard-best').textContent = `Highest night reached: ${bestNight}`;
  showScreen('nightcard-screen');
}
