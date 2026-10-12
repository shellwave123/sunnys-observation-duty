import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gameState, resetGame, GamePhase, nightConfig, saveBestNight } from './gameState.js';
import { createPlayer } from './player.js';
import { createFlashlight } from './flashlight.js';
import { buildRoom } from './room.js';
import { AnomalyManager, REPORT_RANGE } from './anomalies.js';
import { buildColliders, resolveCollisions } from './collisions.js';
import { createQuality } from './quality.js';
import { buildStations } from './rooms.js';
import { MonsterManager, MonsterState } from './monster.js';
import { createMonitor } from './monitor.js';
import { createHand } from './hand.js';
import { createScareDirector } from './scare.js';
import { showToast, updateHUD, showScreen, hideScreens, showNightCard } from './ui.js';
import { audio } from './audio.js';
import { isTouchDevice, createTouchControls } from './touch.js';
import { createViewer } from './viewer.js';
import { createVoiceChat } from './voice.js';

// Phones/tablets get on-screen controls and no pointer lock. Everything else
// keeps the mouse + keyboard path untouched.
const TOUCH = isTouchDevice();
let touch = null;

// --- Scene setup ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // cap for smooth framerate
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.bias = -0.0005;
renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic look (applied in OutputPass)
renderer.toneMappingExposure = 1.65;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.05); // moodier darkness, preserves camera clarity
// Low image-based ambient for PBR materials: wood, fabric, enamel, and brass
// get believable shape and sheen without adding more dynamic lights.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.25; // richer PBR sheen, keep CCTV punchy in feed render
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 60);

const refs = buildRoom(scene);
const colliders = buildColliders(refs);
// Storm light: lightning flashes through the window (normally dark).
const storm = new THREE.DirectionalLight(0xbfd4ff, 0);
storm.position.set(-8, 6, -10);
scene.add(storm);
storm.target.position.set(0, 1, 0);
scene.add(storm.target);
const player = createPlayer(camera, renderer.domElement, (pos) => resolveCollisions(pos, 0.35, colliders, refs));
const flashlight = createFlashlight(camera, scene);
const anomalies = new AnomalyManager(refs);
const stations = buildStations(scene, refs);
const monster = new MonsterManager(scene);
const monitor = createMonitor({ renderer, scene, stations, monster });
// First-person hand viewmodel: its own scene + camera, drawn after the world.
const hand = createHand();
const scare = createScareDirector({ refs, monster, storm });
const raycaster = new THREE.Raycaster();
raycaster.far = 20;

// Post-processing: subtle bloom so the lamp, screen, moon and eyes glow.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.65, 0.7, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Drops bloom/shadows/render-scale automatically if the GPU can't keep up.
const quality = createQuality({
  renderer, composer, bloomPass: bloom, scene, camera, shadowLight: flashlight.spot,
});
quality.apply();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  quality.resize();
});

/** Request pointer lock without unhandled promise rejections. */
function lockPointer() {
  if (TOUCH) return; // phones look around by dragging; the lock has no meaning there
  try {
    const r = renderer.domElement.requestPointerLock?.();
    r?.catch?.(() => {});
  } catch { /* pointer lock unavailable (e.g. headless) */ }
}

// --- Co-op voice chat (WebRTC; the invite codes are copied by hand) ---
// No signalling server exists, so the two players exchange the offer/answer
// through any chat app: one makes an INVITE, the other answers with JOIN, and
// the first pastes that reply into CONNECT. The mic is optional on each side.
const voice = createVoiceChat({ onState: renderVoice });
const voiceEl = document.getElementById('voice');
const voicePanel = document.getElementById('voice-panel');
const voiceCodeEl = document.getElementById('voice-code');
let voiceOpen = false;

const VOICE_LINK = { idle: 'not connected', waiting: 'waiting for your partner…', connecting: 'connecting…', live: 'LIVE', failed: 'failed' };
const VOICE_MIC = { off: 'off', requesting: 'asking…', on: 'on', denied: 'blocked', none: 'no mic' };

function renderVoice(s) {
  document.getElementById('voice-status').textContent =
    `MIC: ${VOICE_MIC[s.mic] || s.mic} · LINK: ${VOICE_LINK[s.link] || s.link}${s.error ? ` · ${s.error}` : ''}`;
  const micBtn = document.getElementById('voice-mic');
  micBtn.textContent = s.mic === 'on' ? 'MIC ON ✓' : s.mic === 'denied' ? 'RETRY MIC' : 'ALLOW MIC';
  micBtn.disabled = s.mic === 'on' || s.mic === 'requesting';
  document.getElementById('voice-mute').textContent = s.muted ? 'UNMUTE (M)' : 'MUTE (M)';
  document.getElementById('voice-dot').className = s.link === 'live' ? 'live' : s.link === 'failed' ? 'bad' : 'off';
}
renderVoice(voice.state);

/** Opening the panel drops the pointer lock so the cursor can click it; the
 *  pointerlockchange listener skips its auto-pause while the panel is up. */
function setVoicePanel(open) {
  if (voiceOpen === open) return;
  voiceOpen = open;
  voicePanel.classList.toggle('hidden', !open);
  if (open) {
    voice.nudge(); // a remote stream held back by autoplay can be retried now
    document.exitPointerLock?.();
  } else if (gameState.phase === GamePhase.PLAYING) {
    lockPointer();
  }
}

function toggleVoicePanel() { setVoicePanel(!voiceOpen); }

function syncVoiceVisibility() {
  voiceEl.classList.toggle('hidden', !gameState.mp || !voice.state.supported);
}

async function copyVoiceCode(msg) {
  try {
    await navigator.clipboard.writeText(voiceCodeEl.value);
    showToast(`${msg} (copied to the clipboard)`, 'info');
  } catch {
    voiceCodeEl.select();
    showToast(`${msg} — press Ctrl+C to copy it.`, 'info');
  }
}

document.getElementById('voice-btn').addEventListener('click', () => { voice.nudge(); toggleVoicePanel(); });
document.getElementById('voice-close').addEventListener('click', () => setVoicePanel(false));
document.getElementById('voice-mic').addEventListener('click', async () => {
  const ok = await voice.enableMic();
  showToast(ok ? 'Microphone on — you can talk.' : (voice.state.error || 'No microphone available.'), ok ? 'good' : 'warn');
});
document.getElementById('voice-mute').addEventListener('click', () => { voice.mute(); audio.click(); });
document.getElementById('voice-host').addEventListener('click', async () => {
  const code = await voice.createInvite();
  if (code) { voiceCodeEl.value = code; voiceCodeEl.select(); copyVoiceCode('Invite created — send it to your partner.'); }
});
document.getElementById('voice-join').addEventListener('click', async () => {
  const code = await voice.joinInvite(voiceCodeEl.value);
  if (code) { voiceCodeEl.value = code; voiceCodeEl.select(); copyVoiceCode('Reply created — send it back to them.'); }
});
document.getElementById('voice-connect').addEventListener('click', async () => {
  const ok = await voice.acceptReply(voiceCodeEl.value);
  showToast(ok ? 'Voice connecting…' : (voice.state.error || 'That reply code did not work.'), ok ? 'info' : 'bad');
});
document.getElementById('voice-copy').addEventListener('click', () => copyVoiceCode('Code copied.'));
voiceCodeEl.addEventListener('keydown', (e) => {
  e.stopPropagation(); // typing in the box must not fire game actions
  if (e.code === 'Escape') voiceCodeEl.blur();
});

/** The two level bars only tick while the panel is actually on screen. */
function updateVoiceMeters() {
  if (!voiceOpen || voiceEl.classList.contains('hidden')) return;
  document.getElementById('voice-meter-fill').style.width = `${Math.min(100, Math.round(voice.state.level * 160))}%`;
  document.getElementById('voice-remote-fill').style.width = `${Math.min(100, Math.round(voice.state.remote * 160))}%`;
}

// --- Input: flashlight + report ---
const REPORT_COOLDOWN = 1.5; // seconds between R presses
let reportCooldown = 0;

/**
 * Back out one level: monitor first, then the desk, then pause. Split out of
 * the key handler so the touch "STAND UP" button behaves identically.
 */
function doEscape() {
  if (deathT > 0) return; // the kill plays out
  if (admin.open) { toggleAdmin(false); return; } // the admin panel is an overlay
  if (voiceOpen) { setVoicePanel(false); return; } // the voice panel is an overlay
  if (monitor.open) { standUp(); return; }
  if (player.mode === 'hide') { unhide(); return; }
  if (gameState.phase === GamePhase.PLAYING) pauseGame();
  else if (gameState.phase === GamePhase.PAUSED) resumeGame();
}

/** Free-fly spectator camera. Ctrl+C toggles it mid-shift. */
function toggleFreeCam() {
  if (gameState.phase !== GamePhase.PLAYING || monster.scaring || deathT > 0) return;
  player.free = !player.free;
  player.keys = {};
  if (player.free) {
    if (monitor.open) standUp();
    if (player.mode === 'hide') unhide();
    player.mode = 'walk';
    showToast('🎥 FREE CAM — WASD fly · SPACE up · Q down · SHIFT fast · CTRL+C exit', 'info');
  } else {
    player.pos.y = 1.6;
    showToast('🎥 BACK ON FOOT', 'info');
  }
  audio.click();
}

