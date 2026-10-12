import * as THREE from 'three';
import { floorTexture, wallTexture, ceilingTexture, contactShadow, woodTexture, screenTexture, starsTexture, glowTexture, rugTexture, curtainTexture, paintingTexture } from './textures.js';

// Builds the normal room. Returns refs used by anomalies.
export function buildRoom(scene) {
  const refs = {};
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.52 });
  const darkTrimMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.58 });

  /**
   * Pure architecture/dressing. These meshes should read in the render but
   * never intercept the report ray: trim, rugs, curtains, wall plates, papers,
   * and other non-anomalous dressing are visual only.
   */
  function decor(obj) {
    obj.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.raycast = () => {};
        o.userData.flatDecor = true;
      }
    });
    return obj;
  }
  function freeze(obj) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { o.matrixAutoUpdate = false; });
    return obj;
  }
  function putDecor(parent, obj, x, y, z, ry = 0) {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    parent.add(decor(obj));
    // Static dressing never moves: freeze its matrices so the renderer skips
    // per-frame matrix updates for hundreds of trim/prop meshes.
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { o.matrixAutoUpdate = false; });
    return obj;
  }

  // Hardwood floor, painted drywall, stippled ceiling, and residential trim.
  const floorTex = floorTexture();
  const floorNorm = floorTexture(); // reuse canvas as simple normal-ish detail
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 8, 32, 24),
    new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.015, roughness: 0.54, metalness: 0.01 })
  );
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  freeze(floor);

  const ceilTex = ceilingTexture();
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 8),
    new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.94 })
  );
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; scene.add(ceil);
  decor(ceil);
  freeze(ceil);

  const wallTex = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 0.008, roughness: 0.88, metalness: 0.001 });
  const mkWall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m); return m;
  };
  // The back wall is split around a real 1.2m doorway. It used to be one
  // solid plane, which left the modelled door frame hanging on a blank wall.
  const DOOR_X0 = 3.0, DOOR_X1 = 4.2, DOOR_H = 2.2;
  refs.doorway = { x0: DOOR_X0, x1: DOOR_X1, h: DOOR_H, cx: (DOOR_X0 + DOOR_X1) / 2 };
  mkWall(DOOR_X0 + 5, 3.2, (DOOR_X0 - 5) / 2, 1.6, -4, 0);                                    // left of the doorway
  mkWall(5 - DOOR_X1, 3.2, (DOOR_X1 + 5) / 2, 1.6, -4, 0);                                    // right of the doorway
  mkWall(DOOR_X1 - DOOR_X0, 3.2 - DOOR_H, (DOOR_X0 + DOOR_X1) / 2, DOOR_H + (3.2 - DOOR_H) / 2, -4, 0); // header
  mkWall(10, 3.2, 0, 1.6, 4, Math.PI);       // front wall
  mkWall(8, 3.2, -5, 1.6, 0, Math.PI / 2);   // left
  mkWall(8, 3.2, 5, 1.6, 0, -Math.PI / 2);   // right

  // Baseboards and crown molding turn four flat planes into a finished room.
  const baseFB = new THREE.BoxGeometry(10, 0.14, 0.055);
  const baseSide = new THREE.BoxGeometry(0.055, 0.14, 8);
  const crownFB = new THREE.BoxGeometry(10, 0.11, 0.075);
  const crownSide = new THREE.BoxGeometry(0.075, 0.11, 8);
  // Back-wall baseboard and crown stop at the doorway jambs.
  putDecor(scene, new THREE.Mesh(new THREE.BoxGeometry(DOOR_X0 + 5, 0.14, 0.055), trimMat), (DOOR_X0 - 5) / 2, 0.07, -3.9725);
  putDecor(scene, new THREE.Mesh(new THREE.BoxGeometry(5 - DOOR_X1, 0.14, 0.055), trimMat), (DOOR_X1 + 5) / 2, 0.07, -3.9725);
  putDecor(scene, new THREE.Mesh(baseFB, trimMat), 0, 0.07, 3.9725);
  putDecor(scene, new THREE.Mesh(baseSide, trimMat), -4.9725, 0.07, 0);
  putDecor(scene, new THREE.Mesh(baseSide, trimMat), 4.9725, 0.07, 0);
  putDecor(scene, new THREE.Mesh(new THREE.BoxGeometry(DOOR_X1 - DOOR_X0, 0.11, 0.075), trimMat), (DOOR_X0 + DOOR_X1) / 2, 3.145, -3.9625);
  putDecor(scene, new THREE.Mesh(crownFB, trimMat), 0, 3.145, 3.9625);
  putDecor(scene, new THREE.Mesh(crownSide, trimMat), -4.9625, 3.145, 0);
  putDecor(scene, new THREE.Mesh(crownSide, trimMat), 4.9625, 3.145, 0);

  // A lived-in rug anchors the desk and chair without changing collision.
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 3.1),
    new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.96 })
  );
  rug.rotation.x = -Math.PI / 2;
  putDecor(scene, rug, -1.0, 0.006, -1.55);
  putDecor(scene, contactShadow(3.1, 1.55, 0.30), -1.2, 0.009, -2.6);
  putDecor(scene, contactShadow(1.0, 1.0, 0.30), -1.2, 0.012, -1.5);
  putDecor(scene, contactShadow(1.15, 0.85, 0.30), 2.6, 0.008, -3.5);
  putDecor(scene, contactShadow(0.85, 0.85, 0.32), -4.2, 0.008, -3.2);

  // Warm residential ambient so wood, fabric, and drywall read at a glance;
  // the flashlight still does the real investigative work.
  // Warm directional fill to model indirect light bouncing off furniture.
  const fillDir = new THREE.DirectionalLight(0xefe2cf, 0.12);
  fillDir.position.set(4, 3, 2);
  fillDir.target.position.set(0, 1, 0);
  scene.add(fillDir);
  scene.add(fillDir.target);

  // Semi-flush frosted dome fixture (normal: steady warm light)
  const lampGroup = new THREE.Group();
  lampGroup.position.set(0, 3.1, 0);
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.10, 20), darkTrimMat);
  mount.position.y = -0.05; lampGroup.add(mount);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 28, 14, 0, Math.PI * 2, Math.PI * 0.48, Math.PI * 0.52),
    new THREE.MeshStandardMaterial({ color: 0xf5e8cf, roughness: 0.42, transparent: true, opacity: 0.96, side: THREE.DoubleSide, emissive: 0xffe4ae, emissiveIntensity: 0.34 })
  );
  dome.position.y = -0.34; lampGroup.add(dome);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  bulb.position.y = -0.42; lampGroup.add(bulb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(1.75); halo.position.y = -0.44; halo.raycast = () => {}; // decorative glow, never aimable
  halo.userData.flatDecor = true;
  lampGroup.add(halo);
  const lampLight = new THREE.PointLight(0xffd9a0, 5.5, 13, 1.35);
  lampLight.position.y = -0.48; lampGroup.add(lampLight);
  scene.add(lampGroup);
  refs.lampGroup = lampGroup; refs.lampLight = lampLight; refs.bulb = bulb;
  freeze(lampGroup); // light color/intensity animate; the fixture itself never moves

  // Desk + monitor + keyboard + mug
  const desk = new THREE.Group(); desk.position.set(-1.2, 0, -2.6); scene.add(desk);
  const deskWood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.58 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.1), deskWood); top.position.y = 0.75; desk.add(top);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.035, 1.12), darkTrimMat); edge.position.y = 0.705; desk.add(edge);
  [[-1.2, -0.45], [1.2, -0.45], [-1.2, 0.45], [1.2, 0.45]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), mat(0x4a3220)); leg.position.set(x, 0.375, z); desk.add(leg);
  });
  // Drawer pedestal, modesty panel, and cable tray make it office furniture,
  // not four legs under a slab.
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.58, 0.92), deskWood); pedestal.position.set(-0.94, 0.4, 0); desk.add(pedestal);
  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.78), darkTrimMat);
    drawer.position.set(-0.665, 0.22 + i * 0.18, 0); desk.add(drawer);
    const pull = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.22), trimMat);
    pull.position.set(-0.65, 0.22 + i * 0.18, 0); desk.add(pull);
  }
  const modesty = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 0.045), deskWood); modesty.position.set(0.1, 0.48, -0.42); desk.add(modesty);
  refs.desk = desk;
  freeze(desk);

  // Lived-in desktop dressing. Visual only: it must never steal report clicks.
  const deskDress = new THREE.Group(); scene.add(deskDress);
  const keyboard = new THREE.Group(); keyboard.position.set(-1.18, 0.815, -2.18); deskDress.add(keyboard);
  const kbBase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.028, 0.19), mat(0x23262e, 0.62)); keyboard.add(kbBase);
  for (let r = 0; r < 3; r++) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.018, 0.038), mat(0x3a3f49, 0.7));
    row.position.set(0, 0.022, -0.058 + r * 0.058); keyboard.add(row);
  }
  const spacebar = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.018, 0.038), mat(0x4b515d, 0.7));
  spacebar.position.set(-0.03, 0.022, 0.10); keyboard.add(spacebar);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.012, 0.24), mat(0x1d3a4a, 0.9));
  pad.position.set(-0.52, 0.806, -2.18); deskDress.add(pad);
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), mat(0x23262e, 0.45));
  mouse.scale.set(1, 0.62, 1.35); mouse.position.set(-0.52, 0.835, -2.20); deskDress.add(mouse);
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d5, roughness: 0.94 });
  const paper1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.32), paperMat);
  paper1.position.set(-1.82, 0.806, -2.24); paper1.rotation.y = 0.18; deskDress.add(paper1);
  const paper2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.32), paperMat);
  paper2.position.set(-1.78, 0.812, -2.20); paper2.rotation.y = -0.11; deskDress.add(paper2);
  const mugGroup = new THREE.Group(); mugGroup.position.set(-0.28, 0.80, -2.36); deskDress.add(mugGroup);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.042, 0.11, 18), new THREE.MeshStandardMaterial({ color: 0x9c2f2f, roughness: 0.38 }));
  mug.position.y = 0.055; mugGroup.add(mug);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.039, 18), new THREE.MeshStandardMaterial({ color: 0x2c1709, roughness: 0.25 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.102; mugGroup.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 8, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0x9c2f2f, roughness: 0.38 }));
  handle.position.set(0.048, 0.055, 0); handle.rotation.z = -Math.PI / 2; mugGroup.add(handle);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.035, 18), mat(0x24262c, 0.5));
  lampBase.position.set(-0.18, 0.818, -2.95); deskDress.add(lampBase);
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.52, 10), mat(0x24262c, 0.5));
  lampArm.position.set(-0.18, 1.06, -2.92); lampArm.rotation.x = 0.22; deskDress.add(lampArm);
  const lampHead = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.13, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x2b4a3f, roughness: 0.45, side: THREE.DoubleSide }));
  lampHead.position.set(-0.18, 1.30, -2.86); lampHead.rotation.x = 2.35; deskDress.add(lampHead);
  const lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  lampGlow.position.set(-0.18, 1.25, -2.83); deskDress.add(lampGlow);
  decor(deskDress);
  freeze(deskDress);

  const monitorGroup = new THREE.Group(); monitorGroup.position.set(-1.2, 1.15, -2.75); scene.add(monitorGroup);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture(), color: 0x9fd4ff });
  const monBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.08), mat(0x14171d, 0.5)); monitorGroup.add(monBody);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.59, 0.025), mat(0x08090c, 0.42));
  bezel.position.z = -0.028; monitorGroup.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), screenMat); screen.position.z = 0.045; monitorGroup.add(screen);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshBasicMaterial({ color: 0x54ff8a }));
  led.position.set(0.39, -0.245, 0.045); monitorGroup.add(led);
  const power = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.018, 0.012), mat(0x2b2f37, 0.55));
  power.position.set(0.31, -0.245, 0.045); monitorGroup.add(power);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.07), mat(0x222222, 0.55)); neck.position.y = -0.39; monitorGroup.add(neck);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.26), mat(0x1b1e24, 0.55)); foot.position.y = -0.545; monitorGroup.add(foot);
  refs.monitorGroup = monitorGroup; refs.screenMat = screenMat;
  freeze(monitorGroup); // screen color animates; the monitor itself never moves

  const chair = new THREE.Group(); chair.position.set(-1.2, 0, -1.5); scene.add(chair);
  const chairFabric = new THREE.MeshStandardMaterial({ color: 0x7e2a24, roughness: 0.78 });
  const chairFrame = mat(0x23262c, 0.48);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.06), chairFrame);
    spoke.position.set(Math.cos(a) * 0.17, 0.075, Math.sin(a) * 0.17);
    spoke.rotation.y = -a;
    chair.add(spoke);
    const caster = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), chairFrame);
    caster.position.set(Math.cos(a) * 0.33, 0.045, Math.sin(a) * 0.33);
    chair.add(caster);
  }
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 12), chairFrame); lift.position.y = 0.27; chair.add(lift);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.56), chairFabric); seat.position.y = 0.50; chair.add(seat);
  const seatFront = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.055, 0.055), chairFabric); seatFront.position.set(0, 0.455, -0.27); chair.add(seatFront);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.48, 0.055), chairFrame);
    post.position.set(0.26 * s, 0.78, 0.22); chair.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.42), chairFrame);
    arm.position.set(0.30 * s, 1.02, 0.02); chair.add(arm);
    const backPost = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.52, 0.055), chairFrame);
    backPost.position.set(0.20 * s, 0.82, 0.27); chair.add(backPost);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.64, 0.10), chairFabric); back.position.set(0, 1.02, 0.29); back.rotation.x = 0.08; chair.add(back);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.13, 0.09), chairFabric); headrest.position.set(0, 1.40, 0.32); headrest.rotation.x = 0.08; chair.add(headrest);
  scene.add(chair);
  refs.chair = chair;
  refs.chairHome = { pos: chair.position.clone(), rotY: chair.rotation.y };

  // Solid-wood home sideboard instead of an office filing cabinet.
  const cab = new THREE.Group(); cab.position.set(2.6, 0, -3.5); scene.add(cab);
  const cabWood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55 });
  const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.42, 0.58), cabWood); cabBody.position.y = 0.79; cab.add(cabBody);
  const cabTop = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.055, 0.63), darkTrimMat); cabTop.position.y = 1.525; cab.add(cabTop);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.10, 0.48), mat(0x2e2013, 0.8)); kick.position.set(0, 0.05, 0.03); cab.add(kick);
  for (const s of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.08, 0.035), cabWood);
    door.position.set(0.215 * s, 0.82, 0.30); cab.add(door);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.88, 0.018), darkTrimMat);
    inset.position.set(0.215 * s, 0.82, 0.315); cab.add(inset);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), trimMat);
    knob.position.set(0.075 * s, 0.82, 0.335); cab.add(knob);
  }
  refs.cabinet = cab;
  freeze(cab); // the books on top move; the sideboard never does

  // Framed landscape print with mat, molding, and glass highlight.
  const paintGroup = new THREE.Group(); paintGroup.position.set(0.6, 1.9, -3.97); scene.add(paintGroup);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.30, 1.00, 0.075), darkTrimMat); paintGroup.add(frame);
  const innerTrim = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.88, 0.082), trimMat); paintGroup.add(innerTrim);
  const matBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.78), new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.92 }));
  matBoard.position.z = 0.042; paintGroup.add(matBoard);
  const canvasMat = new THREE.MeshStandardMaterial({ map: paintingTexture(), roughness: 0.86 });
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.68), canvasMat); canvas.position.z = 0.048; paintGroup.add(canvas);
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.68), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.055, depthWrite: false }));
  glint.position.set(-0.30, 0, 0.052); glint.rotation.z = 0.18; paintGroup.add(glint);
  decor(glint);
  refs.painting = paintGroup; refs.paintingCanvasMat = canvasMat;

  // Residential bed against the left wall - used as a hiding spot.
  // Built axis-aligned around a single center point (no group rotation) so the
  // parts can't drift out of register: local -X is the head, +X the foot.
  // Footprint 2.0m x 1.4m, top of mattress at 0.50m.
  const bedGroup = new THREE.Group();
  bedGroup.position.set(-3.94, 0, -0.2);
  scene.add(bedGroup);
  const bedWood = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xc9a877, roughness: 0.6 });
  const bedMattressMat = new THREE.MeshStandardMaterial({ color: 0xf2ede2, roughness: 0.92 });
  const bedBlanketMat = new THREE.MeshStandardMaterial({ color: 0x4e6f92, roughness: 0.95 });
  const bedPillowMat = new THREE.MeshStandardMaterial({ color: 0xf0ebe0, roughness: 0.95 });

  // 1. Frame: a flat rectangular base carried on four short legs.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.10), bedWood);
      leg.position.set(0.82 * sx, 0.08, 0.61 * sz);
      bedGroup.add(leg);
    }
  }
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.14, 1.32), bedWood);
  bedFrame.position.y = 0.23;
  bedGroup.add(bedFrame);

  // 2. Headboard: a single upright board on the head end only, facing down
  //    the length of the bed, bed-width wide and 1m tall.
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 1.4), bedWood);
  headboard.position.set(-0.96, 0.50, 0);
  bedGroup.add(headboard);

  // 3. Footboard: low board on the opposite end, level with the frame top.
  const footboard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.30, 1.4), bedWood);
  footboard.position.set(0.96, 0.15, 0);
  bedGroup.add(footboard);

  // 4. Mattress: one slab flush on the frame; top lands exactly at 0.50m.
  const bedMatt = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.20, 1.28), bedMattressMat);
  bedMatt.position.y = 0.40;
  bedGroup.add(bedMatt);

  // 5. Blanket over the lower two thirds, with a folded strip on its top edge.
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.06, 1.32), bedBlanketMat);
  blanket.position.set(0.305, 0.53, 0);
  bedGroup.add(blanket);
  const fold = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 1.30), bedBlanketMat);
  fold.position.set(-0.23, 0.60, 0);
  bedGroup.add(fold);

  // 6. Two plump pillows at the head end, resting on the mattress.
  for (const sz of [-1, 1]) {
    const pillow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), bedPillowMat);
    pillow.scale.set(0.29, 0.08, 0.29);
    pillow.position.set(-0.62, 0.58, 0.30 * sz);
    bedGroup.add(pillow);
  }

  putDecor(scene, contactShadow(2.15, 1.55, 0.34), -3.94, 0.008, -0.2);
  decor(bedGroup); freeze(bedGroup);
  refs.bedGroup = bedGroup;

  // Cased home window with divided lights, sill, and tied-back curtains.
  const winGroup = new THREE.Group(); winGroup.position.set(-3.0, 1.9, -3.97); scene.add(winGroup);
  const railH = new THREE.BoxGeometry(1.48, 0.10, 0.10);
  const stileV = new THREE.BoxGeometry(0.10, 1.30, 0.10);
  for (const [geo, x, y] of [[railH, 0, 0.65], [railH, 0, -0.65], [stileV, -0.69, 0], [stileV, 0.69, 0]]) {
    const rail = new THREE.Mesh(geo, trimMat); rail.position.set(x, y, 0); winGroup.add(rail);
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.30, 1.12), new THREE.MeshBasicMaterial({ map: starsTexture() }));
  glass.position.z = -0.025; winGroup.add(glass);
  const muntinV = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.12, 0.025), trimMat); muntinV.position.z = 0.005; winGroup.add(muntinV);
  const muntinH = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.035, 0.025), trimMat); muntinH.position.z = 0.005; winGroup.add(muntinH);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.07, 0.18), trimMat); sill.position.set(0, -0.735, 0.07); winGroup.add(sill);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.09, 0.06), trimMat); apron.position.set(0, -0.81, 0.02); winGroup.add(apron);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: 0xdfeaff }));
  moon.position.set(0.35, 0.28, -0.005); winGroup.add(moon);
  refs.moon = moon; refs.moonHome = moon.position.clone();
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const eyeL = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), eyeMat); eyeL.position.set(-0.15, 0.05, 0.0); eyeL.visible = false; winGroup.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), eyeMat); eyeR.position.set(0.15, 0.05, 0.0); eyeR.visible = false; winGroup.add(eyeR);
  refs.window = winGroup; refs.eyeL = eyeL; refs.eyeR = eyeR;

  // Curtain rod, finials, and side panels stay clear of the glass and eyes.
  const curtainDress = new THREE.Group(); curtainDress.position.set(-3.0, 1.9, -3.97); scene.add(curtainDress);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.35, 12), darkTrimMat);
  rod.rotation.z = Math.PI / 2; rod.position.set(0, 0.86, 0.18); curtainDress.add(rod);
  for (const s of [-1, 1]) {
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), darkTrimMat);
    finial.position.set(1.19 * s, 0.86, 0.18); curtainDress.add(finial);
    const panelGeo = new THREE.PlaneGeometry(0.52, 1.78, 12, 1);
    const pos = panelGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin((x + 0.26) * 18.0) * 0.035);
    }
    panelGeo.computeVertexNormals();
    const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({ map: curtainTexture(), roughness: 0.92, side: THREE.DoubleSide }));
    panel.position.set(1.02 * s, -0.02, 0.18);
    curtainDress.add(panel);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.018, 8, 18), trimMat);
    tie.position.set(1.02 * s, -0.18, 0.18); tie.rotation.x = Math.PI / 2; curtainDress.add(tie);
  }
  decor(curtainDress);
  freeze(curtainDress);

  // Six-panel residential door with casing, hinges, and hardware.
  // Hinge sits at the left jamb so the leaf swings out into the corridor and
  // never blocks the doorway the player has to walk through.
  const doorGroup = new THREE.Group(); doorGroup.position.set(DOOR_X0, 0, -3.95); scene.add(doorGroup);
  const LEAF_W = DOOR_X1 - DOOR_X0 - 0.04; // 1.16m leaf in a 1.2m opening
  const jambV = new THREE.BoxGeometry(0.12, 2.32, 0.14);
  const jambH = new THREE.BoxGeometry(DOOR_X1 - DOOR_X0 + 0.24, 0.12, 0.14);
  const jambL = new THREE.Mesh(jambV, trimMat); jambL.position.set(-0.06, 1.16, 0); doorGroup.add(jambL);
  const jambR = new THREE.Mesh(jambV, trimMat); jambR.position.set(DOOR_X1 - DOOR_X0 + 0.06, 1.16, 0); doorGroup.add(jambR);
  const jambT = new THREE.Mesh(jambH, trimMat); jambT.position.set((DOOR_X1 - DOOR_X0) / 2, DOOR_H + 0.06, 0); doorGroup.add(jambT);
  const doorPivot = new THREE.Group(); doorGroup.add(doorPivot);
  const doorMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.58 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(LEAF_W, 2.2, 0.075), doorMat);
  door.position.set(LEAF_W / 2, 1.1, 0); doorPivot.add(door);
  for (const py of [0.48, 1.08, 1.72]) {
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.30, py > 1.5 ? 0.42 : 0.52, 0.018), darkTrimMat);
      panel.position.set(LEAF_W / 2 + 0.26 * s, py, 0.042); doorPivot.add(panel);
      const panelBack = panel.clone(); panelBack.position.z = -0.042; doorPivot.add(panelBack);
    }
  }
  for (const hy of [0.45, 1.75]) {
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.025), trimMat);
    hinge.position.set(0.005, hy, 0.045); doorPivot.add(hinge);
  }
  const rosette = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.018, 16), trimMat);
  rosette.rotation.x = Math.PI / 2; rosette.position.set(LEAF_W - 0.15, 1.05, 0.045); doorPivot.add(rosette);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshStandardMaterial({ color: 0xb8a25e, roughness: 0.28, metalness: 0.85 }));
  knob.position.set(LEAF_W - 0.15, 1.05, 0.095); doorPivot.add(knob);
  decor(jambL); decor(jambR); decor(jambT);
  refs.doorPivot = doorPivot;

  // Fuller houseplant in glazed terracotta with soil and arching leaves.
  const plant = new THREE.Group(); plant.position.set(-4.2, 0, -3.2); scene.add(plant);
  const potMat = new THREE.MeshStandardMaterial({ color: 0xa34a2a, roughness: 0.42 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.21, 0.36, 18), potMat); pot.position.y = 0.18; plant.add(pot);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 18), potMat); rim.position.y = 0.375; plant.add(rim);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.25, 18), mat(0x241610, 0.98)); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.395; plant.add(soil);
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.72 });
  const leafTipMat = new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const lean = 0.18 + (i % 3) * 0.13;
    const h = 0.62 + (i % 4) * 0.12;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.075, h, 7), i % 2 ? leavesMat : leafTipMat);
    leaf.position.set(Math.cos(a) * 0.09, 0.40 + h * 0.42, Math.sin(a) * 0.09);
    leaf.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    leaf.scale.z = 0.42;
    plant.add(leaf);
  }
  refs.plant = plant;

  // Invisible-but-raycastable marker where the plant sits, so the
  // "plant missing" anomaly can still be aimed at. Uses colorWrite:false
  // so it never renders but still intersects the report ray.
  const plantGhost = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.2, 0.9),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  );
  plantGhost.position.set(-4.2, 0.6, -3.2);
  plantGhost.userData.anomalyType = 'plant-missing';
  plantGhost.userData.isActive = false;
  scene.add(plantGhost);
  refs.plantGhost = plantGhost;

  // Misplaced toy block: the anomaly is an object that should not be on a desk.
  const extra = new THREE.Group(); extra.position.set(-0.2, 0.80, -2.6); scene.add(extra);
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.52 }));
  block.position.y = 0.12; block.rotation.y = 0.28; extra.add(block);
  const inset = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.7 }));
  inset.position.set(-0.055, 0.13, 0.121); inset.rotation.y = 0.28; extra.add(inset);
  extra.visible = false;
  refs.extraObject = extra;
  freeze(extra); // visibility toggles; the block itself never moves

  // Real books on the sideboard: upright spines plus a horizontal stack.
  const books = new THREE.Group(); books.position.set(2.6, 1.75, -3.5); scene.add(books);
  const pageMat = new THREE.MeshStandardMaterial({ color: 0xe8dfc7, roughness: 0.9 });
  const bookCols = [0x7c2f26, 0x274b73, 0x2f6b4f, 0x8a6a2a, 0x4b355e];
  function book(w, h, d, color, x, y, z, ry = 0) {
    const g = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.62 }));
    g.add(cover);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.9, d * 0.96), pageMat);
    pages.position.x = w * 0.035;
    g.add(pages);
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.005, h * 0.18, d * 1.005), new THREE.MeshStandardMaterial({ color: 0xd8c690, roughness: 0.7 }));
    band.position.y = h * 0.22;
    g.add(band);
    g.position.set(x, y, z); g.rotation.y = ry;
    books.add(g);
    return g;
  }
  book(0.055, 0.34, 0.25, bookCols[0], -0.14, 0.17, 0);
  book(0.048, 0.31, 0.24, bookCols[1], -0.085, 0.155, 0.005, 0.025);
  book(0.060, 0.36, 0.26, bookCols[2], -0.025, 0.18, -0.005, -0.02);
  book(0.050, 0.30, 0.23, bookCols[3], 0.035, 0.15, 0.008, 0.04);
  book(0.45, 0.055, 0.32, bookCols[4], 0.12, 0.028, 0).rotation.z = 0.015;
  book(0.41, 0.050, 0.30, bookCols[0], 0.12, 0.080, 0.005).rotation.y = -0.06;
  refs.books = books; refs.booksHomeY = books.position.y;

  // Small residential details: photos, switch plates, vent, and thermostat.
  const homeDetails = new THREE.Group(); scene.add(homeDetails);
  function photoFrame(w, h, x, y, z, ry, art) {
    const g = new THREE.Group();
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), darkTrimMat); g.add(f);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.10, h - 0.10), new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.92 }));
    m.position.z = 0.024; g.add(m);
    const a = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.18, h - 0.18), new THREE.MeshStandardMaterial({ color: art, roughness: 0.88 }));
    a.position.z = 0.028; g.add(a);
    g.position.set(x, y, z); g.rotation.y = ry;
    homeDetails.add(g);
  }
  photoFrame(0.52, 0.66, 4.972, 2.05, -0.55, -Math.PI / 2, 0x365a73);
  photoFrame(0.42, 0.52, 4.972, 1.95, 0.25, -Math.PI / 2, 0x71513a);
  photoFrame(0.62, 0.48, 1.95, 2.18, -3.972, 0, 0x2e4a3a);
  const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.13, 0.018), trimMat);
  switchPlate.position.set(2.42, 1.25, -3.965); homeDetails.add(switchPlate);
  const toggle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.045, 0.028), mat(0x8f8578, 0.6));
  toggle.position.set(2.42, 1.25, -3.952); homeDetails.add(toggle);
  const thermostat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.035), mat(0xd8d2c2, 0.55));
  thermostat.position.set(1.75, 1.62, -3.96); homeDetails.add(thermostat);
  const thermoFace = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.055), new THREE.MeshBasicMaterial({ color: 0x9fd8c8 }));
  thermoFace.position.set(1.75, 1.62, -3.941); homeDetails.add(thermoFace);
  const outlet = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.12, 0.018), trimMat);
  outlet.position.set(-2.35, 0.20, -3.965); homeDetails.add(outlet);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.035), mat(0xcfc6b4, 0.6));
  vent.position.set(-0.1, 0.24, 3.965); vent.rotation.y = Math.PI; homeDetails.add(vent);
  for (let i = 0; i < 5; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.018, 0.012), mat(0x57503f, 0.7));
    slot.position.set(-0.1, 0.18 + i * 0.03, 3.945); homeDetails.add(slot);
  }
  decor(homeDetails);
  freeze(homeDetails);

  // --- Hallway annex + power room (Night 2 outage) ---
  // Corridor behind the office door (x 2.8..4.4, z -4..-9) + power room (x 0..7, z -14..-9).
  // All dressing is decor (non-raycast) so reports never hit it.
  const annex = new THREE.Group(); scene.add(annex);
  const annexFloor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 5.6), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  annexFloor.rotation.x = -Math.PI / 2; annexFloor.position.set(3.5, 0.005, -11.5); annex.add(annexFloor);
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 5.2), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.set(3.6, 0.005, -6.5); annex.add(hallFloor);
  const annexWallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  // The fuse wing is a chain of rooms read from both sides of every wall, so
  // single-sided planes would vanish when you look back through a doorway.
  annexWallMat.side = THREE.DoubleSide;
  const mkAnnexWall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), annexWallMat);
    m.position.set(x, y, z); m.rotation.y = ry; annex.add(m); return m;
  };
  // Power-room back wall, split around the mouth into the fuse wing (x 2.7..4.5).
  mkAnnexWall(2.9, 3.2, 1.25, 1.6, -14, 0);
  mkAnnexWall(2.7, 3.2, 5.85, 1.6, -14, 0);
  mkAnnexWall(1.8, 0.9, 3.6, 2.75, -14, 0);
  // Power-room front wall, split around the corridor mouth (x 2.5..4.7). It
  // used to be one full-width plane, sealing the corridor off from the room.
  mkAnnexWall(2.7, 3.2, 1.15, 1.6, -9, Math.PI);
  mkAnnexWall(2.5, 3.2, 5.95, 1.6, -9, Math.PI);
  mkAnnexWall(2.2, 0.9, 3.6, 2.75, -9, Math.PI);      // header over the mouth
  mkAnnexWall(5, 3.2, -0.2, 1.6, -11.5, Math.PI / 2);  // power room left
  mkAnnexWall(5, 3.2, 7.2, 1.6, -11.5, -Math.PI / 2);  // power room right
  mkAnnexWall(5.2, 3.2, 2.79, 1.6, -6.5, Math.PI / 2);   // corridor left
  mkAnnexWall(5.2, 3.2, 4.41, 1.6, -6.5, -Math.PI / 2);  // corridor right
  const annexCeil = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 5.6), new THREE.MeshStandardMaterial({ color: 0x8f8578, roughness: 0.95 }));
  annexCeil.rotation.x = Math.PI / 2; annexCeil.position.set(3.5, 3.2, -11.5); annex.add(annexCeil);
  const hallCeil = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 5.2), new THREE.MeshStandardMaterial({ color: 0x8f8578, roughness: 0.95 }));
  hallCeil.rotation.x = Math.PI / 2; hallCeil.position.set(3.6, 3.2, -6.5); annex.add(hallCeil);
  // dim emergency strip lights (always on, cheap)
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
  for (const z of [-6.5, -9.5, -11.5, -13]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), stripMat);
    strip.position.set(3.5, 3.05, z); annex.add(strip);
  }
  const annexLight = new THREE.PointLight(0xff8a60, 3.0, 14, 1.4);
  annexLight.position.set(3.5, 2.6, -11.5); scene.add(annexLight);
  refs.annexLight = annexLight;
  // Main breaker + exposed wires in the ELECTRICAL ROOM, the far end of the
  // fuse wing past the archive and the pump room. Restoring it is the last
  // step of the outage, so you always have to cross every wing room — the new
  // ones included — to reach the power supply.
  const breaker = new THREE.Group(); breaker.position.set(3.5, 1.5, -49.9); scene.add(breaker);
  const panelBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.14), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.4 }));
  breaker.add(panelBox);
  const wireCols = [0xd83a2e, 0x2e7ed8, 0x3fa34d, 0xd8c93a];
  refs.breakerWires = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 8), new THREE.MeshStandardMaterial({ color: wireCols[i], roughness: 0.5, emissive: wireCols[i], emissiveIntensity: 0.25 }));
    w.position.set(-0.3 + i * 0.2, -0.1, 0.12); w.rotation.z = 0.25 * (i % 2 ? 1 : -1); breaker.add(w);
    refs.breakerWires.push(w);
  }
  const breakerLamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  breakerLamp.position.set(0.32, 0.45, 0.09); breaker.add(breakerLamp);
  refs.breakerLamp = breakerLamp;
  refs.breakerPos = new THREE.Vector3(3.5, 1.5, -49.1);
  // hiding lockers (wardrobes). Each one is pushed to both refs.lockers (the
  // mesh, for decor/freeze) and refs.lockerPos (the point hiding checks use).
  refs.lockers = [];
  refs.lockerPos = [];
  const lockerMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
  const mkLocker = (x, z, ry = 0) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.1, 0.65), lockerMat);
    body.position.y = 1.05; g.add(body);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slit.position.set(0, 1.4, 0.335); g.add(slit);
    refs.lockers.push(g);
    refs.lockerPos.push(new THREE.Vector3(x, 0, z));
    return g;
  };
  mkLocker(1.0, -13.2); mkLocker(2.1, -13.2); mkLocker(0.8, -9.8);
  // Bed under anchor (office)
  refs.bedUnder = new THREE.Object3D();
  refs.bedUnder.position.set(-3.94, 0.13, -0.2);
  scene.add(refs.bedUnder);

  // --- Fuse-panel wing: six rooms chained behind the power room ------------
  // When the power drops the whole route has to be walked to put the lights
  // back on: MAIN HALLWAY -> STORAGE -> BREAK ROOM -> BOILER -> ARCHIVE ->
  // PUMP ROOM, each with its own panel, and the main breaker only goes once
  // all six are back. The ARCHIVE and the PUMP ROOM sit between the boiler and
  // the ELECTRICAL ROOM, so they are on the only path to the power supply.
  // Doorways sit on alternating sides so no room can be crossed in a straight
  // line -- you are always inside one with it out there somewhere.
  const WING_X0 = -0.2, WING_X1 = 7.2, WING_DOOR_W = 1.8;
  const WING_ROOMS = [
    { id: 'hall',   name: 'MAIN HALLWAY', z0: -14, z1: -20, panel: { x: -0.13, z: -17.0, ry: Math.PI / 2 } },
    { id: 'store',  name: 'STORAGE ROOM',  z0: -20, z1: -25, panel: { x: 7.13,  z: -22.5, ry: -Math.PI / 2 } },
    { id: 'break',  name: 'BREAK ROOM',    z0: -25, z1: -30, panel: { x: -0.13, z: -27.5, ry: Math.PI / 2 } },
    { id: 'boiler', name: 'BOILER ROOM',   z0: -30, z1: -35, panel: { x: 7.13,  z: -32.5, ry: -Math.PI / 2 } },
    { id: 'archive', name: 'ARCHIVE ROOM', z0: -35, z1: -40, panel: { x: -0.13, z: -37.5, ry: Math.PI / 2 } },
    { id: 'pump',   name: 'PUMP ROOM',     z0: -40, z1: -45, panel: { x: 7.13,  z: -42.5, ry: -Math.PI / 2 } },
  ];
  // Doorway on every divider, entry wall first. The entry (z -14) is already
  // built above as the split power-room back wall; the others get their own
  // divider meshes below. Both lists — colliders and the stalker's route
  // — read from here, so a doorway can never be built without a gap to match.
  // The last gap (z -45) is the one you come through with the breaker in sight.
  const WING_DOORS = [{ z: -14, x: 3.6 }, { z: -20, x: 3.6 }, { z: -25, x: 1.8 }, { z: -30, x: 5.4 },
    { z: -35, x: 3.6 }, { z: -40, x: 1.8 }, { z: -45, x: 5.4 }];
  refs.wingRooms = WING_ROOMS;
  refs.wingDoors = WING_DOORS;
  // The annex group holds every wing mesh; the CCTV feeds and their occlusion
  // tests use it (see rooms.js buildStations).
  refs.annex = annex;

  const wingFloor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 36), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  wingFloor.rotation.x = -Math.PI / 2; wingFloor.position.set(3.5, 0.005, -32); annex.add(wingFloor);
  const wingCeil = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 36), new THREE.MeshStandardMaterial({ color: 0x8f8578, roughness: 0.95 }));
  wingCeil.rotation.x = Math.PI / 2; wingCeil.position.set(3.5, 3.2, -32); annex.add(wingCeil);
  mkAnnexWall(36, 3.2, WING_X0, 1.6, -32, Math.PI / 2);    // wing left
  mkAnnexWall(36, 3.2, WING_X1, 1.6, -32, -Math.PI / 2);   // wing right
  mkAnnexWall(7.4, 3.2, 3.5, 1.6, -50, 0);                 // wing back (electrical room)
  const wingDivider = (z, doorX) => {
    const g0 = doorX - WING_DOOR_W / 2, g1 = doorX + WING_DOOR_W / 2;
    mkAnnexWall(g0 - WING_X0, 3.2, (WING_X0 + g0) / 2, 1.6, z, 0);
    mkAnnexWall(WING_X1 - g1, 3.2, (g1 + WING_X1) / 2, 1.6, z, 0);
    mkAnnexWall(WING_DOOR_W, 0.9, doorX, 2.75, z, 0);        // header keeps the wall solid
  };
  for (const d of WING_DOORS.slice(1)) wingDivider(d.z, d.x);

  // Red emergency strips are what let you navigate the wing in the dark; the
  // ceiling lamps only come up as each room's circuit is restored.
  for (const r of WING_ROOMS) {
    for (const z of [r.z0 + 1.5, r.z1 - 1.5]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), stripMat);
      strip.position.set(3.5, 3.05, z); annex.add(strip);
    }
  }
  // Electrical room gets its own strips — it is not a WING_ROOMS circuit, just
  // the far room that holds the main breaker.
  for (const z of [-46.5, -48.5]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), stripMat);
    strip.position.set(3.5, 3.05, z); annex.add(strip);
  }

  const mkPanel = (id, name, x, y, z, ry) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.14), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.4 }));
    g.add(box);
    const wires = [];
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 8), new THREE.MeshStandardMaterial({ color: wireCols[i], roughness: 0.5, emissive: wireCols[i], emissiveIntensity: 0.25 }));
      w.position.set(-0.3 + i * 0.2, -0.1, 0.12); w.rotation.z = 0.25 * (i % 2 ? 1 : -1); g.add(w);
      wires.push(w);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    lamp.position.set(0.32, 0.45, 0.09); g.add(lamp);
    const entry = { id, name, pos: new THREE.Vector3(x, y, z), lamp, wires, lit: false, light: null, fixture: null };
    decor(g); freeze(g);
    return entry;
  };

  refs.panels = [];
  for (const r of WING_ROOMS) {
    const p = mkPanel(r.id, r.name, r.panel.x, 1.5, r.panel.z, r.panel.ry);
    const cz = (r.z0 + r.z1) / 2;
    p.fixture = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 }));
    p.fixture.position.set(3.5, 3.08, cz); annex.add(p.fixture);
    // Starts invisible so a dark wing costs nothing; switching one on is a
    // single recompile at the exact moment the toast fires.
    p.light = new THREE.PointLight(0xffe9a8, 0, 15, 1.4);
    p.light.position.set(3.5, 2.7, cz); p.light.visible = false; scene.add(p.light);
    refs.panels.push(p);
  }
  // The main breaker is the last circuit: it only arms once the wing is lit.
  // The electrical room's own light rides on it, so the room you cross last
  // snaps on exactly as power floods back.
  const mainLight = new THREE.PointLight(0xffe9a8, 0, 15, 1.4);
  mainLight.position.set(3.5, 2.7, -47); mainLight.visible = false; scene.add(mainLight);
  refs.mainLight = mainLight;
  refs.panels.push({ id: 'main', name: 'MAIN BREAKER', pos: refs.breakerPos.clone(), lamp: refs.breakerLamp, wires: refs.breakerWires, lit: false, light: mainLight, fixture: null, main: true });

  // Extra dressing so each wing room reads as a place rather than a corridor.
  const propMat = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.85 });
  const mkProp = (w, h, d, x, y, z, mat = propMat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); annex.add(m); return m;
  };
  decor(mkProp(1.3, 0.9, 1.3, 6.3, 0.45, -24.0));            // stacked crates (storage)
  decor(mkProp(0.9, 0.6, 0.9, 6.5, 1.2, -24.2));
  decor(mkProp(2.2, 0.8, 1.2, 3.5, 0.4, -28.0));             // table (break room)
  decor(mkProp(1.6, 1.4, 1.2, 1.5, 0.7, -31.5));             // furnace (boiler room)
  decor(mkProp(0.5, 2.0, 2.0, 6.6, 1.0, -37.8));             // shelving (archive room)
  decor(mkProp(1.0, 0.8, 1.0, 1.0, 0.4, -36.5));             // boxed files (archive room)
  decor(mkProp(1.6, 1.2, 1.4, 1.6, 0.6, -42.5));             // pump housing (pump room)
  decor(mkProp(1.2, 1.0, 1.0, 5.8, 0.5, -43.5));             // pressure tank (pump room)
  decor(mkProp(2.0, 0.8, 0.7, 1.2, 0.4, -49.0));             // workbench (electrical room)
  decor(mkProp(0.6, 0.5, 0.6, 2.2, 0.4, -48.7));             // tool box (electrical room)

  // Wing lockers: two per room, on the walls, clear of every doorway and panel.
  // The archive and pump rooms get theirs too — they are the two rooms you
  // cross on the way to the power supply, so they need somewhere to duck into.
  mkLocker(0.13, -18.5, Math.PI / 2);   mkLocker(6.87, -15.5, -Math.PI / 2);
  mkLocker(0.13, -23.5, Math.PI / 2);   mkLocker(6.87, -21.0, -Math.PI / 2);
  mkLocker(6.87, -28.5, -Math.PI / 2);  mkLocker(0.13, -26.0, Math.PI / 2);
  mkLocker(0.13, -33.5, Math.PI / 2);   mkLocker(6.87, -31.0, -Math.PI / 2);
  mkLocker(0.13, -38.8, Math.PI / 2);   mkLocker(6.87, -36.0, -Math.PI / 2); // archive room
  mkLocker(0.13, -43.8, Math.PI / 2);   mkLocker(6.87, -41.0, -Math.PI / 2); // pump room
  mkLocker(0.13, -49.4, Math.PI / 2);   mkLocker(6.87, -49.4, -Math.PI / 2); // electrical room

  decor(annex); decor(breaker);
  for (const g of refs.lockers) decor(g);
  freeze(annex); freeze(breaker);

  // "Shadow" blob anomaly (dark plane that shouldn't be there)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(1.2, 0.011, 0.5); blob.visible = false; scene.add(blob);
  refs.shadowBlob = blob;

  // Clean tagging: every reportable root carries its anomalyType + isActive.
  // The AnomalyManager flips isActive on spawn/fix; report logic reads it.
  const tagMap = [
    [refs.painting, 'painting'],   // shared by painting-tilt + painting-color
    [refs.chair, 'chair-moved'],
    [refs.doorPivot, 'door-open'],
    [refs.monitorGroup, 'monitor-red'],
    [refs.plant, 'plant-missing'],
    [refs.extraObject, 'extra-object'],
    [refs.window, 'window-eyes'],
    [refs.lampGroup, 'lamp-flicker'],
    [refs.books, 'books-float'],
    [refs.shadowBlob, 'shadow-blob'],
  ];
  for (const [obj, type] of tagMap) {
    obj.userData.anomalyType = type;
    obj.userData.isActive = false;
    obj.traverse((child) => {
      child.userData.anomalyType = type;
      child.userData.isActive = false;
    });
  }

  // Shadows: reportable furniture casts + receives. Pure dressing receives
  // light but does not cast fiddly contact shadows.
  plantGhost.userData.noShadow = true;
  blob.userData.noShadow = true;
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.noShadow) return;
    if (o.userData.flatDecor) { o.castShadow = false; o.receiveShadow = true; return; }
    o.castShadow = true; o.receiveShadow = true;
  });

  return refs;
}
