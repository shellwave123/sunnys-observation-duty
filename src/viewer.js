// Character viewer: a separate scene + renderer showing the subject outside the
// first-person camera, so the whole model can actually be inspected.
//
// Deliberately independent of the game renderer. It pauses the game loop while
// open, and its own rAF stops the moment it closes, so nothing runs in the
// background burning frames.
import * as THREE from 'three';
import { buildStickFigure } from './monster.js';
import { isTouchDevice } from './touch.js';

export function createViewer() {
  const root = document.getElementById('viewer');
  const stage = document.getElementById('viewer-stage');
  const closeBtn = document.getElementById('viewer-close');
  if (!root || !stage) return null;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  stage.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c12);

  // The in-game figure is lit by a near-black room, which is exactly why you
  // cannot make it out there. This rig uses neutral studio light so the
  // silhouette, proportions and head detail are all readable.
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x1a1410, 1.5));
  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.position.set(2.4, 3.6, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 1.5);
  rim.position.set(-3, 2.2, -2.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffb27f, 0.5);
  fill.position.set(0, -1.6, 2);
  scene.add(fill);

  const turntable = new THREE.Group();
  scene.add(turntable);
  const { root: fig } = buildStickFigure();
  // buildStickFigure darkens the body for the game; lift it here so the shape
  // is visible without touching the in-game look.
  fig.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const m = o.material;
    if (m?.color && m.color.getHex() === 0x0f1116) m.color.setHex(0x4a5260);
  });
  fig.visible = true;
  turntable.add(fig);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  // Frame the whole figure: it stands ~2.3m tall at root scale 1.22.
  const target = new THREE.Vector3(0, 1.15, 0);
  let dist = 4.6;
  let yaw = 0.5;
  let pitch = 0.16;
  let spin = true;

  let raf = 0;
  let open = false;

  function place() {
    const cp = Math.cos(pitch);
    camera.position.set(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * cp * dist,
    );
    camera.lookAt(target);
  }

  function resize() {
    const w = stage.clientWidth || 640;
    const h = stage.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (spin) yaw += 0.005;
    place();
    renderer.render(scene, camera);
  }

  // --- Drag to orbit, wheel/pinch to zoom ---
  let dragging = null;
  let pinch = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    spin = false; // touching it takes manual control
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    yaw -= (e.clientX - dragging.x) * 0.008;
    pitch = Math.max(-0.5, Math.min(1.0, pitch + (e.clientY - dragging.y) * 0.005));
    dragging.x = e.clientX;
    dragging.y = e.clientY;
  });
  const endDrag = () => { dragging = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    dist = Math.max(1.6, Math.min(9, dist + e.deltaY * 0.004));
  }, { passive: false });

  // Two-finger pinch to zoom on a phone.
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    spin = false;
    pinch = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    dist = Math.max(1.6, Math.min(9, dist - (d - pinch) * 0.01));
    pinch = d;
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = null; });

  // --- Toolbar ---
  root.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'spin') spin = !spin;
      if (v === 'front') { yaw = 0; pitch = 0.16; spin = false; dist = 4.6; }
      if (v === 'side') { yaw = Math.PI / 2; pitch = 0.16; spin = false; dist = 4.6; }
      if (v === 'back') { yaw = Math.PI; pitch = 0.16; spin = false; dist = 4.6; }
      if (v === 'head') { yaw = 0; pitch = 0.34; spin = false; dist = 1.9; }
      if (v === 'in') dist = Math.max(1.6, dist - 0.7);
      if (v === 'out') dist = Math.min(9, dist + 0.7);
      syncToolbar();
      place();
    });
  });

  function syncToolbar() {
    root.querySelector('[data-view="spin"]').textContent = spin ? '⏸ PAUSE' : '▶ SPIN';
  }

  function show() {
    if (open) return;
    open = true;
    root.classList.remove('hidden');
    resize();
    syncToolbar();
    place();
    if (!raf) frame();
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.add('hidden');
    cancelAnimationFrame(raf);
    raf = 0;
  }

  closeBtn?.addEventListener('click', hide);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('resize', () => { if (open) resize(); });
  window.addEventListener('orientationchange', () => { if (open) resize(); });

  return {
    show,
    hide,
    get isOpen() { return open; },
    toggle: () => (open ? hide() : show()),
    get spin() { return spin; },
    touch: isTouchDevice(),
    // Test hook: confirms the model is really being drawn, not just that the
    // overlay opened. The screenshot buffer is not readable without
    // preserveDrawingBuffer, so count triangles instead.
    get stats() {
      return { ...renderer.info.render, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    setView: (v) => root.querySelector(`[data-view="${v}"]`)?.click(),
  };
}