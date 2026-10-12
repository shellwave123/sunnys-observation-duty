// The stick-figure subject: tall, thin, glowing eyes. Roams a remote
// station on camera, and — if never logged — comes for the office door.
import * as THREE from 'three';
import { audio } from './audio.js';
import { buildVoidStalker } from './voidmonster.js';

export const MonsterState = {
  IDLE: 'idle', PRESENT: 'present', HUNTING: 'hunting',
  PATROL: 'patrol', CHASE: 'chase', LEAVING: 'leaving', SCARING: 'scaring',
};

/** Backrooms stalker: pitch-black wiggly body with hanging tendrils,
 *  long arms, long fingers, and the cracked black skull with burning eyes. */
export function buildStickFigure() {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0, metalness: 0.0, emissive: 0x000000 });
  const limb = (len, r) => new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, len, 6), skin);

  const pelvis = new THREE.Group(); pelvis.position.y = 1.02; root.add(pelvis);

  // torso (pivot at shoulders so it can lean)
  const shoulderBar = new THREE.Group(); shoulderBar.position.y = 1.62; root.add(shoulderBar);
  const torso = limb(0.62, 0.075); torso.position.y = -0.31; shoulderBar.add(torso);

  // neck + horror head: black cracked skull, void-black eyes, third eye,
  // side eyes, tear streaks, slit nostrils, and a huge jagged grin
  const neck = limb(0.12, 0.045); neck.position.y = 0.06; shoulderBar.add(neck);
  const headG = new THREE.Group(); headG.position.y = 0.26; shoulderBar.add(headG);
  const boneMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9, metalness: 0.0 });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 24), boneMat);
  skull.scale.set(1.02, 1.18, 0.95); headG.add(skull);
  // every glowing dot shares eyeMat so the locked-on stare burns them all red
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 2.2, roughness: 0.35, metalness: 0 });

  const voidEye = (rx, ry, x, y, z) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), voidMat);
    e.scale.set(rx, ry, Math.min(rx, ry) * 0.55);
    e.position.set(x, y, z); headG.add(e);
  };
  const pupil = (r, x, y, z) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), eyeMat);
    p.position.set(x, y, z); headG.add(p);
  };
  // the two huge void eyes + pin pupils
  voidEye(0.085, 0.125, -0.105, 0.05, 0.15);
  voidEye(0.085, 0.125, 0.105, 0.05, 0.15);
  pupil(0.022, -0.105, 0.035, 0.235);
  pupil(0.022, 0.105, 0.035, 0.235);
  voidEye(0.032, 0.046, 0, 0.175, 0.172);
  pupil(0.012, 0, 0.175, 0.208);
  for (const s of [-1, 1]) {
    voidEye(0.024, 0.028, 0.185 * s, -0.02, 0.098);
    pupil(0.01, 0.185 * s, -0.02, 0.12);
    voidEye(0.02, 0.024, 0.175 * s, -0.095, 0.112);
    pupil(0.008, 0.175 * s, -0.095, 0.13);
    voidEye(0.017, 0.02, 0.16 * s, 0.14, 0.08);
    pupil(0.007, 0.16 * s, 0.14, 0.095);
    voidEye(0.014, 0.017, 0.15 * s, -0.16, 0.09);
    pupil(0.006, 0.15 * s, -0.16, 0.1);
  }
  voidEye(0.016, 0.02, 0, -0.22, 0.18);
  pupil(0.007, 0, -0.22, 0.195);
  voidEye(0.014, 0.017, 0, 0.08, 0.195);
  pupil(0.006, 0, 0.08, 0.21);
  // forehead crack (two tilted segments hugging the skull curve)
  const scar = (w, h, x, y, z, rz, rx) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), crackMat);
    m.position.set(x, y, z); m.rotation.z = rz; m.rotation.x = rx; headG.add(m);
  };
  scar(0.01, 0.075, 0.014, 0.112, 0.178, 0.35, 0.3);
  scar(0.01, 0.06, -0.004, 0.05, 0.193, -0.25, 0.15);
  // long black tear streaks dripping from the big eyes
  const tear = (w, h, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.008), voidMat);
    m.position.set(x, y, 0.15); headG.add(m);
  };
  tear(0.022, 0.2, -0.115, -0.1);
  tear(0.016, 0.13, -0.075, -0.06);
  tear(0.022, 0.17, 0.115, -0.09);
  // slit nostrils
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.04, 0.008), voidMat);
    n.position.set(0.024 * s, -0.055, 0.188); headG.add(n);
  }
  // the grin: a wide dark maw with two ragged rows of teeth.
  // The lower jaw is its own pivot so it can drop open — a permanently
  // closed mouth reads as a mask, and the yawn gape is the whole scare.
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.105, 0.10);
  headG.add(jaw);
  const maw = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), voidMat);
  maw.scale.set(1.7, 0.62, 0.5); maw.position.set(0, -0.07, 0); jaw.add(maw);
  const toothGeo = new THREE.ConeGeometry(0.024, 0.07, 6);
  for (let i = 0; i < 11; i++) {
    const t = new THREE.Mesh(toothGeo, toothMat);
    const x = -0.175 + (i / 10) * 0.35;
    t.scale.setScalar(0.75 + (((i * 37) % 10) / 10) * 0.6); // ragged lengths
    t.position.set(x, -0.112, 0.152 - Math.abs(x) * 0.15);
    t.rotation.x = Math.PI; // point down
    t.rotation.z = Math.sin(i * 7.3) * 0.12;
    headG.add(t);
  }
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(toothGeo, toothMat);
    const x = -0.15 + (i / 8) * 0.3;
    t.scale.setScalar(0.7 + (((i * 53) % 10) / 10) * 0.6);
    t.position.set(x, -0.133, 0.048 - Math.abs(x) * 0.15);
    t.rotation.z = Math.sin(i * 5.1 + 1) * 0.12;
    jaw.add(t);
  }
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(toothGeo, toothMat);
    const x = -0.12 + (i / 4) * 0.24;
    t.scale.setScalar(0.65);
    t.position.set(x, -0.07, 0.172);
    t.rotation.x = Math.PI;
    t.rotation.z = Math.sin(i * 11) * 0.08;
    headG.add(t);
  }

  const mkArm = (side) => {
    const sh = new THREE.Group(); sh.position.set(0.21 * side, 0, 0); shoulderBar.add(sh);
    const up = limb(0.6, 0.04); up.position.y = -0.3; sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.6; sh.add(el);
    const fo = limb(0.72, 0.032); fo.position.y = -0.36; el.add(fo);
    const hand = new THREE.Group(); hand.position.y = -0.72; el.add(hand);
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.006, 0.28, 5), skin);
      f.position.set((i - 2) * 0.03, -0.14, 0); hand.add(f);
    }
    return { sh, el };
  };
  const armL = mkArm(-1); const armR = mkArm(1);

  const mkLeg = (side) => {
    const hip = new THREE.Group(); hip.position.set(0.12 * side, 0, 0); pelvis.add(hip);
    const th = limb(0.5, 0.05); th.position.y = -0.25; hip.add(th);
    const knee = new THREE.Group(); knee.position.y = -0.5; hip.add(knee);
    const sh2 = limb(0.52, 0.04); sh2.position.y = -0.26; knee.add(sh2);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.24), skin);
    foot.position.set(0, -0.52, 0.08); knee.add(foot);
    return { hip, knee };
  };
  const legL = mkLeg(-1); const legR = mkLeg(1);

  // taller, wrong proportions: stretched torso, head too big, arms too long
  root.scale.set(1.12, 1.32, 1.12);
  headG.scale.setScalar(1.3);
  // faint blood-red glow cast from its face so it reads in dark rooms/feeds
  const faceGlow = new THREE.PointLight(0xff0000, 6.0, 14, 1.4);
  faceGlow.position.set(0, 0.1, 0.5); headG.add(faceGlow);
  const neckGlow = new THREE.PointLight(0xff0000, 3.0, 10, 1.4);
  neckGlow.position.set(0, -0.05, 0.3); shoulderBar.add(neckGlow);
  // Backrooms wiggle: thin black tendrils hanging off the back, shoulders
  // and elbows. They sway every frame, so the silhouette never sits still.
  const tendrils = [];
  const mkTendril = (parent, x, y, z, len, phase) => {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const k = i / 5;
      pts.push(new THREE.Vector3(
        x + Math.sin(phase + k * 4.2) * 0.06 * k,
        y - len * k,
        z + Math.cos(phase * 1.3 + k * 3.1) * 0.06 * k
      ));
    }
    const g = new THREE.Group(); g.position.set(0, 0, 0);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.014, 5, false), skin);
    g.add(tube);
    g.userData.ph = phase;
    parent.add(g);
    tendrils.push(g);
    return g;
  };
  mkTendril(shoulderBar, -0.14, -0.1, -0.12, 0.75, 0.0);
  mkTendril(shoulderBar, 0.0, -0.12, -0.15, 0.9, 2.1);
  mkTendril(shoulderBar, 0.14, -0.1, -0.12, 0.75, 4.2);
  mkTendril(pelvis, -0.08, -0.05, -0.1, 0.6, 1.2);
  mkTendril(pelvis, 0.08, -0.05, -0.1, 0.6, 3.3);
  mkTendril(armL.el, 0, -0.3, -0.04, 0.5, 5.1);
  mkTendril(armR.el, 0, -0.3, -0.04, 0.5, 0.7);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { root, refs: { shoulderBar, headG, jaw, armL, armR, legL, legR, tendrils }, eyeMat };
}