// --- Admin panel (` toggles): gun, rocket, godmode, speed, summons ---
const admin = { open: false, gun: false, rocket: false, invincible: false, speed: false };
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.85 });
const gunGrip = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.8, metalness: 0.05 });
function bx(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.userData.adminIgnore = true; return m;
}
// Pistol viewmodel, floats in world space in front of the camera.
const gunRig = new THREE.Group();
gunRig.add(bx(0.07, 0.11, 0.24, gunMetal, 0, 0, 0));
gunRig.add(bx(0.05, 0.07, 0.1, gunMetal, 0, 0.045, -0.14));
gunRig.add(bx(0.06, 0.13, 0.07, gunGrip, 0, -0.1, 0.05));
gunRig.add(bx(0.02, 0.02, 0.02, new THREE.MeshBasicMaterial({ color: 0xffd75e }), 0, 0.075, -0.19));
gunRig.visible = false;
gunRig.traverse((o) => { o.userData.adminIgnore = true; });
scene.add(gunRig);
const gunTip = new THREE.Object3D(); gunTip.position.set(0, 0.045, -0.22); gunRig.add(gunTip);
// Rocket launcher viewmodel: fat tube over the shoulder line.
const launcherRig = new THREE.Group();
const tubeGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12);
const tube = new THREE.Mesh(tubeGeo, gunMetal);
tube.rotation.x = Math.PI / 2; tube.userData.adminIgnore = true; launcherRig.add(tube);
launcherRig.add(bx(0.06, 0.1, 0.12, gunGrip, 0, -0.1, 0.1));
const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 10),
  new THREE.MeshBasicMaterial({ color: 0xff4411 }));
warhead.rotation.x = -Math.PI / 2; warhead.position.z = -0.3; warhead.userData.adminIgnore = true;
launcherRig.add(warhead);
launcherRig.visible = false;
launcherRig.traverse((o) => { o.userData.adminIgnore = true; });
scene.add(launcherRig);
const muzzle = new THREE.PointLight(0xffcc66, 0, 7, 1.8);
scene.add(muzzle);
const boomLight = new THREE.PointLight(0xff7733, 0, 25, 1.6);
scene.add(boomLight);
let tracers = [];   // fading gun tracer lines
let rockets = [];   // live rocket projectiles

/** Keep the viewmodels glued in front of the lens. */
function updateGunRig() {
  const show = (admin.gun || admin.rocket) && gameState.phase === GamePhase.PLAYING && !monitor.open;
  gunRig.visible = show && admin.gun;
  launcherRig.visible = show && admin.rocket && !admin.gun;
  if (!show) return;
  const rig = admin.gun ? gunRig : launcherRig;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  rig.position.copy(camera.position).addScaledVector(fwd, 0.45).addScaledVector(right, 0.24).addScaledVector(up, -0.2);
  rig.quaternion.copy(camera.quaternion);
}

/** The monster (or glimpse, or stalker) is an admin bullet magnet. */
function adminKillMonster(cause) {
  const active = monster.present || monster.hunting || monster.patrolling
    || scare.glimpseActive || monster.stalker || monster.scaring;
  if (!active) return false;
  monster.report();
  stopHunt();
  resetStare();
  gameState.reports += 1;
  gameState.monstersLogged += 1;
  audio.shutter();
  showToast(`🔫 SUBJECT TERMINATED${cause ? ' — ' + cause : ''}`, 'good');
  return true;
}

function fireGun() {
  if (!admin.gun || gameState.phase !== GamePhase.PLAYING || monitor.open || monster.scaring || deathT > 0) return;
  audio.bang();
  hand.punch(0.8);
  const tip = new THREE.Vector3(); gunTip.getWorldPosition(tip);
  muzzle.position.copy(tip); muzzle.intensity = 9;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 40;
  const bodies = [monster.fig, monster.voidFig].filter((o) => o.visible);
  const mhit = raycaster.intersectObjects(bodies, true)[0];
  let end;
  if (mhit && mhit.distance <= 40) {
    end = mhit.point;
    if (!adminKillMonster('GUNSHOT')) showToast('🔫 HIT — BUT IT IS ALREADY DOWN', 'warn');
  } else {
    const res = anomalies.resolveAim(raycaster, scene);
    if (res.hit && res.isActive && res.instance && res.distance <= 40) {
      end = res.point;
      anomalies.fix(res.instance.def);
      gameState.reports += 1;
      audio.shutter();
      showToast(`🔫 ANOMALY DESTROYED: ${res.instance.def.label}`, 'good');
    } else {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      end = camera.position.clone().add(fwd.multiplyScalar(30));
      if (res.hit) showToast('🔫 OUT OF RANGE / NOT ACTIVE', 'warn');
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints([tip, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  line.userData.adminIgnore = true;
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

function fireRocket() {
  if (!admin.rocket || gameState.phase !== GamePhase.PLAYING || monitor.open || monster.scaring || deathT > 0) return;
  audio.bang();
  hand.punch(1.2);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6611 }));
  mesh.userData.adminIgnore = true;
  mesh.position.copy(camera.position).addScaledVector(fwd, 0.6);
  const glow = new THREE.PointLight(0xff6611, 3, 5, 1.8);
  mesh.add(glow);
  scene.add(mesh);
  rockets.push({ mesh, vel: fwd.multiplyScalar(20), life: 0 });
  showToast('🚀 ROCKET AWAY', 'warn');
}

function explodeRocket(p) {
  cameraFlash();
  audio.bang(); audio.thunder();
  boomLight.position.copy(p); boomLight.intensity = 60;
  const fl = document.getElementById('flash');
  const shake = document.getElementById('game');
  if (shake) {
    shake.style.transform = `translate(${(Math.random() - 0.5) * 30}px, ${(Math.random() - 0.5) * 30}px)`;
    setTimeout(() => { if (deathT <= 0) shake.style.transform = ''; }, 220);
  }
  let kills = 0;
  for (const inst of [...anomalies.active]) {
    const c = new THREE.Vector3();
    try {
      const t = inst.def.targets[0];
      new THREE.Box3().setFromObject(t).getCenter(c);
    } catch { continue; }
    if (c.distanceTo(p) <= 14) { anomalies.fix(inst.def); gameState.reports += 1; kills++; }
  }
  const mc = monster.fig.position;
  if (mc.distanceTo(p) <= 16) adminKillMonster('ROCKET');
  else if (monster.stalker && monster.voidFig.position.distanceTo(p) <= 16) adminKillMonster('ROCKET');
  audio.shutter();
  showToast(`🚀 DETONATION — ${kills} ANOMAL${kills === 1 ? 'Y' : 'IES'} CLEARED`, 'good');
}

/** Godmode: no death cinematic may keep you. */
function adminSurvive() {
  deathT = 0; caughtT = 0;
  if (monster.scaring) { monster.reset(); stopHunt(); }
  clearScareFx();
  resetStare();
  showToast('🔧 ADMIN: DEATH IGNORED', 'info');
}

function toggleAdmin(force) {
  admin.open = force !== undefined ? force : !admin.open;
  document.getElementById('admin').classList.toggle('hidden', !admin.open);
  if (admin.open) {
    document.exitPointerLock?.();
    audio.click();
    showToast('🔧 ADMIN — ` closes · G gun · T rocket', 'info');
  } else if (gameState.phase === GamePhase.PLAYING) {
    lockPointer();
  }
}
function syncAdminDom() {
  document.getElementById('admin-gun').innerHTML =
    `🔫 GUN: ${admin.gun ? 'ON' : 'OFF'} <span class="akey">G fires</span>`;
  document.getElementById('admin-rocket').innerHTML =
    `🚀 ROCKET: ${admin.rocket ? 'ON' : 'OFF'} <span class="akey">T fires</span>`;
  document.getElementById('admin-inv').checked = admin.invincible;
  document.getElementById('admin-speed').checked = admin.speed;
}
document.getElementById('admin-close').addEventListener('click', () => toggleAdmin(false));
document.getElementById('admin-gun').addEventListener('click', () => {
  admin.gun = !admin.gun; syncAdminDom(); audio.click();
  showToast(admin.gun ? '🔫 GUN SUMMONED — press G to fire' : '🔫 GUN DISMISSED', 'info');
});
document.getElementById('admin-rocket').addEventListener('click', () => {
  admin.rocket = !admin.rocket; syncAdminDom(); audio.click();
  showToast(admin.rocket ? '🚀 ROCKET LAUNCHER SUMMONED — press T to fire' : '🚀 LAUNCHER DISMISSED', 'info');
});
document.getElementById('admin-inv').addEventListener('change', (e) => {
  admin.invincible = e.target.checked; audio.click();
  showToast(admin.invincible ? '🔧 INVINCIBLE ON' : '🔧 INVINCIBLE OFF', 'info');
});
document.getElementById('admin-speed').addEventListener('change', (e) => {
  admin.speed = e.target.checked;
  player.speed = admin.speed ? 7.2 : 2.4;
  audio.click();
  showToast(admin.speed ? '🔧 SPEED ×3' : '🔧 SPEED NORMAL', 'info');
});
document.getElementById('admin-anomaly').addEventListener('click', () => {
  const inst = anomalies.trySpawn(0, 1);
  audio.click();
  showToast(inst ? `👁 ANOMALY SUMMONED: ${inst.def.label}` : '👁 NO ROOM — MAX ACTIVE REACHED', 'warn');
});
document.getElementById('admin-monster').addEventListener('click', () => {
  const roomIx = 1 + Math.floor(Math.random() * (stations.length - 1));
  monster.spawn(roomIx, stations[roomIx].patrol, 90);
  audio.click();
  showToast(`👹 MONSTER SUMMONED: ${stations[roomIx].camNo} ${stations[roomIx].name}`, 'bad');
});
document.getElementById('admin-hunt').addEventListener('click', () => {
  startHunt(); audio.click();
});
document.getElementById('admin-banish').addEventListener('click', () => {
  monster.reset(); stopHunt(); resetStare();
  if (monster.stalker) monster.hideStalker();
  for (const inst of [...anomalies.active]) anomalies.fix(inst.def);
  audio.click();
  showToast('🧹 ALL THREATS BANISHED', 'good');
});

/** The in-game action codes, shared by the keyboard and the touch buttons. */
function doAction(code) {
  if (gameState.phase !== GamePhase.PLAYING || monster.scaring || deathT > 0) return;
  if (player.free) return; // fly in peace: no reports, doors, or monitors
  if (code === 'KeyF') { flashlight.toggle(); hand.setTorch(flashlight.on); audio.click(); }
  if (code === 'KeyR') reportCurrent();
  if (code === 'KeyE') { if (nearDoor()) toggleDoor(); else toggleMonitor(); }
  if (code === 'KeyH') toggleHide();
  if (code === 'KeyV') { if (gameState.mp && voice.state.supported) toggleVoicePanel(); return; }
  if (code === 'KeyM') {
    voice.mute(); audio.click();
    showToast(voice.state.muted ? 'Voice muted.' : 'Voice unmuted — you are live.', 'info');
    return;
  }
  if (code === 'KeyN') { if (monitor.open) switchCam(() => monitor.next()); }
  if (code === 'KeyB') { if (monitor.open) switchCam(() => monitor.prev()); }
  if (code === 'Escape') { doEscape(); return; }
  if (/^Digit[1-8]$/.test(code) && monitor.open) {
    const ix = Number(code.slice(5)) - 1;
    switchCam(() => monitor.select(ix));
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    // The viewer is a fullscreen overlay, so Escape closes it first.
    if (viewer?.isOpen) { viewer.hide(); return; }
    doEscape();
    return;
  }
  // Ctrl+C = free camera (handled here: the browser also wants it for copy).
  if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!e.repeat) toggleFreeCam();
    return;
  }
  // Admin keys — never while typing a voice code.
  const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
  if (!typing && !e.repeat) {
    if (e.code === 'Backquote') { toggleAdmin(); return; }
    if (e.code === 'KeyG') { fireGun(); return; }
    if (e.code === 'KeyT') { fireRocket(); return; }
  }
  if (e.repeat) return; // a held key must not machine-gun the actions
  doAction(e.code);
});

