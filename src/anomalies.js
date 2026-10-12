import * as THREE from 'three';
import { audio } from './audio.js';

export const REPORT_RANGE = 6; // meters — reports only count inside this range

// Each anomaly: { id, label, duration, tag (matches userData.anomalyType),
// difficulty: 'obvious' | 'subtle',
// targets: [Object3D for raycast], apply(refs), revert(refs), update?.(refs, dt, t) }
export function defineAnomalies(refs) {
  return [
    // ---------- OBVIOUS ----------
    {
      id: 'painting-tilt', label: 'Painting tilted', duration: 60, tag: 'painting', difficulty: 'obvious',
      targets: [refs.painting],
      apply() { refs.painting.rotation.z = 0.35; },
      revert() { refs.painting.rotation.z = 0; },
    },
    {
      id: 'painting-color', label: 'Painting replaced', duration: 60, tag: 'painting', difficulty: 'obvious',
      targets: [refs.painting],
      apply() { refs.paintingCanvasMat.color.setHex(0xb03030); },
      revert() { refs.paintingCanvasMat.color.setHex(0xffffff); },
    },
    {
      id: 'chair-moved', label: 'Chair moved', duration: 60, tag: 'chair-moved', difficulty: 'obvious',
      targets: [refs.chair],
      apply() { refs.chair.position.set(0.6, 0, -0.6); refs.chair.rotation.y = 2.2; },
      revert() { refs.chair.position.copy(refs.chairHome.pos); refs.chair.rotation.y = refs.chairHome.rotY; },
    },
    {
      id: 'door-open', label: 'Door open', duration: 55, tag: 'door-open', difficulty: 'obvious',
      targets: [refs.doorPivot],
      apply() { refs.doorPivot.rotation.y = -1.1; },
      revert() { refs.doorPivot.rotation.y = 0; },
    },
    {
      id: 'monitor-red', label: 'Monitor red screen', duration: 55, tag: 'monitor-red', difficulty: 'obvious',
      targets: [refs.monitorGroup],
      apply() { refs.screenMat.color.setHex(0xff1a1a); },
      revert() { refs.screenMat.color.setHex(0x9fd4ff); },
    },
    {
      id: 'plant-missing', label: 'Plant missing', duration: 60, tag: 'plant-missing', difficulty: 'obvious',
      // plantGhost is an invisible-but-raycastable box at the plant's spot,
      // so the missing plant can still be aimed at.
      targets: [refs.plantGhost, refs.plant],
      apply() { refs.plant.visible = false; },
      revert() { refs.plant.visible = true; },
      ghostSpot: new THREE.Vector3(-4.2, 0.6, -3.2),
    },
    {
      id: 'extra-object', label: 'Extra object on desk', duration: 60, tag: 'extra-object', difficulty: 'obvious',
      targets: [refs.extraObject],
      apply() { refs.extraObject.visible = true; },
      revert() { refs.extraObject.visible = false; },
    },
    {
      id: 'window-eyes', label: 'Eyes in the window', duration: 45, tag: 'window-eyes', difficulty: 'obvious',
      targets: [refs.window],
      apply() { refs.eyeL.visible = true; refs.eyeR.visible = true; },
      revert() { refs.eyeL.visible = false; refs.eyeR.visible = false; },
    },
    {
      id: 'lamp-flicker', label: 'Lamp flickering', duration: 50, tag: 'lamp-flicker', difficulty: 'obvious',
      targets: [refs.lampGroup],
      apply() {},
      revert() { refs.lampLight.intensity = 5.5; refs.bulb.material.color.setHex(0xffe9a8); },
      update(r, dt, t) {
        const on = Math.sin(t * 30) > -0.2 && Math.random() > 0.15;
        refs.lampLight.intensity = on ? 5.5 : 0.25;
        refs.bulb.material.color.setHex(on ? 0xffe9a8 : 0x331111);
      },
    },
    {
      id: 'books-float', label: 'Objects floating', duration: 55, tag: 'books-float', difficulty: 'obvious',
      targets: [refs.books],
      apply() {},
      revert() { refs.books.position.y = refs.booksHomeY; refs.books.rotation.y = 0; },
      update(r, dt, t) { refs.books.position.y = refs.booksHomeY + 0.45 + Math.sin(t * 2) * 0.08; refs.books.rotation.y = t * 0.8; },
    },
    {
      id: 'shadow-blob', label: 'Wrong shadow', duration: 55, tag: 'shadow-blob', difficulty: 'obvious',
      targets: [refs.shadowBlob],
      apply() { refs.shadowBlob.visible = true; refs.shadowBlob.material.opacity = 0.75; },
      revert() { refs.shadowBlob.visible = false; refs.shadowBlob.material.opacity = 0.75; },
    },
    // ---------- SUBTLE (later nights) ----------
    {
      id: 'painting-nudge', label: 'Painting slightly tilted', duration: 60, tag: 'painting', difficulty: 'subtle',
      targets: [refs.painting],
      apply() { refs.painting.rotation.z = 0.08; },
      revert() { refs.painting.rotation.z = 0; },
    },
    {
      id: 'painting-fade', label: 'Painting color faded', duration: 60, tag: 'painting', difficulty: 'subtle',
      targets: [refs.painting],
      apply() { refs.paintingCanvasMat.color.setHex(0xdfe8dd); },
      revert() { refs.paintingCanvasMat.color.setHex(0xffffff); },
    },
    {
      id: 'chair-nudge', label: 'Chair shifted', duration: 60, tag: 'chair-moved', difficulty: 'subtle',
      targets: [refs.chair],
      apply() { refs.chair.position.set(refs.chairHome.pos.x + 0.35, 0, refs.chairHome.pos.z + 0.2); refs.chair.rotation.y = 0.45; },
      revert() { refs.chair.position.copy(refs.chairHome.pos); refs.chair.rotation.y = refs.chairHome.rotY; },
    },
    {
      id: 'door-ajar', label: 'Door slightly ajar', duration: 55, tag: 'door-open', difficulty: 'subtle',
      targets: [refs.doorPivot],
      apply() { refs.doorPivot.rotation.y = -0.14; },
      revert() { refs.doorPivot.rotation.y = 0; },
    },
    {
      id: 'monitor-dim', label: 'Monitor dimmed', duration: 55, tag: 'monitor-red', difficulty: 'subtle',
      targets: [refs.monitorGroup],
      apply() { refs.screenMat.color.setHex(0x277fb8); },
      revert() { refs.screenMat.color.setHex(0x9fd4ff); },
    },
    {
      id: 'plant-lean', label: 'Plant leaning', duration: 60, tag: 'plant-missing', difficulty: 'subtle',
      targets: [refs.plant],
      apply() { refs.plant.rotation.z = 0.12; },
      revert() { refs.plant.rotation.z = 0; },
    },
    {
      id: 'books-shift', label: 'Books shifted', duration: 55, tag: 'books-float', difficulty: 'subtle',
      targets: [refs.books],
      apply() { refs.books.rotation.y = 0.18; },
      revert() { refs.books.rotation.y = 0; },
    },
    {
      id: 'lamp-dim', label: 'Lamp dimmed', duration: 50, tag: 'lamp-flicker', difficulty: 'subtle',
      targets: [refs.lampGroup],
      apply() { refs.lampLight.intensity = 3.0; refs.bulb.material.color.setHex(0xc9b98a); },
      revert() { refs.lampLight.intensity = 5.5; refs.bulb.material.color.setHex(0xffe9a8); },
    },
    {
      id: 'moon-shift', label: 'Moon moved', duration: 55, tag: 'window-eyes', difficulty: 'subtle',
      targets: [refs.window],
      apply() { refs.moon.position.set(-0.3, 0.1, 0.06); },
      revert() { refs.moon.position.copy(refs.moonHome); },
    },
    {
      id: 'shadow-faint', label: 'Faint wrong shadow', duration: 55, tag: 'shadow-blob', difficulty: 'subtle',
      targets: [refs.shadowBlob],
      apply() { refs.shadowBlob.visible = true; refs.shadowBlob.material.opacity = 0.28; },
      revert() { refs.shadowBlob.visible = false; refs.shadowBlob.material.opacity = 0.75; },
    },
  ];
}