function wrapAngle(d) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class MonsterManager {
  constructor(scene) {
    this.scene = scene;
    const { root, refs, eyeMat } = buildStickFigure();
    root.visible = false;
    root.userData.anomalyType = 'monster';
    root.userData.isActive = false;
    root.traverse((o) => { o.userData.anomalyType = 'monster'; o.userData.isActive = false; });
    scene.add(root);
    this.fig = root;
    this.r = refs;
    this.eyeMat = eyeMat;
    this.eyeBase = new THREE.Color(0xffe9a8);
    // The power-outage stalker gets its own body: the Backrooms void wire
    // thing. It is parked far below the world whenever it is not in use, so
    // it can never intercept a report ray meant for something else.
    const voidBuilt = buildVoidStalker();
    this.voidFig = voidBuilt.root;
    this.voidFig.visible = false;
    this.voidFig.position.set(0, -60, 0);
    this.voidFig.userData.anomalyType = 'monster';
    this.voidFig.userData.isActive = false;
    this.voidFig.traverse((o) => { o.userData.anomalyType = 'monster'; o.userData.isActive = false; });
    this.animateVoid = voidBuilt.animate;
    this.stalker = false;   // true while the void body is the one walking
    this.scareFig = null;   // which body the current jumpscare is driving
    // A scare can leave the rig twisted. Remember the build-time pose so a
    // reset always returns a neutral body, not a leftover jumpscare shape.
    this.restPose = [];
    root.traverse((o) => { if (o.isObject3D) this.restPose.push([o, o.rotation.clone()]); });
    this.faceCam = null; // station camera it is currently staring into
    this.dread = 0;      // 0..1 how locked-on the stare is
    this.state = MonsterState.IDLE;
    this.stationIndex = -1;  // which station it haunts right now
    this.patrol = [];        // waypoints (world)
    this.nextIdx = 0;
    this.dwell = 0;
    this.warnedHunt = false;
    this.huntT = 0;
    this.scareT = 0;
    this.scareDur = 1.25;   // length of the caught-jumpscare lunge
    this.scareCam = null;   // camera it is rushing, held for the whole lunge
    this.t = 0;
    this.stare = 0;          // countdown while it freezes and stares at the camera
    this.walkSpeed = 1.15;
    this.route = [];
    this.routePause = [];
    this.patrolT = 0;
    this.pauseT = 0;
    this.footstopT = 0;
    this.stepT = 0;
    this.leaveT = 0;
    this.hasEyes = false;   // true once it has actually spotted the player
    this.walkSpeed = 1.15;
    this.work = { v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3() };
  }

  reset() {
    this.fig.visible = false;
    // park it far below the world so the invisible body can never
    // intercept a report ray meant for something behind it
    this.fig.position.set(0, -60, 0);
    this.hideStalker();
    for (const [o, rot] of this.restPose) o.rotation.copy(rot);
    this.scareFig = null;
    this.state = MonsterState.IDLE;
    this.stationIndex = -1;
    this.t = 0;
    this.faceCam = null;
    this.warnedHunt = false;
    this.setDread(0);
  }

  get present() { return this.state === MonsterState.PRESENT; }
  get hunting() { return this.state === MonsterState.HUNTING; }

  // ---- The outage stalker (void body) --------------------------------
  /** Swap the office figure out for the void creature and put it at (x, z). */
  showStalker(x, z) {
    this.stalker = true;
    this.fig.visible = false;
    this.voidFig.visible = true;
    this.voidFig.position.set(x, 0, z);
    this.voidFig.rotation.set(0, Math.PI, 0); // looks back up the wing
    this.animateVoid(this.t, false);
  }

  /** Put the void body away (power restored, shift reset, caught). */
  hideStalker() {
    this.stalker = false;
    this.voidFig.visible = false;
    this.voidFig.position.set(0, -60, 0);
  }

  /** Idle sway while the main loop walks it down the corridor. */
  animateStalker(dt) {
    this.t += dt;
    this.animateVoid(this.t, false);
  }

  /** Locked-on stare 0..1: eyes burn from corpse-pale to blood-red. */
  setDread(d) {
    this.dread = Math.max(0, Math.min(1, d));
    this.eyeMat.emissive.setRGB(1.0, 0.02, 0.0);
    this.eyeMat.emissiveIntensity = 1.6 + this.dread * 3.2;
  }

  /** Appear in a remote station (index >= 1). */
  spawn(stationIndex, patrol, dwellSeconds) {
    this.reset();
    this.state = MonsterState.PRESENT;
    this.stationIndex = stationIndex;
    this.patrol = patrol;
    this.nextIdx = Math.floor(Math.random() * patrol.length);
    this.dwell = dwellSeconds;
    this.warnedHunt = false;
    this.fig.visible = true;
    this.fig.position.copy(patrol[this.nextIdx]);
    audio.spawn();
  }

  /** Logged on camera: scream + vanish. */
  report() {
    audio.scream();
    this.reset();
  }

  /** Dwell expired: head for the office door. */
  beginHunt(doorSpot) {
    this.state = MonsterState.HUNTING;
    this.huntT = 6.0; // seconds to reach the player
    this.fig.visible = true;
    this.fig.position.copy(doorSpot); // just inside the office doorway
    this.fig.rotation.y = Math.PI;    // facing into the room
  }

  /** Player caught: it rushes the lens instead of hanging there twitching.
   *  `voidBody` when the catch came from the outage stalker, whose face is
   *  pinned straight to the camera instead of standing on the floor. */
  beginScare(camera, voidBody = false) {
    this.state = MonsterState.SCARING;
    this.scareT = this.scareDur * 0.75;
    this.scareCam = camera;
    const fig = voidBody ? this.voidFig : this.fig;
    this.scareFig = fig;
    this.voidFig.visible = voidBody;
    this.fig.visible = !voidBody;
    const fwd = this.work.v1.set(0, 0, -1).applyQuaternion(camera.quaternion);
    fig.position.copy(camera.position).add(fwd.multiplyScalar(0.7));
    fig.position.y = voidBody
      ? camera.position.y - 2.45
      : Math.max(0.35, camera.position.y - 0.5);
    fig.rotation.set(0, Math.atan2(camera.position.x - fig.position.x, camera.position.z - fig.position.z), 0);
    if (voidBody) this.animateVoid(0.001, true);
  }

  get scaring() { return this.state === MonsterState.SCARING; }

  // ---- Patrol (inside the office) -------------------------------------
  // Waypoints are ordered like a person checking a room: the bed, the chair,
  // the desk, then a slow lap. Each entry is [x, z, secondsToPauseHere].
  static PATROL_ROUTE = [
    [-3.6, -1.7, 1.6],   // bed, foot end
    [-1.3, -1.4, 1.1],   // desk approach
    [-1.3, -0.4, 1.8],   // chair, looking at the seat
    [0.8, 1.4, 0.9],
    [2.6, -1.2, 1.2],
    [1.4, -3.0, 1.4],    // filing cabinet corner
    [-2.4, -2.6, 1.0],
    [-4.2, 0.6, 1.3],
    [0.2, 2.6, 1.0],
  ];
  static PATROL_MIN = 20;   // seconds inside before it gives up and leaves
  static PATROL_MAX = 30;

  beginPatrol() {
    this.state = MonsterState.PATROL;
    this.patrolT = MonsterManager.PATROL_MIN
      + Math.random() * (MonsterManager.PATROL_MAX - MonsterManager.PATROL_MIN);
    this.route = MonsterManager.PATROL_ROUTE.map((p) => new THREE.Vector3(p[0], 0, p[1]));
    this.routePause = MonsterManager.PATROL_ROUTE.map((p) => p[2]);
    this.nextIdx = Math.floor(Math.random() * this.route.length);
    this.pauseT = 0;
    this.hasEyes = false;
    this.walkSpeed = 0.85;      // inside it moves slowly, like it is listening
    this.stepT = 0;
    this.footstopT = 0;
  }

  get patrolling() { return this.state === MonsterState.PATROL || this.state === MonsterState.CHASE; }

  /** Tick PATROL/CHASE. ctx: { playerPos, hiding, torchOn, moving, noise }. */
  updatePatrol(dt, ctx, hooks = {}) {
    const { v1 } = this.work;
    const R = this.r;
    this.t += dt;
    this.patrolT -= dt;

    const dx = ctx.playerPos.x - this.fig.position.x;
    const dz = ctx.playerPos.z - this.fig.position.z;
    const distToPlayer = Math.hypot(dx, dz);

    // Footsteps, one per step, volume scaled by distance so they read as
    // "somewhere in the room" and swell as it closes in.
    this.stepT -= dt;
    if (this.stepT <= 0 && this.footstopT <= 0) {
      audio.footstep(THREE.MathUtils.clamp(1 - distToPlayer / 9, 0.05, 1));
      this.stepT = 0.62;
    }
    const closeness = THREE.MathUtils.clamp(1 - distToPlayer / 8, 0, 1);
    audio.setBreath(this.patrolling ? closeness * 0.6 : closeness);

    let detected = false;
    if (ctx.hiding) {
      detected = ctx.torchOn || ctx.moving || ctx.noise;
      if (ctx.torchOn && distToPlayer > 4.5) detected = false;
      if (ctx.moving && distToPlayer > 6) detected = false;
      if (ctx.noise && distToPlayer > 5.5) detected = false;
    } else if (distToPlayer < 8.5) {
      const fwd = this.work.v2.set(Math.sin(this.fig.rotation.y), 0, Math.cos(this.fig.rotation.y));
      const toP = this.work.v3.set(dx, 0, dz).normalize();
      const vis = fwd.dot(toP);
      detected = (distToPlayer < 4.5) || (distToPlayer < 6.5 && vis > 0.4);
    }
    if (detected && this.state === MonsterState.PATROL) {
      this.state = MonsterState.CHASE;
      this.hasEyes = true;
      this.walkSpeed = 1.65;
      hooks.onSpotted?.();
      audio.sting();
    }

    if (this.state === MonsterState.CHASE) {
      v1.set(dx, 0, dz);
const d = v1.length() || 1;
    v1.divideScalar(d);
    this.fig.position.addScaledVector(v1, Math.min(this.walkSpeed * dt, d));
    this.fig.rotation.y += wrapAngle(Math.atan2(v1.x, v1.z) - this.fig.rotation.y) * Math.min(1, dt * 6);
    this.animateWalk(dt, 7.4, 1);
    this.stepT -= dt;
    if (this.stepT <= 0) {
      audio.footstep(THREE.MathUtils.clamp(1 - distToPlayer / 10, 0.15, 1.1));
      this.stepT = 0.28;
    }
    // It only takes you once it has eyes on you. A chase it started blind
    // (you stood up, or made a noise under the desk) ends at the spot where
    // it spotted you and then loses interest again.
    if (d < 0.95) {
      if (this.hasEyes || !ctx.hiding) { hooks.onCaughtInside?.(); return; }
      // Lost you again: back to patrolling.
      this.state = MonsterState.PATROL;
      this.hasEyes = false;
      this.walkSpeed = 0.78;
      this.pauseT = 0.6;
      hooks.onLostYou?.();
      return;
    }
      // Give up if it somehow loses the thread.
      if (this.patrolT < -6) {
        this.state = MonsterState.PATROL; this.patrolT = 3;
        this.walkSpeed = 0.78; this.hasEyes = false;
      }
      return;
    }

    // ---- PATROL: walk the route, pause, turn toward the player now and then.
    this.footstopT = Math.max(0, this.footstopT - dt);
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      R.legL.hip.rotation.x *= 0.85; R.legR.hip.rotation.x *= 0.85;
      R.armL.sh.rotation.x *= 0.85; R.armR.sh.rotation.x *= 0.85;
      this.fig.rotation.y += wrapAngle(Math.atan2(dx, dz) - this.fig.rotation.y) * Math.min(1, dt * 1.6);
      R.headG.rotation.x = 0.1 + Math.sin(this.t * 0.8) * 0.06;
      R.headG.rotation.z = Math.sin(this.t * 2.3) * 0.07;
      R.shoulderBar.rotation.z = Math.sin(this.t * 0.9) * 0.04;
      R.jaw.rotation.x += (0.06 - R.jaw.rotation.x) * Math.min(1, dt * 3);
      this.fig.position.y = Math.sin(this.t * 1.3) * 0.012;
      return;
    }

    // Defensive: a PATROL state with no route (or a bad index) resumes its
    // route instead of throwing every frame.
    if (!this.route.length) { this.beginPatrol(); return; }
    if (this.nextIdx >= this.route.length) this.nextIdx = 0;
    const dest = this.route[this.nextIdx];
    if (!dest) { this.nextIdx = 0; return; }
    v1.subVectors(dest, this.fig.position); v1.y = 0;
    const dist = v1.length();
    if (dist < 0.4) {
      this.pauseT = this.routePause[this.nextIdx] ?? 1;
      this.nextIdx = (this.nextIdx + 1) % this.route.length;
      // Now and then it stops dead mid-stride. That reads as wrong.
      if (Math.random() < 0.28) this.footstopT = 0.7 + Math.random() * 1.1;
      return;
    }
    v1.normalize();
    // Slightly uneven gait: the speed itself wavers instead of ramping cleanly.
    const uneven = 1 + Math.sin(this.t * 1.7) * 0.16 + Math.sin(this.t * 0.6) * 0.1;
    this.fig.position.addScaledVector(v1, Math.min(this.walkSpeed * uneven * dt, dist));
    this.fig.rotation.y += wrapAngle(Math.atan2(v1.x, v1.z) - this.fig.rotation.y) * Math.min(1, dt * 3.5);
    this.animateWalk(dt, 4.6, 0.75);

    if (this.patrolT <= 0) hooks.onPatrolEnd?.();
  }

  /** Shared limb cycle. rate = stride frequency, amp = how wide it swings. */
  animateWalk(dt, rate, amp) {
    const R = this.r;
    const s = Math.sin(this.t * rate);
    R.legL.hip.rotation.x = s * 0.55 * amp;
    R.legR.hip.rotation.x = -s * 0.55 * amp;
    R.legL.knee.rotation.x = Math.max(0, -s) * 0.7 * amp;
    R.legR.knee.rotation.x = Math.max(0, s) * 0.7 * amp;
    R.armL.sh.rotation.x = -s * 0.4 * amp;
    R.armR.sh.rotation.x = s * 0.4 * amp;
    R.armL.el.rotation.x = -0.25 * amp;
    R.armR.el.rotation.x = -0.25 * amp;
    R.shoulderBar.rotation.z = s * 0.09 * amp;
    R.shoulderBar.rotation.x = 0.06 + Math.abs(s) * 0.05 * amp;
    R.jaw.rotation.x += (0.05 + Math.abs(s) * 0.03 - R.jaw.rotation.x) * Math.min(1, dt * 4);
    this.fig.position.y = Math.abs(Math.cos(this.t * rate)) * 0.03 * amp;
    R.headG.rotation.x = 0.06;
    R.headG.rotation.y = 0;
    R.headG.rotation.z = s * 0.05 * amp;
  }

  /** Per-frame. hooks: onHuntStart, onGone({logged}|{escaped}|{hunt}), onCaught. */
  update(dt, hooks = {}) {
    if (this.state === MonsterState.IDLE) return;
    this.t += dt;
    const { v1, v2 } = this.work;
    const R = this.r;
    // Backrooms wiggle runs in every state: tendrils writhe, spine wobbles.
    if (this.fig.visible && R.tendrils) {
      for (const td of R.tendrils) {
        td.rotation.x = Math.sin(this.t * 2.4 + td.userData.ph) * 0.4;
        td.rotation.z = Math.cos(this.t * 1.9 + td.userData.ph * 1.3) * 0.4;
      }
      if (this.state !== MonsterState.SCARING) {
        this.fig.rotation.z = Math.sin(this.t * 1.35) * 0.035;
      }
    }

    if (this.state === MonsterState.PRESENT) {
      this.dwell -= dt;
      if (this.dwell <= 6 && !this.warnedHunt) {
        // about to come for the door: rattle it first
        this.warnedHunt = true;
        hooks.onHuntWarning?.();
      }
      if (this.dwell <= 0) {
        // expired unlogged: the caller starts the office hunt (door spot, UI).
        hooks.onHuntStart?.();
        return;
      }
      if (this.faceCam) {
        v1.subVectors(this.faceCam.position, this.fig.position);
        this.fig.rotation.y += wrapAngle(Math.atan2(v1.x, v1.z) - this.fig.rotation.y) * Math.min(1, dt * 6);
        R.headG.rotation.x = 0.3 + Math.sin(this.t * 12) * 0.1;
        R.headG.rotation.z = Math.sin(this.t * 16) * 0.15;
        R.headG.rotation.y = Math.sin(this.t * 9) * 0.12;
        R.shoulderBar.rotation.x = 0.15;
        R.shoulderBar.rotation.z = Math.sin(this.t * 11) * 0.08;
        R.legL.hip.rotation.x *= 0.8; R.legR.hip.rotation.x *= 0.8;
        R.armL.sh.rotation.x = -0.7; R.armR.sh.rotation.x = -0.7;
        R.jaw.rotation.x += (0.25 + this.dread * 0.4 - R.jaw.rotation.x) * Math.min(1, dt * 7);
        this.fig.position.y = Math.sin(this.t * 2.5) * 0.02;
        const wave = Math.sin(this.t * 18) * 0.06;
        this.fig.scale.y = 1.32 + wave * 0.12;
        return;
      }
      R.shoulderBar.rotation.x *= 0.9;
      const dest = this.patrol[this.nextIdx];
      v1.subVectors(dest, this.fig.position); v1.y = 0;
      const dist = v1.length();
      if (this.stare > 0) {
        // frozen, staring — only the head twitches
        this.stare -= dt;
        R.legL.hip.rotation.x *= 0.9; R.legR.hip.rotation.x *= 0.9;
        R.armL.sh.rotation.x *= 0.9; R.armR.sh.rotation.x *= 0.9;
        R.headG.rotation.z = Math.sin(this.t * 7) * 0.14;
        // it breathes, and it is very slightly too tall to be human
        this.fig.position.y = Math.sin(this.t * 1.5) * 0.012;
        if (this.stare <= 0) R.headG.rotation.z = 0;
      } else if (dist < 0.35) {
        this.nextIdx = (this.nextIdx + 1 + Math.floor(Math.random() * 2)) % this.patrol.length;
        if (Math.random() < 0.35) this.stare = 1.2 + Math.random() * 1.6; // sometimes it just stops
        // idle sway in the corner: weight shifting, head drifting
        R.headG.rotation.y = Math.sin(this.t * 0.9) * 0.16;
        R.headG.rotation.x = 0.05 + Math.sin(this.t * 0.7) * 0.05;
        R.shoulderBar.rotation.z = Math.sin(this.t * 0.8) * 0.05;
        this.fig.position.y = Math.sin(this.t * 1.4) * 0.010;
      } else {
        // walk toward the waypoint
        v1.normalize();
        this.fig.position.addScaledVector(v1, Math.min(this.walkSpeed * dt, dist));
        const yaw = Math.atan2(v1.x, v1.z);
        this.fig.rotation.y += wrapAngle(yaw - this.fig.rotation.y) * Math.min(1, dt * 5);
      const s = Math.sin(this.t * 5.4);
      const s2 = Math.sin(this.t * 2.7);
      R.legL.hip.rotation.x = s * 0.55;
      R.legR.hip.rotation.x = -s * 0.55;
      R.legL.knee.rotation.x = Math.max(0, -s) * 0.7;
      R.legR.knee.rotation.x = Math.max(0, s) * 0.7;
      R.armL.sh.rotation.x = -s * 0.4;
      R.armR.sh.rotation.x = s * 0.4;
      R.armL.el.rotation.x = -0.25;
      R.armR.el.rotation.x = -0.25;
      R.shoulderBar.rotation.z = s * 0.09;
      R.shoulderBar.rotation.x = 0.06 + Math.abs(s) * 0.05;
      R.shoulderBar.rotation.y = s2 * 0.03;
      R.jaw.rotation.x += (0.05 + Math.abs(s) * 0.03 - R.jaw.rotation.x) * Math.min(1, dt * 4);
      this.fig.position.y = Math.abs(Math.cos(this.t * 5.4)) * 0.035;
      R.headG.rotation.x = 0.06;
      R.headG.rotation.y = s2 * 0.04;
      R.headG.rotation.z = s * 0.05;
      }
      return;
    }

    if (this.state === MonsterState.HUNTING) {
      this.huntT -= dt;
      // Lurching creep in: legs drag, head lolls side to side, and it
      // advances faster the closer it gets — the last second is a lunge.
      const urgency = 1 - Math.max(0, Math.min(1, this.huntT / 7));
        const creep = Math.sin(this.t * (2.0 + urgency * 4.5));
      const creep2 = Math.sin(this.t * (3.5 + urgency * 8.0));
      R.headG.rotation.z = Math.sin(this.t * (2.2 + urgency * 8.0)) * (0.15 + urgency * 0.4);
      R.headG.rotation.x = 0.25 + creep * 0.18;
      R.headG.rotation.y = Math.sin(this.t * 5.5) * urgency * 0.45;
      R.jaw.rotation.x += (0.5 + urgency * 0.8 - R.jaw.rotation.x) * Math.min(1, dt * 9);
      R.armL.sh.rotation.x = -0.75 + creep2 * 0.4 - urgency * 0.85;
      R.armR.sh.rotation.x = -0.75 - creep2 * 0.4 - urgency * 0.85;
      R.armL.el.rotation.x = -0.6 - urgency * 0.95;
      R.armR.el.rotation.x = -0.6 - urgency * 0.95;
      R.shoulderBar.rotation.z = creep * (0.18 + urgency * 0.25);
      R.shoulderBar.rotation.x = 0.1 + urgency * 0.15;
      R.legL.hip.rotation.x = creep * 0.45;
      R.legR.hip.rotation.x = -creep * 0.45;
      R.legL.knee.rotation.x = Math.max(0, -creep) * 0.6;
      R.legR.knee.rotation.x = Math.max(0, creep) * 0.6;
      // It keeps creeping in from the doorway toward the middle of the office.
      this.fig.position.z += dt * (0.22 + urgency * 0.55);
      this.fig.position.y = Math.abs(Math.cos(this.t * (2.0 + urgency * 3.0))) * 0.03;
      // Arrived inside (fully past the door plane), or ran out of time.
      if (this.fig.position.z > -2.2 || this.huntT <= 0) {
        hooks.onHuntResolve?.();
      }
      return;
    }

    if (this.state === MonsterState.PATROL || this.state === MonsterState.CHASE) {
      // main.js owns the patrol context (player pos, hiding, torch, noise).
      if (!hooks.patrolCtx) return;
      this.updatePatrol(dt, hooks.patrolCtx, hooks);
      return;
    }

    if (this.state === MonsterState.LEAVING) {
      // Walk back out to the door, then it is gone.
      this.leaveT -= dt;
      const dest = this.work.v1.set(3.6, 0, -4.6);
      v1.subVectors(dest, this.fig.position); v1.y = 0;
      const d = v1.length();
      if (d > 0.25) {
        v1.normalize();
        this.fig.position.addScaledVector(v1, Math.min(1.5 * dt, d));
        this.fig.rotation.y += wrapAngle(Math.atan2(v1.x, v1.z) - this.fig.rotation.y) * Math.min(1, dt * 5);
        this.animateWalk(dt, 6.0, 0.9);
        this.stepT -= dt;
        if (this.stepT <= 0) { audio.footstep(0.5); this.stepT = 0.42; }
      } else {
        this.animateWalk(dt, 0, 0);
        this.fig.position.y = Math.sin(this.t * 1.4) * 0.012;
      }
      if (this.leaveT <= 0) { hooks.onLeft?.(); }
      return;
    }

    if (this.state === MonsterState.SCARING) {
      // It closes on the lens the whole time, accelerating in, so the last
      // frames are the face filling the screen rather than a static prop.
      this.scareT -= dt;
      const cam = this.scareCam;
      const fig = this.scareFig || this.fig;
      const isVoid = fig === this.voidFig;
      const k = 1 - THREE.MathUtils.clamp(this.scareT / this.scareDur, 0, 1); // 0 -> 1
      if (cam) {
        v1.set(0, 0, -1).applyQuaternion(cam.quaternion);
        // 0.78m -> 0.28m, easing in so the last third is a slam
        const dist = 0.78 - 0.5 * (k * k);
        fig.position.copy(cam.position).add(v1.multiplyScalar(dist));
        // Park the MOUTH on the lens: the jaw sits ~2.3m above the rig origin,
        // so the origin goes underground and the teeth fill the screen.
        // (The old offset aimed the hips at the camera.)
        fig.position.y = isVoid
          ? cam.position.y - 2.45 + Math.sin(this.t * 21) * 0.05   // face pinned to the lens
          : cam.position.y - 2.3 + Math.sin(this.t * 9.5) * 0.06;
        fig.rotation.set(0, Math.atan2(cam.position.x - fig.position.x, cam.position.z - fig.position.z), 0);
      }
      if (isVoid) {
        // The wire body thrashes: limbs thrown up and out, head jittering.
        this.animateVoid(this.t, true);
      } else {
        // IT EATS YOU: the mouth works in big chomps — gape wide, snap shut
        // with a slam, head bobbing down into each bite while the arms pin
        // the victim. Not a lens rush; a feeding.
        const chomp = Math.sin(this.t * 9.5);
        const bite = chomp > 0.86; // jaw just snapped shut
        R.jaw.rotation.x = 0.15 + (0.5 - 0.5 * chomp) * 1.25;
        if (bite && !this._chomped) { audio.slam(); this._chomped = true; }
        if (!bite) this._chomped = false;
        // head strikes down into the bite, shakes side to side tearing
        R.headG.rotation.x = 0.55 - (0.5 - 0.5 * chomp) * 0.5 + (Math.random() - 0.5) * 0.15;
        R.headG.rotation.z += ((Math.random() - 0.5) * 0.9 - R.headG.rotation.z) * Math.min(1, dt * 35);
        R.headG.rotation.y = (Math.random() - 0.5) * 0.5;
        // arms clamp inward like it's holding you still for the next bite
        R.armL.sh.rotation.x = -1.1 + chomp * 0.15;
        R.armR.sh.rotation.x = -1.1 - chomp * 0.15;
        R.armL.sh.rotation.z = 0.5;
        R.armR.sh.rotation.z = -0.5;
        R.armL.el.rotation.x = -0.9;
        R.armR.el.rotation.x = -0.9;
        R.shoulderBar.rotation.x = 0.45 - (0.5 - 0.5 * chomp) * 0.3;
        R.shoulderBar.rotation.z = (Math.random() - 0.5) * 0.25;
        // each bite shakes the view — the camera is inside its mouth
        if (cam && bite) {
          cam.position.x += (Math.random() - 0.5) * 0.05;
          cam.position.y += (Math.random() - 0.5) * 0.05;
        }
      }
      if (this.scareT <= 0) {
        this.scareCam = null;
        hooks.onCaught?.();
      }
    }
  }
}