// Zoom the CCTV feed with the wheel; pan the zoomed view with mouse drift.
window.addEventListener('wheel', (e) => {
  if (!monitor.open || gameState.phase !== GamePhase.PLAYING) return;
  e.preventDefault();
  if (e.deltaY > 0) monitor.zoomOut(); else monitor.zoomIn();
  audio.click();
}, { passive: false });
    document.addEventListener('mousemove', (e) => {
      if (gameState.phase !== GamePhase.PLAYING) return;
      if (monitor.open) {
        monitor.setPan(monitor.state.panX + e.movementX * 0.0016, monitor.state.panY - e.movementY * 0.0016);
        return;
      }
      if (player.mode === 'hide') {
        player.yaw -= e.movementX * 0.0022;
        player.pitch -= e.movementY * 0.0022;
        player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch));
        return;
      }
    });

// Esc while pointer-locked exits the lock (browser reserves Esc);
// auto-pause in that case. endGame() sets the phase first, so the
// lock exit on win/lose never opens the pause menu.
document.addEventListener('pointerlockchange', () => {
  // Only meaningful when we actually hold the lock. On touch nothing is ever
  // locked, and a failed request would otherwise pause the game instantly.
  if (TOUCH) return;
  // Deliberate: opening the voice panel drops the lock to hand back the cursor,
  // and that must not read as "player paused the game".
  if (voiceOpen) return;
  // Same for the admin panel: clicking its buttons needs the cursor.
  try { if (typeof admin !== 'undefined' && admin.open) return; } catch {}
  if (!document.pointerLockElement && !player.locked && gameState.phase === GamePhase.PLAYING) {
    pauseGame();
  }
});

function pauseGame() {
  if (gameState.phase !== GamePhase.PLAYING) return;
  gameState.phase = GamePhase.PAUSED;
  setVoicePanel(false); // phase is PAUSED, so closing it will not re-lock the mouse
  if (monitor.open) standUp();
  document.exitPointerLock?.();
  audio.suspend();
  document.getElementById('pause-night').textContent =
    `Night ${gameState.night} · ${gameState.reports} logged · 👁 ${gameState.monstersLogged} subjects`;
  document.getElementById('pause-screen').classList.remove('hidden');
}

function resumeGame() {
  if (gameState.phase !== GamePhase.PAUSED) return;
  audio.unlock(); audio.resume(); audio.click();
  gameState.phase = GamePhase.PLAYING;
  document.getElementById('pause-screen').classList.add('hidden');
  lockPointer();
  // A phone player may have swiped out of fullscreen to read this menu, so
  // re-request it on the way back in.
  enterImmersiveMode();
}

// --- Desk monitor + hiding ---
const DESK_SPOT = new THREE.Vector3(-1.2, 1.6, -2.2);
const HIDE_RADIUS = 2.6;
const distToDesk = () => Math.hypot(player.pos.x - DESK_SPOT.x, player.pos.z - DESK_SPOT.z);

function toggleMonitor() {
  if (monitor.open) { standUp(); return; }
  if (player.mode === 'hide') { unhide(); }
  if (distToDesk() > HIDE_RADIUS) {
    showToast('Get to the desk to use the monitor (E)', 'warn');
    audio.deny();
    return;
  }
  player.setMode('desk');
  hand.sync();
  monitor.open_();
  audio.click();
  audio.chairScrape();
  audio.startHum();
}

function standUp() {
  monitor.close();
  audio.stopHum();
  if (player.mode === 'desk') player.setMode('walk');
  // sometimes it is standing where you were sitting
  const t = gameState.elapsed;
  if (debugTuning.behindChance > 0 && monster.state === MonsterState.IDLE && !scare.glimpseActive
      && t - debugTuning.lastBehindScare > 45 && Math.random() < debugTuning.behindChance) {
    debugTuning.lastBehindScare = t;
    scare.glimpse(2.0, 2, false);
  }
}

/** Switching feeds: static burst, and a blast if the subject is there. */
function switchCam(fn) {
  fn();
  monitor.staticBurst(1.0);
  if (monster.present && monster.stationIndex === monitor.state.index) audio.staticBurst();
  else audio.camSwitch();
}

function distToBed() {
  const x = camera.position.x, z = camera.position.z;
  return Math.hypot(x - (-3.94), z - (-0.2));
}
const distToLocker = () => {
  // every locker in the building: the three in the power room plus the two
  // per room in the fuse wing (both lists are built by mkLocker in room.js).
  let best = 99;
  for (const p of refs.lockerPos) {
    const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (d < best) best = d;
  }
  return best;
};
function toggleHide() {
  const hideEl = document.getElementById('hiding');
  const setLabel = (html) => { if (hideEl) hideEl.innerHTML = html; };
  if (player.mode === 'hide') { unhide(); return; }
  if (monitor.open) monitor.close();
  if (player.mode === 'desk' || distToDesk() <= HIDE_RADIUS) {
    // POSES.hide is shared by every hide spot, so put the desk spot back —
    // otherwise hiding in a locker first would strand the desk dive over there.
    player.POSES.hide.pos.set(-1.2, 0.52, -2.02);
    player.setMode('hide');
    hideEl?.classList.remove('hidden');
    setLabel('▓ HIDING UNDER THE DESK — STAY STILL · <b>H</b> to come out ▓');
    hand.sync();
    audio.click();
    audio.chairScrape();
  } else if (distToBed() <= 1.9) {
    player.POSES.hide.pos.set(-3.94, 0.13, -0.2);
    player.setMode('hide');
    hideEl?.classList.remove('hidden');
    setLabel('▓ HIDING UNDER THE BED — STAY STILL · <b>H</b> to come out ▓');
    hand.sync();
    showToast('Hidden under the bed — stay quiet', 'info');
  } else if (distToLocker() <= 1.5) {
    // hiding inside a locker: crouch in place (any of the seventeen in the building)
    player.POSES.hide.pos.set(player.pos.x, 0.9, player.pos.z);
    player.setMode('hide');
    hideEl?.classList.remove('hidden');
    setLabel('▓ HIDDEN IN THE LOCKER — STAY QUIET · <b>H</b> to come out ▓');
    hand.sync();
    audio.click();
    showToast('Hidden in the locker — stay quiet', 'info');
  } else {
    showToast('Get back to hide: under desk, under bed, or in a locker (H)', 'warn');
    audio.deny();
  }
}

function unhide() {
  document.getElementById('hiding')?.classList.add('hidden');
  if (player.mode === 'hide') player.setMode('walk');
}

// --- The office door ---
// E is the monitor when you're at the desk; at the doorway it opens the door
// instead. The hint bar says both, so the key is never a surprise. Looking at
// the door is required, so you cannot toggle it from across the room.
const DOOR_RANGE = 2.2;
const doorIsOpen = () => Math.abs(refs.doorPivot.rotation.y) > 0.5;
const distToDoor = () => Math.hypot(player.pos.x - 3.6, player.pos.z + 3.95);
/** True when the player is close to the doorway AND facing it. */
function nearDoor() {
  if (player.mode !== 'walk' || distToDoor() > DOOR_RANGE) return false;
  // yaw 0 looks toward -z, so the door (at -3.95) is dead ahead from inside.
  const dx = 3.6 - player.pos.x;
  const dz = -3.95 - player.pos.z;
  const fwdX = -Math.sin(player.yaw);
  const fwdZ = -Math.cos(player.yaw);
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * fwdX + (dz / len) * fwdZ > 0.35; // roughly 70 deg cone
}

function toggleDoor() {
  if (doorIsOpen()) {
    refs.doorPivot.rotation.y = 0;
    audio.click();
    showToast('You pull the door shut.', 'info');
  } else {
    refs.doorPivot.rotation.y = -1.15;
    audio.doorCreak();
    showToast('The door is open — the hallway is dark.', 'info');
  }
}

function aimRay() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  return raycaster;
}

/** R dispatches to the feed when seated, the room otherwise. */
function reportCurrent() {
  if (monitor.open) reportSubject();
  else reportAnomaly();
}

/** Report the stick-figure subject on the selected camera feed. */
function reportSubject() {
  if (reportCooldown > 0) {
    showToast(`⏳ SCANNER RECHARGING (${reportCooldown.toFixed(1)}s)`, 'warn');
    return;
  }
  reportCooldown = REPORT_COOLDOWN;
  audio.click();
  hand.punch(0.6);
  cameraFlash();
  const res = monitor.inspect();
  if (res.visible) {
    const st = monitor.station;
    monster.report();
    resetStare();
    gameState.reports += 1;
    gameState.monstersLogged += 1;
    hand.punch(1.0);
    audio.shutter();
    audio.chime();
    showToast(`✅ SUBJECT LOGGED: ${st.camNo} ${st.name}`, 'good');
    monitor.refreshDom();
  } else {
    const why = {
      empty: 'no subject on this feed',
      offscreen: 'nothing in view — switch cam / move the mouse',
      blocked: 'the subject is obstructed',
      toosmall: 'too small to identify — ZOOM IN (wheel)',
    }[res.reason] ?? 'no subject';
    falseReport(`❌ FALSE REPORT — ${why}`);
  }
}

