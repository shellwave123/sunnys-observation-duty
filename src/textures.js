// Procedural canvas textures — zero downloads, all generated at boot.
import * as THREE from 'three';

function canvasTex(size, draw, rx = 1, ry = 1, opts = {}) {
  const w = opts.w ?? size;
  const h = opts.h ?? size;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; // maximize texture sharpness for procedural surfaces
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
  return t;
}

function speckle(g, size, n, alpha) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 255) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
  }
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v + amount))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Warm hardwood planks with grain, joints, and board-to-board variation. */
export function hardwoodTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#6d4e30'; g.fillRect(0, 0, s, s);
    const rows = 6;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const tone = (Math.sin(r * 12.9898) * 43758.5453 % 1 + 1) % 1;
      g.fillStyle = shade('#77552f', tone * 22 - 11);
      g.fillRect(0, r * rh, s, rh);
      for (let i = 0; i < 34; i++) {
        const y = r * rh + Math.random() * rh;
        g.strokeStyle = `rgba(38,22,8,${0.10 + Math.random() * 0.18})`;
        g.lineWidth = 0.7 + Math.random() * 1.4;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= s; x += 24) g.lineTo(x, y + Math.sin(x * 0.035 + i * 1.7 + r) * 2.2);
        g.stroke();
      }
      // butt joints, staggered like a real floor
      const joints = 2 + (r % 2);
      for (let j = 0; j <= joints; j++) {
        const x = ((j + (r % 2) * 0.5) / joints) * s + (r * 37) % 48;
        g.fillStyle = 'rgba(24,13,4,0.72)';
        g.fillRect(x % s, r * rh, 2.5, rh);
      }
      g.fillStyle = 'rgba(24,13,4,0.78)';
      g.fillRect(0, r * rh, s, 2.5);
      g.fillStyle = 'rgba(255,225,170,0.10)';
      g.fillRect(0, r * rh + 2.5, s, 1.5);
    }
    speckle(g, s, 900, 0.045);
  }, 3, 2);
}

/** Warm residential drywall: soft plaster noise without office grime. */
export function drywallTexture(base = '#8b8378') {
  return canvasTex(512, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 8 + Math.random() * 34;
      const grad = g.createRadialGradient(x, y, 1, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.018 + Math.random() * 0.025})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    speckle(g, s, 1300, 0.035);
  }, 3, 1.5);
}

/** Low-profile residential carpet tile in warm greige. */
export function carpetTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#4d443c'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 3) {
      for (let x = 0; x < s; x += 3) {
        const v = 62 + ((x * 31 + y * 17) % 19);
        g.fillStyle = `rgba(${v},${v - 6},${v - 13},0.5)`;
        g.fillRect(x, y, 2, 2);
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2);
    speckle(g, s, 700, 0.04);
  }, 5, 4);
}

/** Woven area rug with a bordered medallion motif. */
export function rugTexture() {
  return canvasTex(512, (g, w, h) => {
    g.fillStyle = '#5d2d28'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#31435c'; g.fillRect(30, 30, w - 60, h - 60);
    g.strokeStyle = '#c8a86a'; g.lineWidth = 8; g.strokeRect(30, 30, w - 60, h - 60);
    g.strokeStyle = '#8c3b32'; g.lineWidth = 5; g.strokeRect(58, 58, w - 116, h - 116);
    g.fillStyle = '#c8a86a';
    for (let i = 0; i < 7; i++) {
      const x = 100 + i * 52;
      const y = h / 2 + Math.sin(i * 1.3) * 48;
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
      g.fillRect(-18, -18, 36, 36);
      g.restore();
    }
    g.fillStyle = 'rgba(20,12,8,0.16)';
    for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1.5);
    speckle(g, w, 1800, 0.055);
  }, 1, 1, { w: 512, h: 384 });
}

/** Heavy curtain fabric with vertical folds and a hem. */
export function curtainTexture(base = '#5b2f35') {
  return canvasTex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 4) {
      const fold = Math.sin(x * 0.24) * 0.5 + Math.sin(x * 0.061) * 0.5;
      g.fillStyle = fold > 0 ? `rgba(255,210,190,${0.05 + fold * 0.10})` : `rgba(8,2,4,${0.08 - fold * 0.16})`;
      g.fillRect(x, 0, 2, s);
    }
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, s - 18, s, 18);
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, s - 22, s, 3);
    speckle(g, s, 500, 0.035);
  }, 2, 1);
}

