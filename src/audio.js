// Procedural audio — Web Audio API only, no files needed.
let ctx = null;
let master = null;
let breath = null; // live proximity-breathing loop, see setBreath()

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function beep(freq, dur, type = 'sine', vol = 0.2, when = 0) {
  try {
    const c = ensureCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur);
    o.connect(g).connect(master);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur);
  } catch { /* audio unavailable */ }
}

/** Soft sustained tone with slow attack + long decay (for the chime). */
function softTone(freq, dur, vol, when = 0) {
  const c = ensureCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  const t = c.currentTime + when;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Loopable brown-noise buffer for hum beds. */
function noiseBuffer(seconds = 2) {
  const c = ensureCtx();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // brown-ish
    data[i] = last * 3.5;
  }
  return buf;
}

// --- Ambient engine state ---
let ambience = null; // { nodes:[], timers:[] }

function later(fn, ms) {
  const id = setTimeout(() => {
    if (ambience) fn();
  }, ms);
  ambience?.timers.push(id);
  return id;
}

/** A wooden creak: slow downward chirp through a bandpass filter. */
function creak() {
  try {
    const c = ensureCtx();
    const t = c.currentTime;
    const dur = 0.5 + Math.random() * 0.7;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f0 = 220 + Math.random() * 320;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.4 + Math.random() * 0.3), t + dur);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400 + Math.random() * 500;
    bp.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(bp).connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch {}
  // schedule the next one
  later(creak, 9000 + Math.random() * 14000);
}

/** Distant footsteps: 2–4 muffled low thumps, panned slightly. */
function footsteps() {
  try {
    const c = ensureCtx();
    const steps = 2 + Math.floor(Math.random() * 3);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; pan.connect(master); }
    const out = pan ?? master;
    for (let i = 0; i < steps; i++) {
      const t = c.currentTime + i * (0.45 + Math.random() * 0.2);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      // muffle: thump through a lowpass
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
  } catch {}
  later(footsteps, 18000 + Math.random() * 18000);
}