/** Brief white camera-flash overlay on every report press. */
function cameraFlash() {
  const el = document.getElementById('flash');
  if (!el) return;
  el.classList.remove('go');
  void el.offsetWidth; // restart CSS animation
  el.classList.add('go');
}

function falseReport(msg) {
  audio.buzz();
  hand.punch(0.45); // a half-hearted jab
  showToast(msg, 'bad');
  // No strikes anymore — false reports only cost you time. The subject is
  // the only thing that can end your shift.
}

function reportAnomaly() {
  if (gameState.phase !== GamePhase.PLAYING) return;
  if (reportCooldown > 0) {
    showToast(`⏳ SCANNER RECHARGING (${reportCooldown.toFixed(1)}s)`, 'warn');
    return;
  }
  reportCooldown = REPORT_COOLDOWN;

  // Click + flash on EVERY report press (valid or not).
  audio.click();
  hand.punch(1.0); // you physically slam the report button
  cameraFlash();

  // 1. Cast a ray from the center of the screen.
  const result = anomalies.resolveAim(aimRay(), scene);

  // 2. Must hit something.
  if (!result.hit) {
    falseReport('❌ FALSE REPORT — nothing there');
    return;
  }

  // 3. Must be within range.
  if (result.distance > REPORT_RANGE) {
    falseReport(`❌ FALSE REPORT — target too far (${result.distance.toFixed(1)}m > ${REPORT_RANGE}m)`);
    return;
  }

  // 3b. You can only log what is in the room you are standing in, otherwise
  // the ray reaches down the hallway through the open door.
  const myZone = zoneOf(camera.position);
  const hitZone = zoneOf(result.point);
  if (hitZone !== myZone) {
    falseReport(`❌ FALSE REPORT — that is in the ${hitZone}, not this room`);
    return;
  }

  // 4. Must be lit by the flashlight beam.
  if (!flashlight.isPointLit(result.point)) {
    falseReport('❌ FALSE REPORT — target is in darkness (shine the 🔦 beam on it)');
    return;
  }

  // 4b. A glimpse: the subject flickered INTO the office with you.
  if (result.anomalyType === 'monster' && scare.glimpseActive) {
    scare.resolveGlimpse();
    resetStare();
    gameState.reports += 1;
    gameState.monstersLogged += 1;
    audio.shutter();
    audio.chime();
    showToast('✅ SUBJECT LOGGED — IT WAS IN THE ROOM', 'good');
    return;
  }

  // 4c. The subject itself, inside the office with you: drive it off.
  if (result.anomalyType === 'monster' && (monster.hunting || monster.patrolling)) {
    monster.report(); // scream + vanish
    stopHunt();
    resetStare();
    gameState.reports += 1;
    gameState.monstersLogged += 1;
    audio.shutter();
    audio.chime();
    showToast('✅ SUBJECT DRIVEN OFF — THE DOOR SLAMS', 'good');
    return;
  }
  // 5. Hit object must be a currently-active anomaly.
  if (result.isActive && result.instance) {
    anomalies.fix(result.instance.def);
    gameState.reports += 1;
    audio.shutter();
    audio.chime();
    showToast(`✅ ANOMALY LOGGED: ${result.instance.def.label}`, 'good');
  } else {
    falseReport('❌ FALSE REPORT');
  }
}

// --- The stare: watch a live subject too long and it watches back ---
const debugTuning = { stareLimit: 6, behindChance: 0.4, lastBehindScare: -999 }; // seconds of locked eyes before it kills (tests shrink this)
let stareT = 0;   // builds while a live subject is reportable on your feed
let deathT = 0;   // >0 while the stare-kill cinematic plays
let deathPhase = ''; // 'freeze' | 'burst' | 'settle'
let caughtT = 0;     // >0 while the caught jumpscare lunge is on screen
let heartT = 0;   // heartbeat timer
let warnedStare = false;

// The scare is a three-beat sequence: a held-breath freeze, a violent burst,
// then a decaying settle. Total ~1.55s.
const DEATH_FREEZE = 0.26;
const DEATH_BURST = 0.82;
const DEATH_SETTLE = 0.47;
const DEATH_TOTAL = DEATH_FREEZE + DEATH_BURST + DEATH_SETTLE;

function updateStare(dt) {
  if (deathT > 0) return; // the kill cinematic owns the frame
  // The stare only applies to a subject you can actually see on a feed: while
  // it is inside the office with you there is no feed to stare into.
  const onFeed = monitor.open && monster.present && monster.stationIndex === monitor.state.index;
  if (onFeed && deathT <= 0) {
    const res = monitor.inspect();
    if (res.visible) {
      stareT += dt;
      const dread = Math.min(1, stareT / debugTuning.stareLimit);
      monster.faceCam = monitor.station.camera;
      monster.setDread(dread);
      monitor.setDread(dread);
      // heartbeat quickens as it locks on
      heartT -= dt;
      if (heartT <= 0) {
        audio.heartbeat(0.2 + dread * 0.3);
        heartT = 1.1 - dread * 0.75;
      }
      if (dread > 0.45) {
        document.getElementById('stare-warn')?.classList.remove('hidden');
        if (!warnedStare) {
          warnedStare = true;
          audio.riser();
          hand.flinch(1); // your hands come up when it locks eyes
          showToast('👁 IT SEES YOU — REPORT IT (R) OR LOOK AWAY', 'bad');
        }
      }
      if (stareT >= debugTuning.stareLimit) startStareKill();
      return;
    }
  }
  // not looking at it: the lock loosens
  stareT = Math.max(0, stareT - dt * 0.6);
  monster.faceCam = null;
  if (stareT === 0) {
    monster.setDread(0);
    monitor.setDread(0);
    warnedStare = false;
    document.getElementById('stare-warn')?.classList.add('hidden');
  } else {
    const dread = Math.min(1, stareT / debugTuning.stareLimit);
    monster.setDread(dread);
    monitor.setDread(dread);
  }
}

function startStareKill() {
  if (admin.invincible) { resetStare(); showToast('🔧 ADMIN: STARE IGNORED', 'info'); return; }
  deathT = DEATH_TOTAL;
  deathPhase = 'freeze';
  monitor.state.zoomIx = monitor.ZOOMS.length - 1;
  // The freeze is quiet and wrong: a stab, then a rising drone under it.
  audio.sting();
  audio.riser();
  audio.heartbeat(0.5);
}

/** Wipe every effect the scare layers on, so a retry starts clean. */
function clearScareFx() {
  deathPhase = '';
  caughtT = 0;
  const flashEl = document.getElementById('flash');
  if (flashEl) flashEl.style.opacity = '0';
  canvas.style.transform = '';
  canvas.style.filter = '';
}

function resetStare() {
  stareT = 0; deathT = 0; heartT = 0; warnedStare = false;
  clearScareFx();
  monster.faceCam = null;
  monster.setDread(0);
  monitor.setDread(0);
  canvas.style.transform = '';
  document.getElementById('stare-warn')?.classList.add('hidden');
}

/** The real wing feeds are lit by the room panels, so the panels get a gentle
 *  breath each — the cameras keep a little life instead of freeze-frames. */
function flickerLights() {
  for (const p of (refs.panels || [])) {
    if (p.light && p.light.visible) {
      p.light.intensity = 7 * (0.97 + Math.sin(performance.now() / 1500 + (p.pos ? p.pos.x : 0)) * 0.03);
    }
  }
}
const DOOR_SPOT = new THREE.Vector3(3.6, 0, -4.6);
/** Circuit panels: six in the fuse wing, then the main breaker behind them. */
const wingPanels = () => (refs.panels || []).filter((p) => !p.main);
const wingDone = () => wingPanels().every((p) => gameState.circuitsFixed.includes(p.id));
const nearestPanel = (range = 1.6) => {
  let best = null, bestD = range;
  for (const p of refs.panels || []) {
    const d = Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
    if (d <= bestD) { bestD = d; best = p; }
  }
  return best;
};
/** The main breaker only accepts a hand once every wing circuit is back. */
const panelReady = (p) => !!p && (!p.main || wingDone());
const setPanelPower = (p, on) => {
  if (p.lamp) p.lamp.material.color.setHex(on ? 0x33ff66 : 0xff2222);
  if (p.light) { p.light.visible = !!on; p.light.intensity = on ? 7 : 0; }
};
/** Which zone a Z sits in: 0 = power room, 1..6 = the wing rooms, 7 = electrical. */
function wingZone(z) {
  if (z >= -14) return 0;
  if (z >= -20) return 1;
  if (z >= -25) return 2;
  if (z >= -30) return 3;
  if (z >= -35) return 4;
  if (z >= -40) return 5;  // archive room
  if (z >= -45) return 6;  // pump room
  return 7;                // electrical room / power supply
}
/** The power supply: the electrical room at the very end of the wing. */
const POWER_SUPPLY_Z = -44.5;
const atPowerSupply = (pos) => pos.z < POWER_SUPPLY_Z;
/**
 * First hop toward a destination that may be in another room. Chained rooms
 * have no straight line between them, so the stalker has to be walked to a
 * doorway one divider at a time — exactly the route the player walks.
 * Returns null when the destination is already in the same room.
 */
