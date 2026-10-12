/**
 * Touch controls so the shift is playable on a phone: left-thumb stick to walk,
 * drag anywhere else to look, and on-screen buttons wired to the same action
 * codes the keyboard uses.
 *
 * Everything runs on Pointer Events, so one code path covers touch, pen and
 * mouse. Nothing here is active unless the device reports a coarse pointer, so
 * desktop play is untouched.
 */

/** True on phones/tablets. A coarse pointer is the reliable test; laptops that
 *  merely have a touchscreen report a fine pointer and keep the mouse controls. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return !!(
    window.matchMedia?.('(pointer: coarse)').matches ||
    window.matchMedia?.('(hover: none)').matches
  );
}

const STICK_RADIUS = 54;   // px the knob can travel from the stick centre
const STICK_DEAD = 0.18;   // ignore small wobbles so standing still is truly still
const LOOK_SPEED = 0.0042; // rad per px; a touch drag is coarser than a mouse
const PAN_SPEED = 0.0022;

/**
 * @param {object} o
 * @param {object} o.player   the player object (we write player.keys)
 * @param {Function} o.action  (code) => void, mirrors the keydown handler
 * @param {Function} o.escape  () => void, mirrors the Escape branch
 * @param {Function} o.zoom    (delta) => void, CCTV zoom in/out
 * @param {Function} o.pan     (dx, dy) => void, CCTV pan while dragging
 * @param {Function} o.cam     (dir) => void, next/previous camera
 * @param {Function} o.state   () => ({ phase, monitorOpen })
 */
