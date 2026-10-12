// Live voice chat for co-op: browser-to-browser WebRTC, no server in between.
//
// There is no signalling backend in this build, so the two peers swap the
// connection description by hand — one player creates an invite code, sends it
// to their partner (any chat app), and pastes the reply back. Both codes are
// just the offer/answer SDP, base64-wrapped so they survive a copy/paste.
//
// The mic is optional on each side: a player without one (or who denied the
// permission) can still listen and be the one who pastes codes, because the
// peer that starts the invite adds a receive-only audio transceiver.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

const enc = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const dec = (str) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(str.trim()), (c) => c.charCodeAt(0))));

/** Resolve once ICE gathering stops (or after a grace period, so a stalled
 *  network can never hang the CONNECT button forever). */
function gathered(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } };
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', done);
  });
}

/** Speak a stream's loudness back every ~90ms as a 0..1 peak level. */
function meter(stream, ctx, cb) {
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    cb(peak);
    timer = setTimeout(tick, 90);
  };
  let timer = setTimeout(tick, 90);
  return () => { clearTimeout(timer); try { src.disconnect(); an.disconnect(); } catch { /* already gone */ } };
}

export function createVoiceChat({ onState } = {}) {
  const state = {
    supported: voiceSupported(),
    mic: 'off',          // off | requesting | on | denied | none
    link: 'idle',        // idle | waiting | connecting | live | failed
    muted: false,
    level: 0,            // your own voice, 0..1
    remote: 0,           // your partner's voice, 0..1
    error: '',
  };

  let pc = null;
  let local = null;        // getUserMedia stream
  let ctx = null;          // AudioContext used for the two level meters
  let stopLocalMeter = null;
  let stopRemoteMeter = null;
  const remoteEl = document.createElement('audio');
  remoteEl.autoplay = true;
  remoteEl.setAttribute('playsinline', '');
  document.body.appendChild(remoteEl);

  const notify = () => onState?.({ ...state });
  const fail = (msg) => { state.error = msg; state.link = 'failed'; notify(); };

  const audioCtx = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  /** The remote track may be blocked by autoplay until a real user gesture. */
  const playRemote = () => remoteEl.play?.().catch(() => {});

  function ensurePc() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: ICE });
    pc.ontrack = (e) => {
      remoteEl.srcObject = e.streams[0] || new MediaStream([e.track]);
      playRemote();
      stopRemoteMeter?.();
      const c = audioCtx();
      if (c && remoteEl.srcObject) stopRemoteMeter = meter(remoteEl.srcObject, c, (v) => { state.remote = v; });
      state.link = 'connecting';
      notify();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') { state.link = 'live'; state.error = ''; playRemote(); }
      else if (s === 'failed') state.link = 'failed';
      else if (s === 'disconnected') state.link = 'failed';
      else if (s === 'closed') state.link = 'idle';
      notify();
    };
    if (local) for (const t of local.getTracks()) pc.addTrack(t, local);
    else pc.addTransceiver('audio', { direction: 'recvonly' }); // no mic: listen only
    return pc;
  }

  return {
    state,
    get remoteAudio() { return remoteEl; },

    /** Ask for the microphone. Safe to call again after a denial. */
    async enableMic() {
      if (!state.supported) { state.mic = 'none'; state.error = 'Voice chat is not supported in this browser.'; notify(); return false; }
      state.mic = 'requesting'; state.error = ''; notify();
      try {
        local = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        state.mic = 'on';
        stopLocalMeter?.();
        const c = audioCtx();
        if (c) stopLocalMeter = meter(local, c, (v) => { state.level = state.muted ? 0 : v; });
        // Late mic on an already-built connection: hand the track to the
        // existing audio transceiver (best effort — turning the mic on BEFORE
        // connecting is what the panel nudges you to do).
        if (pc) {
          const tx = pc.getTransceivers().find((t) => (t.receiver.track?.kind || t.sender.track?.kind) === 'audio');
          if (tx) {
            await tx.sender.replaceTrack(local.getAudioTracks()[0]);
            if (tx.direction === 'recvonly') tx.direction = 'sendrecv';
          } else {
            for (const t of local.getTracks()) pc.addTrack(t, local);
          }
        }
        notify();
        return true;
      } catch (e) {
        state.mic = e?.name === 'NotAllowedError' ? 'denied' : 'none';
        state.error = state.mic === 'denied'
          ? 'Microphone blocked — allow the mic in the browser bar, or listen only.'
          : 'No microphone found — you can still listen and relay codes.';
        notify();
        return false;
      }
    },

    mute(on = !state.muted) {
      state.muted = on;
      if (local) for (const t of local.getTracks()) t.enabled = !on;
      if (!on) playRemote();
      notify();
    },

    /** Host step 1: build the invite code to send to your partner. */
    async createInvite() {
      if (!state.supported) return '';
      try {
        pc?.close(); pc = null;
        ensurePc();
        state.link = 'waiting'; state.error = ''; notify();
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        await gathered(pc);
        return enc(pc.localDescription);
      } catch (e) { fail('Could not create an invite: ' + (e?.message || e)); return ''; }
    },

    /** Guest step: turn their invite into a reply code to send back. */
    async joinInvite(code) {
      if (!state.supported || !code?.trim()) return '';
      try {
        pc?.close(); pc = null;
        ensurePc();
        state.link = 'connecting'; state.error = ''; notify();
        await pc.setRemoteDescription(dec(code));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await gathered(pc);
        return enc(pc.localDescription);
      } catch (e) { fail('That invite code did not work — check you pasted all of it.'); return ''; }
    },

    /** Host step 2: take their reply and open the call. */
    async acceptReply(code) {
      if (!state.supported || !code?.trim()) return false;
      try {
        if (!pc) { fail('Create an invite first.'); return false; }
        state.link = 'connecting'; state.error = ''; notify();
        await pc.setRemoteDescription(dec(code));
        playRemote();
        return true;
      } catch (e) { fail('That reply code did not work — check you pasted all of it.'); return false; }
    },

    hangup() {
      stopRemoteMeter?.(); stopRemoteMeter = null;
      try { pc?.close(); } catch { /* already closed */ }
      pc = null;
      remoteEl.srcObject = null;
      state.link = 'idle';
      notify();
    },

    stop() {
      this.hangup();
      stopLocalMeter?.(); stopLocalMeter = null;
      local?.getTracks().forEach((t) => t.stop());
      local = null;
      state.mic = 'off';
      state.level = 0; state.remote = 0;
      notify();
    },

    /** A gesture just happened: good moment to retry a blocked remote stream. */
    nudge() { playRemote(); if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); },
  };
}

/** Feature-detect before anything touches the DOM. */
export function voiceSupported() {
  return !!(window.RTCPeerConnection
    && navigator.mediaDevices?.getUserMedia
    && typeof btoa === 'function'
    && typeof atob === 'function');
}