function wingStep(fromZ, toZ) {
  const a = wingZone(fromZ), b = wingZone(toZ);
  if (a === b) return null;
  const i = a > b ? a - 1 : a;          // divider between this room and the next
  const door = (refs.wingDoors || [])[i] || { x: 3.6, z: -14 };
  return { x: door.x, z: door.z + (a > b ? 1.4 : -1.4) }; // one metre past the gap
}
/** Snap a room's circuit back: light on, lamp green, toast says what's next. */
function completeCircuit(p) {
  gameState.circuitsFixed.push(p.id);
  gameState.circuitProgress = 0;
  gameState.circuitFixing = false;
  gameState.activeCircuit = null;
  setPanelPower(p, true);
  try { audio.powerUp(); } catch (e) {}
  if (p.main) {
    gameState.powerFixed = true;
    gameState.powerOut = false;
    if (refs.annexLight) refs.annexLight.intensity = 3.0;
    scare.restoreLamp();
    audio.setBreath(0);
    if (monster.stalker) { monster.hideStalker(); stalkWay = null; }
    stalkHunt = false;
    showToast('POWER RESTORED — every circuit is back. Get to the office.', 'good');
    return;
  }
  const fixed = gameState.circuitsFixed.filter((id) => id !== 'main').length;
  const next = (refs.panels || []).find((q) => !gameState.circuitsFixed.includes(q.id));
  showToast(`CIRCUIT RESTORED — ${p.name} (${fixed}/${wingPanels().length}) — next: ${next ? next.name : 'MAIN BREAKER'}`, 'good');
}
/** Which connected space a point sits in: office / corridor / power room. */
function zoneOf(p) {
  if (p.z > -4.2) return 'office';
  if (p.z > -9.2) return 'corridor';
  return 'power';
}
let breathStop = null;
let stalkerGrace = 0; // seconds of safety after entering the power room
let stalkSpawned = false; // the stalker emerges once per power cut
let stalkWay = null; // fenced current doorway the stalker is walking to
let stalkHunt = false; // true once you reach the power supply: it stops circling and hunts
let huntBangT = 0; // door impacts while it creeps in
let rainSurge = 0; // storm rain hammers the windows, then settles

function startHunt() {
  monster.beginHunt(DOOR_SPOT);
  gameState.huntsFaced += 1;
  hand.flinch(1);
  hand.setClench(1); // you grab the desk edge
  if (monitor.open) standUp(); // yanked out of the chair
  audio.doorCreak();
  breathStop = audio.startBreath();
  monitor.staticBurst(1.2); // every feed dies as it leaves the rooms
  showToast('⚠️ SOMETHING IS OPENING THE DOOR', 'bad');
  document.getElementById('door-warn')?.classList.remove('hidden');
  // red alert: the room itself bleeds, and your beam starts to fail
  if (!anomalies.active.some((a) => a.def.tag === 'lamp-flicker')) {
    refs.lampLight.color.setHex(0xff2a1a);
    refs.bulb.material.color.setHex(0xff2a1a);
  }
  flashlight.fear = 1;
  huntBangT = 0.8; // first impact a second after the creak
}

/** It's in. Start the patrol loop rather than an instant jumpscare. */
function resolveHunt() {
  document.getElementById('door-warn')?.classList.add('hidden');
  refs.doorPivot.rotation.y = 0; // the door shuts behind it: you are in the room with it
  huntBangT = 0;
  monster.beginPatrol();
  monster.fig.position.set(3.6, 0, -2.2);
  flashlight.fear = 1;
  showToast('🚪 IT IS INSIDE — HIDE (H) OR STAY STILL', 'bad');
}

/** Caught mid-patrol: the same lens rush as before. */
function caughtInside() {
  if (admin.invincible) {
    monster.reset(); stopHunt(); resetStare();
    showToast('🔧 ADMIN: CAUGHT — IGNORED', 'info');
    return;
  }
  monster.beginScare(camera);
  audio.scream();
  audio.bang();
  audio.heartbeat(0.8);
  const fl = document.getElementById('flash');
  if (fl) fl.style.opacity = '0.9';
  caughtT = 0.0001;
}

/** It gave up and left. */
function onMonsterLeft() {
  stopHunt();
  gameState.huntsSurvived += 1;
  audio.slam();
  audio.setBreath(0);
  showToast('🚪 IT LEFT. YOU SURVIVED.', 'good');
}

function stopHunt() {
  monster.reset();
  refs.doorPivot.rotation.y = 0;
  hand.setClench(0); // you let go of the desk
  document.getElementById('door-warn')?.classList.add('hidden');
  if (breathStop) { breathStop(); breathStop = null; }
  audio.setBreath(0);
  flashlight.fear = 0;
  // restore warm lamplight unless a blackout is running (it owns the lamp)
  if (!scare.lightsOutActive && !anomalies.active.some((a) => a.def.tag === 'lamp-flicker')) {
    refs.lampLight.intensity = 5.5;
    refs.lampLight.color.setHex(0xffd9a0);
    refs.bulb.material.color.setHex(0xffe9a8);
  }
}

/** Full lamp reset for shift starts / game over. */
function resetOfficeLights() {
  flashlight.fear = 0;
  refs.lampLight.intensity = 5.5;
  refs.lampLight.color.setHex(0xffd9a0);
  refs.bulb.material.color.setHex(0xffe9a8);
}

const monsterHooks = {
  onHuntStart: () => startHunt(),
  onHuntResolve: () => resolveHunt(),
  onHuntWarning: () => {
    audio.knock();
    audio.approach();
    showToast('🚪 SOMETHING IS RATTLING THE DOOR…', 'bad');
  },
  onCaught: () => endGame(false, 'It found you. Never turn your back on the door.'),
  // Patrol hooks: it is walking the office with you now.
  onSpotted: () => {
    flashlight.fear = 1;
    hand.flinch(1);
    showToast('👁 IT SAW YOU — RUN OR HIDE (H)', 'bad');
  },
  onCaughtInside: () => caughtInside(),
  onLostYou: () => {
    flashlight.fear = 1;
    showToast('…it stops. It cannot see you. Do not move.', 'warn');
  },
  onPatrolEnd: () => {
    monster.state = MonsterState.LEAVING;
    monster.leaveT = 6;
    monster.walkSpeed = 1.5;
    audio.setBreath(0);
    showToast('…it is heading for the door. Hold still.', 'warn');
  },
  onLeft: () => onMonsterLeft(),
  patrolCtx: null, // refreshed each frame in loop()
};

// --- Start / restart / night flow ---
let pendingNight = 1;

function showCard(night) {
  pendingNight = night;
  audio.unlock(); audio.click();
  showNightCard(night, gameState.bestNight, nightConfig(night));
}

document.getElementById('start-btn').addEventListener('click', () => { gameState.mp = false; showCard(1); });
document.getElementById('start-mp-btn')?.addEventListener('click', () => { gameState.mp = true; showCard(1); });
document.getElementById('begin-btn').addEventListener('click', () => startShift(pendingNight));
document.getElementById('retry-btn').addEventListener('click', () => startShift(gameState.night));
document.getElementById('again-btn').addEventListener('click', () => showCard(gameState.night + 1));
document.getElementById('resume-btn').addEventListener('click', () => resumeGame());
document.getElementById('restart-btn').addEventListener('click', () => startShift(gameState.night));

// Model viewer, reachable from the title screen and the pause menu. It takes
// over the screen, so the game loop is frozen while it is open.
const viewer = createViewer();
document.getElementById('viewer-btn')?.addEventListener('click', () => {
  audio.unlock();
  viewer.show();
});
document.getElementById('viewer-btn-pause')?.addEventListener('click', () => {
  if (gameState.phase === GamePhase.PLAYING) pauseGame();
  audio.unlock();
  viewer.show();
});
document.getElementById('viewer-tip').textContent = isTouchDevice()
  ? 'Drag to rotate · pinch to zoom'
  : 'Drag to rotate · scroll to zoom';

/** Phones: try to go fullscreen and hold landscape once a shift starts.
 *  iOS Safari has no orientation lock and no fullscreen on most builds, so every
 *  step here is allowed to fail silently. Must run inside the click handler
 *  (iOS ignores fullscreen requests that aren't user-initiated). */
/** Keeps the screen awake during a shift. Without it the phone dims and then
 *  locks mid-night, which on a browser game looks like a freeze. Re-acquired
 *  on every return to the tab, since the old one is dropped when hidden. */
