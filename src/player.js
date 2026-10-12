import * as THREE from 'three';
import { isTouchDevice } from './touch.js';

export function createPlayer(camera, domElement, collide = null) {
  const player = {
    pos: new THREE.Vector3(0, 1.6, 2.8),
    yaw: Math.PI, // face -z? adjusted below; room faces -z wall
    pitch: 0,
    keys: {},
    speed: 2.4,
    locked: false,
    bobT: 0,    // head-bob phase while walking
    speedNow: 0, // smoothed planar speed (m/s) for lean / bob amplitude
    strafe: 0,  // -1 left .. 1 right
    lean: 0,    // camera roll that follows a strafe
    moving: false,
    velocityY: 0,
    onGround: true,
    jumpStrength: 5.5,
    free: false, // free-fly debug camera: no collision, no gravity, no poses
  };

  // Start facing the desk/window wall (-z is forward default). yaw=0 looks -z.
  player.yaw = 0;

  // Body modes: 'walk' (free), 'desk' (seated at the monitor), 'hide' (under the desk).
  // Anything but walk lerps the camera to a fixed pose and ignores input.
  player.mode = 'walk';
  const POSES = {
    desk: { pos: new THREE.Vector3(-1.0, 1.5, -1.62), yaw: 0, pitch: -0.08 },
    hide: { pos: new THREE.Vector3(-1.2, 0.52, -2.02), yaw: 0, pitch: 0.06 },
    bed:  { pos: new THREE.Vector3(1.6, 0.38, -2.4), yaw: 0, pitch: 0.05 },
  };
  player.POSES = POSES;
  player.setMode = (m) => {
    if (player.mode !== 'walk' && m === 'walk') {
      // crawl back out: stay where you hid unless you hid under the office desk
      const inOffice = player.pos.z > -4.5;
      if (inOffice) player.pos.set(-1.0, 1.6, -0.9);
      else player.pos.y = 1.6;
    }
    player.mode = m;
    player.keys = {};
  };

  const touchDevice = isTouchDevice();
  domElement.addEventListener('click', () => {
    // Touch devices drag to look instead; grabbing the pointer there only
    // hides the on-screen controls and can fail outright.
    if (touchDevice) return;
    if (player.locked === false) {
      try {
        const r = domElement.requestPointerLock?.();
        r?.catch?.(() => {});
      } catch { /* pointer lock unavailable */ }
    }
  });
  document.addEventListener('pointerlockchange', () => {
    player.locked = document.pointerLockElement === domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!player.locked || (player.mode !== 'walk' && !player.free)) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch -= e.movementY * 0.0022;
    player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch));
  });
  window.addEventListener('keydown', (e) => { player.keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { player.keys[e.code] = false; });

  player.update = (dt, opts = {}) => {
    const refs = opts.refs || {};
    // Velocity-ish state used for the camera lean + the hand viewmodel.
    const prevX = player.pos.x;
    const prevZ = player.pos.z;
    if (player.free) {
      // Free-fly camera: WASD + mouse, Space up, Q down, Shift = fast.
      // No collision, no gravity, no poses — pure spectator.
      const fast = (player.keys['ShiftLeft'] || player.keys['ShiftRight']) ? 2.4 : 1;
      const speed = 5.5 * fast;
      const eul = new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ');
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(eul);
      const right = new THREE.Vector3(1, 0, 0).applyEuler(eul);
      const move = new THREE.Vector3();
      if (player.keys['KeyW']) move.add(fwd);
      if (player.keys['KeyS']) move.sub(fwd);
      if (player.keys['KeyD']) move.add(right);
      if (player.keys['KeyA']) move.sub(right);
      if (player.keys['Space']) move.y += 1;
      if (player.keys['KeyQ']) move.y -= 1;
      player.moving = move.lengthSq() > 0;
      player.strafe = 0;
      if (player.moving) {
        move.normalize().multiplyScalar(speed * dt);
        player.pos.add(move);
      }
      // Loose leash so you can't get lost in the void.
      player.pos.x = Math.max(-60, Math.min(60, player.pos.x));
      player.pos.y = Math.max(0.2, Math.min(25, player.pos.y));
      player.pos.z = Math.max(-60, Math.min(60, player.pos.z));
    } else if (player.mode !== 'walk') {
      // Seated / hidden: glide to the pose; allow yaw/pitch control while hiding.
      const pose = POSES[player.mode] || POSES.hide;
      const k = Math.min(1, Math.max(dt, 0.0001) * 7);
      player.pos.lerp(pose.pos, dt > 0 ? k : 1);
      if (player.mode === 'hide') {
        // allow camera movement while hiding
        player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch));
      } else {
        let dy = pose.yaw - player.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        player.yaw += dy * (dt > 0 ? k : 1);
        player.pitch += (pose.pitch - player.pitch) * (dt > 0 ? k : 1);
      }
    } else {
      const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const move = new THREE.Vector3();
      if (player.keys['KeyW']) move.add(forward);
      if (player.keys['KeyS']) move.sub(forward);
      if (player.keys['KeyA']) move.sub(right);
      if (player.keys['KeyD']) move.add(right);
      // Strafe amount drives the camera lean (-1 left .. 1 right).
      player.strafe = (player.keys['KeyD'] ? 1 : 0) - (player.keys['KeyA'] ? 1 : 0);
      player.moving = move.lengthSq() > 0;
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(player.speed * dt);
        player.pos.add(move);
        player.bobT += dt * 9; // head-bob only while actually stepping
      } else {
        player.strafe *= 0.9; // lean relaxes back to level
      }
      // Jump - simple gravity
      if (player.keys['Space'] && player.onGround) {
        player.velocityY = player.jumpStrength;
        player.onGround = false;
      }
      player.velocityY -= 20 * dt;
      player.pos.y += player.velocityY * dt;
      if (player.pos.y <= 1.6) {
        player.pos.y = 1.6;
        player.velocityY = 0;
        player.onGround = true;
      }
      // Keep inside room; allow corridor + power room behind the door, plus the
      // fuse wing (six chained rooms) out to the electrical room's back wall.
      const nearDoor = Math.hypot(player.pos.x - 3.6, player.pos.z + 3.0) < 1.9;
      const doorOpen = Math.abs((refs?.doorPivot?.rotation?.y) || 0) > 0.2;
      const nearBed = Math.hypot(player.pos.x - (-3.94), player.pos.z - (-0.2)) < 1.5;
      const inAnnex = (player.pos.z < -3.4 && player.pos.x > 2.2 && player.pos.x < 5.0) || (nearDoor && doorOpen && player.pos.z < -1.5);
      const inPower = player.pos.z <= -8.6 && player.pos.z >= -50.6 && player.pos.x >= -0.2 && player.pos.x <= 7.4;
      if (inAnnex || inPower) {
        player.pos.x = Math.max(-0.1, Math.min(7.1, player.pos.x));
        player.pos.z = Math.max(-49.6, Math.min(3.4, player.pos.z));
      } else {
        player.pos.x = Math.max(-4.2, Math.min(4.2, player.pos.x));
        player.pos.z = Math.max(-3.2, Math.min(3.4, player.pos.z));
      }
      // Allow getting under bed area without hard wall pushing back
      if (nearBed && player.pos.z < -1.8 && player.pos.z > -3.1) {
        // Don't clamp if trying to go under bed; collision will be handled? test allows sliding
      }
      // Furniture collision (desk, chair, cabinet, plant, open door).
      if (collide) collide(player.pos);
    }

    camera.position.copy(player.pos);
    // Speed measured from real displacement, so a wall you're leaning on or
    // a collision slide reads correctly instead of faking a walk cycle.
    const moved = Math.hypot(player.pos.x - prevX, player.pos.z - prevZ);
    const inst = dt > 0 ? moved / dt : 0;
    player.speedNow += (inst - player.speedNow) * Math.min(1, dt * 10);

    if (player.mode === 'walk') {
      // Breathing while still, head-bob while stepping, lean into strafes.
      const idle = performance.now() / 1000;
      const breathe = Math.sin(idle * 1.25) * 0.006;
      const bobAmp = 0.035 * Math.min(1, player.speedNow / player.speed);
      camera.position.y += Math.abs(Math.sin(player.bobT)) * bobAmp + breathe;
      camera.position.x += Math.sin(player.bobT * 0.5) * 0.012 * Math.min(1, player.speedNow / player.speed);
      camera.position.y -= Math.min(1, player.speedNow / player.speed) * 0.012; // weight under load
      player.lean += (player.strafe * 0.035 - player.lean) * Math.min(1, dt * 6);
    } else {
      player.lean += (0 - player.lean) * Math.min(1, dt * 5);
    }
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = player.lean;
  };

  player.reset = () => {
    player.pos.set(0, 1.6, 2.8);
    player.yaw = 0;
    player.pitch = 0;
    player.keys = {};
    player.mode = 'walk';
    player.free = false;
    player.bobT = 0; // head-bob phase while walking
    player.speedNow = 0;
    player.strafe = 0;
    player.lean = 0;
    player.moving = false;
    player.velocityY = 0;
    player.onGround = true;
  };

  return player;
}
