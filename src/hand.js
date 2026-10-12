// Two-handed first-person viewmodel (R15-style: one rounded slab per hand).
//
// Everything lives in its own scene + camera and is drawn as a separate pass
// after the world, so the hands can never be hit by the report raycast, cast
// shadows into the office, occlude CCTV inspection, or appear on CAM 01.
//
// Hand-local convention (shared by both hands):
//   +Z = toward the fingertips     +Y = back of hand (dorsal)
//   +X = thumb side (radial)      -Y = palm side
// side = +1 for the right hand, -1 for the left (mirrors X).

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Rest poses in camera space. The overlay camera is 55deg / 16:9, so at
 *  z=-0.5 the visible half-height is only ~0.26 — anything lower is cropped. */
const POSE = {
  idle:   { R: new THREE.Vector3(0.245, -0.205, -0.50), L: new THREE.Vector3(-0.255, -0.215, -0.50) },
  ready:  { R: new THREE.Vector3(0.140, -0.130, -0.46), L: new THREE.Vector3(-0.150, -0.140, -0.46) },
  desk:   { R: new THREE.Vector3(0.115, -0.150, -0.40), L: new THREE.Vector3(-0.125, -0.160, -0.40) },
  hide:   { R: new THREE.Vector3(0.155, -0.135, -0.37), L: new THREE.Vector3(-0.165, -0.145, -0.37) },
  guard:  { R: new THREE.Vector3(0.185, -0.090, -0.38), L: new THREE.Vector3(-0.195, -0.100, -0.38) },
  torch:  { R: new THREE.Vector3(0.215, -0.085, -0.44), L: new THREE.Vector3(-0.190, -0.215, -0.50) },
};