let wakeLock = null;
async function acquireWakeLock() {
  if (!isTouchDevice() || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function enterImmersiveMode() {
  if (!isTouchDevice()) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
    try { const p = req.call(el); if (p?.catch) p.catch(() => {}); } catch {}
  }
  // Locking is a separate API and is the part that throws "not supported" on
  // iOS, so it never touches the fullscreen promise.
  try {
    screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  } catch {}
  acquireWakeLock();
}

function startShift(night) {
  audio.unlock(); audio.click();
  audio.resume();
  audio.startAmbience();
  enterImmersiveMode();
  anomalies.reset();
  resetGame(night);
  // The cameras watch the real wing rooms, so the whole wing starts lit like
  // any normal shift — the outage mid-night kills those circuits and turns
  // every feed dark at once. resetGame clears outage state, so a retry never
  // inherits half-restored rooms.
  for (const p of refs.panels || []) setPanelPower(p, true);
  saveBestNight(night);
  gameState.bestNight = Math.max(gameState.bestNight, night);
  reportCooldown = 0;
  player.reset();
  hand.sync();
  hand.setTremor(0);
  hand.setClench(0);
  hand.setVisible(true);
  hand.setTorch(flashlight.on);
  flashlight.on = true; flashlight.battery = 100;
  // monster / monitor layer reset
  monster.reset();
  monster.stalker = false;
  stalkHunt = false;
  stalkWay = null;
  refs.doorPivot.rotation.y = 0;
  if (player.POSES && player.POSES.hide) player.POSES.hide.pos.set(-1.2, 0.52, -2.02);
  monitor.close();
  stopHunt();
  scare.reset();
  resetOfficeLights();
  resetStare();
  unhide();
  voiceOpen = false; // a stale panel from the previous run must not carry over
  voicePanel.classList.add('hidden');
  syncVoiceVisibility();
  document.getElementById('pause-screen').classList.add('hidden');
  hideScreens();
  showToast(`Night ${night} started. Watch the room and the cameras. (E = monitor / door)`, 'info');
  runIntro();
  // pointer lock for FPS feel
  lockPointer();
}

// --- Intro: click to advance, right-click to skip ---
const INTRO_LINES = [
  'YOU WOKE UP', 'YOU HEARD A SOUND', 'OF THINGS MOVING', 'YOU TRIED TO SLEEP',
  'YOU CAN\'T', 'BUT', 'YOUR HOME', 'ALONE', 'TRY TO INVESTIGATE', 'WHAT IS HAPPENING',
];
const INTRO_LINE_MS = 1000;  // how long one line takes to fully type in
const INTRO_COOLDOWN = 150;  // ms guard so a double click can't skip two lines

/**
 * One-shot intro overlay. Left click finishes the typing line, or advances
 * when that line is already done; right click skips the lot. Teardown stops
 * the timers, drops the audio, removes the text, and detaches every listener
 * so none of it can touch the running game.
 */
function runIntro() {
  const intro = document.createElement('div');
  intro.className = 'intro-screen';
  intro.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;color:#fff;background:#000;z-index:40;font-size:clamp(10px,1.8vw,16px);letter-spacing:3px;text-transform:uppercase;pointer-events:none;';
  const stack = document.createElement('div');
  stack.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
  const els = INTRO_LINES.map((text) => {
    const el = document.createElement('div');
    el.className = 'intro-line';
    el.textContent = text;
    el.style.cssText = 'opacity:0;transform:translateY(10px);transition:opacity 1.2s ease,transform 1.2s ease;';
    stack.appendChild(el);
    return el;
  });
  const hint = document.createElement('div');
  hint.textContent = 'Left click: next line | Right click: skip intro';
  hint.style.cssText = 'position:absolute;bottom:6%;font-size:clamp(9px,1.1vw,12px);letter-spacing:2px;opacity:.6;';
  intro.appendChild(stack);
  intro.appendChild(hint);
  document.body.appendChild(intro);

  let idx = 0;          // index of the line being typed
  let typing = false;   // is that line still fading/typing in?
  let lastSkip = -1e9;
  let closed = false;
  const timers = [];

  const showLine = (i) => {
    if (i >= els.length) return;
    els[i].style.opacity = '1';
    els[i].style.transform = 'translateY(0)';
  };
  /** Jump the current line to its finished state immediately. */
  const finishTyping = () => {
    const el = els[idx];
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    typing = false;
  };

  /** Reveal line idx and start its typing window. */
  const beginLine = (i) => {
    idx = i;
    showLine(i);
    typing = true;
    timers.push(setTimeout(() => { typing = false; }, INTRO_LINE_MS));
  };
  /** Move on: finish the line if it is still typing, else open the next. */
  const advance = () => {
    if (idx >= els.length) { teardown(); return; }
    if (typing) { finishTyping(); return; }
    if (idx + 1 >= els.length) {
      idx = els.length;
      timers.push(setTimeout(teardown, 1600));
      return;
    }
    beginLine(idx + 1);
  };

  function teardown() {
    if (closed) return;
    closed = true;
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    audio.setBreath(0);
    audio.stopHum?.();
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('touchstart', onTouchStart, true);
    window.removeEventListener('touchend', onTouchEnd, true);
    window.removeEventListener('touchcancel', onTouchEnd, true);
    window.removeEventListener('contextmenu', onMenu, true);
    intro.style.transition = 'opacity .7s ease';
    intro.style.opacity = '0';
    const done = () => intro.remove();
    setTimeout(done, 750);
  }

  /** Rate-limit taps so one impatient double-tap can't eat two lines. */
  function tap() {
    const now = performance.now();
    if (now - lastSkip < INTRO_COOLDOWN) return false;
    lastSkip = now;
    return true;
  }

  function onDown(e) {
    if (closed) return;
    if (e.button === 2) { e.preventDefault(); teardown(); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (!tap()) return;
    advance(); // finishes the typing line, or opens the next one
  }

  /**
   * Phones have no right button, so a tap does what left click does and a
   * long press skips. preventDefault here also suppresses the compatibility
   * mousedown, so one tap cannot advance twice.
   */
  let pressAt = 0;
  function onTouchStart(e) {
    if (closed) return;
    if (e.touches.length > 1) { e.preventDefault(); teardown(); return; }
    pressAt = performance.now();
    e.preventDefault();
    if (!tap()) return;
    advance();
  }
  function onTouchEnd(e) {
    if (closed) return;
    // Only a press that outstayed its welcome counts as the skip gesture.
    if (pressAt && performance.now() - pressAt > 450) { e.preventDefault(); teardown(); }
    pressAt = 0;
  }

  // Swallow the browser menu while the intro is up.
  function onMenu(e) { e.preventDefault(); }

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  window.addEventListener('touchend', onTouchEnd, true);
  window.addEventListener('touchcancel', onTouchEnd, true);
  window.addEventListener('contextmenu', onMenu, true);
  timers.push(setTimeout(() => beginLine(0), 300));
}

function endGame(won, reason = null) {
  if (!won && admin.invincible) { adminSurvive(); return; }
  audio.stopAmbience();
  resetStare();
  scare.reset();
  resetOfficeLights();
  if (breathStop) { breathStop(); breathStop = null; }
  audio.setBreath(0);
  if (monitor.open) monitor.close();
  unhide();
  document.getElementById('pause-screen').classList.add('hidden');
  if (won) {
    gameState.phase = GamePhase.WIN;
    document.getElementById('win-night').textContent =
      `6:00 AM. Sunny survived Night ${gameState.night}.`;
    document.getElementById('win-stats').textContent =
      `Anomalies logged: ${gameState.reports} · Subjects logged: ${gameState.monstersLogged} · Hunts survived: ${gameState.huntsSurvived} · Missed: ${gameState.missed} · Best: Night ${gameState.bestNight}`;
    showScreen('win-screen');
    audio.win();
  } else {
    gameState.phase = GamePhase.GAMEOVER;
    document.getElementById('lose-stats').textContent =
      `Night ${gameState.night} · Anomalies logged: ${gameState.reports} · Subjects logged: ${gameState.monstersLogged} · Missed: ${gameState.missed} · Time: ${(gameState.elapsed | 0)}s`;
    document.getElementById('lose-reason').textContent =
      reason ?? 'The anomalies got you…';
    showScreen('gameover-screen');
    audio.lose();
  }
  document.exitPointerLock?.();
}

// --- Main loop ---
const clock = new THREE.Clock();
let tickAcc = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  // The viewer draws the model fullscreen; the game frame underneath is wasted
  // work and, worse, would keep game timers running behind the overlay.
  if (viewer?.isOpen) return;

  if (gameState.phase === GamePhase.PAUSED) {
    // Frozen frame behind the pause menu; timers and input stay put.
    quality.render();
    return;
  }

  if (gameState.phase === GamePhase.PLAYING) {
    gameState.elapsed += dt;
    player.update(dt, { refs });
    flashlight.update(dt);
    hand.update({
      dt,
      yaw: player.yaw,
      pitch: player.pitch,
      walking: player.speedNow > 0.15,
      mode: player.mode,
      fear: flashlight.fear,
      dread: Math.max(monitor.dread, monster.dread),
      hunt: monster.hunting || monster.patrolling || stalkHunt,
      dead: deathT > 0,
      torchUp: flashlight.on && player.mode === 'walk',
    });
    hand.setTremor(
      (deathT > 0 ? 1 : 0) * 0.9
      + ((monster.hunting || monster.patrolling || stalkHunt) ? 0.45 : 0)
      + (monitor.dread > 0.3 ? 0.25 : 0)
      + (scare.lightsOutActive ? 0.15 : 0)
    );
    hand.setVisible(!monitor.open);
    // Admin toys: viewmodels, muzzle flash decay, tracers, live rockets.
    updateGunRig();
    muzzle.intensity = Math.max(0, muzzle.intensity - dt * 90);
    boomLight.intensity = Math.max(0, boomLight.intensity - dt * 220);
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.life += dt;
      r.mesh.position.addScaledVector(r.vel, dt);
      if (r.life > 1.2 || r.mesh.position.y < 0.05) {
        const p = r.mesh.position.clone();
        scene.remove(r.mesh); rockets.splice(i, 1);
        explodeRocket(p);
      }
    }
    reportCooldown = Math.max(0, reportCooldown - dt);
    document.getElementById('crosshair')?.classList.toggle('cooling', reportCooldown > 0);

    // anomaly spawning follows the current night's difficulty
    const cfg = nightConfig(gameState.night);
    gameState.spawnTimer += dt;
    if (gameState.spawnTimer >= gameState.nextSpawnIn && anomalies.active.length < cfg.maxActive) {
      gameState.spawnTimer = 0;
      gameState.nextSpawnIn = cfg.spawnMin + Math.random() * (cfg.spawnMax - cfg.spawnMin);
      const inst = anomalies.trySpawn(cfg.subtleChance, cfg.durationScale);
      if (inst) showToast(`⚠️ Something feels off… (${anomalies.active.length} active)`, 'warn');
    }

    // subject-on-cameras scheduling. During an outage the stalker owns the one
    // figure they share, so no subject is put on the cameras.
    gameState.monsterTimer += dt;
    if (gameState.monsterTimer >= gameState.nextMonsterIn && monster.state === MonsterState.IDLE
        && !gameState.powerOut) {
      gameState.monsterTimer = 0;
      gameState.nextMonsterIn = cfg.monsterSpawnMin + Math.random() * (cfg.monsterSpawnMax - cfg.monsterSpawnMin);
      const roomIx = 1 + Math.floor(Math.random() * (stations.length - 1));
      monster.spawn(roomIx, stations[roomIx].patrol, cfg.monsterDwell);
      showToast(`⚠️ MOTION ON THE CAMERAS — SIT AT THE MONITOR (E)`, 'warn');
      audio.camSwitch();
    }
    // Patrol context: what it can perceive of the player right now.
    monsterHooks.patrolCtx = {
      playerPos: player.pos,
      // Any cover counts, including a locker in the power room.
      hiding: player.mode === 'hide',
      // A lit torch gives you away even from under the desk, so hiding with the
      // beam on is a real mistake the player has to avoid.
      torchOn: flashlight.on,
      moving: player.speedNow > 0.35 && player.mode === 'walk',
      noise: reportCooldown > 0 || caughtT > 0,
    };
    monster.update(dt, monsterHooks);

    // The figure on the wing feeds is physically in the same rooms you walk.
    // Getting too close to it while it is just "there on camera" makes it grab
    // you — a wing room you wander into mid-sighting is a real takedown, and
    // hiding in a locker is the only thing that spares you.
    if (monster.present && monster.stationIndex > 0 && player.mode !== 'hide'
        && !monitor.open && deathT <= 0) {
      const touch = Math.hypot(player.pos.x - monster.fig.position.x, player.pos.z - monster.fig.position.z);
      if (touch < 1.05) caughtInside();
    }

    // hunt: the office door swings open while it creeps in
    if (monster.hunting) {
      const cur = refs.doorPivot.rotation.y;
      refs.doorPivot.rotation.y = cur + (-1.1 - cur) * Math.min(1, dt * 1.4);
      // it beats on the doorframe as it closes in
      huntBangT -= dt;
      if (huntBangT <= 0) { audio.bang(); huntBangT = 1.3; }
    } else if (monster.state === MonsterState.LEAVING) {
      // the door swings shut behind it as it goes
      const cur = refs.doorPivot.rotation.y;
      refs.doorPivot.rotation.y = cur + (0 - cur) * Math.min(1, dt * 1.6);
    }

    // lightning surge: rain hammers the windows for a stretch after each strike
    if (storm.intensity > 1 && rainSurge <= 0) {
      rainSurge = 10;
      audio.setRain(0.45);
    }
    if (rainSurge > 0) {
      rainSurge -= dt;
      if (rainSurge <= 0) audio.setRain(0.07);
    }

    // context prompt near the desk / door / fuse panels / lockers
    const promptEl = document.getElementById('prompt');
    if (promptEl) {
      let text = null;
      const outage = gameState.powerOut && !gameState.powerFixed;
      if (player.mode === 'hide') {
        text = 'H — COME OUT';
      } else if (gameState.circuitFixing) {
        const p = (refs.panels || []).find((q) => q.id === gameState.activeCircuit);
        const pct = Math.min(100, Math.round((gameState.circuitProgress / gameState.circuitTarget) * 100));
        text = `RESTORING ${p ? p.name : 'CIRCUIT'}… ${pct}%`;
      } else if (player.mode === 'walk') {
        const panel = outage ? nearestPanel() : null;
        if (panel) {
          if (gameState.circuitsFixed.includes(panel.id)) text = `${panel.name} — RESTORED`;
          else if (panel.main) text = wingDone() ? 'E — RESTORE MAIN BREAKER' : `MAIN BREAKER — restore all ${wingPanels().length} fuse panels first`;
          else text = `E — RESTORE CIRCUIT · ${panel.name}`;
        } else if (nearDoor()) {
          text = doorIsOpen() ? 'E — CLOSE DOOR' : 'E — OPEN DOOR';
        } else if (distToLocker() <= 1.5) {
          text = 'H — HIDE IN LOCKER';
        } else if (!monitor.open && distToBed() <= 1.5) {
          text = 'H — HIDE UNDER BED';
        } else if (!monitor.open && distToDesk() <= HIDE_RADIUS) {
          text = 'E — USE MONITOR · H — HIDE UNDER DESK';
        }
      }
      if (text) { promptEl.textContent = text; promptEl.classList.remove('hidden'); }
      else promptEl.classList.add('hidden');
    }

    // Objective line: where the outage objective stands, and only then.
    const objectiveEl = document.getElementById('objective');
    if (objectiveEl) {
      const outage = gameState.powerOut && !gameState.powerFixed;
      if (!outage || monitor.open) objectiveEl.classList.add('hidden');
      else {
        const fixed = gameState.circuitsFixed.filter((id) => id !== 'main');
        const next = (refs.panels || []).find((p) => !gameState.circuitsFixed.includes(p.id));
        let msg = `FUSES ${fixed.length}/${wingPanels().length}`;
        if (next) msg += next.main ? ' · MAIN BREAKER — ELECTRICAL ROOM' : ` · NEXT: ${next.name}`;
        objectiveEl.textContent = msg;
        objectiveEl.classList.remove('hidden');
      }
    }

    monitor.update(dt);

    // ambient horror: glimpses, blackouts, whispers, lightning
    scare.update(dt, {
      cfg,
      lampBusy: anomalies.active.some((a) => a.def.tag === 'lamp-flicker'),
      seated: player.mode === 'desk',
    });
    camera.rotation.z += scare.consumeShudder(dt); // whisper shudder (roll resets every frame)

    // Night 2 power outage: leave the office, then walk the fuse wing behind
    // the power room putting each room's circuit back before the main breaker
    // will take. The whole wing has to be crossed with it out there.
    if ((gameState.night >= 2) && !gameState.powerEventTriggered && gameState.elapsed>=90){
      gameState.powerEventTriggered=true;
      scare.lightsOut(9999);
      try{audio.powerDown();}catch(e){}
      gameState.powerOut=true;
      gameState.powerFixed=false;
      gameState.circuitsFixed=[]; gameState.circuitProgress=0;
      gameState.circuitFixing=false; gameState.activeCircuit=null;
      stalkSpawned = false; stalkWay = null; stalkHunt = false;
      // Corridor and every wing room go dark; the red emergency strips are all
      // that is left until each circuit is put back by hand.
      if (refs.annexLight) refs.annexLight.intensity = 0;
      for (const p of refs.panels) setPanelPower(p, false);
      // The office monster clears out for the outage; the stalker takes over
      // the same figure, so only one of them can ever be walking.
      monster.reset();
      stalkWay = null;
      refs.doorPivot.rotation.y = -1.1; // door swings open: you can leave
      showToast(`POWER OUT — the FUSE WING behind the power room is dead. Restore all ${wingPanels().length} room circuits (ARCHIVE and PUMP ROOM included), then the MAIN BREAKER in the ELECTRICAL ROOM. It hunts out there — hide (H).`,"bad");
    }
    if (gameState.powerOut && !gameState.powerFixed) {
      refs.doorPivot.rotation.y += (-1.1 - refs.doorPivot.rotation.y) * Math.min(1, dt * 2);
      if (refs.breakerLamp && !gameState.circuitsFixed.includes('main')) {
        refs.breakerLamp.material.color.setHex(Math.sin(performance.now() / 150) > 0 ? 0xff2222 : 0x440000);
      }
      const panel = (player.mode === 'walk' && !monitor.open) ? nearestPanel() : null;
      if (panel && panelReady(panel) && !gameState.circuitsFixed.includes(panel.id)) {
        gameState.circuitFixing = true;
        gameState.activeCircuit = panel.id;
        gameState.circuitProgress += dt;
        if (gameState.circuitProgress >= gameState.circuitTarget) completeCircuit(panel);
      } else {
        gameState.circuitFixing = false;
        gameState.activeCircuit = null;
      }
      // Hallway stalker while the power is out. It only stalks you once you
      // are actually in the wing, so the corridor stays a survivable approach
      // and the first room is never an unavoidable death sentence.
      const inPowerRoom = player.pos.z < -9.2;
      if (!inPowerRoom) stalkerGrace = 0;
      if (inPowerRoom && player.mode !== 'hide'
          && !monster.hunting && !monster.patrolling && !monster.scaring && deathT <= 0) {
        stalkerGrace += dt;
        if (stalkerGrace > 5 && !stalkSpawned) {
          stalkSpawned = true;
          monster.showStalker(3.5, -10.5);   // down the corridor, waiting
          try { audio.sting(); } catch (e) {}
          showToast('IT IS OUT HERE WITH YOU — HIDE (H)', 'bad');
        }
      }
      // Power supply: the electrical room at the end of the wing. Walk in
      // there and it drops the circling act — it commits and hunts you around
      // the breaker until you get the power back or it takes you.
      if (atPowerSupply(player.pos) && !stalkHunt && !monster.scaring && deathT <= 0) {
        stalkHunt = true;
        if (!stalkSpawned) {
          stalkSpawned = true;
          monster.showStalker(3.5, -40.5);   // behind you, in the pump room
          stalkWay = null;
        }
        try { audio.sting(); } catch (e) {}
        showToast('⚠️ IT IS HUNTING YOU — RESTORE THE MAIN BREAKER AND GET OUT (H)', 'bad');
      }
      if (monster.stalker) {
        const fig = monster.voidFig;
        monster.animateStalker(dt);
        // Every destination — you, or the corridor mouth — is routed through
        // the same doorways the player uses, one room at a time. The current
        // waypoint is cached until it is reached, so it never stops to
        // realign for the NEXT divider while still standing on THIS one's
        // line, which is what would shoulder the wall beside the gap.
        const hunt = stalkHunt;
        const lost = player.mode === 'hide' || !inPowerRoom;
        // Hunting: it stays on you even under cover — it walks to where you
        // went to ground instead of drifting back to the corridor mouth.
        const toX = (lost && !hunt) ? 3.6 : player.pos.x;
        const toZ = (lost && !hunt) ? -10.5 : player.pos.z;
        if (!stalkWay || Math.hypot(stalkWay.x - fig.position.x, stalkWay.z - fig.position.z) < 0.05) {
          stalkWay = wingStep(fig.position.z, toZ);
        }
        const tx = stalkWay ? stalkWay.x : toX;
        const tz = stalkWay ? stalkWay.z : toZ;
        const dx = tx - fig.position.x, dz = tz - fig.position.z;
        // Line up with the gap before committing to the cross. A diagonal
        // approach would cut the corner and end up shouldering the wall
        // beside the doorway instead of walking through it.
        const mz = (stalkWay && Math.abs(dx) > 0.2) ? 0 : dz;
        const d = Math.hypot(dx, mz);
        if (d > 0.02) {
          const sp = hunt ? 2.4 : 1.35; // hunting: twice the pace, no drifting
          const move = Math.min(sp * dt, d);
          fig.position.x += (dx / d) * move;
          fig.position.z += (mz / d) * move;
          fig.rotation.y = Math.atan2(dx, mz);
        }
        fig.position.y = Math.abs(Math.sin(performance.now() / 300)) * 0.04;
        // It can only take you in the room you are both standing in, never
        // through a wall or a doorway it is still halfway through.
        if (!lost && wingZone(fig.position.z) === wingZone(player.pos.z)) {
          const pd = Math.hypot(player.pos.x - fig.position.x, player.pos.z - fig.position.z);
          if (pd < (hunt ? 1.25 : 0.9)) {
            monster.beginScare(camera, true); // the void body takes the lens
            monster.stalker = false;
            audio.scream(); audio.bang();
            const fl = document.getElementById('flash');
            if (fl) fl.style.opacity = '0.9';
            caughtT = 0.0001;
          }
        }
      }
    }
    // The stare: keeping a live subject on your current feed lets it lock
    // eyes. It turns to the lens, the feed bleeds, the heart pounds — and
    // after STARE_LIMIT seconds it kills you. Look away or report it.
    updateStare(dt);

    // death cinematic (stare kill): slam to max zoom on its face, then game over
    if (deathT > 0) {
      deathT -= dt;
      monitor.setDread(1);
      monster.setDread(1);
      const fig = monster.fig;
      const ndc = fig.position.clone().project(monitor.station.camera);
      monitor.state.zoomIx = monitor.ZOOMS.length - 1;
      monitor.centerOn(ndc.x, ndc.y);
      monitor.refreshDom();

      const flashEl = document.getElementById('flash');
      const elapsed = DEATH_TOTAL - deathT;

      // One-shot the moment the freeze breaks open into the burst.
      if (deathPhase === 'freeze' && elapsed >= DEATH_FREEZE) {
        deathPhase = 'burst';
        audio.scream();
        audio.bang();
        audio.heartbeat(0.75);
        if (flashEl) flashEl.style.opacity = '0.92';
      }

      // ---- Beat 1: freeze. Colour drains, the frame barely moves, the zoom
      // creeps in. Reads as the held breath before something awful.
      if (elapsed < DEATH_FREEZE) {
        const f = elapsed / DEATH_FREEZE;
        canvas.style.transform =
          `translate(${(Math.random() - 0.5) * 2}px, ${(Math.random() - 0.5) * 2}px)`;
        canvas.style.filter =
          `saturate(${(1 - f * 0.85).toFixed(2)}) contrast(${(1 + f * 0.5).toFixed(2)}) brightness(${(1 - f * 0.35).toFixed(2)})`;
        if (flashEl) flashEl.style.opacity = '0';

        // ---- Beat 2: burst. Violent shake, hue tearing and a stuttering
        // exposure while the feed slams to max zoom on the face.
      } else if (elapsed < DEATH_FREEZE + DEATH_BURST) {
        deathPhase = 'burst';
        const b = (elapsed - DEATH_FREEZE) / DEATH_BURST;
        const s = 26 * (1 - b * 0.55);
        const rot = (Math.random() - 0.5) * 2.4 * (1 - b * 0.6);
        canvas.style.transform =
          `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px) rotate(${rot}deg)`;
        // strobe the exposure so the image stutters instead of pulsing smoothly
        const dark = Math.random() < 0.35;
        canvas.style.filter = dark
          ? 'saturate(0.25) contrast(1.9) brightness(0.4)'
          : `saturate(2.2) contrast(1.9) hue-rotate(${((Math.random() - 0.5) * 40).toFixed(0)}deg)`;
        if (flashEl) flashEl.style.opacity = String(Math.max(0, 0.9 * (1 - b * 3)));

        // ---- Beat 3: settle. Shake and colour bleed off, then you die.
      } else {
        const s2 = (elapsed - DEATH_FREEZE - DEATH_BURST) / DEATH_SETTLE;
        canvas.style.transform =
          `translate(${(Math.random() - 0.5) * 11 * (1 - s2)}px, ${(Math.random() - 0.5) * 11 * (1 - s2)}px)`;
        canvas.style.filter =
          `saturate(0.2) contrast(1.5) brightness(${(0.6 + 0.4 * (1 - s2)).toFixed(2)})`;
        if (flashEl) flashEl.style.opacity = '0';
      }

      if (deathT <= 0) {
        clearScareFx();
        endGame(false, 'It stared back. You should have looked away.');
      }
    }

    // Caught jumpscare: the shake and colour tear ramp as it closes on the lens.
    if (caughtT > 0 && deathT <= 0) {
      caughtT += dt;
      const k = Math.min(1, caughtT / monster.scareDur);
      const s = 12 + 20 * k;
      const rot = (Math.random() - 0.5) * (1 + 3 * k);
      canvas.style.transform =
        `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px) rotate(${rot}deg)`;
      canvas.style.filter = Math.random() < 0.3
        ? 'saturate(0.3) contrast(1.8) brightness(0.45)'
        : `saturate(2) contrast(1.6) hue-rotate(${((Math.random() - 0.5) * 30).toFixed(0)}deg)`;
      const cf = document.getElementById('flash');
      if (cf) cf.style.opacity = String(Math.max(0, 0.9 * (1 - k * 4)));
    }

    // remote-room lights breathe: the hallway tube flickers, the boiler pulses
    flickerLights();

    // dread vignette: the screen bleeds as it locks on / hunts / kills
    const dreadEl = document.getElementById('dread');
    if (dreadEl) {
      const target = deathT > 0 ? 1 : monster.hunting || monster.patrolling || stalkHunt ? 0.55 : monitor.open ? monitor.dread : 0;
      const cur = parseFloat(dreadEl.dataset.v || '0');
      if (Math.abs(target - cur) > 0.03) {
        dreadEl.dataset.v = String(target);
        dreadEl.style.opacity = String(target);
      }
    }
    // heartbeat while it is inside the office with you
    if (monster.hunting || monster.patrolling || stalkHunt) {
      heartT -= dt;
      if (heartT <= 0) { audio.heartbeat(0.35); heartT = (monster.patrolling || stalkHunt) ? 0.9 : 0.7; }
    }

    // anomaly expiry => missed (no strikes anymore; the subject is the threat)
    const expired = anomalies.update(dt);
    for (const e of expired) {
      gameState.missed += 1;
      audio.buzz();
      showToast(`👁 MISSED: ${e.def.label} (it got away)`, 'bad');
    }

    // win condition
    if (gameState.elapsed >= gameState.shiftLength) endGame(true);

    // hourly tick sound
    tickAcc += dt;
    if (tickAcc > 50) { tickAcc = 0; audio.tick(); }

    updateHUD(flashlight.battery, anomalies.active.length);
    updateVoiceMeters();
  } else {
    // idle camera sway on title screen
    const t = performance.now() / 1000;
    camera.position.set(Math.sin(t * 0.2) * 1.5, 1.6, 2.8);
    camera.lookAt(0, 1.2, -3);
    flashlight.update(0.016);
  }

  quality.render();
  // First-person hand, drawn last so it's never clipped by world geometry and
  // never picks up the room's fog. Hidden while seated (you'd be looking at
  // the monitor, not your hand).
  hand.render(renderer, camera.aspect);
  if (monitor.open) monitor.render(); // CCTV frame fullscreen over the office
  if (monster.scaring) { /* jumpscare renders the figure point-blank at the lens */ }
  // the dark breathes almost imperceptibly — the night feels alive
  renderer.toneMappingExposure = 1.45 + Math.sin(performance.now() / 2600) * 0.025;
  quality.update();
}