/** Wind gust: a slow swelling howl through a wandering bandpass. */
function gust() {
  try {
    const c = ensureCtx();
    const t = c.currentTime;
    const dur = 3.5 + Math.random() * 2;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(5);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.linearRampToValueAtTime(700 + Math.random() * 400, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(250, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  } catch {}
  later(gust, 22000 + Math.random() * 30000);
}

// --- Rain + monitor-hum beds (gain nodes live under ambience) ---
let rainGain = null;
let rainLevel = 0.07;
let humNodes = null;

function startAmbience() {
  try {
    const c = ensureCtx();
    if (ambience) return; // already running
    ambience = { nodes: [], timers: [] };

    // Low electrical hum: two detuned sines + faint brown noise bed.
    const humGain = c.createGain();
    humGain.gain.value = 0.035;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    humGain.connect(lp).connect(master);
    for (const f of [55, 55.6, 110.4]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(humGain);
      o.start();
      ambience.nodes.push(o);
    }
    const bed = c.createBufferSource();
    bed.buffer = noiseBuffer(3);
    bed.loop = true;
    const bedGain = c.createGain();
    bedGain.gain.value = 0.05;
    const bedLp = c.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 300;
    bed.connect(bedGain).connect(bedLp).connect(master);
    bed.start();
    ambience.nodes.push(bed);

    ambience.nodes.push(humGain, lp, bedGain, bedLp);
    // rain on the windows: faint bed, storms surge it via setRain()
    const rain = c.createBufferSource();
    rain.buffer = noiseBuffer(3);
    rain.loop = true;
    const rainHp = c.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1600;
    rainGain = c.createGain();
    rainGain.gain.value = rainLevel;
    rain.connect(rainHp).connect(rainGain).connect(master);
    rain.start();
    ambience.nodes.push(rain, rainHp, rainGain);
    later(creak, 5000 + Math.random() * 6000);
    later(footsteps, 12000 + Math.random() * 8000);
    later(gust, 20000 + Math.random() * 15000);
  } catch { /* ignore */ }
}

function stopAmbience() {
  if (!ambience) return;
  for (const id of ambience.timers) clearTimeout(id);
  for (const n of ambience.nodes) {
    try {
      if (n.stop) n.stop();
      else if (n.gain) n.gain.value = 0;
      n.disconnect?.();
    } catch {}
  }
  ambience = null;
  try { for (const n of humNodes ?? []) { n.stop?.(); n.disconnect?.(); } } catch {}
  humNodes = null;
  rainGain = null;
}

export const audio = {
  unlock() { try { ensureCtx(); } catch {} },
  suspend() { try { ctx?.suspend(); } catch {} },
  resume() { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch {} },
  confirm() { /* muted */ },
  chime() { /* muted */ },
  deny() { /* muted */ },
  /** Harsh buzz for a false report: dissonant low square + saw stack. */
  buzz() {
    try {
      beep(110, 0.45, 'square', 0.22);
      beep(116.5, 0.45, 'sawtooth', 0.18);
      beep(55, 0.5, 'square', 0.14, 0.02);
    } catch {}
  },
  spawn() { beep(220, 0.4, 'triangle', 0.08); },
  /** Harsh inhuman shriek when a logged subject vanishes off camera. */
  scream() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 0.8;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(1);
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(2400, t);
      bp.frequency.exponentialRampToValueAtTime(320, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.05);
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(140, t + dur);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch {}
  },
  /** Slow heavy door creak + slam for the subject reaching the office. */
  doorCreak() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 1.6;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(70, t + dur);
      const bp = c.createBiquadFilter();
      bp.type = 'lowpass'; bp.frequency.value = 420;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(bp).connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
      // shudder thumps while it creeps in
      for (let i = 0; i < 5; i++) beep(48, 0.35, 'sine', 0.4, 1.4 + i * 0.9);
    } catch {}
  },
  /** Low loopable breath bed for the hunt countdown (returns a stopper). */
  startBreath() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(4);
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      const lfo = c.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.32; // ~one breath per 3s
      const lg = c.createGain(); lg.gain.value = 0.045;
      lfo.connect(lg).connect(g.gain);
      g.gain.value = 0.075;
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      lfo.start(t);
      return () => {
        try {
          g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
          src.stop(c.currentTime + 0.6);
          lfo.stop(c.currentTime + 0.6);
        } catch {}
      };
    } catch { return () => {}; }
  },
  /** One double-thump heartbeat (call on a timer; shorten the gap as dread rises). */
  heartbeat(vol = 0.3) {
    try {
      beep(58, 0.16, 'sine', vol);
      beep(52, 0.14, 'sine', vol * 0.7, 0.16);
    } catch {}
  },
  /** Heavy slam for when it leaves (you survived) or grabs you. */
  slam() {
    try {
      beep(60, 0.6, 'sine', 0.5);
      beep(90, 0.4, 'square', 0.2, 0.02);
    } catch {}
  },
  /** Quiet dissonant sting when something is suddenly there. */
  sting() {
    try {
      softTone(1244.5, 1.2, 0.05);          // D#6
      softTone(1318.5, 1.2, 0.05, 0.02);    // E6 — minor 2nd rub
      softTone(62, 1.4, 0.10, 0.05);        // low dread pulse
    } catch {}
  },
  /** Close breathy whisper swell with a trembling formant. */
  whisper() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 1.3;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(2);
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 7;
      bp.frequency.setValueAtTime(1400, t);
      bp.frequency.exponentialRampToValueAtTime(750, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      const trem = c.createOscillator();
      trem.type = 'sine'; trem.frequency.value = 9;
      const tg = c.createGain(); tg.gain.value = 0.05;
      trem.connect(tg).connect(g.gain);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.05);
      trem.start(t); trem.stop(t + dur + 0.05);
    } catch {}
  },
  /** Distant thunder crack + long low rumble. */
  thunder() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 2.4;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(3);
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 130;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(lp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.05);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(55, t);
      o.frequency.exponentialRampToValueAtTime(32, t + dur);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.3, t + 0.1);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch {}
  },
  /** Harsh white-noise blast + low boom when a feed cuts to the subject. */
  staticBurst() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(1);
      src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 900;
      const g = c.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      src.connect(hp).connect(g).connect(master);
      src.start(t); src.stop(t + 0.8);
      beep(55, 0.7, 'sine', 0.35);
    } catch {}
  },
  /** Three heavy knocks — something rattling the office door. */
  knock() {
    try {
      for (let i = 0; i < 4; i++) {
        beep(68, 0.26, 'sine', 0.5, i * 0.55);
        beep(135, 0.09, 'square', 0.12, i * 0.55);
      }
    } catch {}
  },
  /** One massive door impact: low boom + wood crack + rattle. */
  bang() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      beep(48, 0.7, 'sine', 0.55);
      beep(96, 0.2, 'square', 0.16, 0.01);
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.5);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 1.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + 0.35);
    } catch {}
  },
  /** Footsteps approaching: faster and louder as they close in. */
  approach() {
    try {
      const c = ensureCtx();
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const gap = 0.52 - i * 0.045;
        const t = c.currentTime + i * gap;
        const vol = 0.07 + i * 0.025;
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(72, t);
        o.frequency.exponentialRampToValueAtTime(36, t + 0.2);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 200;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        o.connect(lp).connect(g).connect(master);
        o.start(t); o.stop(t + 0.32);
      }
    } catch {}
  },
  /** Chair scrape: sitting down / scrambling under the desk. */
  chairScrape() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 0.4;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.6);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(320, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.05);
    } catch {}
  },
  /** Camera-shutter snap for a CONFIRMED log (on top of the chime). */
  shutter() {
    try {
      beep(2200, 0.03, 'square', 0.12);
      beep(1500, 0.04, 'square', 0.12, 0.06);
      beep(990, 0.15, 'sine', 0.18, 0.1);
    } catch {}
  },
  /** Rising tension tone when the stare locks halfway — ends abruptly. */
  riser() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const dur = 2.2;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(920, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + dur);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.02);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch {}
  },
  /** The lamps die: electrical buzz-down. */
  powerDown() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(lp).connect(g).connect(master);
      o.start(t); o.stop(t + 0.75);
    } catch {}
  },
  /** The lamps stutter back: fluorescent flicker-on. */
  powerUp() {
    try {
      beep(1800, 0.03, 'square', 0.07);
      beep(1800, 0.03, 'square', 0.07, 0.09);
      beep(1800, 0.05, 'square', 0.07, 0.2);
      const c = ensureCtx();
      const t = c.currentTime + 0.26;
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = 120;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.5);
    } catch {}
  },
  /** CCTV switch blip + static burst. */
  camSwitch() {    try {
      beep(1200, 0.04, 'square', 0.08);
      const c = ensureCtx();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      src.connect(hp).connect(g).connect(master);
      src.start(t); src.stop(t + 0.3);
    } catch {}
  },
  tick() { beep(880, 0.05, 'square', 0.05); },
  win() { /* muted happy sounds */ },
  lose() {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(3);
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 110;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      src.connect(lp).connect(g).connect(master);
      src.start(t); src.stop(t + 2.4);
      [55, 40, 30].forEach((f, i) => beep(f, 0.4, 'sawtooth', 0.35, i * 0.25));
    } catch {}
  },
  click() { /* muted */ },
  /** Rain level 0..1 (storms surge it; it settles back after). */
  /** One damp footstep on a hard floor. vol 0..1 scales the whole hit. */
  footstep(vol = 0.6) {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(0.16);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 150 + Math.random() * 90;
      bp.Q.value = 1.1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.22 * vol), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      src.stop(t + 0.15);
    } catch {}
  },

  /**
   * One low, slow breathing loop that runs while the subject is inside.
   * vol 0..1 sets loudness; pitch rises with it so it gets tighter and more
   * urgent as it closes on the player. Safe to call every frame.
   */
  setBreath(vol = 0) {
    try {
      const c = ensureCtx();
      const t = c.currentTime;
      if (vol <= 0.01) {
        if (breath) { breath.stop(); breath = null; }
        return;
      }
      if (!breath) {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(4);
        src.loop = true;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 340; bp.Q.value = 1.5;
        const g = c.createGain();
        g.gain.value = 0.0001;
        const lfo = c.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 0.3;
        const lg = c.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg).connect(g.gain);
        src.connect(bp).connect(g).connect(master);
        src.start(t); lfo.start(t);
        breath = { src, g, bp, lfo, lg };
      }
      const b = breath;
      b.g.gain.setTargetAtTime(0.16 * vol, t, 0.35);
      b.bp.frequency.setTargetAtTime(300 + vol * 260, t, 0.4);
      b.lfo.frequency.setTargetAtTime(0.28 + vol * 0.55, t, 0.4);
      b.lg.gain.setTargetAtTime(0.28 + vol * 0.32, t, 0.4);
    } catch {}
  },

  setRain(level) {
    rainLevel = Math.max(0, Math.min(1, level));
    try { if (rainGain) rainGain.gain.value = 0.02 + rainLevel * 0.5; } catch {}
  },
  getRainLevel() { return rainLevel; },
  /** Faint CRT whine + static bed while seated at the monitor. */
  startHum() {
    try {
      if (humNodes) return;
      const c = ensureCtx();
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = 7900;
      const og = c.createGain(); og.gain.value = 0.006;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(2); src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4000;
      const ng = c.createGain(); ng.gain.value = 0.012;
      o.connect(og).connect(master);
      src.connect(hp).connect(ng).connect(master);
      o.start(); src.start();
      humNodes = [o, src];
    } catch {}
  },
  stopHum() {
    if (!humNodes) return;
    for (const n of humNodes) { try { n.stop(); n.disconnect?.(); } catch {} }
    humNodes = null;
  },
  startAmbience,
  stopAmbience,
};
