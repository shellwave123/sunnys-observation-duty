// CCTV monitor: shows one station's live feed fullscreen with scanlines,
// chromatic noise and digital zoom. Reporting a subject requires it to be
// visible, unblocked, and large enough on screen — i.e. zoom in on it.
import * as THREE from 'three';

const ZOOMS = [1, 1.5, 2, 3, 4, 6];
export const FEED_W = 640; // sharper feeds — the digital zoom has to stay legible
export const FEED_H = 360;

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tFeed;
uniform float uZoom;      // digital zoom 1..6
uniform vec2 uPan;        // mouse pan in feed-uv
uniform float uTime;
uniform float uGrain;
uniform float uDread;     // 0..1 locked-on stare: the feed bleeds red
varying vec2 vUv;

vec3 filmic(vec3 c) {
  // cheap Reinhard + sRGB encode so the raw linear feed reads like a camera
  c = c / (c + vec3(0.35));
  return pow(c, vec3(1.0 / 2.2));
}

void main() {
  float span = (1.0 - 1.0 / uZoom);
  vec2 uv = (vUv - 0.5) / uZoom + 0.5 + uPan * span * 0.5;
  vec3 col;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    col = vec3(0.02, 0.025, 0.03);
  } else {
    float ca = 0.0016 + 0.0011 * (uZoom - 1.0); // chromatic spread grows with zoom
    float r = texture2D(tFeed, uv + vec2(ca, 0.0)).r;
    vec4 c = texture2D(tFeed, uv);
    float b = texture2D(tFeed, uv - vec2(ca, 0.0)).b;
    col = vec3(r, c.g, b);
    // Bright security-camera grade: lift exposure hard, then roll the blacks
    // up so shadows stay readable instead of crushing to nothing.
    col *= 3.6;
    col = col / (col + vec3(1.0)) * 1.9;
    col = filmic(col);
    col = col * 0.82 + vec3(0.11, 0.13, 0.15); // lift blacks: no more black holes
    // gentle contrast S-curve keeps it looking like video, not a flat wash
    col = clamp(col, 0.0, 1.0);
    col = col * col * (3.0 - 2.0 * col) * 0.35 + col * 0.65;
    // faint green CCTV cast
    col *= vec3(0.9, 1.0, 0.92);
  }
  // scanlines + rolling band (gentler now that the image is brighter)
  col *= 0.9 + 0.1 * sin(vUv.y * 700.0 + uTime * 3.0);
  col *= 0.96 + 0.04 * sin(vUv.y * 14.0 - uTime * 2.2);
  // animated grain (thickens as the stare locks on)
  float n = fract(sin(dot(vUv * (uTime + 13.0), vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * (uGrain + uDread * 0.30);
  // the feed bleeds red under a locked stare
  col = mix(col, vec3(col.r * 1.5 + 0.06, col.g * 0.35, col.b * 0.35), uDread * 0.75);
  // edge vignette (much softer than before)
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * 0.42;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createMonitor({ renderer, scene, stations, monster }) {
  const rt = new THREE.WebGLRenderTarget(FEED_W, FEED_H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });

  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    tFeed: { value: rt.texture },
    uZoom: { value: 1 },
    uPan: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uGrain: { value: 0.10 },
    uDread: { value: 0 },
  };
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    })
  );
  quad.frustumCulled = false;
  quad.renderOrder = 999;
  overlayScene.add(quad);

  const state = {
    open: false,
    index: 0,
    zoomIx: 0,
    panX: 0, // -1..1 mouse nudge
    panY: 0,
    time: 0,
    staticT: 0, // fullscreen static burst timer (feed cuts)
  };

  const ray = new THREE.Raycaster();
  const box = new THREE.Box3();
  const tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  const api = {
    state,
    ZOOMS,
    get open() { return state.open; },
    get station() { return stations[state.index]; },
    get zoom() { return ZOOMS[state.zoomIx]; },
    get stations() { return stations; },

    toggle() { return state.open ? api.close() : api.open_(); },
    open_() {
      state.open = true;
      state.zoomIx = 0; state.panX = 0; state.panY = 0;
      document.getElementById('cctv')?.classList.remove('hidden');
      api.refreshDom();
    },
    close() {
      state.open = false;
      document.getElementById('cctv')?.classList.add('hidden');
    },
    next() { api.select((state.index + 1) % stations.length); },
    prev() { api.select((state.index - 1 + stations.length) % stations.length); },
    select(i) {
      state.index = Math.max(0, Math.min(stations.length - 1, i));
      state.zoomIx = 0; state.panX = 0; state.panY = 0;
      api.refreshDom();
    },
    zoomIn() { state.zoomIx = Math.min(ZOOMS.length - 1, state.zoomIx + 1); api.refreshDom(); },
    zoomOut() { state.zoomIx = Math.max(0, state.zoomIx - 1); api.refreshDom(); },
    /** Fullscreen static burst (landing on an occupied feed, room change). */
    staticBurst(sec = 1.0) { state.staticT = Math.max(state.staticT, sec); },
    /** Mouse nudge pans the zoomed view (-1..1). */
    setPan(nx, ny) {
      state.panX = Math.max(-1, Math.min(1, nx));
      state.panY = Math.max(-1, Math.min(1, ny));
    },
    /** Locked-on stare 0..1 (drives the shader + eye burn). */
    setDread(d) {
      uniforms.uDread.value = Math.max(0, Math.min(1, d));
    },
    get dread() { return uniforms.uDread.value; },
    /**
     * Recenter the zoomed view on a feed-space point (ndc -1..1),
     * so the kill shot frames the subject's face.
     */
    centerOn(nx, ny) {
      const z = api.zoom;
      const span = 1 - 1 / z;
      if (span < 1e-4) { api.setPan(0, 0); return; }
      const uvx = nx * 0.5 + 0.5;
      const uvy = ny * 0.5 + 0.5;
      api.setPan((uvx - 0.5) * 2 / span, (uvy - 0.5) * 2 / span);
    },
    refreshDom() {
      const st = api.station;
      const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
      set('cctv-cam', `${st.camNo} — ${st.name}`);
      set('cctv-zoom', `ZOOM x${api.zoom.toFixed(1)}`);
      set('cctv-zoom-t', `ZOOM x${api.zoom.toFixed(1)}`);
      set('cctv-signal', st.signal);
    },

    /**
     * Is the live subject on the selected feed reportable?
     * Needs: subject in this room + on screen + unblocked + big enough
     * on screen (zoom in on small distant figures).
     */
    inspect() {
      if (!monster.present || monster.stationIndex !== state.index) {
        return { visible: false, reason: 'empty' };
      }
      const st = api.station;
      const cam = st.camera;
      box.setFromObject(monster.fig);
      if (box.isEmpty()) return { visible: false, reason: 'empty' };
      const [center, size, dir] = tmp;
      box.getCenter(center);
      box.getSize(size);
      const ndc = center.clone().project(cam);
      if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95 || ndc.z > 1 || ndc.z < -1) {
        return { visible: false, reason: 'offscreen' };
      }
      const dist = cam.position.distanceTo(center);
      if (dist > cam.far) return { visible: false, reason: 'offscreen' };
      // occlusion: anything between the lens and the subject?
      dir.subVectors(center, cam.position).normalize();
      ray.set(cam.position, dir);
      ray.far = dist - 0.25;
      if (st.group && ray.intersectObject(st.group, true).length > 0) {
        return { visible: false, reason: 'blocked' };
      }
      // apparent height as a fraction of screen height, before zoom
      const fov = (cam.fov * Math.PI) / 180;
      const apparent = size.y / (2 * Math.tan(fov / 2) * dist);
      const onScreen = apparent * api.zoom;
      if (onScreen < 0.16) {
        return { visible: false, reason: 'toosmall', needZoom: 0.16 / Math.max(apparent, 1e-4) };
      }
      return { visible: true, reason: 'ok', dist, size: size.y };
    },

    update(dt) {
      state.time += dt;
      if (state.staticT > 0) state.staticT = Math.max(0, state.staticT - dt);
    },

    /** Render the selected feed to the texture, then the CCTV frame fullscreen. */
    render() {
      const st = api.station;
      renderer.setRenderTarget(rt);
      renderer.render(scene, st.camera);
      renderer.setRenderTarget(null);
      uniforms.uZoom.value = api.zoom;
      uniforms.uPan.value.set(state.panX, state.panY);
      uniforms.uTime.value = state.time;
      uniforms.uGrain.value = 0.10 + (state.staticT > 0 ? 0.45 : 0);
      const was = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlayScene, overlayCam);
      renderer.autoClear = was;
    },
  };
  return api;
}