document.getElementById('title-best').textContent =
  gameState.bestNight > 1 ? `Highest night reached: ${gameState.bestNight}` : 'No nights survived yet. Good luck.';
showScreen('title-screen');

// On-screen controls for phones. They feed the same action codes as the
// keyboard, so there is only one rule set to reason about.
if (TOUCH) {
  touch = createTouchControls({
    player,
    action: doAction,
    escape: doEscape,
    zoom: (dir) => {
      if (!monitor.open || gameState.phase !== GamePhase.PLAYING) return;
      if (dir > 0) monitor.zoomIn(); else monitor.zoomOut();
      audio.click();
    },
    pan: (dx, dy) => {
      if (!monitor.open) return;
      monitor.setPan(monitor.state.panX + dx, monitor.state.panY + dy);
    },
    cam: (dir) => {
      if (!monitor.open || gameState.phase !== GamePhase.PLAYING) return;
      switchCam(() => (dir > 0 ? monitor.next() : monitor.prev()));
    },
    state: () => ({
      phase: gameState.phase,
      monitorOpen: !!monitor.open,
      // Only offer HIDE where there is actually somewhere to hide — desk, bed,
      // or any locker (power room and all six fuse wing rooms); everywhere
      // else the same button becomes BACK, which is the only Escape equivalent.
      canHide: player.mode === 'desk' || distToDesk() <= HIDE_RADIUS
        || distToBed() <= 1.9 || distToLocker() <= 1.5,
    }),
  });
}

