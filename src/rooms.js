// Eight CCTV stations: the office the player sits in (CAM 01) plus seven
// feeds that shoot the REAL fuse-wing rooms behind the power room — main
// hallway, storage room, break room, boiler room, the archive, the pump room,
// and the electrical room at the far end. The cameras are mounted inside the
// actual walkable rooms, so what you watch on the monitors is exactly where
// you go when the power fails — and the only way to the main breaker is
// through every one of them.
//
// Each station: { idx, camNo, id, name, signal, camPos, lookAt, group,
//                 camera, light, fill, lightBase, patrol: [Vector3] }
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Build the monitoring stations against the real wing rooms (refs.annex). */
export function buildStations(scene, refs) {
  // The wing group. The occlusion tests in monitor.js ray-check against it, so
  // a wall between the lens and the subject correctly hides it — just like
  // looking through the real rooms.
  const annex = refs?.annex || null;
  const defs = [
    {
      id: 'office', name: 'SECURITY OFFICE', signal: 'LOCAL FEED', group: null,
      camPos: V(4.3, 3.0, 3.4), lookAt: V(-1.2, 1.1, -2.6), fov: 65,
      far: 12, // the office feed never sees past the room it sits in
      patrol: [],
    },
    // One high-corner dome per wing room, angled back along it. The positions
    // live inside the real rooms, so each feed is framed by the same walls,
    // doors and stashed props the player walks past at night.
    {
      id: 'hall', name: 'MAIN HALLWAY', signal: 'AUX-2 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -14.8), lookAt: V(4.6, 1.2, -19.0), fov: 70,
      patrol: [[2.0, -16.0], [5.0, -18.0], [2.1, -19.4], [5.0, -16.6]],
    },
    {
      id: 'store', name: 'STORAGE ROOM', signal: 'AUX-3 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -20.8), lookAt: V(4.6, 1.2, -24.0), fov: 70,
      patrol: [[2.0, -21.0], [5.0, -23.0], [2.1, -24.4], [5.0, -21.6]],
    },
    {
      id: 'break', name: 'BREAK ROOM', signal: 'AUX-4 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -25.8), lookAt: V(4.6, 1.2, -29.0), fov: 70,
      patrol: [[2.0, -26.0], [5.0, -28.0], [2.1, -29.4], [5.0, -26.6]],
    },
    {
      id: 'boiler', name: 'BOILER ROOM', signal: 'AUX-5 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -30.8), lookAt: V(4.6, 1.2, -34.0), fov: 70,
      patrol: [[2.6, -32.2], [5.0, -31.2], [2.1, -33.6], [5.0, -34.2]],
    },
    {
      id: 'archive', name: 'ARCHIVE ROOM', signal: 'AUX-6 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -35.8), lookAt: V(4.4, 1.2, -39.2), fov: 70,
      patrol: [[2.6, -37.4], [4.8, -38.2], [2.5, -39.4], [4.6, -37.0]],
    },
    {
      id: 'pump', name: 'PUMP ROOM', signal: 'AUX-7 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -40.8), lookAt: V(4.4, 1.2, -44.2), fov: 70,
      patrol: [[2.6, -42.4], [4.8, -43.2], [2.5, -44.4], [4.6, -42.0]],
    },
    {
      id: 'elec', name: 'ELECTRICAL ROOM', signal: 'AUX-8 · 4fps', group: annex,
      camPos: V(2.4, 2.9, -45.8), lookAt: V(4.4, 1.2, -49.2), fov: 70,
      patrol: [[2.6, -47.4], [4.8, -48.2], [2.5, -49.4], [4.6, -47.0]],
    },
  ];

  return defs.map((d, idx) => {
    const camera = new THREE.PerspectiveCamera(d.fov, 16 / 9, 0.1, d.far ?? 40);
    camera.position.copy(d.camPos);
    camera.lookAt(d.lookAt);
    camera.updateMatrixWorld();
    return {
      idx,
      camNo: `CAM 0${idx + 1}`,
      id: d.id,
      name: d.name,
      signal: d.signal,
      camPos: d.camPos.clone(),
      lookAt: d.lookAt.clone(),
      group: d.group,
      camera,
      light: null,   // wing rooms are lit by their fuse panels, not by a rig
      fill: null,
      lightBase: 0,
      patrol: d.patrol.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    };
  });
}