// The outage stalker, built as its own body: a Backrooms "wire / smudge"
// void creature — a tall wiggly pitch-black strand column, two long arms
// reaching at the lens, needle claws, and a fixed white grin with mismatched
// eyes. Authored from the reference design (sinusoidal spine over 0..12 units,
// braided silhouette strands, arm sweep, face layout), scaled to metres.
//
// The face parts are MeshBasicMaterial white/red so they read as glowing
// against the black body in a dead-dark corridor; the body is near-black
// standard material so the flashlight still catches it as a silhouette.
import * as THREE from 'three';

const H = 2.6;        // total height in metres (the design is 12 units tall)
const S = H / 12;     // design unit -> metres
const TOP_U = 12;
const ARM_U = 8;      // where the design's arms leave the spine (index 240/350)

// Spine offsets straight from the design (x/y wander over z 0..12).
const spineX = (u) => (1.6 * Math.sin(1.8 * u) + 0.4 * Math.cos(3.5 * u)) * S;
const spineZ = (u) => (1.2 * Math.cos(1.4 * u) + 0.5 * Math.sin(2.2 * u)) * S;

class SpineCurve extends THREE.Curve {
  getPoint(t, target = new THREE.Vector3()) {
    const u = t * TOP_U;
    return target.set(spineX(u), u * S, spineZ(u));
  }
}

/** One of the 12 braided strands ringing the core — the "wire" silhouette. */
class StrandCurve extends THREE.Curve {
  constructor(angle) { super(); this.angle = angle; }
  getPoint(t, target = new THREE.Vector3()) {
    const u = t * TOP_U;
    const r = 0.4 * (1.1 - u / 15) * S * 1.75;   // design taper, widened so the ring reads as a body
    const a = this.angle + u * 0.5;              // slow twist: the wires braid as they climb
    return target.set(spineX(u) + r * Math.cos(a), u * S, spineZ(u) + r * Math.sin(a));
  }
}

/** A long wiggly arm from the shoulder: forward (+Z) and down, wobbling. */
class ArmCurve extends THREE.Curve {
  constructor(side) { super(); this.side = side; }
  getPoint(t, target = new THREE.Vector3()) {
    const s = this.side;
    const x = s * (0.05 + 0.55 * t + 0.18 * t * Math.sin(4.5 * t));
    const y = -0.72 * t + 0.26 * Math.sin(3.0 * t);
    const z = 0.85 * t * t + 0.14 * t * Math.sin(6.0 * t);
    return target.set(x, y, z);
  }
}