/** Flip userData.isActive on every target root + its children. */
function setTagActive(def, on) {
  for (const t of def.targets) {
    t.userData.isActive = on;
    t.traverse((child) => { child.userData.isActive = on; });
  }
}

export class AnomalyManager {
  constructor(refs) {
    this.refs = refs;
    this.all = defineAnomalies(refs);
    this.active = []; // { def, timeLeft }
    this.time = 0;
  }
  reset() {
    for (const a of this.active) {
      a.def.revert(this.refs);
      setTagActive(a.def, false);
    }
    this.active = [];
    this.time = 0;
  }
  /**
   * Spawn one anomaly.
   * @param {number} subtleChance - probability of picking from the subtle pool (0 = obvious only)
   * @param {number} durationScale - multiplier for the anomaly time limit
   * @param {string|null} forceId - spawn this specific id (used by the playtest
   *   so report checks aim at a known, easily-hit target instead of a random one)
   */
  trySpawn(subtleChance = 0, durationScale = 1, forceId = null) {
    if (forceId) {
      const def = this.all.find((d) => d.id === forceId);
      if (!def) return null;
      if (this.active.some((a) => a.def.id === def.id || a.def.tag === def.tag)) return null;
      def.apply(this.refs);
      setTagActive(def, true);
      const inst = { def, timeLeft: def.duration * durationScale };
      this.active.push(inst);
      audio.spawn();
      return inst;
    }
    const activeTags = new Set(this.active.map((a) => a.def.tag));
    const idle = this.all.filter((d) => !this.active.some((a) => a.def.id === d.id) && !activeTags.has(d.tag));
    if (idle.length === 0) return null;
    const wantSubtle = Math.random() < subtleChance;
    let pool = idle.filter((d) => (wantSubtle ? d.difficulty === 'subtle' : d.difficulty === 'obvious'));
    if (pool.length === 0) pool = idle; // fall back to whatever is free
    const def = pool[Math.floor(Math.random() * pool.length)];
    def.apply(this.refs);
    setTagActive(def, true);
    const inst = { def, timeLeft: def.duration * durationScale };
    this.active.push(inst);
    audio.spawn();
    return inst;
  }
  /** returns expired instances */
  update(dt) {
    this.time += dt;
    const expired = [];
    for (const a of this.active) {
      a.timeLeft -= dt;
      if (a.def.update) a.def.update(this.refs, dt, this.time);
      if (a.timeLeft <= 0) expired.push(a);
    }
    for (const e of expired) {
      e.def.revert(this.refs);
      setTagActive(e.def, false);
      this.active = this.active.filter((a) => a !== e);
    }
    return expired;
  }
  fix(def) {
    def.revert(this.refs);
    setTagActive(def, false);
    this.active = this.active.filter((a) => a.def !== def);
  }
  /**
   * Resolve a center-screen ray against the room.
   * Returns { hit, distance, point, anomalyType, isActive, instance }
   * - `instance` is the matching active anomaly, if any.
   * - Range + flashlight checks are done by the caller (main.js).
   */
  resolveAim(raycaster, scene) {
    raycaster.far = REPORT_RANGE + 14; // see past range so we can say "too far"
    const hits = raycaster.intersectObjects(scene.children, true);
    // Ignore the plant-ghost marker unless its anomaly is live (it would
    // otherwise block rays aimed at the wall behind the plant).
    const ghostActive = this.active.some((a) => a.def.id === 'plant-missing');
    for (const h of hits) {
      let o = h.object;
      if (o === this.refs.plantGhost && !ghostActive) continue;
      // colorWrite:false ghost still occludes in depth but renders nothing —
      // fine, skip it when inactive.
      if (o.material?.colorWrite === false && !ghostActive && o !== this.refs.plantGhost) continue;
      // Walk up to find the tagged root.
      let node = o;
      let tag = null;
      while (node) {
        if (node.userData?.anomalyType) { tag = node; break; }
        node = node.parent;
      }
      const anomalyType = tag?.userData.anomalyType ?? null;
      const isActive = tag?.userData.isActive === true;
      const instance = isActive
        ? this.active.find((a) => a.def.tag === anomalyType) ?? null
        : null;
      return { hit: h, distance: h.distance, point: h.point, anomalyType, isActive, instance };
    }
    return { hit: null, distance: Infinity, point: null, anomalyType: null, isActive: false, instance: null };
  }
}