export function createTouchControls(o) {
  const { player } = o;
  const root = document.getElementById('touch');
  const stick = document.getElementById('stick');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const camPad = document.getElementById('cctv-touch');
  const hideBtn = document.getElementById('btn-hide');
  const tpad = document.getElementById('tpad');
  const look = { ids: new Map() };
  const vec = { x: 0, y: 0 };
  let stickId = null;
  let pinchStart = 0;
  let pinchZoomed = false;

  if (!root) return null;
  root.classList.remove('hidden');
  document.body.classList.add('touch-mode');

  /** Push the stick vector into the same key flags the keyboard writes. */
  function applyKeys() {
    player.keys.KeyW = vec.y > STICK_DEAD;
    player.keys.KeyS = vec.y < -STICK_DEAD;
    player.keys.KeyD = vec.x > STICK_DEAD;
    player.keys.KeyA = vec.x < -STICK_DEAD;
  }

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function resetStick() {
    vec.x = 0; vec.y = 0;
    setKnob(0, 0);
    base.style.transform = '';
    stick.classList.remove('active');
    stickId = null;
    applyKeys();
  }

  // --- Movement stick: the finger stays where it lands, the base recentres ---
  // Centre the ring on wherever the thumb lands inside the stick zone. Offsets
  // are relative to #stick, not the old ring position, so it never drifts.
  function recentre(clientX, clientY) {
    const z = stick.getBoundingClientRect();
    base.style.transform =
      `translate(${clientX - z.left - z.width / 2}px, ${clientY - z.top - z.height / 2}px)`;
  }

  function stickPoint(e) {
    const t = e.changedTouches?.[0] || e.touches?.[0];
    return t ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
  }

  stick.addEventListener('touchstart', (e) => {
    const p = stickPoint(e);
    if (!p || stickId !== null) return;
    e.preventDefault();
    stickId = p.id;
    recentre(p.x, p.y);
    stick.classList.add('active');
    moveStick(p.x, p.y);
  }, { passive: false, capture: true });

  stick.addEventListener('touchmove', (e) => {
    const p = stickPoint(e);
    if (!p || p.id !== stickId) return;
    e.preventDefault();
    moveStick(p.x, p.y);
  }, { passive: false, capture: true });

  function moveStick(cx, cy) {
    const b = base.getBoundingClientRect();
    let dx = cx - (b.left + b.width / 2);
    let dy = cy - (b.top + b.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx = (dx / len) * STICK_RADIUS; dy = (dy / len) * STICK_RADIUS; }
    setKnob(dx, dy);
    vec.x = dx / STICK_RADIUS;
    vec.y = -dy / STICK_RADIUS; // screen-up is forward
    applyKeys();
  }

  // Raw touch events throughout, so a look drag and a button press can never
  // be confused for one another and nothing waits on click synthesis.
  const playing = () => o.state?.().phase === 'playing';

  function touchXY(e) {
    const t = e.changedTouches?.[0] || e.touches?.[0];
    return t ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
  }

  window.addEventListener('touchstart', (e) => {
    if (!playing()) return;                        // menus keep their own taps
    if (e.target.closest('#touch')) return;        // the stick or a button
    // A second finger arriving in the same event has to be registered too, or
    // a pinch would look like one finger dragging.
    const added = [...(e.changedTouches || [])];
    if (!added.length) return;
    e.preventDefault();
    for (const t of added) look.ids.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (look.ids.size === 2) {
      const [a, b] = [...look.ids.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }, { capture: true, passive: false });

  window.addEventListener('touchmove', (e) => {
    const p = touchXY(e);
    if (!p || !look.ids.has(p.id)) return;
    e.preventDefault();
    const prev = look.ids.get(p.id);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    look.ids.set(p.id, { x: p.x, y: p.y });

    if (look.ids.size === 2) {
      // Two fingers on the feed = pinch to zoom.
      const [a, b] = [...look.ids.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart > 0 && Math.abs(d - pinchStart) > 14 && o.zoom) {
        o.zoom(d > pinchStart ? 1 : -1);
        pinchStart = d;
      }
      return;
    }
    if (o.state?.().monitorOpen) {
      o.pan?.(dx * PAN_SPEED, -dy * PAN_SPEED);
      return;
    }
    // Same feel as the mouse path, including looking around while under the desk.
    player.yaw -= dx * LOOK_SPEED;
    player.pitch -= dy * LOOK_SPEED;
    const lim = player.mode === 'hide' ? 1.2 : 1.4;
    player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
  }, { capture: true, passive: false });

  function dropLook(e) {
    for (const t of e.changedTouches || []) look.ids.delete(t.identifier);
    if (look.ids.size < 2) pinchStart = 0;
  }
  window.addEventListener('touchend', dropLook, { capture: true });
  window.addEventListener('touchcancel', dropLook, { capture: true });

  // --- Buttons: fire the action on press so there is no 300ms tap delay ---
  // A tap has to fire on touchstart, not pointerdown: by the time the browser
  // finishes synthesising the pointer/click sequence a tap may already have
  // been handed to something else. Listening for the raw touch event keeps the
  // press instant and sidesteps the 300ms click delay.
  root.addEventListener('touchstart', (e) => {
    const btn = e.target.closest('[data-act],[data-cam],[data-zoom]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add('down');
    fire(btn);
  }, { passive: false, capture: true });
  root.addEventListener('click', (e) => {
    // Mouse fallback (and any tap that arrived without a touchstart).
    const btn = e.target.closest('[data-act],[data-cam],[data-zoom]');
    if (!btn || btn.dataset.fired) return;
    fire(btn);
  });

  function fire(btn) {
    btn.dataset.fired = '1';
    if (btn.dataset.act) o.action?.(btn.dataset.act);
    else if (btn.dataset.cam) o.cam?.(btn.dataset.cam === 'next' ? 1 : -1);
    else if (btn.dataset.zoom) o.zoom?.(btn.dataset.zoom === 'in' ? 1 : -1);
    setTimeout(() => { delete btn.dataset.fired; }, 400);
  }
  root.addEventListener('pointerup', (e) => {
    e.target.closest('.tbtn')?.classList.remove('down');
  });
  root.addEventListener('pointercancel', (e) => {
    e.target.closest('.tbtn')?.classList.remove('down');
  });

  // Anything meant to be tapped keeps its native click; only the game surface
  // gets its touch behaviour suppressed. Menus scroll, buttons work normally.
  const interactive = (t) => !!t.closest('.screen, #viewer, button, input, select, textarea, a');

  // iOS pinch/double-tap zoom would fight the camera, so refuse it outright.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (interactive(e.target)) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', (e) => {
    // preventDefault here suppresses the synthesised click, so it must skip
    // buttons or they stop responding to a tap.
    if (!interactive(e.target)) e.preventDefault();
  }, { passive: false });

  /**
   * Hide the stick while a menu is up, swap in the CCTV pad with the monitor,
   * and relabel HIDE to BACK when there is no under-desk to climb out of.
   * Phones have no Escape key, so BACK is the only way out of a mode.
   */
  function syncVisibility() {
    const s = o.state?.() || {};
    const playing = s.phase === 'playing';
    root.classList.toggle('live', playing);
    // The camera pad only makes sense with the feed up; while it is, it owns the
    // bottom of the screen and the right-hand cluster steps out of its way.
    camPad.classList.toggle('hidden', !playing || !s.monitorOpen);
    tpad.classList.toggle('shifted', playing && s.monitorOpen);
    hideBtn.textContent = s.canHide ? 'HIDE' : 'BACK';
    hideBtn.dataset.act = s.canHide ? 'KeyH' : 'Escape';
  }
  const raf = () => { applyKeys(); syncVisibility(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);

  // A held stick must not survive a phase change, a hide, or losing the window.
  window.addEventListener('touchend', resetStick, { capture: true });
  window.addEventListener('touchcancel', resetStick, { capture: true });
  window.addEventListener('blur', resetStick);

  return {
    get stick() { return { x: vec.x, y: vec.y }; },
    resetStick,
    syncVisibility,
  };
}