export function createHand() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 4);
  scene.add(camera);

  // Three-point rig. Key from the upper left (the desk lamp), cool fill from
  // the window behind, warm bounce from below so fingers never go flat.
  const key = new THREE.DirectionalLight(0xffe6c0, 2.4);
  key.position.set(-0.6, 1.0, 0.5);
  camera.add(key);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.95);
  fill.position.set(0.8, -0.2, -1.0);
  camera.add(fill);
  const bounce = new THREE.DirectionalLight(0xffb27a, 0.6);
  bounce.position.set(0.1, -1.0, 0.6);
  camera.add(bounce);
  // A viewmodel has to stay readable in a pitch-black office, so the rig keeps
  // a brightness floor that no pose rotation can drop below. Kept modest: the
  // hand is one broad slab, so a strong key washes its top face out.
  scene.add(new THREE.AmbientLight(0x6a7488, 1.9));
  const floor = new THREE.DirectionalLight(0xffd8b0, 0.8);
  floor.position.set(0.2, 0.4, -1.0);
  camera.add(floor);

  const M = {
    skin: new THREE.MeshStandardMaterial({ color: 0xc99a7a, roughness: 0.72, metalness: 0.02 }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0x1a1e26, roughness: 0.4, metalness: 0.5,
      emissive: 0xffe9c4, emissiveIntensity: 1.6,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.34, metalness: 0.85 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x5c636d, roughness: 0.46, metalness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.95, metalness: 0.05 }),
    lens: new THREE.MeshStandardMaterial({
      color: 0xfff4dc, roughness: 0.12, metalness: 0.1,
      emissive: 0xfff0d0, emissiveIntensity: 2.4,
    }),
  };

  /**
   * A plain rectangle with every edge softened: a rounded-rect profile in XY,
   * extruded along Z with a bevel, so all twelve edges catch the light instead
   * of reading as hard corners. This is the whole hand.
   */
  function roundedBox(w, h, d, r, mat, bevel = 0.009) {
    const rr = Math.max(0.0005, Math.min(r, w / 2 - 0.001, h / 2 - 0.001));
    const x = w / 2;
    const y = h / 2;
    const s = new THREE.Shape();
    s.moveTo(-x + rr, -y);
    s.lineTo(x - rr, -y);
    s.quadraticCurveTo(x, -y, x, -y + rr);
    s.lineTo(x, y - rr);
    s.quadraticCurveTo(x, y, x - rr, y);
    s.lineTo(-x + rr, y);
    s.quadraticCurveTo(-x, y, -x, y - rr);
    s.lineTo(-x, -y + rr);
    s.quadraticCurveTo(-x, -y, -x + rr, -y);

    const bv = Math.max(0.0005, Math.min(bevel, d / 2 - 0.001, x - rr - 0.001, y - rr - 0.001));
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: Math.max(0.001, d - bv * 2),
      bevelEnabled: true,
      bevelThickness: bv,
      bevelSize: bv,
      bevelOffset: 0,
      bevelSegments: 4,
      curveSegments: 6,
    });
    geo.center(); // extrusion is not centred on its own
    // ExtrudeGeometry's bevel grows the contour outward by an amount that
    // depends on the bevel settings, so normalise afterwards to guarantee the
    // finished slab is exactly w x h x d.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.scale(w / (bb.max.x - bb.min.x), h / (bb.max.y - bb.min.y), d / (bb.max.z - bb.min.z));
    geo.computeVertexNormals(); // the scale above is not uniform
    return new THREE.Mesh(geo, mat);
  }

  /**
   * One hand. side: +1 right (thumb toward +X), -1 left.
   * R15 style: one smooth rectangle, no digits.
   * Returns the joints the animation controller drives.
   */
  function makeHand(side) {
    const root = new THREE.Group();
    const arm = new THREE.Group();
    root.add(arm);

    // ---- The hand is a single rounded rectangle floating in view. No wrist,
    // no forearm, no sleeve, no cuff, no watch: just the slab.
    const palm = new THREE.Group();
    arm.add(palm);

    const mitt = roundedBox(0.096, 0.054, 0.140, 0.018, M.skin, 0.010);
    mitt.position.set(0, 0, -0.028);
    palm.add(mitt);

    // No fingers by design. Kept as an empty array so callers can feature-test.
    const fingers = [];
    let thumbBase = null;
    let thumbIP = null;

    // ---- The torch itself, gripped in the right hand (left hand hides it)
    let torch = null;
    if (side > 0) {
      torch = new THREE.Group();
      torch.position.set(0.006 * side, -0.052, 0.030);
      torch.rotation.set(-16 * DEG, 6 * DEG, 8 * DEG);
      palm.add(torch);

      // Barrel: knurled aluminium, slightly narrower toward the tail cap.
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0185, 0.0165, 0.132, 14), M.steel
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.014;
      torch.add(barrel);

      // Grip bands, so it reads as a real torch instead of a plain tube.
      for (const gz of [0.046, 0.026, 0.006]) {
        const band2 = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0205, 0.0205, 0.009, 14), M.rubber
        );
        band2.rotation.x = Math.PI / 2;
        band2.position.z = gz;
        torch.add(band2);
      }

      // Tail cap.
      const tail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0175, 0.014, 0.020, 14), M.steelDark
      );
      tail.rotation.x = Math.PI / 2;
      tail.position.z = 0.088;
      torch.add(tail);

      // Head: flared reflector housing.
      const headHousing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.0195, 0.052, 18), M.steel
      );
      headHousing.rotation.x = Math.PI / 2;
      headHousing.position.z = -0.095;
      torch.add(headHousing);

      // Bezel ring around the lens.
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0035, 6, 20), M.steelDark);
      bezel.position.z = -0.119;
      torch.add(bezel);

      // Reflector dish + lens, facing down the beam axis (-Z).
      const reflector = new THREE.Mesh(
        new THREE.CircleGeometry(0.031, 20), M.lamp
      );
      reflector.rotation.y = Math.PI;
      reflector.position.z = -0.1175;
      torch.add(reflector);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 20), M.lens);
      lens.rotation.y = Math.PI;
      lens.position.z = -0.1205;
      torch.add(lens);

      // Thumb switch on top of the barrel.
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.010, 0.026), M.rubber);
      sw.position.set(0, 0.019, -0.012);
      torch.add(sw);
      const swCap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 10), M.steelDark);
      swCap.position.set(0, 0.024, -0.012);
      torch.add(swCap);

      torch.rotation.y = -20 * DEG; // points down the beam axis
      torch.userData.lens = lens;
      torch.userData.reflector = reflector;
    }

    return { side, root, arm, palm, fingers, thumbBase, thumbIP, torch };
  }

  // ---- Rig root: both hands hang off this, so sway is one transform.
  const rig = new THREE.Group();
  camera.add(rig);

  const right = makeHand(1);
  const left = makeHand(-1);
  // Mirror the left hand so its thumb also points outward-inward correctly.
  left.root.scale.x = -1;
  left.root.position.copy(POSE.idle.L);
  right.root.position.copy(POSE.idle.R);
  rig.add(left.root, right.root);

  // ---------------------------------------------------------------------------
  // Animation state
  // ---------------------------------------------------------------------------
  const state = {
    t: 0,
    swayX: 0, swayY: 0,       // look lag behind head turns
    bob: 0,                   // walk cycle
    recoil: 0,                // report punch
    tremor: 0,                // hunt / scare shake
    clench: 0,                // 0 relaxed .. 1 fist
    guard: 0,                 // 0 idle .. 1 defensive up
    lookDown: 0,              // 0 forward .. 1 head tipped down at the hands
    torchT: 0,                // 0 stowed .. 1 raised (flashlight toggle)
    torchOn: true,
    typing: 0,                // keyboard tap amount
    lastYaw: 0, lastPitch: 0,
    visible: true,
    tapPhase: 0,
    idleSeed: Math.random() * 100,
  };

  const hands = [right, left];
  const clamp = THREE.MathUtils.clamp;
  /** Frame-rate independent approach factor. */
  const approach = (dt, rate) => 1 - Math.exp(-rate * dt);

  const api = {
    scene,
    camera,
    rig,
    state,
    hands,
    get visible() { return state.visible; },
    get lookDown() { return state.lookDown; },

    /** Snap the trailing sway (teleport / seat) so it doesn't whip. */
    sync() {
      state.lastYaw = 0; state.lastPitch = 0;
      state.swayX = 0; state.swayY = 0;
      state.bob = 0; state.clench = 0; state.guard = 0;
      state.recoil = 0; state.tremor = 0; state.lookDown = 0; state.torchT = 0;
    },

    /** Both hands slam the report button. */
    punch(amount = 1) {
      state.recoil = Math.min(1.4, state.recoil + amount);
    },

    /** React to a noise: hands flinch up for a moment. */
    flinch(amount = 1) {
      state.flinchT = 0.45 * amount;
      state.flinch = Math.min(1, (state.flinch ?? 0) + amount);
    },

    setTremor(v) { state.tremor = clamp(v, 0, 1); },
    setClench(v) { state.clenchTarget = clamp(v, 0, 1); },
    setVisible(v) { state.visible = !!v; rig.visible = !!v; },
    setTorch(on) { state.torchOn = !!on; },

    /**
     * ctx: { dt, yaw, pitch, walking, mode, fear, dread, hunt, dead }
     */
    update(ctx) {
      const dt = Math.min(ctx.dt, 0.05);
      state.t += dt;
      const t = state.t;

      // --- Look lag: hands trail a fast head turn, then settle.
      const dYaw = ctx.yaw - state.lastYaw;
      const dPitch = ctx.pitch - state.lastPitch;
      state.lastYaw = ctx.yaw; state.lastPitch = ctx.pitch;
      state.swayX += (clamp(-dYaw * 3.2, -0.07, 0.07) - state.swayX) * approach(dt, 9);
      state.swayY += (clamp(-dPitch * 2.6, -0.05, 0.05) - state.swayY) * approach(dt, 9);

      // --- Looking down brings both hands up into frame.
      const wantLook = ctx.pitch < -0.28 ? clamp((-ctx.pitch - 0.28) / 0.75, 0, 1) : 0;
      state.lookDown += (wantLook - state.lookDown) * approach(dt, 7);

      // --- Walk bob: hands counter-swing against the body.
      const walking = ctx.walking && ctx.mode === 'walk';
      state.bob = walking ? Math.sin(t * 9) : state.bob * 0.88;

      // --- Breathing + idle finger fidget (never perfectly still).
      const breath = Math.sin(t * 1.35) * 0.004;
      state.tapPhase += dt * (walking ? 1 : 0.55);
      state.flinch = Math.max(0, (state.flinch ?? 0) - dt * 2.2);

      // --- Targets
      const stress = Math.max(state.tremor, ctx.dread ?? 0, ctx.hunt ? 0.7 : 0);
      const guardTarget = ctx.dead ? 1 : ctx.hunt ? 0.85 : stress > 0.6 ? 0.35 : 0;
      state.guard += (guardTarget - state.guard) * approach(dt, 6);
      const clenchTarget = clamp(
        Math.max(state.clenchTarget ?? 0, ctx.mode === 'hide' ? 0.9 : 0, stress * 0.6), 0, 1
      );
      state.clench += (clenchTarget - state.clench) * approach(dt, 8);
      state.typing = (ctx.mode === 'desk' ? 1 : 0) * (1 - state.lookDown * 0.5);
      state.torchT += ((ctx.torchUp ?? state.torchOn ? 1 : 0) - state.torchT) * approach(dt, 8);
      state.recoil = Math.max(0, state.recoil - dt * 4.2);

      const punchAmt = state.recoil * state.recoil;
      const punchPose = punchAmt * (1 - state.guard * 0.5);

      for (const h of hands) {
        const s = h.side;

        // ---- Pick the base pose and blend toward the look-down pose.
        const base = ctx.mode === 'desk' ? POSE.desk
          : ctx.mode === 'hide' ? POSE.hide
            : POSE.idle;
        const guardPose = POSE.guard;
        const px = (1 - state.guard) * (base[s > 0 ? 'R' : 'L'].x
          + (POSE.ready[s > 0 ? 'R' : 'L'].x - base[s > 0 ? 'R' : 'L'].x) * state.lookDown)
          + state.guard * guardPose[s > 0 ? 'R' : 'L'].x;
        const py = (1 - state.guard) * (base[s > 0 ? 'R' : 'L'].y
          + (POSE.ready[s > 0 ? 'R' : 'L'].y - base[s > 0 ? 'R' : 'L'].y) * state.lookDown)
          + state.guard * guardPose[s > 0 ? 'R' : 'L'].y;
        const pz = (1 - state.guard) * (base[s > 0 ? 'R' : 'L'].z
          + (POSE.ready[s > 0 ? 'R' : 'L'].z - base[s > 0 ? 'R' : 'L'].z) * state.lookDown)
          + state.guard * guardPose[s > 0 ? 'R' : 'L'].z;

        // Counter-phase: the right hand swings forward as the left swings back.
        const swing = state.bob * 0.020 * s;
        const jitterX = state.tremor * (Math.random() - 0.5) * 0.030;
        const jitterY = state.tremor * (Math.random() - 0.5) * 0.026;

        const tx = px + state.swayX * 0.5 + swing + jitterX;
        const ty = py + state.swayY * 0.5 - state.bob * 0.012 + breath + jitterY;
        const tz = pz - punchPose * 0.075 - state.guard * 0.03
          - state.flinch * 0.05 - state.lookDown * 0.02;

        h.root.position.x += (tx - h.root.position.x) * approach(dt, 13);
        h.root.position.y += (ty - h.root.position.y) * approach(dt, 13);
        h.root.position.z += (tz - h.root.position.z) * approach(dt, 15 + punchAmt * 20);

        // ---- Arm/hand orientation
        const readyTilt = state.lookDown * 0.55;
        h.root.rotation.set(
          readyTilt + punchPose * 0.34 + state.flinch * 0.30 + state.bob * 0.012,
          (-0.22 + state.swayX * 1.6 + state.guard * 0.30) * s
            + Math.sin(t * 0.7 + s) * 0.015,
          (0.14 + state.swayX * 0.9 + state.tremor * 0.10 * Math.sin(t * 23)) * s
            - state.bob * 0.05
        );

        // ---- Hand block
        const fist = state.clench;
        // Keyboard typing: the two hands alternate so it does not look synced.
        const typing = state.typing * (
          Math.sin(t * 11 + (s > 0 ? 0 : Math.PI)) * 0.5 + 0.5
        );
        // A single slab has no joints to articulate, so every bit of
        // expression the finger chain used to carry moves to the whole block:
        // a clench tilts it into a fist, typing taps it, stress shakes it.
        const fidget = (Math.sin(t * 0.9 + state.idleSeed + s) * 0.5 + 0.5) * 0.10;
        const jitter = stress * 0.09 * Math.sin(t * 19 + s);
        h.palm.rotation.x = fist * 0.62 + punchPose * 0.30
          + state.lookDown * 0.12 - typing * 0.26 + fidget * 0.20 + jitter;
        h.palm.rotation.y = fist * 0.16 * s - state.guard * 0.20 * s
          + state.swayX * 1.2;
        h.palm.rotation.z = fist * 0.14 * s - state.lookDown * 0.10 * s;
        // The mitten rides slightly up as it curls, and dips when you relax.
        h.palm.position.y = -fist * 0.010 - typing * 0.006
          + Math.sin(t * 1.6 + state.idleSeed) * 0.004;

        // Torch: raised briefly on F, otherwise tucked in the right fist.
        if (h.torch) {
          const tt = state.torchT;
          h.torch.position.set(0.006 * s, -0.052 + tt * 0.055, 0.030 - tt * 0.045);
          h.torch.rotation.set(-16 * DEG + tt * 0.55, (6 - tt * 26) * DEG, 8 * DEG);
          // Lens brightens with the toggle; the reflector keeps a faint glow so
          // the torch still reads as glass when it is switched off.
          const lit = state.torchOn ? 1 : 0;
          M.lens.emissiveIntensity = lit
            ? 2.4 + Math.sin(t * 9) * 0.12
            : 0.10;
          M.lamp.emissiveIntensity = lit
            ? 0.55 + Math.sin(t * 9) * 0.05
            : 0.04;
        }
      }
    },

    /** Render the viewmodel over the finished frame. */
    render(renderer, aspect) {
      if (!state.visible) return;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const wasAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
      renderer.autoClear = wasAutoClear;
    },
  };

  return api;
}