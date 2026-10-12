// Adaptive quality: watches the real frame rate and sheds the expensive
// extras (bloom -> shadow map -> render scale) so weak GPUs still run smooth.
// Steps back up when there's headroom, with a long cooldown to avoid flapping.
import * as THREE from 'three';

export function createQuality({ renderer, composer, bloomPass, scene, camera, shadowLight, maxPixelRatio = 1.5 }) {
  const LABELS = ['full — bloom + shadows', 'no bloom', 'no bloom, no shadows'];
  let tier = 0; // 0 = everything, 1 = no bloom, 2 = no bloom/shadows, ratio 1
  let frames = 0;
  let lastSample = performance.now();
  let cooldown = 2; // ignore boot / shader-compile spikes
  let slow = 0;
  let fast = 0;
  let fps = 0;

  const pixelRatio = () => (tier >= 2 ? 1 : Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  const ENV_BASE = 0.25;

  function apply() {
    bloomPass.enabled = tier === 0;
    // Image-based lighting is a GPU luxury: full quality keeps the PBR sheen,
    // degraded tiers drop it entirely so weak/software GPUs stay playable.
    if (scene) scene.environmentIntensity = tier === 0 ? ENV_BASE : 0;
    if (shadowLight) shadowLight.castShadow = tier < 2;
    const r = pixelRatio();
    renderer.setPixelRatio(r);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(r);
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  return {
    get tier() { return tier; },
    get fps() { return fps; },
    get bloomEnabled() { return tier === 0; },
    get shadowsEnabled() { return tier < 2; },
    get pixelRatio() { return pixelRatio(); },
    label: () => LABELS[tier],
    apply,
    resize: apply,
    /** Bloom path when we can afford it, plain forward render otherwise. */
    render() {
      if (tier === 0) composer.render();
      else renderer.render(scene, camera);
    },
    /** Call once per frame. */
    update() {
      const now = performance.now();
      frames++;
      if (cooldown > 0) {
        cooldown -= (now - lastSample) / 1000;
        lastSample = now;
        frames = 0;
        return;
      }
      const window_ = (now - lastSample) / 1000;
      if (window_ < 1) return; // keep counting frames into this window
      lastSample = now;
      fps = frames / window_;
      frames = 0;
      if (window_ > 2.5) return; // stall (tab switch, alt-tab) — not a real frame rate
      if (fps < 26) { slow++; fast = 0; }
      else if (fps > 55) { fast++; slow = 0; }
      else { slow = 0; fast = 0; }
      // Two slow windows in a row step down, three fast ones step back up,
      // so a single hitch never changes the look.
      if (slow >= 2 && tier < 2) { tier++; apply(); slow = 0; cooldown = 2; }
      else if (fast >= 3 && tier > 0) { tier--; apply(); fast = 0; cooldown = 8; }
    },
  };
}
