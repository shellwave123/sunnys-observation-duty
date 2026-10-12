// ScareDirector: ambient horror events independent of the anomaly system.
// - glimpse: the subject flickers INTO the office for ~2s (reportable bonus)
// - lightsout: the office lamp dies for a stretch (flashlight matters)
// - lightning: storm flash through the window + delayed thunder
// - whisper: a close breathy sting + camera shudder
import * as THREE from 'three';
import { MonsterState } from './monster.js';
import { audio } from './audio.js';

const GLIMPSE_SPOTS = [
  { pos: new THREE.Vector3(-3.0, 0, -3.25), yaw: 0, needSeat: false },     // at the window
  { pos: new THREE.Vector3(3.7, 0, -3.1), yaw: -1.1, needSeat: false },     // by the door
  { pos: new THREE.Vector3(-1.0, 0, -0.55), yaw: Math.PI, needSeat: true }, // right behind your chair
];

export function createScareDirector({ refs, monster, storm }) {
  const d = {
    glimpse: false,
    glimpseT: 0,
    lightsOut: false,
    lightsOutT: 0,
    stormT: 0,
    shudder: 0,
    eventT: 20,
    stormNext: 18,
    timers: [], // thunder timeouts
  };

  function clearTimers() {
    for (const id of d.timers) clearTimeout(id);
    d.timers.length = 0;
  }

  function endGlimpse() {
    d.glimpse = false;
    monster.fig.visible = false;
    monster.setDread(0);
  }

  const api = {
    get glimpseActive() { return d.glimpse; },
    get lightsOutActive() { return d.lightsOut; },

    /** Freeze the ambient schedulers (used by the automated playtest). */
    calm(seconds = 9999) { d.eventT = seconds; d.stormNext = seconds; },

    trigger(kind, arg = {}) {
      if (kind === 'glimpse') return api.glimpse(arg.seconds ?? 2.2, arg.spot ?? -1, arg.seated ?? false);
      if (kind === 'lightsout') return api.lightsOut(arg.seconds ?? 10);
      if (kind === 'whisper') return api.whisper();
      if (kind === 'lightning') return api.lightning();
      return false;
    },

    glimpse(seconds = 2.2, spotIx = -1, seated = false) {
      // Never while the outage stalker is out: it owns the wing, and a
      // glimpse would put the office figure on screen next to it.
      if (d.glimpse || monster.stalker || monster.state !== MonsterState.IDLE) return false;
      const pool = GLIMPSE_SPOTS.map((s, i) => ({ ...s, i })).filter((s) => !s.needSeat || seated);
      if (pool.length === 0) return false;
      const pick = spotIx >= 0 ? { ...GLIMPSE_SPOTS[spotIx], i: spotIx } : pool[Math.floor(Math.random() * pool.length)];
      d.glimpse = true;
      d.glimpseT = seconds;
      monster.fig.position.copy(pick.pos);
      monster.fig.rotation.y = pick.yaw;
      monster.fig.visible = true;
      monster.setDread(0.65);
      audio.sting();
      return true;
    },

    /** Successful report on a glimpse: scream + vanish (caller logs it). */
    resolveGlimpse() {
      endGlimpse();
      audio.scream();
    },

    lightsOut(seconds = 10) {
      if (d.lightsOut) return false;
      d.lightsOut = true;
      d.lightsOutT = seconds;
      refs.lampLight.intensity = 0;
      refs.bulb.material.color.setHex(0x1a1a1a);
      audio.powerDown();
      return true;
    },

    restoreLamp(normalI = 5.5) {
      d.lightsOut = false;
      refs.lampLight.intensity = normalI;
      refs.bulb.material.color.setHex(0xffe9a8);
      audio.powerUp();
    },

    whisper() {
      audio.whisper();
      d.shudder = 0.5;
      return true;
    },

    lightning() {
      if (d.stormT > 0) return false;
      d.stormT = 0.7;
      // thunder cracks a moment after the flash, like real distance
      const id = setTimeout(() => { try { audio.thunder(); } catch {} }, 500 + Math.random() * 1500);
      d.timers.push(id);
      return true;
    },

    reset() {
      clearTimers();
      endGlimpse();
      d.lightsOut = false;
      d.stormT = 0;
      d.shudder = 0;
      storm.intensity = 0;
      d.eventT = 20;
      d.stormNext = 18;
    },

    update(dt, ctx) {
      // ctx: { cfg, lampBusy, seated }
      if (d.glimpse) {
        d.glimpseT -= dt;
        monster.fig.position.x += Math.sin(performance.now() / 300) * 0.0006;
        if (d.glimpseT <= 0) endGlimpse(); // gone before you could blink
      }
      if (d.lightsOut) {
        d.lightsOutT -= dt;
        if (d.lightsOutT <= 0) api.restoreLamp();
      }
      if (d.stormT > 0) {
        d.stormT -= dt;
        const t = 0.7 - Math.max(0, d.stormT);
        let k = 0;
        if (t < 0.08) k = t / 0.08;
        else if (t < 0.14) k = 0.1;
        else if (t < 0.22) k = 0.1 + ((t - 0.14) / 0.08) * 0.9;
        else k = Math.max(0, 1 - (t - 0.22) / 0.48);
        storm.intensity = 7 * k;
        if (d.stormT <= 0) storm.intensity = 0;
      }
      // ambient scheduling
      d.eventT -= dt;
      if (d.eventT <= 0) {
        d.eventT = ctx.cfg.eventMin + Math.random() * (ctx.cfg.eventMax - ctx.cfg.eventMin);
        const roll = Math.random();
        if (roll < 0.4) api.glimpse(2.0 + Math.random() * 0.8, -1, ctx.seated);
        else if (roll < 0.7) { if (!ctx.lampBusy) api.lightsOut(8 + Math.random() * 7); }
        else api.whisper();
      }
      d.stormNext -= dt;
      if (d.stormNext <= 0) {
        d.stormNext = ctx.cfg.stormMin + Math.random() * (ctx.cfg.stormMax - ctx.cfg.stormMin);
        api.lightning();
      }
    },

    /** Camera-roll shudder this frame (0 when settled). Call after player.update. */
    consumeShudder(dt) {
      if (d.shudder <= 0) return 0;
      d.shudder -= dt;
      return (Math.random() - 0.5) * 0.03;
    },
  };
  return api;
}
