// Circle-vs-AABB collision for furniture. Colliders may follow a live
// Object3D (chair, which moves) or enable conditionally (open door swing).
export function buildColliders(refs) {
  const list = [
    { x: -1.2, z: -2.5, hx: 1.3, hz: 0.5 }, // desk (slightly less back block)
    { ref: refs.chair, hx: 0.35, hz: 0.35 }, // chair (follows it, even mid-anomaly)
    { x: 2.6, z: -3.5, hx: 0.45, hz: 0.3 }, // filing cabinet
    { x: -4.2, z: -3.2, hx: 0.3, hz: 0.3 }, // plant pot
    // The doorway leaf. Solid ONLY while it is shut; once it swings open the
    // gap is walkable, which is the whole point of the fix.
    { door: true, x: 3.6, z: -3.95, hx: 0.6, hz: 0.09 },
    // Corridor walls: inner faces at x 2.85 / 4.35 leave a 1.5m channel.
    { x: 2.35, z: -6.5, hx: 0.5, hz: 2.8 }, // corridor left wall
    { x: 4.85, z: -6.5, hx: 0.5, hz: 2.8 }, // corridor right wall
    // Power room: side and back walls, plus the front wall in two pieces with
    // a gap at x 2.5..4.7 where the corridor comes through.
    { x: -0.4, z: -11.5, hx: 0.6, hz: 2.8 }, // power room left wall
    { x: 7.4, z: -11.5, hx: 0.6, hz: 2.8 }, // power room right wall
    { x: 1.15, z: -9.0, hx: 1.35, hz: 0.4 }, // front wall, left of the mouth
    { x: 5.95, z: -9.0, hx: 1.25, hz: 0.4 }, // front wall, right of the mouth
  ];

  // Fuse-panel wing + electrical room: chained behind the power room, all the
  // way out to the main breaker. Side walls use the same inner faces as the
  // power room so the two read as one building.
  list.push(
    { x: -0.4, z: -32, hx: 0.6, hz: 18.1 }, // wing left wall
    { x: 7.4, z: -32, hx: 0.6, hz: 18.1 }, // wing right wall
    { x: 3.5, z: -50.2, hx: 3.9, hz: 0.5 }, // wing back wall (electrical room)
  );
  // Every divider — the power-room back wall first, then the six internal
  // ones — is two segments with the doorway gap left walkable. Same list the
  // stalker routes through, so its gap and yours are always the same gap.
  const DOOR_W = 1.8;
  for (const d of refs.wingDoors || []) {
    const g0 = d.x - DOOR_W / 2, g1 = d.x + DOOR_W / 2;
    list.push({ x: (-0.2 + g0) / 2, z: d.z, hx: (g0 + 0.2) / 2, hz: 0.4 });
    list.push({ x: (g1 + 7.2) / 2, z: d.z, hx: (7.2 - g1) / 2, hz: 0.4 });
  }

  // Wing props, matching the boxes built in room.js.
  list.push(
    { x: 6.4, z: -24.1, hx: 0.75, hz: 0.75 }, // stacked crates (storage)
    { x: 3.5, z: -28.0, hx: 1.15, hz: 0.65 }, // table (break room)
    { x: 1.5, z: -31.5, hx: 0.85, hz: 0.65 }, // furnace (boiler room)
    { x: 6.6, z: -37.8, hx: 0.35, hz: 1.05 }, // shelving (archive room)
    { x: 1.0, z: -36.5, hx: 0.5, hz: 0.5 }, // boxed files (archive room)
    { x: 1.6, z: -42.5, hx: 0.85, hz: 0.75 }, // pump housing (pump room)
    { x: 5.8, z: -43.5, hx: 0.65, hz: 0.55 }, // pressure tank (pump room)
    { x: 1.2, z: -49.0, hx: 1.0, hz: 0.35 }, // workbench (electrical room)
    { x: 2.2, z: -48.7, hx: 0.3, hz: 0.3 }, // tool box (electrical room)
  );

  // Hiding lockers derive from the meshes so a rotated body (against a wing
  // wall) swaps its half-extents instead of blocking the wrong axis.
  for (const g of refs.lockers || []) {
    const turned = Math.abs(Math.sin(g.rotation.y)) > 0.5;
    list.push({ x: g.position.x, z: g.position.z, hx: turned ? 0.35 : 0.5, hz: turned ? 0.5 : 0.35 });
  }
  return list;
}

export function resolveCollisions(pos, radius, colliders, refs) {
  for (const c of colliders) {
    if (c.door && Math.abs(refs.doorPivot.rotation.y) > 0.35) continue; // open: walk through
    const cx = c.ref ? c.ref.position.x : c.x;
    const cz = c.ref ? c.ref.position.z : c.z;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const px = c.hx + radius - Math.abs(dx);
    if (px <= 0) continue;
    const pz = c.hz + radius - Math.abs(dz);
    if (pz <= 0) continue;
    // Push out along the axis of least penetration.
    if (px < pz) pos.x = cx + Math.sign(dx || 1) * (c.hx + radius);
    else pos.z = cz + Math.sign(dz || 1) * (c.hz + radius);
  }
}