export function buildVoidStalker() {
  const root = new THREE.Group();

  const voidMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.99, metalness: 0.0, emissive: 0x050505,
  });
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.99, metalness: 0.0, emissive: 0x040404,
  });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const red = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });

  // --- Body: solid core tube plus the braided strand ring around it
  root.add(new THREE.Mesh(new THREE.TubeGeometry(new SpineCurve(), 170, 0.11, 10, false), voidMat));
  for (let i = 0; i < 16; i++) {
    const geo = new THREE.TubeGeometry(new StrandCurve((i / 16) * Math.PI * 2), 150, 0.022, 6, false);
    root.add(new THREE.Mesh(geo, wireMat));
  }

  // --- Head: black bulb at the spine top, carrying the floating face
  const headG = new THREE.Group();
  headG.position.copy(new SpineCurve().getPoint(1));
  headG.position.y -= 0.12;   // sink the bulb onto the spine tip: total height ~2.7m
  root.add(headG);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), voidMat);
  bulb.scale.set(1.0, 1.08, 0.92);
  headG.add(bulb);

  // The grinning mouth: a wide sagging curve (corners up, centre dropped).
  const MOUTH_W = 0.30, MOUTH_Y = -0.045, MOUTH_DROP = 0.15, FACE_Z = 0.215;
  const mouthPt = (a) => new THREE.Vector3(a * MOUTH_W, MOUTH_Y - MOUTH_DROP * (1 - a * a), FACE_Z - 0.05 * a * a);
  const mouthPts = [];
  for (let i = 0; i <= 16; i++) mouthPts.push(mouthPt(-1 + (2 * i) / 16));
  headG.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mouthPts), 64, 0.024, 6, false), white));

  // Razor teeth hanging from the grin curve.
  const toothGeo = new THREE.BoxGeometry(0.016, 1, 0.012);
  for (let i = 0; i < 14; i++) {
    const a = -0.88 + (1.76 * i) / 13;
    const p = mouthPt(a);
    const len = 0.115 * (1 - 0.35 * Math.abs(a));
    const tooth = new THREE.Mesh(toothGeo, white);
    tooth.scale.y = len;
    tooth.position.set(p.x, p.y - len / 2 - 0.012, p.z + 0.006);
    headG.add(tooth);
  }

  // Mismatched eyes: a big hollow ring left, a frantic pinprick right.
  const eyeL = new THREE.Group();
  eyeL.position.set(-0.135, 0.105, FACE_Z - 0.02);
  eyeL.add(new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), white));
  const ringL = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.013, 8, 26), red);
  ringL.position.z = 0.004;
  eyeL.add(ringL);
  const pupilL = new THREE.Mesh(new THREE.CircleGeometry(0.044, 18), black);
  pupilL.position.z = 0.008;
  eyeL.add(pupilL);
  headG.add(eyeL);

  const eyeR = new THREE.Group();
  eyeR.position.set(0.135, 0.09, FACE_Z - 0.02);
  eyeR.add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 18), white));
  const coreR = new THREE.Mesh(new THREE.CircleGeometry(0.023, 14), red);
  coreR.position.z = 0.006;
  eyeR.add(coreR);
  headG.add(eyeR);

  // A faint cold light at the face so the creature lights its own approach.
  const faceGlow = new THREE.PointLight(0xff0000, 1.8, 5.5, 1.9);
  faceGlow.position.set(0, 0.02, 0.26);
  headG.add(faceGlow);
  const throatGlow = new THREE.PointLight(0xff0000, 0.8, 4.0, 2.0);
  throatGlow.position.set(0, -0.12, 0.15);
  headG.add(throatGlow);

  // --- Arms: shoulder-pivoted so they can writhe and lunge
  const mkArm = (side) => {
    const g = new THREE.Group();
    g.position.set(spineX(ARM_U), ARM_U * S, spineZ(ARM_U));
    const curve = new ArmCurve(side);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.048, 7, false), voidMat));
    const tip = curve.getPoint(1);
    for (const f of [-0.16, -0.055, 0.055, 0.16]) {
      const claw = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.2, 0.016), white);
      claw.position.copy(tip).add(new THREE.Vector3(0, 0.01, 0.05));
      claw.rotation.x = 1.3;              // needles continue the reach
      claw.rotateZ(f);                    // fan them like fingers
      g.add(claw);
    }
    return g;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  root.add(armL, armR);

  /** Per-frame pose. `scare` throws the limbs wide and jitters the head. */
  function animate(t, scare = false) {
    root.rotation.z = Math.sin(t * 2.0) * 0.15;
    root.rotation.x = Math.sin(t * 1.5) * 0.1;
    root.rotation.y = Math.sin(t * 1.2) * 0.08;
    headG.rotation.y = Math.sin(t * 1.8) * (scare ? 1.2 : 0.5);
    headG.rotation.x = scare ? 0.5 + (Math.random() - 0.5) * 0.8 : Math.sin(t * 2.4) * 0.15;
    headG.rotation.z = scare ? (Math.random() - 0.5) * 0.7 : Math.sin(t * 3.0) * 0.2;
    const lift = scare ? -1.2 : -0.2;
    const wr = scare ? 1.8 : 0.7;
    armL.rotation.x = lift + Math.sin(t * (scare ? 35 : 2.5)) * 0.3 * wr;
    armL.rotation.y = Math.sin(t * 3.5) * 0.25 * wr;
    armL.rotation.z = Math.sin(t * 4.5) * 0.18 * wr;
    armR.rotation.x = lift + Math.sin(t * (scare ? 32 : 2.2) + 2) * 0.3 * wr;
    armR.rotation.y = -Math.sin(t * 3.2 + 1) * 0.25 * wr;
    armR.rotation.z = -Math.sin(t * 4.2 + 1) * 0.18 * wr;
  }

  return { root, animate, head: headG, arms: [armL, armR] };
}