// Debug/testing handle (used by the automated playtest; harmless in production).
window.__game = {
  THREE, gameState, GamePhase, anomalies, flashlight, player, camera, scene, renderer, refs, composer, colliders, quality,
  stations, monster, monitor, MonsterState, DOOR_SPOT, scare, storm, audio, hand,
  reportAnomaly, reportCurrent, reportSubject, startShift, pauseGame, resumeGame,
  toggleMonitor, standUp, toggleHide, unhide, startHunt, resolveHunt, stopHunt, resetOfficeLights,
  doAction, doEscape, viewer, voice, createVoiceChat,
  admin, toggleAdmin, fireGun, fireRocket,
  get voiceOpen() { return voiceOpen; },
  get TOUCH() { return TOUCH; },
  get touch() { return touch; },
  debug: debugTuning,
  get stareT() { return stareT; },
  get deathT() { return deathT; },
  get reportCooldown() { return reportCooldown; },
  get stalkHunt() { return stalkHunt; },
  get stalkSpawned() { return stalkSpawned; },
};
updateHUD(100, 0);

// A phone that gets locked or backgrounded mid-shift would otherwise resume
// with the game clock hours ahead of the player (requestAnimationFrame stalls
// while hidden). Auto-pause instead, and take the wake lock back on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseWakeLock();
    if (gameState.phase === GamePhase.PLAYING) pauseGame();
  } else if (gameState.phase === GamePhase.PAUSED) {
    acquireWakeLock();
  }
});

loop();
