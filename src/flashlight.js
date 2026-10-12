import * as THREE from 'three';
import { gameState } from './gameState.js';

export function createFlashlight(camera, scene) {
  const spot = new THREE.SpotLight(0xfff2d9, 30, 25, Math.PI / 6.5, 0.45, 1.2);
  spot.castShadow = true; // the beam throws real shadows
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.2;
  spot.shadow.camera.far = 20;
  spot.shadow.bias = -0.004;
  scene.add(spot);
  scene.add(spot.target);

  // Small visible "torch" glow + point fill so nearby objects are readable
  const fill = new THREE.PointLight(0xffe9c4, 0.6, 4);
  scene.add(fill);

  const fl = {
    on: true,
    battery: 100, // percent
    fear: 0, // 0..1 — the beam stutters when something is hunting you
    spot,
    toggle() { fl.on = !fl.on; gameState.flashlightOn = fl.on; },
    /** Center of the beam in world space (where the crosshair points). */
    beamCenter() {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      return camera.position.clone().add(dir.multiplyScalar(5));
    },
    /**
     * Is a world-space point inside the flashlight cone?
     * True only while the light is on and has charge.
     */
    isPointLit(point) {
      if (!fl.on || fl.battery <= 0) return false;
      const toPoint = point.clone().sub(spot.position);
      const dist = toPoint.length();
      if (dist > spot.distance + 2) return false;
      const beamDir = spot.target.position.clone().sub(spot.position).normalize();
      const angle = beamDir.angleTo(toPoint.normalize());
      // Slightly generous vs. the visual cone so edge hits still count.
      return angle <= spot.angle * 1.25;
    },
    update(dt) {
      if (fl.on) {
        fl.battery = Math.max(0, fl.battery - dt * 2.2); // ~45s of light
        if (fl.battery <= 0) { fl.on = false; gameState.flashlightOn = false; }
      } else {
        fl.battery = Math.min(100, fl.battery + dt * 4);
      }
      const flicker = 1 + (Math.random() - 0.5) * 0.04;
      let level = fl.on ? 30 * flicker * (0.35 + 0.65 * (fl.battery / 100 + 0.3)) : 0;
      // Low battery (<20%): failing bulb — random dropouts + stutter.
      if (fl.on && fl.battery < 20) {
        fl._drop = Math.max(0, (fl._drop ?? 0) - dt);
        if (fl._drop <= 0 && Math.random() < dt * 2.2) fl._drop = 0.05 + Math.random() * 0.16;
        if (fl._drop > 0) level *= Math.random() < 0.5 ? 0.05 : 0.45;
        else if (Math.random() < 0.12) level *= 0.7; // constant stutter
      }
      spot.intensity = level;
      // Pure fear: the beam cuts out in bursts while it is close.
      if (fl.on && fl.fear > 0 && Math.random() < fl.fear * 0.4) spot.intensity *= 0.15;
      fill.intensity = fl.on ? 0.6 * (spot.intensity / 30) : 0;
      // Attach to camera
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      spot.position.copy(camera.position);
      spot.target.position.copy(camera.position).add(dir.multiplyScalar(5));
      fill.position.copy(camera.position);
    },
  };
  gameState.flashlightOn = true;
  return fl;
}