/** Small framed landscape print: night hills above a warm farmhouse window. */
export function paintingTexture() {
  const t = canvasTex(256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.66);
    sky.addColorStop(0, '#101c34'); sky.addColorStop(1, '#2d4a68');
    g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.66);
    g.fillStyle = 'rgba(225,236,255,0.9)';
    g.beginPath(); g.arc(w * 0.74, h * 0.2, 13, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 34; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.5, 1.4, 1.4);
    }
    g.fillStyle = '#1d2c22'; g.fillRect(0, h * 0.52, w, h * 0.48);
    g.fillStyle = '#2c4a34'; g.fillRect(0, h * 0.64, w, h * 0.36);
    g.fillStyle = '#10150f';
    g.fillRect(w * 0.2, h * 0.52, w * 0.34, h * 0.20);
    g.fillStyle = '#0b0e0a';
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.52); g.lineTo(w * 0.37, h * 0.39); g.lineTo(w * 0.56, h * 0.52);
    g.fill();
    g.fillStyle = '#ffcf7a'; g.fillRect(w * 0.335, h * 0.575, 12, 15);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, h - 8, w, 8);
  }, 1, 1, { w: 256, h: 192 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Pale checkerboard linoleum for a home kitchen. */
export function tileTexture() {
  return canvasTex(512, (g, s) => {
    const n = 6;
    const cell = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = (x + y) % 2 ? '#aeb8ad' : '#d9d4c2';
        g.fillRect(x * cell, y * cell, cell, cell);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
      }
    }
    g.strokeStyle = 'rgba(55,50,38,0.72)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(s, i * cell); g.stroke();
    }
    speckle(g, s, 900, 0.035);
  }, 3, 3);
}

/** Sealed basement concrete with control joints and mottling. */
export function concreteTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#57565a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 12 + Math.random() * 48;
      const grad = g.createRadialGradient(x, y, 1, x, y, r);
      grad.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.035)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(20,20,22,0.65)'; g.lineWidth = 4;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    speckle(g, s, 1700, 0.05);
  }, 3, 3);
}

/** Home-office hardwood. */
export function floorTexture() {
  return hardwoodTexture();
}

/** Warm residential drywall. */
export function wallTexture() {
  return drywallTexture();
}

/** Soft stippled ceiling paint. */
export function ceilingTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#bab2a4'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2200, 0.055);
  }, 4, 3);
}

/** Wood grain: streaks + plank tone shifts. */
export function woodTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#6b4a2b'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const y = Math.random() * s;
      g.strokeStyle = `rgba(${20 + Math.random() * 40 | 0},${12 + Math.random() * 22 | 0},6,${0.25 + Math.random() * 0.3})`;
      g.lineWidth = 0.8 + Math.random() * 1.8;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2.5);
      g.stroke();
    }
    speckle(g, s, 500, 0.05);
  }, 1, 1);
}

/** Monitor screen: scanlines + fake terminal text + status bar. */
export function screenTexture() {
  const t = canvasTex(384, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#0d2f4a'); grad.addColorStop(1, '#081c30');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    g.font = '11px monospace';
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i === 0 ? 'rgba(120,220,255,0.95)' : `rgba(90,180,230,${0.35 + Math.random() * 0.4})`;
      const w = 40 + Math.random() * 160;
      g.fillRect(12, 16 + i * 17, w, 7);
    }
    g.fillStyle = 'rgba(60,220,130,0.9)'; g.fillRect(12, s - 22, 90, 8); // status bar
    g.fillStyle = 'rgba(0,0,0,0.28)'; // scanlines
    for (let y = 0; y < s; y += 3) g.fillRect(0, y, s, 1);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft radial glow sprite (lamp halo, dust points). */
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shadowTex = null;
/** Cheap grounded contact shadow: a soft dark ellipse under furniture. */
export function contactShadow(w = 1, h = 1, opacity = 0.34) {
  shadowTex ??= glowTexture();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTex, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.raycast = () => {};
  m.userData.flatDecor = true;
    return m;
}

/** Starfield for the night sky outside the window. */
export function starsTexture() {
  const t = canvasTex(384, (g, s) => {
    g.fillStyle = '#0a1626'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const a = 0.25 + Math.random() * 0.75;
      g.fillStyle = `rgba(220,232,255,${a})`;
      const r = Math.random() < 0.12 ? 1.6 : 0.9;
      g.fillRect(Math.random() * s, Math.random() * s, r, r);
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
