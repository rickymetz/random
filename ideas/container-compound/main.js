// Container Compound — compose a tiny-home compound from purpose-built
// shipping-container units on a rural Virginia acre. World units are feet.

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { TYPES, PLAN_LABELS } from "./data.js";

// ---------------------------------------------------------------- unit data

const WALL_T = 0.35; // container wall thickness for rendering
const H = 9.5; // high cube exterior height
const WET_RADIUS = 30; // advisory short-plumbing-run radius around the utility core, ft
const SEP_CLEAR = 10; // gap giving both units >=5 ft to the imaginary line (VRC R302.1)
const JOIN_EPS = 0.75; // gaps at or under this read as butted/joined
const TRENCH_PER_FT = 40; // ballpark $/ft for a utility trench with supply + drain

// Furniture pieces are boxes in unit-local feet, centered at the unit origin,
// x along the container length, z across the 8' width. y is the base height.
const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

// Materials reused across every unit. They are tagged so removeItem leaves
// them alone: disposing them with the unit threw away the shader program
// cache, so one undo used to recreate five programs.
const shared = (m) => { m.userData.shared = true; return m; };

// Copy branches on this: "pinch to zoom" and "double-tap" are wrong on a
// machine with no touchscreen.
const FINE_POINTER = matchMedia("(hover: hover) and (pointer: fine)").matches;

// ------------------------------------------------------------------- scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde7ee);
scene.fog = new THREE.Fog(0xdde7ee, 340, 900);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 2400);
// portrait phones need to sit further back to frame the compound
if (innerHeight > innerWidth) camera.position.set(115, 95, 170);
else camera.position.set(85, 70, 125);

// A phone at DSF 3 does not need a 2x buffer for a read-only viewer; the fill
// rate costs more than the extra sharpness is worth on a 390 px screen.
const PHONE_VIEW = innerWidth < 700;
const renderer = new THREE.WebGLRenderer({ antialias: !PHONE_VIEW });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, PHONE_VIEW ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 25;
controls.maxDistance = 420;
controls.target.set(0, 4, 0);

const hemi = new THREE.HemisphereLight(0xe8f0f8, 0x8a9a74, 0.85);
scene.add(hemi);
// north is -z; the sun arcs east (+x) -> south (+z) -> west (-x). The time of
// day is not just a light direction: a low morning sun sits under a paler,
// cooler sky, and an evening one under a warm haze that closes the distance.
const SUNS = [
  { name: "Morning", pos: [150, 55, 45], color: 0xffe4bd, intensity: 1.8,
    sky: 0xd7e6ee, hemiSky: 0xeaf2f8, hemiGround: 0x84956f, hemi: 0.8, fog: [300, 820] },
  { name: "Midday", pos: [25, 170, 95], color: 0xfff3e0, intensity: 2.1,
    sky: 0xdde7ee, hemiSky: 0xe8f0f8, hemiGround: 0x8a9a74, hemi: 0.85, fog: [340, 900] },
  { name: "Evening", pos: [-150, 50, 45], color: 0xffd2a4, intensity: 1.6,
    sky: 0xe8d2b4, hemiSky: 0xf2dcc2, hemiGround: 0x7d7a58, hemi: 0.7, fog: [220, 640] },
];
let sunIdx = 1;
const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(PHONE_VIEW ? 1024 : 2048, PHONE_VIEW ? 1024 : 2048);
sun.shadow.camera.left = -160;
sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160;
sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0004;
// Nothing in this scene moves on its own, so the shadow map is redrawn only
// when the layout, the sun or a peek actually changes.
sun.shadow.autoUpdate = false;
scene.add(sun);
let shadowDirty = true;
const markShadowDirty = () => { shadowDirty = true; };

function applySun() {
  markShadowDirty();
  const s = SUNS[sunIdx];
  sun.position.set(...s.pos);
  sun.color.set(s.color);
  sun.intensity = s.intensity;
  scene.background.set(s.sky);
  scene.fog.color.set(s.sky);
  scene.fog.near = s.fog[0];
  scene.fog.far = s.fog[1];
  hemi.color.set(s.hemiSky);
  hemi.groundColor.set(s.hemiGround);
  hemi.intensity = s.hemi;
  document.getElementById("btn-sun").title = s.name;
}
applySun();

// The acre: ~209' square of grass, gravel drive, scattered trees.
// The ground reaches past the far edge of the fog (900 ft) in every direction,
// so the world fades into haze instead of ending at a visible corner.
const ACRE = 209;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2600, 2600),
  new THREE.MeshLambertMaterial({ color: 0x7c9464 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const acreLine = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-ACRE / 2, 0.06, -ACRE / 2),
    new THREE.Vector3(ACRE / 2, 0.06, -ACRE / 2),
    new THREE.Vector3(ACRE / 2, 0.06, ACRE / 2),
    new THREE.Vector3(-ACRE / 2, 0.06, ACRE / 2),
  ]),
  new THREE.LineBasicMaterial({ color: 0x5f7350 })
);
scene.add(acreLine);

const grid = new THREE.GridHelper(ACRE, ACRE / 4, 0x74895e, 0x74895e);
grid.material.transparent = true;
grid.material.opacity = 0.22;
grid.position.y = 0.05;
scene.add(grid);

// ---- editable scenery: the gravel drive and the trees ----
// Both are saved state, not fixtures: they move with the layout, ride the
// share link and sit on the undo stack. The parcel itself stays a fixed acre.

// Text reaching markup is escaped at the emitter rather than trusted to be
// safe by accident — the layout name is user-supplied.
const esc = (v) => String(v).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Every numeric attribute goes through this: a non-finite value used to emit
// `x="NaN"`, which SVG drops silently, so a broken drawing looked like a
// missing feature rather than an error.
// the drawer swatch shows the same 40% wash over paper the sheet draws, so a
// chip and its footprint are recognisably the same colour
const SHEET_PAPER = [0xfb, 0xfa, 0xf6];
const chipTint = (hex) => {
  const n = typeof hex === "number" ? hex : parseInt(String(hex).replace("#", ""), 16);
  const mix = (c, i) => Math.round(c * 0.4 + SHEET_PAPER[i] * 0.6);
  return `rgb(${mix((n >> 16) & 255, 0)}, ${mix((n >> 8) & 255, 1)}, ${mix(n & 255, 2)})`;
};
const nf = (v, fallback = 0) => (Number.isFinite(v) ? +v.toFixed(3) : fallback);

// Findings carry a second, achromatic channel — a long-short dash against the
// utility run's even one — because in greyscale the redline and the trench are
// within half a luminance point of each other.
const FINDING_DASH_A = 14, FINDING_DASH_B = 5;

let layoutName = "Container Compound";
// County-specific, so it is a setting rather than a constant. 25 ft is a
// common rural A-1 side/rear figure; the front is usually more.
let setback = 25;

const DRIVE_LEN = 96, DRIVE_WID = 14, PAD_R = 16, PAD_OFF = -46;
// VDH separations: 50 ft well to septic tank, 100 ft well to drainfield. The
// larger one is what actually shapes a one-acre site, so that is the ring.
const WELL_CLEAR = 100, DRAIN_W = 40, DRAIN_L = 60;
// pulled east so the turnaround pad no longer sits on the bath + laundry unit
const DEFAULT_DRIVE = { x: 66, z: 56, rot: 0 };
const DEFAULT_TREES = [
  [-88, -78, 1.5], [-70, -92, 1.1], [-95, -30, 1.2], [-84, 30, 1.6], [-92, 72, 1.0],
  [-60, 88, 1.3], [-10, 94, 1.1], [24, 90, 1.5], [88, 84, 1.2], [94, 40, 1.0],
  [92, -32, 1.4], [80, -80, 1.6], [40, -92, 1.0], [-30, -95, 1.3], [8, -88, 0.9],
];

let drive = { ...DEFAULT_DRIVE };
let trees = DEFAULT_TREES.map(([x, z, s], i) => ({ id: i + 1, x, z, s }));
let nextTreeId = trees.length + 1;
// A rural acre's real constraint is rarely the building code — it is where the
// well and the drainfield already are, and the 100 ft they hold around them.
let wells = [];
let drainfields = [];
let nextSiteId = 1;

// the drive's turnaround pad, in world feet, for hit tests and the plan
// Trench length measured between the facing edges rather than centre to
// centre, which used to charge 8 ft to connect a unit physically butted to
// the core.
function trenchRuns() {
  const cores = items.filter((i) => TYPE_BY_ID[i.typeId].core);
  if (!cores.length) return [];
  const out = [];
  for (const w of items.filter((i) => TYPE_BY_ID[i.typeId].wet && !TYPE_BY_ID[i.typeId].core)) {
    let best = cores[0], bd = Infinity;
    for (const c of cores) {
      const d = Math.hypot(c.x - w.x, c.z - w.z);
      if (d < bd) { bd = d; best = c; }
    }
    const b = gapBand(w, best);
    out.push({ ax: b.x0, az: b.z0, bx: b.x1, bz: b.z1, ft: Math.max(0, b.gap) });
  }
  return out;
}

function padCenter(d = drive) {
  const [dx, dz] = DIRS[d.rot % 4];
  // local +z maps to world by the same rotation the mesh group uses
  return { x: d.x - dz * PAD_OFF, z: d.z + dx * PAD_OFF };
}

const sceneryRoot = new THREE.Group();
scene.add(sceneryRoot);

const gravelMat = shared(new THREE.MeshLambertMaterial({ color: 0xb6ae9f }));

// Every tree used to be the same tree, unrotated, so a ring of fifteen read as
// one asset stamped fifteen times. The variation is hashed off the tree's own
// position, so it is stable across rebuilds and across a reload.
function treeHash(t) {
  const n = Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function buildTree(t) {
  const g = new THREE.Group();
  const s = t.s;
  const h = treeHash(t);
  const lean = (h - 0.5) * 0.14;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5 * s, 0.7 * s, 7 * s, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5c3e })
  );
  trunk.position.y = 3.5 * s;
  trunk.castShadow = true;
  g.add(trunk);
  const tones = [0x5e7d4f, 0x6b8a55, 0x557246, 0x6f8f4a, 0x4f6b44];
  for (let i = 0; i < 3; i++) {
    const j = (h * 7919 + i) | 0;
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry((4.6 - i * 0.9) * s * (0.85 + ((j % 7) / 7) * 0.35), 1),
      new THREE.MeshLambertMaterial({
        color: tones[(j + i) % tones.length], flatShading: true,
      })
    );
    puff.position.set(
      ((i - 1) * 1.6 + ((j % 5) - 2) * 0.5) * s,
      (8.5 + i * 2.6 + ((j % 3) - 1) * 0.7) * s,
      (((i % 2) - 0.5) * 1.8 + (((j >> 3) % 5) - 2) * 0.5) * s
    );
    puff.rotation.set(h * 3.1, h * 6.2 + i, h * 1.7);
    puff.castShadow = true;
    g.add(puff);
  }
  g.position.set(t.x, 0, t.z);
  g.rotation.y = h * Math.PI * 2;
  g.rotation.z = lean;
  return g;
}

function rebuildScenery() {
  markShadowDirty();
  for (const child of [...sceneryRoot.children]) {
    child.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !Array.isArray(o.material) && !o.material.userData.shared)
        o.material.dispose();
    });
    sceneryRoot.remove(child);
  }

  const driveG = new THREE.Group();
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(DRIVE_WID, DRIVE_LEN), gravelMat);
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.04;
  strip.receiveShadow = true;
  driveG.add(strip);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD_R, 24), gravelMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.045, PAD_OFF);
  pad.receiveShadow = true;
  driveG.add(pad);
  driveG.position.set(drive.x, 0, drive.z);
  driveG.rotation.y = (drive.rot * Math.PI) / 2;
  sceneryRoot.add(driveG);

  for (const t of trees) sceneryRoot.add(buildTree(t));
}

// ------------------------------------------------------------ unit meshes

const floorMat = shared(new THREE.MeshLambertMaterial({ color: 0xd8cdbb }));
const doorMat = shared(new THREE.MeshLambertMaterial({ color: 0x4f4a42 }));
const glassWallMat = shared(new THREE.MeshLambertMaterial({
  color: 0xbcd6e2, transparent: true, opacity: 0.55,
}));
const condMat = shared(new THREE.MeshLambertMaterial({ color: 0xd9d9d4 }));
const deckMat = shared(new THREE.MeshLambertMaterial({ color: 0xb78e5f }));

function buildUnit(type) {
  const g = new THREE.Group();
  g.userData.typeId = type.id;
  const L = type.len, W = type.wid;

  if (type.deck) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, W), deckMat);
    slab.position.y = 0.45;
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
    // plank lines, at the same 2 ft spacing the sheet draws them
    const lines = new THREE.Group();
    for (let i = 1; i < 4; i++) {
      const li = new THREE.Mesh(
        new THREE.BoxGeometry(L - 0.2, 0.02, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x9c744c })
      );
      li.position.set(0, 0.92, -W / 2 + (W / 4) * i);
      lines.add(li);
    }
    g.add(lines);
    g.userData.pickBox = new THREE.Box3(
      new THREE.Vector3(-L / 2, 0, -W / 2),
      new THREE.Vector3(L / 2, 1, W / 2)
    );
    return g;
  }

  // The walls do not fade on peek. Ghosting every surface at once read as a
  // rendering fault rather than a cutaway; lifting only the lid is what a
  // dollhouse actually is, and it leaves the walls opaque enough to carry
  // their own shading.
  const wallMat = new THREE.MeshLambertMaterial({ color: type.color });
  const leafMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(type.color).multiplyScalar(0.86),
  });

  // floor slab on low piers
  const slab = new THREE.Mesh(new THREE.BoxGeometry(L, 0.8, W), floorMat);
  slab.position.y = 0.9;
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  for (const px of [-L / 2 + 1.2, L / 2 - 1.2]) {
    for (const pz of [-W / 2 + 1.2, W / 2 - 1.2]) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.6, 1.2),
        new THREE.MeshLambertMaterial({ color: 0x9a968e })
      );
      pier.position.set(px, 0.3, pz);
      g.add(pier);
    }
  }

  // Walls, per the fabrication rules: no cut openings anywhere. Glazing and
  // entries live only in factory apertures (container door ends, or the
  // factory side doors of an open-side box), with the original cargo doors
  // kept as operable shutters swung flat against the adjacent walls.
  const base = 1.3, wallH = H - 1.3 - 0.6;
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, base + wallH / 2, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const apertureEnds = type.variant === "tunnel" ? [1, -1] : [1];
  const openSide = type.variant === "openside";

  // long walls: back is always solid steel; front is glazed on open-side units
  mkWall(L, WALL_T, 0, -W / 2 + WALL_T / 2);
  if (openSide) {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(L - 1.6, wallH - 0.6, 0.14), glassWallMat);
    glass.position.set(0, base + (wallH - 0.6) / 2, W / 2 - 0.14);
    g.add(glass);
    const span = L - 1.6, bays = Math.max(2, Math.round(span / 4.5));
    for (let i = 1; i < bays; i++) {
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.16, wallH - 0.6, 0.2), doorMat);
      mull.position.set(-span / 2 + (span / bays) * i, base + (wallH - 0.6) / 2, W / 2 - 0.14);
      g.add(mull);
    }
    for (const xs of [-1, 1]) mkWall(0.8, WALL_T, xs * (L / 2 - 0.4), W / 2 - WALL_T / 2);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(L, 0.6, WALL_T), wallMat);
    fascia.position.set(0, base + wallH - 0.3, W / 2 - WALL_T / 2);
    g.add(fascia);
  } else {
    mkWall(L, WALL_T, 0, W / 2 - WALL_T / 2);
  }

  // container ends: solid steel, or a factory door aperture with an inset
  // glazed wall + entry door, shutter leaves parked against the long walls
  for (const s of [1, -1]) {
    if (!apertureEnds.includes(s)) {
      mkWall(WALL_T, W - WALL_T * 2, s * (L / 2 - WALL_T / 2), 0);
      continue;
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, wallH - 0.7, W - 1.2), glassWallMat);
    glass.position.set(s * (L / 2 - 1.0), base + (wallH - 0.7) / 2, 0);
    g.add(glass);
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, wallH - 1.0, 3.0), doorMat);
    doorFrame.position.set(s * (L / 2 - 0.95), base + (wallH - 1.0) / 2, -1.6);
    g.add(doorFrame);
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_T, 0.7, W - WALL_T * 2), wallMat);
    header.position.set(s * (L / 2 - WALL_T / 2), base + wallH - 0.35, 0);
    g.add(header);
    for (const zs of [-1, 1]) {
      if (openSide && zs === 1) continue; // no shutter over the glazed side
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(3.8, wallH - 0.3, 0.16), leafMat);
      leaf.position.set(s * (L / 2 - 1.95), base + (wallH - 0.3) / 2, zs * (W / 2 + 0.18));
      leaf.castShadow = true;
      g.add(leaf);
    }
  }

  // corrugation hint: vertical ribs on the solid steel faces only
  const ribMat = new THREE.MeshLambertMaterial({ color: type.color });
  const ribs = Math.floor(L / 2);
  for (let i = 0; i <= ribs; i++) {
    const x = -L / 2 + (L / ribs) * i;
    for (const zs of openSide ? [-1] : [-1, 1]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, wallH - 0.4, 0.14), ribMat);
      rib.position.set(x * 0.96, base + wallH / 2, zs * (W / 2 + 0.02));
      g.add(rib);
    }
  }

  // mini-split condenser on the solid back side (one lineset sleeve)
  if (type.hvac === "minisplit") {
    const cond = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 1.0), condMat);
    cond.position.set(-L / 2 + 2.4, 0.85, -(W / 2 + 1.8));
    cond.castShadow = true;
    g.add(cond);
  }

  // utility core: soft advisory ring showing the short-plumbing-run radius
  if (type.core) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(WET_RADIUS - 0.6, WET_RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: 0x7e97a6, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    g.add(ring);
  }

  // Roof group — lifts and fades on peek. The material is per unit and
  // transparent, because a shared opaque one cannot fade: the roof used to
  // wink out of existence at peek 0.98, still 6.9 ft in the air and fully
  // solid. It also carries the unit's own tint, mixed most of the way to a
  // pale membrane, so a unit is recognisable from directly above instead of
  // reading as one more white cap.
  const roofG = new THREE.Group();
  const roofMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(type.color).lerp(new THREE.Color(0xf5f3ee), 0.62),
    transparent: true,
  });
  g.userData.roofMat = roofMat;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, 0.6, W + 0.3), roofMat);
  roof.position.y = base + wallH + 0.3;
  roofG.add(roof);
  g.add(roofG);
  g.userData.roof = roofG;

  // The roof was the only thing casting the unit's footprint shadow, so a
  // lifted roof left the building floating with no shade under it while every
  // tree still cast one. This cap draws nothing and casts always, so the
  // building stays planted whatever the roof is doing — which is how a
  // cutaway is drawn: the volume is still there, you are just seeing into it.
  const shadowCap = new THREE.Mesh(
    new THREE.BoxGeometry(L + 0.3, 0.6, W + 0.3),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  );
  shadowCap.position.y = base + wallH + 0.3;
  shadowCap.castShadow = true;
  g.add(shadowCap);

  // interior furniture
  const inte = new THREE.Group();
  for (const f of type.furniture) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(f.w, f.h, f.d),
      new THREE.MeshLambertMaterial({ color: f.color })
    );
    m.position.set(f.x, base + (f.y || 0) + f.h / 2, f.z);
    m.castShadow = true;
    inte.add(m);
  }
  g.add(inte);

  g.userData.pickBox = new THREE.Box3(
    new THREE.Vector3(-L / 2, 0, -W / 2),
    new THREE.Vector3(L / 2, H, W / 2)
  );
  return g;
}

// selection ring
const ringMat = shared(new THREE.MeshBasicMaterial({
  color: 0xb3542e, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
}));
const sepRingMat = shared(new THREE.MeshBasicMaterial({
  color: 0xc0574a, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
}));
const sepLineMat = new THREE.LineBasicMaterial({ color: 0xc0574a });
const trenchMat = new THREE.LineDashedMaterial({
  color: 0x5f7a8a, dashSize: 1.6, gapSize: 1.1,
});

// ------------------------------------------------------------------ state

let items = []; // { id, typeId, x, z, rot, group, ring, sepRing, peek }
let nextId = 1;
let selected = null;

const unitRoot = new THREE.Group();
scene.add(unitRoot);

function addItem(typeId, x, z, rot, opts = {}) {
  const type = TYPE_BY_ID[typeId];
  if (!type) return null;
  const group = buildUnit(type);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(type.len + 2.5, type.wid + 2.5),
    ringMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  ring.visible = false;
  group.add(ring);
  let sepRing = null;
  if (!type.deck) {
    sepRing = new THREE.Mesh(
      new THREE.PlaneGeometry(type.len + 4, type.wid + 4), sepRingMat);
    sepRing.rotation.x = -Math.PI / 2;
    sepRing.position.y = 0.055;
    sepRing.visible = false;
    group.add(sepRing);
  }
  const item = { id: nextId++, typeId, x, z, rot, group, ring, sepRing, peek: 0 };
  applyTransform(item);
  unitRoot.add(group);
  items.push(item);
  if (!opts.silent) { save(); updateStats(); }
  return item;
}

function applyTransform(item) {
  markShadowDirty();
  item.group.position.set(item.x, 0, item.z);
  item.group.rotation.y = (item.rot * Math.PI) / 2;
}

function removeItem(item, opts = {}) {
  // a drag or a pending placement holding this item must not outlive it
  if (planDrag && (planDrag.primary === item || planDrag.members?.includes(item)))
    abortGestures();
  unitRoot.remove(item.group);
  item.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !Array.isArray(o.material) && !o.material.userData.shared)
      o.material.dispose();
  });
  items = items.filter((i) => i !== item);
  if (selected === item) select(null);
  if (opts.silent) return; // a bulk teardown should not write 11 times
  save();
  updateStats();
}

function select(item) {
  if (selected) selected.ring.visible = false;
  selected = item;
  document.body.classList.toggle("has-selection", !!item);
  const info = document.getElementById("info");
  if (!item) {
    document.body.classList.remove("sheet-open");
    document.getElementById("sel-name").textContent = "";
    setPlacing(false);
    updateSelDims();
    return;
  }
  item.ring.visible = true;
  const t = TYPE_BY_ID[item.typeId];
  document.getElementById("info-name").textContent = t.name;
  document.getElementById("info-sub").textContent = t.deck
    ? `8′ × 8′ platform · 64 ft² deck · ≈$${t.cost.toLocaleString()}`
    : `${t.len}′ ${t.len === 10 ? "mini " : ""}high cube · ${t.len}′ × 8′ × 9′6″ · ${t.len * t.wid} ft² · ≈$${t.cost.toLocaleString()}`;
  document.getElementById("info-desc").textContent = t.desc;
  const VARIANT_LABEL = {
    standard: "Standard container · shutters one end",
    tunnel: "Tunnel container · shutters both ends",
    openside: "Open-side container · glazed side wall",
  };
  document.getElementById("info-build").textContent = t.deck
    ? "Ground-screw framing · no permit under 30\" (VRC R105.2)"
    : `${VARIANT_LABEL[t.variant]} · spray-foam interior (~7'2" wide) · ${
        t.hvac === "minisplit" ? "mini-split (one lineset sleeve)"
        : t.hvac === "none" ? "unconditioned"
        : "panel heater + exhaust"
      } · no wall or roof cuts`;
  document.getElementById("info-va").textContent = t.va;
  const permitEl = document.getElementById("info-permit");
  permitEl.textContent = t.accessory
    ? "Accessory use — the 256 sq ft permit exemption can apply to this one (VCC 108.2 / VRC R105.2), and butting it to others sums the area."
    : "Habitable / dwelling use — the 256 sq ft accessory exemption does not apply at any size. Expect a building permit and full residential code review.";
  const wetEl = document.getElementById("info-wet");
  if (t.wet) {
    const cores = items.filter((i) => i.typeId === "laundry");
    if (!cores.length) {
      wetEl.textContent = "No utility core on site — add a laundry / utility unit to serve water and drains.";
    } else {
      const d = Math.min(...cores.map((c) => Math.hypot(c.x - item.x, c.z - item.z)));
      wetEl.textContent = d <= WET_RADIUS
        ? `✓ ${Math.round(d)} ft to the utility core — short plumbing runs.`
        : `${Math.round(d)} ft to the utility core — expect a long trench.`;
    }
    wetEl.style.display = "block";
  } else {
    wetEl.style.display = "none";
  }
  const sepEl = document.getElementById("info-sep");
  const msgs = [];
  if (!t.deck) {
    for (const p of sepPairs) {
      if (p.a !== item && p.b !== item) continue;
      const other = p.a === item ? p.b : p.a;
      msgs.push(`${Math.max(1, Math.round(p.gap))} ft to the ${TYPE_BY_ID[other.typeId].name.toLowerCase()} — 1–9 ft gaps need rated walls and limit glazing (VRC R302.1). Butt them together or open to 10 ft.`);
    }
    const j = joined.get(item.id);
    if (j && j.sqft > 256) {
      msgs.push(`Butted with ${j.count - 1} other unit${j.count > 2 ? "s" : ""}: ${j.sqft} ft² as one structure — the exemption is read per structure, not per box.`);
    }
  }
  sepEl.textContent = msgs.join(" ");
  sepEl.style.display = msgs.length ? "block" : "none";
  document.getElementById("btn-plan").style.display = t.deck ? "none" : "block";
  syncCoordFields(item);
  document.getElementById("sel-name").textContent = t.name;
  // plan: selection shows the tool strip; the sheet opens via the name chip.
  // 3D: a tap goes straight to the (read-only) sheet.
  // On a phone the details sheet covers the drawing, so it stays on demand.
  // On a wide screen it is a docked inspector beside the drawing, and having
  // to ask for it hid the position fields — the only precise way to place
  // anything — behind a second click.
  if (mode === "view" || matchMedia("(min-width: 900px)").matches)
    document.body.classList.add("sheet-open");
  updateSelDims();
}
// ---- typing a position ----------------------------------------------------
//
// Dragging and the 1 ft arrow nudge were the only ways to place anything, so
// "put it 18 ft east" meant eighteen keypresses and "line these two up" meant
// counting pixels. The fields are east/south of the middle of the lot, which
// is the origin every dimension on the sheet is measured from.
let syncingCoords = false;
function syncCoordFields(item) {
  const x = document.getElementById("pos-x"), z = document.getElementById("pos-z");
  if (!x || !z || !item) return;
  syncingCoords = true;
  x.value = Math.round(item.x);
  z.value = Math.round(item.z);
  syncingCoords = false;
}
const posX = document.getElementById("pos-x");
const posZ = document.getElementById("pos-z");
function commitCoords() {
  if (syncingCoords || !selected || mode !== "plan") return;
  const target = selected;
  const x = clampX(num(posX.value, target.x));
  const z = clampZ(num(posZ.value, target.z));
  if (x === target.x && z === target.z) return;
  const ox = target.x, oz = target.z;
  const ok = tryEdit(() => {
    // a butted cluster moves as one, exactly as a drag of it would
    const members = clusterOf(target);
    const dx = x - ox, dz = z - oz;
    for (const m of members) {
      m.x = clampX(m.x + dx);
      m.z = clampZ(m.z + dz);
      applyTransform(m);
    }
  }, "That position blocks a door wall — try another");
  if (!ok) syncCoordFields(selected || target);
}
for (const el of [posX, posZ]) {
  el.addEventListener("change", commitCoords);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitCoords(); el.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); if (selected) syncCoordFields(selected); el.blur(); }
  });
}

document.getElementById("btn-info").addEventListener("click", () =>
  document.body.classList.add("sheet-open"));
document.getElementById("btn-desel").addEventListener("click", () => select(null));

// find an open spot near the center for a newly added unit
function findSpot(type, ox = 0, oz = 0) {
  ox = clampX(ox); oz = clampZ(oz);
  const step = 4;
  for (let r = 0; r < 26; r++) {
    for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      const x = clampX(ox + Math.cos(ang) * r * step);
      const z = clampZ(oz + Math.sin(ang) * r * step);
      if (isFree(x, z, type)) return { x, z };
    }
  }
  return { x: Math.round(ox), z: Math.round(oz) };
}
function isFree(x, z, type) {
  // clear the rated-wall band, not just a courtesy foot, so an auto-placed
  // unit is not already redlined the moment it lands
  const pad = type.deck ? 1 : SEP_CLEAR;
  const hw = type.len / 2 + pad, hd = type.wid / 2 + pad;
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    const ihw = (it.rot % 2 ? t.wid : t.len) / 2;
    const ihd = (it.rot % 2 ? t.len : t.wid) / 2;
    if (Math.abs(x - it.x) < hw + ihw && Math.abs(z - it.z) < hd + ihd) return false;
  }
  return true;
}

// ------------------------------------------------------------- persistence

const LS_KEY = "container-compound-v1";

function serialize() {
  return {
    v: 2,
    items: items.map((i) => [i.typeId, i.x, i.z, i.rot]),
    trees: trees.map((t) => [t.x, t.z, t.s]),
    drive: [drive.x, drive.z, drive.rot],
    wells: wells.map((w) => [w.x, w.z]),
    drains: drainfields.map((d) => [d.x, d.z]),
    setback,
    name: layoutName,
  };
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch {}
  // An edited layout that arrived by link used to leave the sender's original
  // payload in the address bar, so copying the URL re-shared the wrong thing.
  if (location.hash.startsWith("#d=")) {
    history.replaceState(null, "", `#d=${encodeShare()}`);
  }
  if (visiting) { visiting = false; document.body.classList.remove("visiting"); }
}
// True while showing a layout that arrived by link and has not been adopted:
// receiving a link used to overwrite the visitor's own saved compound on
// arrival, with no route back.
let visiting = false;
// Everything arriving from a share link or from localStorage is untrusted:
// a single malformed row used to throw out of the boot and leave a blank app
// that reloaded blank forever. Coerce what can be coerced, drop what cannot,
// and never let a payload reach the model unchecked.
const MAX_ITEMS = 400, MAX_TREES = 200;
const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const onSheet = (v) => Math.max(SP_MINX, Math.min(SP_MAXX, v));
// Placement and movement were unclamped, so a unit could be created hundreds
// of feet off the parcel, outside the sheet's viewBox — where it is clipped
// away, leaving a blank screen that Fit could not recover.
// Round last: the sheet's own edge is a half foot, so clamping after rounding
// put a unit driven into the margin at x = 108.5 and the position field then
// disagreed with the model by half a foot.
const clampX = (v) => Math.round(Math.max(SP_MINX + 4, Math.min(SP_MAXX - 4, v)));
const clampZ = (v) => Math.round(Math.max(SP_MINZ + 4, Math.min(SP_MAXZ - 4, v)));
const rot4 = (v) => (((v | 0) % 4) + 4) % 4;

function normalize(data) {
  const out = { v: 2, items: [], trees: null, drive: null };
  if (!data || typeof data !== "object") return out;
  if (Array.isArray(data.items)) {
    for (const row of data.items.slice(0, MAX_ITEMS)) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const [typeId, x, z, rot] = row;
      // a plain object inherits toString/constructor/__proto__, all of which
      // used to pass `if (TYPE_BY_ID[typeId])` and reach buildUnit
      if (typeof typeId !== "string" || !Object.hasOwn(TYPE_BY_ID, typeId)) continue;
      out.items.push([typeId, onSheet(num(x)), onSheet(num(z)), rot4(num(rot))]);
    }
  }
  if (Array.isArray(data.trees)) {
    out.trees = data.trees.slice(0, MAX_TREES)
      .filter((r) => Array.isArray(r) && r.length >= 2)
      .map((r) => [onSheet(num(r[0])), onSheet(num(r[1])),
                   Math.max(0.3, Math.min(3, num(r[2], 1.2)))]);
  }
  const pts = (rows) => Array.isArray(rows)
    ? rows.slice(0, 20).filter((r) => Array.isArray(r) && r.length >= 2)
        .map((r) => [onSheet(num(r[0])), onSheet(num(r[1]))])
    : [];
  out.wells = pts(data.wells);
  out.drains = pts(data.drains);
  out.setback = Math.max(0, Math.min(80, num(data.setback, 25)));
  out.name = typeof data.name === "string" ? data.name.slice(0, 60) : "Container Compound";
  if (Array.isArray(data.drive) && data.drive.length >= 3) {
    out.drive = [onSheet(num(data.drive[0], DEFAULT_DRIVE.x)),
                 onSheet(num(data.drive[1], DEFAULT_DRIVE.z)),
                 rot4(num(data.drive[2]))];
  }
  return out;
}

function loadFrom(raw, opts = {}) {
  const data = normalize(raw);
  // A gesture in flight refers to objects this is about to destroy. Letting it
  // finish against them produced a phantom selection whose Delete deleted
  // nothing and whose drop popped an unrelated undo entry.
  abortGestures();
  for (const it of [...items]) removeItem(it, { silent: true });
  items = [];
  select(null);
  // ids restart with each load so a snapshot round-trips to the same ids,
  // which is what lets a selection survive an undo
  nextId = 1;
  for (const [typeId, x, z, rot] of data.items) {
    addItem(typeId, x, z, rot, { silent: true });
  }
  // v1 payloads carry no scenery — every share link already in the wild, and
  // every browser still holding a v1 layout, falls back to the default acre.
  const treeRows = data.trees || DEFAULT_TREES;
  trees = treeRows.map(([x, z, s], i) => ({ id: i + 1, x, z, s: s || 1.2 }));
  nextTreeId = trees.length + 1;
  drive = data.drive
    ? { x: data.drive[0], z: data.drive[1], rot: data.drive[2] }
    : { ...DEFAULT_DRIVE };
  nextSiteId = 1;
  wells = data.wells.map(([x, z]) => ({ id: nextSiteId++, x, z }));
  drainfields = data.drains.map(([x, z]) => ({ id: nextSiteId++, x, z }));
  setback = data.setback;
  layoutName = data.name;
  const nameEl = document.getElementById("layout-name");
  if (nameEl) nameEl.textContent = layoutName;
  rebuildScenery();
  if (!opts.noSave) save();
  updateStats();
  // a whole-layout change has no relationship to the old viewport
  if (mode === "plan") renderSitePlan(opts.refit ? { fit: true } : {});
}

function encodeShare() {
  const json = JSON.stringify(serialize());
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeShare(s) {
  try {
    const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

// Spaced to demo the rules: freestanding gaps are all >=10 ft (no rated
// walls), and the utility core butts the bathhouse's solid side — legal
// joining, 240 sq ft combined, still under the 256 sq ft permit exemption.
const EXAMPLE = {
  v: 2,
  items: [
    ["dining", -16, 14, 0],
    ["kitchen", 16, 4, 0],
    ["deck", 0, 14, 0],
    ["sleeping", -16, -16, 0],
    ["bathhouse", 16, -16, 0],
    ["deck", -4, -1, 0],
    ["deck", 4, -1, 0],
    ["office", -41, -1, 1],
    ["bath-laundry", 41, -13, 3],
    ["laundry", 16, -24, 0],
  ],
};

// --------------------------------------------------------------------- UI

// ---- modes: plan (the editor) / view (3D, read-only) ----
// Everything that changes the compound happens on the plan sheet. The 3D
// view inspects: orbit, sun, a dollhouse toggle, and tap-to-select.
let mode = "plan";
let dollhouseOn = false;
document.body.dataset.mode = "plan";
function setMode(m) {
  if (mode === m) return;
  mode = m;
  document.body.dataset.mode = m;
  for (const b of document.querySelectorAll("#tabbar button")) {
    const on = b.dataset.mode === m;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  }
  setPlacing(false);
  closeAdd();
  document.body.classList.remove("sheet-open");
  // selection survives the switch, so you land on the same unit
  if (m === "plan") { stopLoop(); renderSitePlan(); }
  else { markShadowDirty(); startLoop(); updateSelDims(); renderChrome(); }
}
for (const b of document.querySelectorAll("#tabbar button"))
  b.addEventListener("click", () => setMode(b.dataset.mode));

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const ICON_ROOFED = SVG_OPEN + '<path d="M3 11l9-7 9 7"/><path d="M5 11v9h14v-9"/></svg>';
const ICON_ROOFLESS = SVG_OPEN + '<path d="M3 7l9-4 9 4" stroke-dasharray="3 3" opacity="0.55"/><path d="M5 12v8h14v-8"/><path d="M5 12h14"/></svg>';
const btnDoll = document.getElementById("btn-doll");
btnDoll.addEventListener("click", () => {
  dollhouseOn = !dollhouseOn;
  markShadowDirty();
  btnDoll.classList.toggle("on", dollhouseOn);
  btnDoll.setAttribute("aria-pressed", String(dollhouseOn));
  btnDoll.innerHTML = dollhouseOn ? ICON_ROOFLESS : ICON_ROOFED;
  btnDoll.title = dollhouseOn ? "Dollhouse: roofs lifted" : "Dollhouse: roofs on";
  toast(dollhouseOn ? "Dollhouse — every roof lifted" : "Roofs back on");
});

const addList = document.getElementById("add-list");
const openAdd = () => { select(null); document.body.classList.add("add-open"); };
const closeAdd = () => document.body.classList.remove("add-open");
document.getElementById("fab").addEventListener("click", openAdd);
document.getElementById("add-close").addEventListener("click", closeAdd);
document.getElementById("add-backdrop").addEventListener("click", closeAdd);

// drag-out-of-the-drawer placement state
let pendingAdd = null;

const ADD_GROUPS = [
  { label: "20′ high cubes — habitable", match: (t) => !t.deck && t.len === 20 },
  { label: "10′ minis — non-habitable", match: (t) => !t.deck && t.len === 10 },
  { label: "Site", match: (t) => t.deck },
];
const BADGES = { tunnel: "tunnel", openside: "open-side" };
for (const group of ADD_GROUPS) {
  const sec = document.createElement("div");
  sec.className = "add-sec";
  sec.textContent = group.label;
  addList.appendChild(sec);
  for (const t of TYPES.filter(group.match)) {
    const row = document.createElement("button");
    row.className = "add-row";
    const meta = t.deck
      ? `8′ × 8′ platform · 64 ft² · ≈$${(t.cost / 1000).toFixed(1)}k`
      : `${t.len}′ ${t.len === 10 ? "mini " : ""}high cube · ${t.len * t.wid} ft² · ≈$${Math.round(t.cost / 1000)}k`;
    const badge = BADGES[t.variant] ? `<span class="badge">${BADGES[t.variant]}</span>` : "";
    row.innerHTML = `<span class="add-chip${t.len === 10 || t.deck ? " mini" : ""}" style="background:${chipTint(t.color)}"></span>
      <span>
        <div class="add-name">${t.name}${badge}</div>
        <div class="add-meta">${meta}</div>
        <div class="add-desc">${t.desc}</div>
      </span>`;
    // drag it onto the sheet to choose where it lands; a plain click still
    // drops it on the nearest free ground under the middle of the view
    // Only a mouse drags out of the drawer. On touch the list is scrollable,
    // so the browser claims the gesture and cancels the pointer — the drag
    // never completed, and the armed placement leaked onto the next tap.
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      pendingAdd = { type: t, from: { x: e.clientX, y: e.clientY }, armed: false };
    });
    row.addEventListener("click", () => {
      pushUndo();
      const c = viewCenterWorld();
      const spot = findSpot(t, c.x, c.z);
      const item = addItem(t.id, spot.x, spot.z, 0);
      closeAdd();
      select(item);
      renderSitePlan();
    });
    addList.appendChild(row);
  }
}

// scenery and site constraints, which are not units but are what you plan
// around, get their own rows under Site
for (const spec of [
  { id: "__tree", name: "Tree", chip: "#6b8a55",
    meta: "Existing canopy · shade and screening",
    desc: "Drag onto the plan to place. Drag to move, double-tap to clear." },
  { id: "__well", name: "Well", chip: "#3f5c70",
    meta: "Existing or planned · 100 ft to a drainfield",
    desc: "VDH wants 50 ft from a septic tank and 100 ft from a drainfield. The ring shows the 100 ft." },
  { id: "__drain", name: "Septic drainfield", chip: "#6f8a5c",
    meta: "40 ft × 60 ft · AOSE-designed",
    desc: "Usually the biggest constraint on a rural acre. Keep units and the drive off it." },
]) {
  const row = document.createElement("button");
  row.className = "add-row";
  row.innerHTML = `<span class="add-chip mini" style="background:${chipTint(spec.chip)}"></span>
    <span>
      <div class="add-name">${spec.name}</div>
      <div class="add-meta">${spec.meta}</div>
      <div class="add-desc">${spec.desc}</div>
    </span>`;
  const TYPE = { id: spec.id, name: spec.name, deck: true, len: 12, wid: 12 };
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    pendingAdd = { type: TYPE, from: { x: e.clientX, y: e.clientY }, armed: false };
  });
  row.addEventListener("click", () => {
    pushUndo();
    const c = viewCenterWorld();
    placeSiteObject(spec.id, clampX(c.x), clampZ(c.z));
    closeAdd();
    save();
    renderSitePlan();
  });
  addList.appendChild(row);
}

function placeSiteObject(kind, x, z) {
  // nudge off anything already there, so a second tap does not stack
  const taken = [...trees, ...wells, ...drainfields];
  for (let r = 0; r < 24 && taken.some((o) => Math.hypot(o.x - x, o.z - z) < 24); r++) {
    x = clampX(x + 26); if (x >= SP_MAXX - 8) { x = clampX(x - 120); z = clampZ(z + 26); }
  }
  if (kind === "__tree") trees.push({ id: nextTreeId++, x, z, s: 1.2 });
  else if (kind === "__well") wells.push({ id: nextSiteId++, x, z });
  else if (kind === "__drain") drainfields.push({ id: nextSiteId++, x, z });
  else return false;
  rebuildScenery();
  updateStats();
  return true;
}


// ---- undo / redo ----
const undoStack = [];
const redoStack = [];
function updateHistoryButtons() {
  document.getElementById("btn-undo").disabled = !undoStack.length;
  document.getElementById("btn-redo").disabled = !redoStack.length;
}
// Takes the state to record, so the call sites that must snapshot BEFORE
// mutating no longer need a second entry point. (There used to be three
// copies of this, one of them hung off the function as `pushUndo.replace`.)
function pushUndo(snapshot = JSON.stringify(serialize())) {
  undoStack.push(snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0; // a new action invalidates the redo branch
  updateHistoryButtons();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) { toast("Nothing to undo"); return; }
  redoStack.push(JSON.stringify(serialize()));
  restoreSnapshot(prev, selected && selected.id);
  updateHistoryButtons();
  toast("Undone");
}
function redo() {
  const next = redoStack.pop();
  if (!next) { toast("Nothing to redo"); return; }
  undoStack.push(JSON.stringify(serialize()));
  restoreSnapshot(next, selected && selected.id);
  updateHistoryButtons();
  toast("Redone");
}
document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);

document.getElementById("btn-sun").addEventListener("click", () => {
  sunIdx = (sunIdx + 1) % SUNS.length;
  applySun();
  toast(`${SUNS[sunIdx].name} light`);
});

// Recentre on what you built. It used to restore a hard-coded pose aimed at
// the middle of the parcel, so a compound in a corner came back as three toys
// in the top-left — while the same glyph on the Plan tab fits correctly.
function fit3D() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const it of items) {
    const [hw, hd] = halfDims(it);
    x0 = Math.min(x0, it.x - hw); x1 = Math.max(x1, it.x + hw);
    z0 = Math.min(z0, it.z - hd); z1 = Math.max(z1, it.z + hd);
  }
  if (!items.length) { x0 = z0 = -30; x1 = z1 = 30; }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const span = Math.max(x1 - x0, z1 - z0, 26);
  const fov = (camera.fov * Math.PI) / 180;
  const aspect = innerWidth / innerHeight;
  // a portrait phone is the narrow axis, so frame against it
  const need = (span / 2) / Math.tan(fov / 2) / Math.min(1, aspect) * 1.45;
  const dist = Math.max(controls.minDistance + 5,
    Math.min(need, controls.maxDistance - 20));
  controls.target.set(cx, 4, cz);
  camera.position.set(cx + dist * 0.52, dist * 0.55, cz + dist * 0.66);
  controls.update();
  markShadowDirty();
}
document.getElementById("btn-fit").addEventListener("click", fit3D);

// overflow menu
document.getElementById("btn-menu").addEventListener("click", (e) => {
  e.stopPropagation();
  document.body.classList.toggle("menu-open");
});
addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#menu, #btn-menu")) document.body.classList.remove("menu-open");
});
for (const id of ["btn-share", "btn-va", "btn-reset"])
  document.getElementById(id).addEventListener("click", () =>
    document.body.classList.remove("menu-open"));

function duplicateSelected() {
  if (!selected || mode !== "plan") return;
  pushUndo();
  const t = TYPE_BY_ID[selected.typeId];
  const spot = findSpot(t, selected.x, selected.z); // land beside the original
  const item = addItem(selected.typeId, spot.x, spot.z, selected.rot);
  select(item);
  renderSitePlan();
}
document.getElementById("btn-dup").addEventListener("click", duplicateSelected);

document.getElementById("btn-rotate").addEventListener("click", rotateSelected);
function deleteSelected() {
  if (!selected || mode !== "plan") return;
  // A drag still holding this unit would re-select it on release and put its
  // uncommitted mid-drag position on the stack as a second entry.
  const snapshot = planDrag && planDrag.moved ? planDrag.snapshot : undefined;
  if (planDrag) { abortGestures(); if (snapshot) undoStack.pop(); }
  pushUndo(snapshot);
  removeItem(selected);
  renderSitePlan();
  toast("Deleted — ↩ to undo");
}
document.getElementById("btn-delete").addEventListener("click", deleteSelected);
document.getElementById("btn-close").addEventListener("click", () => {
  document.body.classList.remove("sheet-open");
  if (mode === "view") select(null);
});
document.getElementById("stats-pill").addEventListener("click", () =>
  document.getElementById("stats-pop").classList.toggle("open"));
document.getElementById("cart-key").addEventListener("click", () =>
  openDialog(document.getElementById("key-modal")));
document.getElementById("key-close").addEventListener("click", () =>
  closeDialog(document.getElementById("key-modal")));
document.getElementById("btn-va").addEventListener("click", () =>
  openDialog(document.getElementById("va-modal")));
document.getElementById("btn-va-close").addEventListener("click", () =>
  closeDialog(document.getElementById("va-modal")));
document.getElementById("btn-reset").addEventListener("click", () => {
  if (confirm("Reset to the example compound?")) {
    pushUndo();
    history.replaceState(null, "", location.pathname);
    loadFrom(EXAMPLE, { refit: true });
  }
});
document.getElementById("btn-share").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#d=${encodeShare()}`;
  history.replaceState(null, "", `#d=${encodeShare()}`);
  try {
    await navigator.clipboard.writeText(url);
    toast("Share link copied to clipboard");
  } catch {
    toast("Share link is in the address bar");
  }
});

// Run a change and keep it only if it is legal. Legality is tested BEFORE
// the history stacks are touched: the old shape pushed undo first, and since
// pushing clears the redo branch, every rejected action silently destroyed a
// redo the user could still see. Restoring also holds the selection, which a
// rejected nudge used to drop mid-keypress.
function tryEdit(mutate, rejectMsg) {
  const before = JSON.stringify(serialize());
  const keep = selected && selected.id;
  const preBlocked = blockedPairs().length;
  const preOverlap = overlappingPairs().length;
  mutate();
  if (blockedPairs().length > preBlocked) {
    restoreSnapshot(before, keep);
    toast(rejectMsg || "That blocks a door wall — butt against solid sides only");
    return false;
  }
  if (overlappingPairs().length > preOverlap) {
    restoreSnapshot(before, keep);
    toast("Units cannot overlap — butt them edge to edge instead");
    return false;
  }
  pushUndo(before);
  save();
  updateStats();
  if (selected) select(selected);
  if (mode === "plan") renderSitePlan();
  return true;
}

function rotateSelected() {
  if (!selected || mode !== "plan" || anyOpenDialog()) return;
  const it = selected;
  tryEdit(() => { it.rot = (it.rot + 1) % 4; applyTransform(it); },
    "That blocks a door wall — keep apertures clear");
}

// A control with focus owns its own keys. Arrow keys move between the tabs of
// a tablist and between radio buttons, and space presses a button — nudging a
// unit or panning the paper out from under a focused control is not what
// either keypress meant.
const FOCUS_OWNS_KEYS = "button, a[href], input, textarea, select, [contenteditable], [role='tab'], [role='menuitem']";
const focusOwnsKeys = () => {
  const el = document.activeElement;
  return !!(el && el !== document.body && el.closest && el.closest(FOCUS_OWNS_KEYS));
};

// Tab cycles the selection while the sheet itself has focus, which is the only
// route to a unit that does not need a pointer. Escape hands focus back out,
// so the sheet is a stop on the tab order rather than a trap in it.
function cycleSelection(dir) {
  if (!items.length) return;
  const order = [...items].sort((a, b) => a.z - b.z || a.x - b.x || a.id - b.id);
  const at = selected ? order.indexOf(selected) : -1;
  const next = order[(at + dir + order.length * 2) % order.length];
  select(next);
  renderChrome();
  // keep whatever you just picked on screen
  const c = viewCenterWorld();
  if (Math.abs(next.x - c.x) * SP_S * sview.k > innerWidth * 0.45
      || Math.abs(next.z - c.z) * SP_S * sview.k > innerHeight * 0.4) {
    sview.x += (c.x - next.x) * SP_S * sview.k;
    sview.y += (c.z - next.z) * SP_S * sview.k;
    siteApply();
  }
}

addEventListener("keyup", (e) => { if (e.code === "Space") setSpaceHeld(false); });

addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
  // A dialog that traps Tab but lets a bare keypress rotate or DELETE the
  // object it is describing is worse than one that does neither — Backspace
  // is the key people press meaning "go back".
  if (anyOpenDialog() && e.key !== "Escape") return;
  const mod = e.metaKey || e.ctrlKey;
  const sheet = mode === "plan";
  const stageFocused = document.activeElement === sitePanelEl;

  if (e.code === "Space" && sheet && !focusOwnsKeys()) {
    e.preventDefault();
    setSpaceHeld(true);
    return;
  }
  if (e.key === "Tab" && sheet && stageFocused && items.length) {
    e.preventDefault();
    cycleSelection(e.shiftKey ? -1 : 1);
    return;
  }

  if (mod && (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
    e.preventDefault(); redo();
  } else if (mod && e.key === "z") { e.preventDefault(); undo(); }
  else if (mod && (e.key === "d" || e.key === "D") && selected && sheet) {
    e.preventDefault(); duplicateSelected();
  } else if (mod) {
    return; // every other accelerator belongs to the browser
  }
  else if (e.key === "r" || e.key === "R") rotateSelected();
  else if ((e.key === "Delete" || e.key === "Backspace") && selected && sheet) {
    e.preventDefault();
    deleteSelected();
  } else if (sheet && !focusOwnsKeys() && (e.key === "+" || e.key === "=")) {
    e.preventDefault(); zoomBy(1.25);
  } else if (sheet && !focusOwnsKeys() && (e.key === "-" || e.key === "_")) {
    e.preventDefault(); zoomBy(1 / 1.25);
  } else if (sheet && !focusOwnsKeys() && (e.key === "0" || e.key === "f" || e.key === "F")) {
    e.preventDefault(); siteFitView();
  } else if (e.key.startsWith("Arrow") && selected && sheet && !focusOwnsKeys()) {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") nudgeSelected(-step, 0);
    else if (e.key === "ArrowRight") nudgeSelected(step, 0);
    else if (e.key === "ArrowUp") nudgeSelected(0, -step);
    else if (e.key === "ArrowDown") nudgeSelected(0, step);
  } else if (e.key === "Escape") {
    setSpaceHeld(false);
    const dlg = anyOpenDialog();
    if (dlg) { closeDialog(dlg); return; }
    if (document.body.classList.contains("menu-open")) {
      document.body.classList.remove("menu-open");
      document.getElementById("btn-menu").focus();
      return;
    }
    // A drag in flight is the most urgent thing Escape can be about: it puts
    // the unit back where it started rather than leaving you to undo a move
    // you never meant to finish.
    if (planDrag && planDrag.moved) { cancelPlanDrag(); toast("Move cancelled"); return; }
    if (pendingAdd || ghost) {
      pendingAdd = null; ghost = null; snapGuides = []; renderChrome();
      return;
    }
    if (placing) { setPlacing(false); return; }
    if (stageFocused && selected) { sitePanelEl.blur(); }
    closeAdd();
    select(null);
  }
});

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------------------------------------------- compliance checks

const overlayGroup = new THREE.Group(); // separation + trench lines
scene.add(overlayGroup);
let sepPairs = []; // [{a, b, gap}] freestanding pairs in the 1-9 ft zone
let joined = new Map(); // item.id -> { count, sqft } for butted clusters
let trenchFt = 0, trenchCost = 0;

function halfDims(it) {
  const t = TYPE_BY_ID[it.typeId];
  return it.rot % 2 ? [t.wid / 2, t.len / 2] : [t.len / 2, t.wid / 2];
}
// gap between two axis-aligned footprints (0 = touching/overlapping)
function gapBetween(a, b) {
  const [aw, ad] = halfDims(a), [bw, bd] = halfDims(b);
  const gx = Math.abs(a.x - b.x) - (aw + bw);
  const gz = Math.abs(a.z - b.z) - (ad + bd);
  if (gx <= 0 && gz <= 0) return 0;
  if (gx <= 0) return gz;
  if (gz <= 0) return gx;
  return Math.hypot(gx, gz);
}

// `gapBetween` returns 0 both for two units touching and for one sitting
// entirely inside another, so it can never tell a legal butt-join from a
// physically impossible stack. This measures penetration instead: positive on
// both axes means the footprints genuinely intersect.
const OVERLAP_EPS = 0.5;
function overlapDepth(a, b) {
  const [aw, ad] = halfDims(a), [bw, bd] = halfDims(b);
  return Math.min((aw + bw) - Math.abs(a.x - b.x), (ad + bd) - Math.abs(a.z - b.z));
}
function overlappingPairs() {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      // a deck is meant to tuck against a container; two of either is not
      if (TYPE_BY_ID[a.typeId].deck !== TYPE_BY_ID[b.typeId].deck) continue;
      if (overlapDepth(a, b) > OVERLAP_EPS) out.push([a, b]);
    }
  }
  return out;
}

// local +x rotated into world by rot steps (rotation.y = rot * PI/2)
const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];
// world-axis directions of a unit's aperture (door/glazed) faces
function apertureFaces(it) {
  const t = TYPE_BY_ID[it.typeId];
  if (t.deck) return [];
  const px = DIRS[it.rot % 4]; // door end at local +x on every variant
  const faces = [px];
  if (t.variant === "tunnel") faces.push([-px[0], -px[1]]);
  if (t.variant === "openside") faces.push(DIRS[(it.rot + 3) % 4]); // glazed local +z side
  return faces;
}
// pairs of units butted against an aperture face — entry/egress blocked
function blockedPairs() {
  const units = items.filter((i) => !TYPE_BY_ID[i.typeId].deck);
  const out = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      const [aw, ad] = halfDims(a), [bw, bd] = halfDims(b);
      const gx = Math.abs(a.x - b.x) - (aw + bw);
      const gz = Math.abs(a.z - b.z) - (ad + bd);
      if (gx > JOIN_EPS || gz > JOIN_EPS) continue; // not touching
      const axis = gx >= gz ? "x" : "z";
      const s = axis === "x" ? Math.sign(b.x - a.x) || 1 : Math.sign(b.z - a.z) || 1;
      const faceA = axis === "x" ? [s, 0] : [0, s]; // A's face toward B
      const hit = (it, f) => apertureFaces(it).some((d) => d[0] === f[0] && d[1] === f[1]);
      if (hit(a, faceA) || hit(b, [-faceA[0], -faceA[1]])) out.push([a, b]);
    }
  }
  return out;
}

function groundLine(ax, az, bx, bz, mat, dashed) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(ax, 0.15, az),
    new THREE.Vector3(bx, 0.15, bz),
  ]);
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  overlayGroup.add(line);
}

function updateCompliance() {
  for (const child of [...overlayGroup.children]) {
    child.geometry.dispose();
    overlayGroup.remove(child);
  }
  const units = items.filter((i) => !TYPE_BY_ID[i.typeId].deck);

  // fire-separation conflicts + butted clusters (union-find)
  sepPairs = [];
  const parent = new Map(units.map((u) => [u.id, u.id]));
  const find = (i) => (parent.get(i) === i ? i : (parent.set(i, find(parent.get(i))), parent.get(i)));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const gap = gapBetween(units[i], units[j]);
      if (gap <= JOIN_EPS) {
        parent.set(find(units[i].id), find(units[j].id));
      } else if (gap < SEP_CLEAR) {
        sepPairs.push({ a: units[i], b: units[j], gap });
        groundLine(units[i].x, units[i].z, units[j].x, units[j].z, sepLineMat);
      }
    }
  }
  const conflicted = new Set(sepPairs.flatMap((p) => [p.a.id, p.b.id]));
  for (const it of units) if (it.sepRing) it.sepRing.visible = conflicted.has(it.id);

  joined = new Map();
  const clusters = new Map();
  for (const u of units) {
    const root = find(u.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(u);
  }
  clusterIndex = new Map();
  for (const members of clusters.values()) {
    for (const m of members) clusterIndex.set(m.id, members);
  }
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const sqft = members.reduce((s, m) => s + TYPE_BY_ID[m.typeId].len * TYPE_BY_ID[m.typeId].wid, 0);
    for (const m of members) joined.set(m.id, { count: members.length, sqft });
  }

  // utility trenches: each wet unit to its nearest core
  trenchFt = 0;
  const cores = units.filter((u) => TYPE_BY_ID[u.typeId].core);
  for (const run of trenchRuns()) {
    trenchFt += run.ft;
    groundLine(run.ax, run.az, run.bx, run.bz, trenchMat, true);
  }
  trenchFt = Math.round(trenchFt);
  trenchCost = trenchFt * TRENCH_PER_FT;

  // Every class of finding the drawing redlines, not just the separations —
  // the badge used to say 2 on a layout showing 5 problems.
  // The exemption is a function of USE, not area: it covers sheds and
  // playhouses, not habitable space. Applying it by size alone told people a
  // bedroom plus its bath was permit-exempt because it came to 240 sq ft.
  let over = 0, dwelling = 0;
  const counted = new Set();
  for (const u of units) {
    if (!TYPE_BY_ID[u.typeId].accessory) dwelling++;
    const j = joined.get(u.id);
    if (!j || j.sqft <= 256) continue;
    const members = clusterOf(u);
    if (!members.every((m) => TYPE_BY_ID[m.typeId].accessory)) continue;
    const key = members.map((m) => m.id).sort().join(",");
    if (counted.has(key)) continue;
    counted.add(key);
    over++;
  }
  let stranded = 0;
  for (const w of units.filter((u) => TYPE_BY_ID[u.typeId].wet)) {
    const near = cores.length
      ? Math.min(...cores.map((c) => Math.hypot(c.x - w.x, c.z - w.z))) : Infinity;
    if (near > WET_RADIUS) stranded++;
  }
  // A unit whose footprint crosses the property line. The parcel was drawn in
  // surveyor's dash-dot — which promises it means something — and checked
  // nowhere, so a unit could sit wholly outside it with no complaint.
  let offsite = 0;
  for (const u of units) {
    const [hw, hd] = halfDims(u);
    if (Math.abs(u.x) + hw > SP_HALF || Math.abs(u.z) + hd > SP_HALF) offsite++;
  }
  const blocked = blockedPairs().length;
  const overlap = overlappingPairs().length;

  // Inside the setback line rather than merely inside the parcel — the
  // setback is what a county actually enforces.
  const sb = SP_HALF - setback;
  let tooClose = 0;
  for (const u of units) {
    const [hw, hd] = halfDims(u);
    if (Math.abs(u.x) + hw > SP_HALF || Math.abs(u.z) + hd > SP_HALF) continue; // already offsite
    if (Math.abs(u.x) + hw > sb || Math.abs(u.z) + hd > sb) tooClose++;
  }
  // A unit sitting on the gravel — the drive is editable and was checked
  // nowhere, so the shipped example used to do this.
  let onDrive = 0;
  for (const u of units) if (overlapsDrive(u)) onDrive++;
  // Fire apparatus access: IFC D107 wants a dwelling reachable from the
  // approved road, and many VA counties enforce it past a driveway length.
  let farFromDrive = 0;
  for (const u of units) if (distanceToDrive(u) > FIRE_ACCESS) farFromDrive++;
  // VDH: 100 ft between a well and a drainfield.
  let wellTooClose = 0;
  for (const w of wells) {
    for (const d of drainfields) {
      if (Math.hypot(w.x - d.x, w.z - d.z) < WELL_CLEAR) { wellTooClose++; break; }
    }
  }
  let deckOver = 0;
  for (const d of deckClusters()) if (d.sqft > 256) deckOver++;
  // and nothing may be built over the drainfield
  let overDrain = 0;
  for (const u of units) {
    for (const d of drainfields) {
      const [hw, hd] = halfDims(u);
      if (Math.abs(u.x - d.x) < hw + DRAIN_W / 2 && Math.abs(u.z - d.z) < hd + DRAIN_L / 2) {
        overDrain++; break;
      }
    }
  }
  dwellingUnits = dwelling;
  findings = {
    sep: sepPairs.length, over, stranded, offsite, blocked, overlap,
    tooClose, onDrive, farFromDrive, wellTooClose, overDrain, deckOver,
    total: sepPairs.length + over + stranded + offsite + blocked + overlap
      + tooClose + onDrive + farFromDrive + wellTooClose + overDrain + deckOver,
  };
}
let findings = { sep: 0, over: 0, stranded: 0, offsite: 0, blocked: 0, overlap: 0,
                 tooClose: 0, onDrive: 0, farFromDrive: 0, wellTooClose: 0,
                 overDrain: 0, deckOver: 0, total: 0 };
let dwellingUnits = 0;

function updateStats() {
  updateCompliance();
  let hc20 = 0, hc10 = 0, sqft = 0, deckSqft = 0, cost = trenchCost;
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    cost += t.cost;
    if (t.deck) { deckSqft += t.len * t.wid; continue; }
    if (t.len === 20) hc20++; else hc10++;
    sqft += t.len * t.wid;
  }
  document.getElementById("st-units").textContent = hc20 + hc10;
  document.getElementById("st-hc20").textContent = hc20;
  document.getElementById("st-hc10").textContent = hc10;
  document.getElementById("st-sqft").textContent = `${sqft.toLocaleString()} ft²`;
  document.getElementById("st-deck").textContent = `${deckSqft.toLocaleString()} ft²`;
  document.getElementById("st-trench").textContent = trenchFt
    ? `${trenchFt} ft · $${trenchCost.toLocaleString()}` : "—";
  document.getElementById("st-cost").textContent = `$${cost.toLocaleString()}`;
  const n = hc20 + hc10;
  const plural = (k, one, many = one + "s") => `${k} ${k === 1 ? one : many}`;
  const fRow = document.getElementById("st-findings");
  if (fRow) {
    // sentences, not fragments: this row used to read "2 separation"
    fRow.textContent = findings.total
      ? [findings.overlap && `${plural(findings.overlap, "pair")} of units overlap`,
         findings.blocked && `${plural(findings.blocked, "unit")} butted against a door wall`,
         findings.offsite && `${plural(findings.offsite, "unit")} across the property line`,
         findings.tooClose && `${plural(findings.tooClose, "unit")} inside the ${setback} ft setback`,
         findings.overDrain && `${plural(findings.overDrain, "unit")} over the drainfield`,
         findings.onDrive && `${plural(findings.onDrive, "unit")} sitting on the drive`,
         findings.farFromDrive && `${plural(findings.farFromDrive, "unit")} over ${FIRE_ACCESS} ft from the drive`,
         findings.wellTooClose && `${plural(findings.wellTooClose, "well")} within 100 ft of a drainfield`,
         findings.sep && `${plural(findings.sep, "pair")} 1–9 ft apart, needing rated walls`,
         findings.over && `${plural(findings.over, "storage cluster")} over the 256 sq ft exemption`,
         findings.deckOver && `${plural(findings.deckOver, "deck run")} over the 256 sq ft exemption`,
         findings.stranded && `${plural(findings.stranded, "wet unit")} too far from a utility core`]
        .filter(Boolean).join(" · ")
      : "None";
    fRow.parentElement.classList.toggle("warn", findings.total > 0);
  }
  const pRow = document.getElementById("st-permit");
  if (pRow) {
    pRow.textContent = dwellingUnits
      ? `${plural(dwellingUnits, "habitable unit")} — permit required`
      : "Storage and decks only";
  }
  const money = cost >= 1000 ? `≈$${Math.round(cost / 1000)}k` : `$${cost.toLocaleString()}`;
  const pill = document.getElementById("stats-pill");
  const warn = `<svg class="warn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/></svg>`;
  pill.innerHTML =
    `${plural(n, "unit")} · ${(sqft + deckSqft).toLocaleString()} ft² · ${esc(money)}` +
    (findings.total ? ` · <span class="pill-warn">${warn}${findings.total}</span>` : "");
  pill.classList.toggle("has-findings", findings.total > 0);
  pill.setAttribute("aria-label",
    `${plural(n, "unit")}, ${(sqft + deckSqft).toLocaleString()} square feet, about $${cost.toLocaleString()}, ` +
    (findings.total ? plural(findings.total, "code finding") : "no code findings") +
    ". Opens the summary.");
}

// ------------------------------------------------- CAD-style dimension labels

const labelCache = new Map();
function dimSprite(text) {
  const key = text;
  let proto = labelCache.get(key);
  if (!proto) {
    const c = document.createElement("canvas");
    const measure = c.getContext("2d");
    measure.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    const w = Math.ceil(measure.measureText(text).width) + 30;
    c.width = w;
    c.height = 54;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(43, 43, 40, 0.85)";
    g.beginPath();
    g.roundRect(0, 0, w, 54, 16);
    g.fill();
    g.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, 28);
    const tex = new THREE.CanvasTexture(c);
    proto = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    proto.scale.set(w / 15, 54 / 15, 1);
    labelCache.set(key, proto);
  }
  return proto.clone(); // clones share the material/texture
}

const selDimGroup = new THREE.Group();
scene.add(selDimGroup);

// footprint dimensions of the selected unit
function updateSelDims() {
  for (const c of [...selDimGroup.children]) selDimGroup.remove(c);
  if (!selected || mode !== "view") return;
  const t = TYPE_BY_ID[selected.typeId];
  if (t.deck) return;
  const [hw, hd] = halfDims(selected);
  const lenLabel = dimSprite(`${t.len}′`);
  const widLabel = dimSprite(`${t.wid}′`);
  if (selected.rot % 2 === 0) {
    lenLabel.position.set(selected.x, 4, selected.z + hd + 2.6);
    widLabel.position.set(selected.x + hw + 2.6, 4, selected.z);
  } else {
    lenLabel.position.set(selected.x + hw + 2.6, 4, selected.z);
    widLabel.position.set(selected.x, 4, selected.z + hd + 2.6);
  }
  selDimGroup.add(lenLabel, widLabel);
}

// -------------------------------------------------------------- picking

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
let moved = false;

function itemAt(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  let best = null, bestDist = Infinity;
  const inv = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  for (const it of items) {
    inv.copy(it.group.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inv);
    const hit = localRay.intersectBox(it.group.userData.pickBox, new THREE.Vector3());
    if (hit) {
      const d = hit.applyMatrix4(it.group.matrixWorld).distanceTo(raycaster.ray.origin);
      if (d < bestDist) { bestDist = d; best = it; }
    }
  }
  return best;
}

// 3D is read-only: a press selects (and opens the sheet), nothing moves.
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
  moved = false;
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!downPos || moved) return;
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) moved = true;
});

renderer.domElement.addEventListener("pointerup", (e) => {
  // an orbit drag is not a tap, so it must not change the selection
  if (downPos && !moved) {
    const it = itemAt(e.clientX, e.clientY);
    select(it && !TYPE_BY_ID[it.typeId].deck ? it : null);
  }
  downPos = null;
});

// ------------------------------------------------------------- parts list

function renderParts() {
  const qty = new Map();
  for (const it of items) qty.set(it.typeId, (qty.get(it.typeId) || 0) + 1);

  let unitsRows = "", unitsTotal = 0;
  for (const t of TYPES) {
    if (t.deck) continue;
    const n = qty.get(t.id);
    if (!n) continue;
    unitsRows += `<tr><td>${t.name}</td><td>×${n}</td><td>$${t.cost.toLocaleString()}</td><td>$${(t.cost * n).toLocaleString()}</td></tr>`;
    unitsTotal += t.cost * n;
  }

  const ORDER_LABEL = {
    standard: "20′ high cube — standard",
    tunnel: "20′ high cube — tunnel (doors both ends)",
    openside: "20′ high cube — open-side",
  };
  const order = new Map();
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    if (t.deck) continue;
    const key = t.len === 10 ? "10′ mini high cube — standard" : ORDER_LABEL[t.variant];
    order.set(key, (order.get(key) || 0) + 1);
  }
  let orderRows = "";
  for (const [k, n] of order) orderRows += `<tr><td>${k}</td><td>×${n}</td></tr>`;

  const decks = qty.get("deck") || 0;
  const deckCost = decks * TYPE_BY_ID.deck.cost;
  const total = unitsTotal + deckCost + trenchCost;

  document.getElementById("parts-list").innerHTML = `
    <h4>Units</h4>
    <table>${unitsRows || "<tr><td>No units yet</td></tr>"}</table>
    <h4>Container order</h4>
    <table>${orderRows || "<tr><td>—</td></tr>"}</table>
    <h4>Site</h4>
    <table>
      <tr><td>Deck sections (8′ × 8′)</td><td>×${decks}</td><td></td><td>$${deckCost.toLocaleString()}</td></tr>
      <tr><td>Utility trench</td><td>${trenchFt} ft</td><td>$${TRENCH_PER_FT}/ft</td><td>$${trenchCost.toLocaleString()}</td></tr>
    </table>
    <table class="grand"><tr><td>Total (rough)</td><td>$${total.toLocaleString()}</td></tr></table>
    <div class="fine">Ballpark, fully fitted-out. Site work, utility hookups &amp; container delivery extra.</div>`;
}

document.getElementById("btn-parts").addEventListener("click", () => {
  renderParts();
  document.getElementById("stats-pop").classList.remove("open");
  openDialog(document.getElementById("parts-modal"));
});
document.getElementById("parts-close").addEventListener("click", () =>
  closeDialog(document.getElementById("parts-modal")));

// ------------------------------------------------------------- site plan

const SHORT_NAME = {
  sleeping: "Sleeping", kitchen: "Kitchen", bathhouse: "Bathhouse",
  "bath-laundry": "Bath + laundry", dining: "Dining", living: "Living",
  bathroom: "Bath", laundry: "Utility", office: "Office", hobby: "Hobby",
  deck: "",
};

const SP_S = 8; // px per foot at 1x zoom
const SP_M = 60; // sheet margin, px
const SP_HALF = 104.5; // one acre, ~209 ft square
const SP_MINX = -SP_HALF - 8, SP_MAXX = SP_HALF + 8;
const SP_MINZ = -SP_HALF - 8, SP_MAXZ = SP_HALF + 8;
const SP_W = (SP_MAXX - SP_MINX) * SP_S + SP_M * 2;
const SP_H = (SP_MAXZ - SP_MINZ) * SP_S + SP_M * 2;
// world feet <-> sheet pixels
const spX = (x) => SP_M + (x - SP_MINX) * SP_S;
const spY = (z) => SP_M + (z - SP_MINZ) * SP_S;
const spInvX = (px) => (px - SP_M) / SP_S + SP_MINX;
const spInvZ = (py) => (py - SP_M) / SP_S + SP_MINZ;
const FONT = "ui-sans-serif, system-ui";

// Above this zoom the sheet stops drawing units as coarse footprints and
// starts drawing them at floor-plan fidelity, so zooming from the whole
// parcel down to one unit is continuous.
let detailOn = false;

// Annotation is authored in sheet units but read in screen pixels. At the
// phone's fitted zoom (~0.38) a 10 px label lands at 4 px, so every label,
// rule weight and dash on the drawing is emitted through `ss()`, which asks
// for a size in SCREEN px and converts. The footprints still scale with zoom;
// the writing on them does not.
let AK = 1; // sheet units per screen px
const ss = (screenPx) => +(screenPx / AK).toFixed(3);
const dash = (a, b) => `${ss(a)} ${ss(b)}`;
let exportScale = false; // exports render at 1:1 so they never carry the zoom

// The detail tier is relative to the fit, not absolute: on a desktop the fit
// lands near 1.5 and on a phone near 0.38, so one fixed threshold is either
// one pinch away or five. Hysteresis keeps a wobbling pinch from thrashing it.
let fitK = 1;
const detailIn = () => Math.max(1.6, fitK * 2.2);
const detailOut = () => detailIn() * 0.85;

// one unit (or deck) drawn architecturally in local coords, rotated into place.
// `detail` is the zoomed-in reading: furniture labels, the finished-interior
// line, egress arrows and the unit's own dimension string.
function unitPlanGroup(it, detail) {
  const t = TYPE_BY_ID[it.typeId];
  const S = SP_S;
  const hw = (t.len / 2) * S, hd = (t.wid / 2) * S;
  let g = "";

  if (t.deck) {
    g += `<rect x="${-hw}" y="${-hd}" width="${hw * 2}" height="${hd * 2}" fill="#ecd9b8" stroke="#a8814f" stroke-width="1.4"/>`;
    for (let i = 1; i < 4; i++) {
      const y = -hd + (hd * 2 / 4) * i;
      g += `<line x1="${-hw + 2}" y1="${y}" x2="${hw - 2}" y2="${y}" stroke="#c8a878" stroke-width="0.8"/>`;
    }
  } else {
    // wall poché: dark outer line, white interior, faint tint wash
    g += `<rect x="${-hw}" y="${-hd}" width="${hw * 2}" height="${hd * 2}" fill="#ffffff" stroke="#23231f" stroke-width="2.6"/>`;
    g += `<rect x="${-hw + 3}" y="${-hd + 3}" width="${hw * 2 - 6}" height="${hd * 2 - 6}" fill="#${t.color.toString(16).padStart(6, "0")}" fill-opacity="0.40" stroke="#55524c" stroke-width="${ss(0.8)}"/>`;

    // the finished interior after spray foam, only worth drawing up close
    if (detail) {
      g += `<rect x="${(-t.len / 2 + 0.55) * S}" y="${(-t.wid / 2 + 0.42) * S}" width="${(t.len - 1.1) * S}" height="${(t.wid - 0.84) * S}" fill="none" stroke="#b8b2a6" stroke-width="0.9" stroke-dasharray="4 3"/>`;
    }

    // furniture outlines, labelled once there is room for the words
    const labels = PLAN_LABELS[t.id] || [];
    t.furniture.forEach((f, i) => {
      g += `<rect x="${(f.x - f.w / 2) * S}" y="${(f.z - f.d / 2) * S}" width="${f.w * S}" height="${f.d * S}" rx="1.5" fill="#f2efe9" stroke="#55524c" stroke-width="0.9"/>`;
      if (detail && labels[i] && f.w * S * AK > 30) {
        g += `<text x="${f.x * S}" y="${f.z * S + ss(2.8)}" text-anchor="middle" font-size="${ss(8)}" fill="#55524c" font-family="${FONT}">${labels[i]}</text>`;
      }
    });

    // glazed apertures + door swings
    const ends = t.variant === "tunnel" ? [1, -1] : [1];
    for (const e of ends) {
      g += `<line x1="${e * (hw - 2)}" y1="${-hd + 4}" x2="${e * (hw - 2)}" y2="${hd - 4}" stroke="#4a90c2" stroke-width="2.2"/>`;
      // hinge at the far jamb, leaf open square to the wall, arc closing on
      // the strike jamb — the tip is on its own arc, which it was not before
      const hy = -3.1 * S, r = 3 * S;
      g += `<line x1="${e * hw}" y1="${hy}" x2="${e * (hw + r)}" y2="${hy}" stroke="#55524c" stroke-width="${ss(1.6)}"/>`;
      g += `<path d="M ${e * (hw + r)} ${hy} A ${r} ${r} 0 0 ${e === 1 ? 1 : 0} ${e * hw} ${hy + r}" fill="none" stroke="#55524c" stroke-width="${ss(0.9)}" stroke-dasharray="${dash(3, 3)}"/>`;
    }
    if (t.variant === "openside") {
      g += `<line x1="${-hw + 5}" y1="${hd - 2}" x2="${hw - 5}" y2="${hd - 2}" stroke="#4a90c2" stroke-width="2.2"/>`;
    }

    // egress arrows out through each aperture, and the unit's own dimension
    if (detail) {
      for (const e of ends) {
        g += `<line x1="${e * (hw - 3.4 * S)}" y1="${-1.6 * S}" x2="${e * (hw + 1.2 * S)}" y2="${-1.6 * S}" stroke="#c0574a" stroke-width="1.3" marker-end="url(#sp-arr)"/>`;
      }
      const dy = hd + ss(14);
      g += `<line x1="${-hw}" y1="${dy}" x2="${hw}" y2="${dy}" stroke="#6b6861" stroke-width="${ss(0.9)}"/>`;
      g += `<line x1="${-hw}" y1="${dy - ss(3)}" x2="${-hw}" y2="${dy + ss(3)}" stroke="#6b6861" stroke-width="${ss(0.9)}"/>`;
      g += `<line x1="${hw}" y1="${dy - ss(3)}" x2="${hw}" y2="${dy + ss(3)}" stroke="#6b6861" stroke-width="${ss(0.9)}"/>`;
      g += `<text x="0" y="${dy - ss(3)}" text-anchor="middle" font-size="${ss(9)}" fill="#55524c" font-family="${FONT}">${t.len}′-0″</text>`;
    }
  }
  return g;
}

// The sheet is emitted as two groups inside one SVG. `paper` is everything
// that does not depend on the layout; `draw` is everything that does. A drag
// re-emits `draw` whole, which is what keeps it self-consistent — the old
// shape patched individual unit transforms and left core rings, trench runs,
// the separation layer and the dimension strings at their previous positions.
function unitExtents() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const it of items) {
    const [hw, hd] = halfDims(it);
    x0 = Math.min(x0, it.x - hw); x1 = Math.max(x1, it.x + hw);
    z0 = Math.min(z0, it.z - hd); z1 = Math.max(z1, it.z + hd);
  }
  return { x0, x1, z0, z1 };
}

function paperMarkup() {
  const S = SP_S, HALF = SP_HALF, X = spX, Y = spY;
  const minX = SP_MINX, maxX = SP_MAXX, minZ = SP_MINZ, maxZ = SP_MAXZ;
  let s = "";

  // paper sheet with a soft shadow, sitting on the workspace
  s += `<rect x="10" y="12" width="${SP_W - 14}" height="${SP_H - 14}" fill="#22201c" opacity="0.10"/>`;
  s += `<rect x="4" y="4" width="${SP_W - 14}" height="${SP_H - 14}" fill="#fbfaf6" stroke="#c9c4b8" stroke-width="1.5"/>`;

  // The grid's pitch follows the zoom: at the fitted view a 10 ft grid is
  // uncountable noise, and at floor-plan zoom a 1 ft grid is what you want.
  const pitch = sview.k >= detailIn() ? 5 : sview.k >= 0.8 ? 10 : 50;
  for (let gx = Math.ceil(minX / pitch) * pitch; gx <= maxX; gx += pitch) {
    const major = gx % 50 === 0;
    s += `<line x1="${X(gx)}" y1="${Y(minZ)}" x2="${X(gx)}" y2="${Y(maxZ)}" stroke="${major ? "#d6d0c2" : "#e7e4da"}" stroke-width="${ss(major ? 0.9 : 0.6)}"/>`;
  }
  for (let gz = Math.ceil(minZ / pitch) * pitch; gz <= maxZ; gz += pitch) {
    const major = gz % 50 === 0;
    s += `<line x1="${X(minX)}" y1="${Y(gz)}" x2="${X(maxX)}" y2="${Y(gz)}" stroke="${major ? "#d6d0c2" : "#e7e4da"}" stroke-width="${ss(major ? 0.9 : 0.6)}"/>`;
  }

  // property line (dash-dot) — the one-acre parcel
  s += `<rect x="${X(-HALF)}" y="${Y(-HALF)}" width="${HALF * 2 * S}" height="${HALF * 2 * S}" fill="none" stroke="#8a867c" stroke-width="${ss(1.6)}" stroke-dasharray="${dash(16, 6)} ${dash(3, 6)}"/>`;

  // the buildable envelope after setbacks, which is what actually constrains
  // where anything can go in a rural A-1 district
  const sb = SP_HALF - setback;
  s += `<rect x="${X(-sb)}" y="${Y(-sb)}" width="${sb * 2 * S}" height="${sb * 2 * S}" fill="none" stroke="#a89f8c" stroke-width="${ss(1)}" stroke-dasharray="${dash(6, 5)}"/>`;
  s += `<text x="${X(-sb) + ss(6)}" y="${Y(-sb) - ss(5)}" font-size="${ss(8.5)}" letter-spacing="${ss(0.8)}" fill="#8a8272" font-family="${FONT}">${setback}′ SETBACK</text>`;

  // north arrow and graphic scale, sheet furniture at a constant screen size
  const nx = X(maxX) - ss(40), ny = Y(minZ) + ss(42);
  const r = ss(22);
  s += `<circle cx="${nx}" cy="${ny}" r="${r}" fill="#fbfaf6" stroke="#55524c" stroke-width="${ss(1.4)}"/>`;
  s += `<path d="M ${nx} ${ny - ss(15)} L ${nx - ss(7)} ${ny + ss(9)} L ${nx} ${ny + ss(3)} L ${nx + ss(7)} ${ny + ss(9)} Z" fill="#23231f"/>`;
  s += `<text x="${nx}" y="${ny + ss(38)}" text-anchor="middle" font-size="${ss(12)}" font-weight="700" fill="#23231f" font-family="${FONT}">N</text>`;
  return s;
}

function titleBlockMarkup() {
  const S = SP_S;
  let hc20 = 0, hc10 = 0, sqft = 0, deckSf = 0;
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    if (t.deck) { deckSf += t.len * t.wid; continue; }
    if (t.len === 20) hc20++; else hc10++;
    sqft += t.len * t.wid;
  }
  const tbw = 340, tbh = 150;
  const tbx = SP_W - tbw - 40, tby = SP_H - tbh - 42;
  const L = (y, size, fill, text, weight = "400", ls = 0) =>
    `<text x="${tbx + 14}" y="${tby + y}" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${fill}" font-family="${FONT}">${text}</text>`;
  let s = `<rect x="${tbx}" y="${tby}" width="${tbw}" height="${tbh}" fill="#ffffff" stroke="#23231f" stroke-width="1.6"/>`;
  s += `<line x1="${tbx}" y1="${tby + 36}" x2="${tbx + tbw}" y2="${tby + 36}" stroke="#23231f" stroke-width="1"/>`;
  s += L(24, 14, "#23231f", esc(layoutName.toUpperCase()), "700", 2);
  s += L(54, 10, "#55524c", "SITE PLAN · VIRGINIA · 1.0 AC PARCEL", "400", 1);
  s += L(70, 8.5, "#55524c", `${hc20 + hc10} UNITS (${hc20}× 20′ HC, ${hc10}× 10′ MINI) · ${sqft.toLocaleString()} SF ENCLOSED · ${deckSf} SF DECK`);
  s += L(84, 8.5, "#55524c", `DRAWN ${new Date().toISOString().slice(0, 10)} · SHEET A1 · NOT FOR CONSTRUCTION`);
  s += L(101, 7.5, "#6b6861", "BLUE = GLAZED APERTURE · DASHED = UTILITY RUN / CORE RING");
  s += L(113, 7.5, "#6b6861", "RED, HEAVY DASH = CODE FINDING · NOMINAL CONTAINER LENGTHS SHOWN");
  s += `<line x1="${tbx + 14}" y1="${tby + 135}" x2="${tbx + 14 + 20 * S}" y2="${tby + 135}" stroke="#23231f" stroke-width="3"/>`;
  s += `<line x1="${tbx + 14 + 10 * S}" y1="${tby + 131}" x2="${tbx + 14 + 10 * S}" y2="${tby + 139}" stroke="#23231f" stroke-width="1.2"/>`;
  s += `<text x="${tbx + 22 + 20 * S}" y="${tby + 139}" font-size="9" fill="#55524c" font-family="${FONT}">20 FT</text>`;
  return s;
}

function derivedMarkup() {
  const S = SP_S, X = spX, Y = spY;
  let s = "";

  // gravel drive (editable: the strip and its turnaround move together)
  s += `<g id="drive-layer" transform="${driveTransform()}">`
    + `<circle cx="0" cy="${PAD_OFF * S}" r="${PAD_R * S}" fill="#e7e2d6" stroke="#b9b1a0" stroke-width="${ss(1)}"/>`
    + `<rect x="${-DRIVE_WID / 2 * S}" y="${-DRIVE_LEN / 2 * S}" width="${DRIVE_WID * S}" height="${DRIVE_LEN * S}" fill="#e7e2d6" stroke="#b9b1a0" stroke-width="${ss(1)}"/>`
    + `</g>`;

  // tree canopies
  for (const t of trees) {
    s += `<g id="tree${t.id}" transform="translate(${X(t.x)} ${Y(t.z)})">`
      + `<circle cx="0" cy="0" r="${6 * t.s * S}" fill="#7c9464" fill-opacity="0.14" stroke="#7c9464" stroke-width="${ss(1)}"/>`
      + `<circle cx="0" cy="0" r="${ss(2)}" fill="#5f7350"/></g>`;
  }

  // well and septic, with the separations the health department enforces
  for (const w of wells) {
    s += `<g id="well${w.id}" transform="translate(${X(w.x)} ${Y(w.z)})">`
      + `<circle cx="0" cy="0" r="${WELL_CLEAR * S}" fill="none" stroke="#6f8fa6" stroke-width="${ss(1.1)}" stroke-dasharray="${dash(7, 6)}" opacity="0.7"/>`
      + `<circle cx="0" cy="0" r="${ss(7)}" fill="#fbfaf6" stroke="#3f5c70" stroke-width="${ss(1.8)}"/>`
      + `<text x="0" y="${ss(3.5)}" text-anchor="middle" font-size="${ss(9)}" font-weight="700" fill="#3f5c70" font-family="${FONT}">W</text></g>`;
  }
  for (const d of drainfields) {
    const hw = DRAIN_W / 2 * S, hd = DRAIN_L / 2 * S;
    s += `<g id="drain${d.id}" transform="translate(${X(d.x)} ${Y(d.z)})">`
      + `<rect x="${-hw}" y="${-hd}" width="${hw * 2}" height="${hd * 2}" fill="#6f8a5c" fill-opacity="0.10" stroke="#6f8a5c" stroke-width="${ss(1.4)}"/>`;
    for (let i = 1; i < 5; i++) {
      s += `<line x1="${-hw}" y1="${-hd + (hd * 2 / 5) * i}" x2="${hw}" y2="${-hd + (hd * 2 / 5) * i}" stroke="#6f8a5c" stroke-width="${ss(0.7)}" stroke-dasharray="${dash(4, 3)}"/>`;
    }
    s += `<text x="0" y="${-hd + ss(12)}" text-anchor="middle" font-size="${ss(8.5)}" font-weight="700" letter-spacing="${ss(0.8)}" fill="#4d6640" font-family="${FONT}">DRAINFIELD</text></g>`;
  }

  // utility core rings + trench runs, measured edge to edge
  for (const it of items) {
    if (!TYPE_BY_ID[it.typeId].core) continue;
    s += `<circle cx="${X(it.x)}" cy="${Y(it.z)}" r="${WET_RADIUS * S}" fill="none" stroke="#7e97a6" stroke-width="${ss(1.2)}" stroke-dasharray="${dash(8, 6)}" opacity="0.55"/>`;
  }
  for (const run of trenchRuns()) {
    s += `<line x1="${X(run.ax)}" y1="${Y(run.az)}" x2="${X(run.bx)}" y2="${Y(run.bz)}" stroke="#5f7a8a" stroke-width="${ss(1.4)}" stroke-dasharray="${dash(5, 5)}" opacity="0.7"/>`;
  }

  // units: decks underneath, then containers, world rotation -> screen rotation
  const drawOrder = [...items].sort((a, b) =>
    (TYPE_BY_ID[a.typeId].deck ? 0 : 1) - (TYPE_BY_ID[b.typeId].deck ? 0 : 1));
  for (const it of drawOrder) {
    s += `<g id="u${it.id}" transform="translate(${X(it.x)} ${Y(it.z)}) rotate(${-it.rot * 90})">${unitPlanGroup(it, detailOn)}</g>`;
  }

  // labels, always upright: a label that rode the unit's rotate() read upside
  // down at rot 2 and sideways at rot 3
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    if (t.deck) continue;
    s += `<g id="ul${it.id}" transform="translate(${X(it.x)} ${Y(it.z)})">${unitLabel(it)}</g>`;
  }

  s += `<g id="sep-layer">${separationMarkup()}</g>`;
  s += `<g id="findings-layer">${findingsMarkup()}</g>`;
  s += `<g id="dim-layer">${dimensionMarkup()}</g>`;
  s += titleBlockMarkup();
  return s;
}

// the unit's name, set across the room, along it, or outside it
function unitLabel(it) {
  const t = TYPE_BY_ID[it.typeId], S = SP_S;
  const label = SHORT_NAME[it.typeId] || t.name;
  const [lhw, lhd] = halfDims(it);
  const nameW = label.length * ss(11) * 0.72;
  const acrossW = lhw * 2 * S * 0.95, alongW = lhd * 2 * S * 0.95;
  const fitsInside = nameW < acrossW;
  const fitsAlong = !fitsInside && lhd > lhw && nameW < alongW;
  const name = (y) => `<text x="0" y="${y}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" letter-spacing="${ss(1.1)}" fill="#23231f" font-family="${FONT}">${esc(label.toUpperCase())}</text>`;
  const area = (y) => `<text x="0" y="${y}" text-anchor="middle" font-size="${ss(9)}" fill="#6b6861" font-family="${FONT}">${t.len * t.wid} SF</text>`;
  if (fitsAlong) return `<g transform="rotate(-90)">${name(-ss(2))}${area(ss(10))}</g>`;
  if (detailOn || !fitsInside) {
    return plate(0, -lhd * S - ss(13), (label.length + 7) * ss(7), ss(15))
      + `<text x="0" y="${-lhd * S - ss(9)}" text-anchor="middle" font-size="${ss(10)}" font-weight="700" letter-spacing="${ss(1.1)}" fill="#23231f" font-family="${FONT}">${esc(label.toUpperCase())} · ${t.len * t.wid} SF</text>`;
  }
  return name(-ss(2)) + area(ss(10));
}

// a paper-coloured knockout, so annotation stops overprinting the drawing
// A drawn triangle at the text's own weight, replacing a font fallback that
// rendered as a hairline outline at 0.75x the cap height beside it.
function warnMark(x, y, size = 10, fill = "#8c3b2e") {
  const r = ss(size) * 0.55;
  return `<path d="M ${x} ${y - r} L ${x + r * 0.95} ${y + r * 0.75} L ${x - r * 0.95} ${y + r * 0.75} Z" fill="none" stroke="${fill}" stroke-width="${ss(1.6)}" stroke-linejoin="round"/>`
    + `<path d="M ${x} ${y - r * 0.25} v ${r * 0.55}" stroke="${fill}" stroke-width="${ss(1.5)}" stroke-linecap="round"/>`
    + `<circle cx="${x}" cy="${y + r * 0.55}" r="${ss(0.8)}" fill="${fill}"/>`;
}

// a drawn warning mark plus its label, centred as one unit
function warnLabel(cx, y, text, size = 10) {
  const tw = text.length * ss(size * 0.64);
  const mark = ss(size) * 1.1;
  const total = tw + mark;
  const mx = cx - total / 2 + mark * 0.5;
  return plate(cx, y - ss(4), total + ss(10), ss(size + 5))
    + warnMark(mx, y - ss(3.2), size)
    + `<text x="${cx - total / 2 + mark}" y="${y}" font-size="${ss(size)}" font-weight="700" letter-spacing="${ss(0.9)}" fill="#8c3b2e" font-family="${FONT}">${esc(text)}</text>`;
}

function plate(cx, cy, w, h) {
  return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${ss(2)}" fill="#fbfaf6" opacity="0.88"/>`;
}

function separationMarkup() {
  const X = spX, Y = spY;
  let s = "";
  for (const p of sepPairs) {
    const b = gapBand(p.a, p.b);
    const mx = b.axis === "x" ? (X(b.x0) + X(b.x1)) / 2 : X((b.x0 + b.x1) / 2);
    const my = b.axis === "x" ? Y((b.z0 + b.z1) / 2) : (Y(b.z0) + Y(b.z1)) / 2;
    const d = dash(FINDING_DASH_A, FINDING_DASH_B);
    if (b.axis === "x") {
      s += `<line x1="${X(b.x0)}" y1="${my}" x2="${X(b.x1)}" y2="${my}" stroke="#c0574a" stroke-width="${ss(2.6)}" stroke-dasharray="${d}"/>`;
    } else {
      s += `<line x1="${mx}" y1="${Y(b.z0)}" x2="${mx}" y2="${Y(b.z1)}" stroke="#c0574a" stroke-width="${ss(2.6)}" stroke-dasharray="${d}"/>`;
    }
    // floor, never round: a diagonal pair at 9.899 ft used to print "10′
    // RATED" beside a remedy telling you to open it to 10 ft
    const shown = Math.max(1, Math.floor(p.gap));
    s += warnLabel(mx, my - ss(6), `${shown}′ RATED`, 11);
  }
  return s;
}

// Setback dimensions to each property line, which is what a plan reviewer
// looks for, plus the compound's overall extent.
function dimensionMarkup() {
  if (!items.length) return "";
  const X = spX, Y = spY;
  const { x0, x1, z0, z1 } = unitExtents();
  const tick = (x, y, dx, dy) => `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
  const label = (x, y, text, rot) => plate(x, y - ss(4), text.length * ss(6.4), ss(14))
    + `<text x="${x}" y="${y}" text-anchor="middle" font-size="${ss(10)}" fill="#23231f" font-family="${FONT}"${rot ? ` transform="rotate(-90 ${x} ${y})"` : ""}>${text}</text>`;
  let s = "";
  const dy = Y(z1) + ss(30);
  s += `<line x1="${X(x0)}" y1="${dy}" x2="${X(x1)}" y2="${dy}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
  s += tick(X(x0), dy, 0, ss(5)) + tick(X(x1), dy, 0, ss(5));
  s += label((X(x0) + X(x1)) / 2, dy - ss(6), `${Math.round(x1 - x0)}′-0″`);
  const dx2 = X(x1) + ss(30);
  s += `<line x1="${dx2}" y1="${Y(z0)}" x2="${dx2}" y2="${Y(z1)}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
  s += tick(dx2, Y(z0), ss(5), 0) + tick(dx2, Y(z1), ss(5), 0);
  s += label(dx2 + ss(9), (Y(z0) + Y(z1)) / 2, `${Math.round(z1 - z0)}′-0″`, true);

  // distance from the compound to each property line
  const edges = [
    { a: [X(x0), Y(z0) - ss(16)], b: [X(-SP_HALF), Y(z0) - ss(16)], v: x0 + SP_HALF, rot: false,
      m: [(X(x0) + X(-SP_HALF)) / 2, Y(z0) - ss(20)] },
    { a: [X(x1), Y(z0) - ss(16)], b: [X(SP_HALF), Y(z0) - ss(16)], v: SP_HALF - x1, rot: false,
      m: [(X(x1) + X(SP_HALF)) / 2, Y(z0) - ss(20)] },
    { a: [X(x0) - ss(16), Y(z0)], b: [X(x0) - ss(16), Y(-SP_HALF)], v: z0 + SP_HALF, rot: true,
      m: [X(x0) - ss(20), (Y(z0) + Y(-SP_HALF)) / 2] },
    { a: [X(x0) - ss(16), Y(z1)], b: [X(x0) - ss(16), Y(SP_HALF)], v: SP_HALF - z1, rot: true,
      m: [X(x0) - ss(20), (Y(z1) + Y(SP_HALF)) / 2] },
  ];
  for (const e of edges) {
    const tight = e.v < setback;
    s += `<line x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" stroke="${tight ? "#8c3b2e" : "#a9a397"}" stroke-width="${ss(0.9)}" stroke-dasharray="${dash(4, 4)}"/>`;
    const txt = `${Math.round(e.v)}′`;
    s += plate(e.m[0], e.m[1] - ss(4), txt.length * ss(7) + ss(6), ss(13));
    s += `<text x="${e.m[0]}" y="${e.m[1]}" text-anchor="middle" font-size="${ss(9)}" font-weight="${tight ? 700 : 400}" fill="${tight ? "#8c3b2e" : "#77746c"}" font-family="${FONT}"${e.rot ? ` transform="rotate(-90 ${e.m[0]} ${e.m[1]})"` : ""}>${txt}</text>`;
  }
  return s;
}

function sheetDefs() {
  return `<defs><marker id="sp-arr" markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#c0574a"/></marker>${HATCH_DEF}</defs>`;
}

function renderSitePlan(opts = {}) {
  rendering = true;
  try {
    updateCompliance();
    // The fit has to settle before anything is emitted: annotation is sized in
    // screen pixels, so building the markup first and zooming afterwards writes
    // every label at the wrong scale.
    const e = unitExtents();
    siteFitBox = items.length
      ? { x0: spX(e.x0) - 30, x1: spX(e.x1) + 40, y0: spY(e.z0) - 30, y1: spY(e.z1) + 45 }
      : { x0: 0, x1: SP_W, y0: 0, y1: SP_H };
    if (!exportScale && (opts.fit || !siteFitted)) { siteFitted = true; siteFitView(); }

    detailOn = exportScale ? true : (detailOn ? sview.k >= detailOut() : sview.k >= detailIn());
    AK = exportScale ? 1 : sview.k;

    const w = Math.round(SP_W), h = Math.round(SP_H);
    document.getElementById("site-svg").innerHTML =
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`
      + `${sheetDefs()}<g id="paper-layer">${paperMarkup()}</g>`
      + `<g id="draw-layer">${derivedMarkup()}</g></svg>`;
    siteApply();
    renderChrome();
  } finally {
    // without this, one throw left the flag set and afterZoom returned early
    // forever, so zooming silently stopped redrawing the sheet
    rendering = false;
  }
}

// Re-emit only the layout-dependent half. One string, so every derived mark —
// rings, trenches, findings, dimensions — moves together with the units.
let derivedPending = false;
function renderDerived() {
  if (mode !== "plan" || exportScale) return;
  const g = document.getElementById("draw-layer");
  if (!g) { renderSitePlan(); return; }
  updateCompliance();
  AK = sview.k;
  g.innerHTML = derivedMarkup();
  renderChrome();
}
// coalesced to one emission per frame, however fast the pointer moves
function scheduleDerived() {
  if (derivedPending) return;
  derivedPending = true;
  requestAnimationFrame(() => { derivedPending = false; renderDerived(); });
}

let siteFitted = false;
let rendering = false;

let siteFitBox = null;

// The floating chrome used to be two magic numbers (118 top, 34 bottom) tuned
// on a desktop, so on a phone the fit ran the drawing under the export pills
// and the add button, where it could not be pressed. Measure what is actually
// on screen instead.
// Chrome that only occupies a corner used to cost the drawing a full-width
// band: on a desktop the bottom-left stats pill and the bottom-right add
// button between them reserved a strip the whole width of the window, and the
// docked info panel was not measured at all. A piece of chrome now gives up
// whichever edge it is actually hugging, so the fit gets a rectangle.
function chromeBand() {
  const box = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    // Chrome that is only faded out still has a box. The details card on a
    // desktop is hidden that way until something is selected, and measuring it
    // anyway cost the drawing the right-hand fifth of the window at all times.
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  const g = 12;
  const band = { top: g, bottom: g, left: g, right: g };
  for (const id of ["topbar", "tabbar"]) {
    const r = box(id);
    if (r) band.top = Math.max(band.top, r.bottom + g);
  }
  const side = (r) => {
    if (r.left > innerWidth - r.right) band.right = Math.max(band.right, innerWidth - r.left + g);
    else band.left = Math.max(band.left, r.right + g);
  };
  for (const id of ["site-actions", "fab", "stats-pill", "toolstrip", "edge-tools", "info"]) {
    const r = box(id);
    if (!r) continue;
    // Anything that runs a good part of the window's height can only be
    // stepped around sideways — giving up rows to it would leave none.
    if (r.height > innerHeight * 0.3) { side(r); continue; }
    // Otherwise take whichever bite is smaller in area: a corner pill costs
    // far less as a narrow side inset than as a strip the whole width of the
    // window, which is what every piece of chrome used to cost.
    const vCost = Math.max(0, innerHeight - r.top + g - band.bottom);
    const nearLeft = r.left < innerWidth - r.right;
    const hCost = Math.max(0, nearLeft ? r.right + g - band.left
                                       : innerWidth - r.left + g - band.right);
    const cornerish = r.width < innerWidth * 0.4
      && (r.right < innerWidth * 0.6 || r.left > innerWidth * 0.4);
    if (cornerish && hCost * innerHeight < vCost * innerWidth) side(r);
    else band.bottom = Math.max(band.bottom, innerHeight - r.top + g);
  }
  return band;
}

// Below this the units stop being touchable — an 8 ft side has to stay near a
// finger's width — so the compound is allowed to overflow and be panned
// rather than shrunk until the drawing is a row of grey slabs. A mouse hits a
// 2 mm target happily, so on a fine pointer the floor is much lower and the
// whole acre can actually fit on screen.
const MIN_FIT_K = FINE_POINTER ? 0.2 : 0.5;
// the zoom-out floor and the fit floor were 0.1 and 0.5, so a fit could not
// reach what the wheel could
const MIN_ZOOM_K = MIN_FIT_K;

// the free rectangle the drawing gets to live in, after the chrome
function sheetViewport() {
  const { top, bottom, left, right } = chromeBand();
  const pad = 8;
  return {
    x: left + pad,
    y: top,
    w: Math.max(160, innerWidth - left - right - pad * 2),
    h: Math.max(120, innerHeight - top - bottom),
  };
}

function siteFitView() {
  if (!siteFitBox) return;
  const { x0, x1, y0, y1 } = siteFitBox;
  const vp = sheetViewport();
  const k = Math.min(
    Math.max(MIN_FIT_K, Math.min(vp.w / (x1 - x0), vp.h / (y1 - y0))),
    2.5);
  sview.k = k;
  fitK = k;
  sview.x = vp.x + (vp.w - k * (x1 - x0)) / 2 - k * x0;
  sview.y = vp.y + (vp.h - k * (y1 - y0)) / 2 - k * y0;
  afterZoom();
}
document.getElementById("site-fit").addEventListener("click", siteFitView);

function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// the exported drawing is the sheet at its own scale, with no editing chrome
// (that lives in a separate overlay) and no trace of the current zoom
function sheetForExport() {
  // Re-emit at 1:1 rather than cloning whatever the screen is showing:
  // annotation is sized in screen pixels now, so a clone would bake in the
  // current zoom and export a different drawing depending on how far you
  // happened to be pinched in.
  const wasDetail = detailOn; // the export forces detail; restoring from that
  exportScale = true;          // forced value flipped the screen's own tier
  renderSitePlan();
  const svg = document.querySelector("#site-svg svg");
  const clone = svg ? svg.cloneNode(true) : null;
  exportScale = false;
  detailOn = wasDetail;
  renderSitePlan();
  if (clone) {
    clone.setAttribute("width", SP_W);
    clone.setAttribute("height", SP_H);
  }
  return clone;
}
document.getElementById("site-svg-dl").addEventListener("click", () => {
  const svg = sheetForExport();
  if (!svg) return;
  downloadBlob("container-compound-site-plan.svg",
    new Blob([svg.outerHTML], { type: "image/svg+xml" }));
});
document.getElementById("site-png").addEventListener("click", () => {
  const svg = sheetForExport();
  if (!svg) return;
  const w = +svg.getAttribute("width"), h = +svg.getAttribute("height");
  const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    const g = c.getContext("2d");
    g.fillStyle = "#e8e5dd";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && downloadBlob("container-compound-site-plan.png", b), "image/png");
  };
  img.src = url;
  toast("Rendering PNG…");
});

// ------------------------------------------------- the plan sheet as editor
//
// Press a unit and drag to move it; press empty paper and drag to pan; wheel
// or pinch to zoom. Nothing is armed, and there is no tool to remember.

const sitePanelEl = document.getElementById("site-panel");
const siteStageEl = document.getElementById("site-stage");
const siteChromeEl = document.getElementById("site-chrome");
const sview = { x: 0, y: 0, k: 1 };
const sitePtrs = new Map();

// Zoom resizes the drawing rather than CSS-scaling it. Scaling the layer
// makes the browser stretch a bitmap, which turns the small drafting text to
// mush exactly when you have zoomed in to read it; giving the SVG its real
// size re-renders the vectors instead. Panning stays a cheap translate.
// the cartouche's scale bar is live: it always spans 20 real feet
function updateCartouche() {
  const el = document.getElementById("cartouche");
  if (!el) return;
  el.style.setProperty("--scale-w", `${Math.round(20 * SP_S * sview.k)}px`);
}

function siteApply() {
  siteStageEl.style.transform = `translate(${sview.x}px, ${sview.y}px)`;
  const w = Math.round(SP_W * sview.k), h = Math.round(SP_H * sview.k);
  for (const svg of siteStageEl.querySelectorAll("svg")) {
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
  }
  updateCartouche();
}
// crossing the detail threshold redraws the sheet at the other fidelity
function afterZoom() {
  siteApply();
  if (rendering) return;
  // Every zoom step changes the annotation scale, so the sheet is re-emitted —
  // coalesced into one frame so a two-finger pinch does not rebuild it twice
  // per frame, once per moving pointer.
  if (!zoomPending) {
    zoomPending = true;
    requestAnimationFrame(() => { zoomPending = false; if (mode === "plan") renderSitePlan(); });
  }
}
let zoomPending = false;
function siteZoomAt(px, py, f) {
  const k2 = Math.min(6, Math.max(MIN_ZOOM_K, sview.k * f));
  f = k2 / sview.k;
  sview.x = px - f * (px - sview.x);
  sview.y = py - f * (py - sview.y);
  sview.k = k2;
  afterZoom();
}
function clientToWorld(cx, cy) {
  return {
    x: spInvX((cx - sview.x) / sview.k),
    z: spInvZ((cy - sview.y) / sview.k),
  };
}
function viewCenterWorld() {
  return clientToWorld(innerWidth / 2, innerHeight / 2);
}

// ---- hit tests, in world feet ----

function unitAtWorld(p) {
  // containers read above decks; later items above earlier ones
  const ordered = [...items].sort(
    (a, b) => (TYPE_BY_ID[a.typeId].deck ? 0 : 1) - (TYPE_BY_ID[b.typeId].deck ? 0 : 1));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const it = ordered[i];
    const [hw, hd] = halfDims(it);
    if (Math.abs(p.x - it.x) <= hw && Math.abs(p.z - it.z) <= hd) return it;
  }
  return null;
}
function treeAtWorld(p) {
  for (let i = trees.length - 1; i >= 0; i--) {
    const t = trees[i];
    if (Math.hypot(p.x - t.x, p.z - t.z) <= 6 * t.s) return t;
  }
  return null;
}
const FIRE_ACCESS = 150; // ft from the drive, IFC D107-ish

// the drive's footprint in world space: the strip plus its turnaround
function driveShapes() {
  const [dx, dz] = DIRS[drive.rot % 4];
  const pc = padCenter();
  return { dx, dz, pc };
}
function overlapsDrive(u) {
  const [hw, hd] = halfDims(u);
  const { dx, dz, pc } = driveShapes();
  // pad: circle against the unit's rectangle
  const cx = Math.max(u.x - hw, Math.min(pc.x, u.x + hw));
  const cz = Math.max(u.z - hd, Math.min(pc.z, u.z + hd));
  if (Math.hypot(pc.x - cx, pc.z - cz) < PAD_R) return true;
  // strip: the unit's centre rotated into the strip's own frame, inflated by
  // the unit's half-extent (an approximation, and a conservative one)
  const rx = u.x - drive.x, rz = u.z - drive.z;
  const lx = rx * dx + rz * dz, lz = -rx * dz + rz * dx;
  return Math.abs(lx) < DRIVE_WID / 2 + Math.min(hw, hd)
      && Math.abs(lz) < DRIVE_LEN / 2 + Math.min(hw, hd);
}
function distanceToDrive(u) {
  const { dx, dz, pc } = driveShapes();
  const rx = u.x - drive.x, rz = u.z - drive.z;
  const lx = rx * dx + rz * dz, lz = -rx * dz + rz * dx;
  const stripD = Math.hypot(
    Math.max(0, Math.abs(lx) - DRIVE_WID / 2),
    Math.max(0, Math.abs(lz) - DRIVE_LEN / 2));
  const padD = Math.max(0, Math.hypot(u.x - pc.x, u.z - pc.z) - PAD_R);
  return Math.min(stripD, padD);
}

function siteObjAt(p) {
  for (const w of wells) if (Math.hypot(p.x - w.x, p.z - w.z) <= 8) return { obj: w, kind: "well" };
  for (const d of drainfields) {
    if (Math.abs(p.x - d.x) <= DRAIN_W / 2 && Math.abs(p.z - d.z) <= DRAIN_L / 2)
      return { obj: d, kind: "drain" };
  }
  return null;
}
function driveAtWorld(p) {
  const pc = padCenter();
  if (Math.hypot(p.x - pc.x, p.z - pc.z) <= PAD_R) return true;
  const [dx, dz] = DIRS[drive.rot % 4];
  const rx = p.x - drive.x, rz = p.z - drive.z;
  const lx = rx * dx + rz * dz;
  const lz = -rx * dz + rz * dx;
  return Math.abs(lx) <= DRIVE_WID / 2 && Math.abs(lz) <= DRIVE_LEN / 2;
}

// Butted units are one structure — the 256 sq ft rule already treats them
// that way — so dragging any member takes the whole cluster with it.
let clusterIndex = new Map();
function clusterOf(root) {
  if (TYPE_BY_ID[root.typeId].deck) return [root];
  // updateCompliance already resolved every cluster with union-find; the
  // flood fill below is the fallback for the rare call before that has run.
  const known = clusterIndex.get(root.id);
  if (known && known.includes(root)) return known;
  const units = items.filter((i) => !TYPE_BY_ID[i.typeId].deck);
  const set = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of units) {
      if (set.has(u)) continue;
      for (const m of set) {
        if (gapBetween(u, m) <= JOIN_EPS) { set.add(u); grew = true; break; }
      }
    }
  }
  return [...set];
}

// ---- snapping ----

const SNAP_FT = 1.8;
let snapGuides = [];

function snapMove(primary, rawX, rawZ, moving) {
  const [hw, hd] = halfDims(primary);
  snapGuides = [];
  let bestX = null, bestZ = null;
  for (const o of items) {
    if (moving.has(o)) continue;
    const [ow, od] = halfDims(o);
    const overlapZ = Math.abs(rawZ - o.z) < hd + od;
    const overlapX = Math.abs(rawX - o.x) < hw + ow;
    const candX = [
      { v: o.x, line: o.x },                    // centrelines align
      { v: o.x - ow + hw, line: o.x - ow },     // near edges flush
      { v: o.x + ow - hw, line: o.x + ow },     // far edges flush
    ];
    if (overlapZ) candX.push({ v: o.x - ow - hw }, { v: o.x + ow + hw }); // butt
    for (const c of candX) {
      const d = Math.abs(c.v - rawX);
      if (d <= SNAP_FT && (!bestX || d < bestX.d)) bestX = { ...c, d };
    }
    const candZ = [
      { v: o.z, line: o.z },
      { v: o.z - od + hd, line: o.z - od },
      { v: o.z + od - hd, line: o.z + od },
    ];
    if (overlapX) candZ.push({ v: o.z - od - hd }, { v: o.z + od + hd });
    for (const c of candZ) {
      const d = Math.abs(c.v - rawZ);
      if (d <= SNAP_FT && (!bestZ || d < bestZ.d)) bestZ = { ...c, d };
    }
  }
  const x = bestX ? bestX.v : Math.round(rawX);
  const z = bestZ ? bestZ.v : Math.round(rawZ);
  if (bestX && bestX.line !== undefined) snapGuides.push({ axis: "x", at: bestX.line });
  if (bestZ && bestZ.line !== undefined) snapGuides.push({ axis: "z", at: bestZ.line });
  return { x, z };
}

// the band of empty ground between two footprints, for dimensions and hatching
function gapBand(a, b) {
  const [aw, ad] = halfDims(a), [bw, bd] = halfDims(b);
  const gx = Math.abs(a.x - b.x) - (aw + bw);
  const gz = Math.abs(a.z - b.z) - (ad + bd);
  if (gx >= gz) {
    const s = Math.sign(b.x - a.x) || 1;
    const e0 = a.x + s * aw, e1 = b.x - s * bw;
    const o0 = Math.max(a.z - ad, b.z - bd), o1 = Math.min(a.z + ad, b.z + bd);
    return {
      axis: "x", gap: Math.max(0, gx), overlap: o1 - o0,
      x0: Math.min(e0, e1), x1: Math.max(e0, e1),
      z0: Math.min(o0, o1), z1: Math.max(o0, o1),
    };
  }
  const s = Math.sign(b.z - a.z) || 1;
  const e0 = a.z + s * ad, e1 = b.z - s * bd;
  const o0 = Math.max(a.x - aw, b.x - bw), o1 = Math.min(a.x + aw, b.x + bw);
  return {
    axis: "z", gap: Math.max(0, gz), overlap: o1 - o0,
    x0: Math.min(o0, o1), x1: Math.max(o0, o1),
    z0: Math.min(e0, e1), z1: Math.max(e0, e1),
  };
}

// ---- the chrome overlay ----
//
// Selection, snap guides, in-flight ghosts, drag dimensions and the code
// redlines all live here, on top of the drawing and out of the export.

let planDrag = null;
let ghost = null; // { type, x, z, rot } while adding by drag

// The code findings — hatched rated-wall gaps, an over-exemption cluster, a
// wet unit stranded from its core. These are NOT editing chrome: they are the
// answer to the permit question, so they live on the drawing and they export.
// Only the live editing marks (halo, guides, ghost, drag dimensions) are
// chrome, and only those are stripped.
function findingsMarkup() {
  const X = spX, Y = spY, S = SP_S;
  const D = () => dash(FINDING_DASH_A, FINDING_DASH_B);
  let s = "";

  // one way of flagging a unit, so every class reads the same
  const flag = (u, text, below = false) => {
    const [hw, hd] = halfDims(u);
    const out = `<rect x="${X(u.x - hw)}" y="${Y(u.z - hd)}" width="${hw * 2 * S}" height="${hd * 2 * S}" fill="none" stroke="#8c3b2e" stroke-width="${ss(2.2)}" stroke-dasharray="${D()}"/>`;
    const y = below ? Y(u.z + hd) + ss(15) : Y(u.z - hd) - ss(8);
    return out + warnLabel(X(u.x), y, text);
  };

  // rated-wall gaps: hatched band between the two footprints
  for (const p of sepPairs) {
    const b = gapBand(p.a, p.b);
    if (b.overlap <= 0) continue;
    s += `<rect x="${X(b.x0)}" y="${Y(b.z0)}" width="${Math.max(1, (b.x1 - b.x0) * S)}" height="${Math.max(1, (b.z1 - b.z0) * S)}" fill="url(#ch-hatch)" stroke="#c0574a" stroke-width="${ss(1)}" stroke-dasharray="${D()}"/>`;
  }

  // a butted cluster past the exemption, where the exemption could apply
  const seen = new Set();
  for (const it of items) {
    const j = joined.get(it.id);
    if (!j || j.sqft <= 256) continue;
    const members = clusterOf(it);
    if (!members.every((m) => TYPE_BY_ID[m.typeId].accessory)) continue;
    const key = members.map((m) => m.id).sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of members) {
      const [hw, hd] = halfDims(m);
      x0 = Math.min(x0, m.x - hw); x1 = Math.max(x1, m.x + hw);
      z0 = Math.min(z0, m.z - hd); z1 = Math.max(z1, m.z + hd);
    }
    s += `<rect x="${X(x0) - ss(6)}" y="${Y(z0) - ss(6)}" width="${(x1 - x0) * S + ss(12)}" height="${(z1 - z0) * S + ss(12)}" fill="none" stroke="#c0574a" stroke-width="${ss(1.8)}" stroke-dasharray="${D()}"/>`;
    s += warnLabel(X((x0 + x1) / 2), Y(z0) - ss(13), `${j.sqft} SF > 256 SF EXEMPTION`);
  }

  // a deck run past the exemption, which the unit-only checks never saw
  const deckSeen = new Set();
  for (const d of deckClusters()) {
    if (d.sqft <= 256) continue;
    const key = d.members.map((m) => m.id).sort().join(",");
    if (deckSeen.has(key)) continue;
    deckSeen.add(key);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of d.members) {
      const [hw, hd] = halfDims(m);
      x0 = Math.min(x0, m.x - hw); x1 = Math.max(x1, m.x + hw);
      z0 = Math.min(z0, m.z - hd); z1 = Math.max(z1, m.z + hd);
    }
    s += `<rect x="${X(x0) - ss(4)}" y="${Y(z0) - ss(4)}" width="${(x1 - x0) * S + ss(8)}" height="${(z1 - z0) * S + ss(8)}" fill="none" stroke="#c0574a" stroke-width="${ss(1.6)}" stroke-dasharray="${D()}"/>`;
    s += warnLabel(X((x0 + x1) / 2), Y(z0) - ss(11), `DECK RUN ${d.sqft} SF > 256 SF`, 9.5);
  }

  const cores = items.filter((i) => TYPE_BY_ID[i.typeId].core);
  const units = items.filter((i) => !TYPE_BY_ID[i.typeId].deck);
  const sb = SP_HALF - setback;

  for (const w of items.filter((i) => TYPE_BY_ID[i.typeId].wet && !TYPE_BY_ID[i.typeId].core)) {
    const near = cores.length
      ? Math.min(...cores.map((c) => Math.hypot(c.x - w.x, c.z - w.z))) : Infinity;
    if (near <= WET_RADIUS) continue;
    const [, hd] = halfDims(w);
    s += warnLabel(X(w.x), Y(w.z + hd) + ss(16),
      cores.length ? `${Math.round(near)}′ TO CORE` : "NO UTILITY CORE");
  }

  // overlapping footprints — a saved or shared layout can still hold these
  for (const [a, b] of overlappingPairs()) {
    for (const u of [a, b]) {
      const [hw, hd] = halfDims(u);
      s += `<rect x="${X(u.x - hw)}" y="${Y(u.z - hd)}" width="${hw * 2 * S}" height="${hd * 2 * S}" fill="url(#ch-hatch)" stroke="#8c3b2e" stroke-width="${ss(2)}"/>`;
    }
    s += warnLabel(X((a.x + b.x) / 2), Y((a.z + b.z) / 2) - ss(4), "UNITS OVERLAP");
  }

  // butted against a door wall
  for (const [a, b] of blockedPairs()) {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    s += `<circle cx="${X(mx)}" cy="${Y(mz)}" r="${ss(11)}" fill="#fbfaf6" stroke="#8c3b2e" stroke-width="${ss(1.8)}"/>`;
    s += warnMark(X(mx), Y(mz), 12);
    const txt = "DOOR WALL BLOCKED";
    s += plate(X(mx), Y(mz) - ss(19), txt.length * ss(6.2), ss(14));
    s += `<text x="${X(mx)}" y="${Y(mz) - ss(15)}" text-anchor="middle" font-size="${ss(9.5)}" font-weight="700" letter-spacing="${ss(0.9)}" fill="#8c3b2e" font-family="${FONT}">${txt}</text>`;
  }

  for (const u of units) {
    const [hw, hd] = halfDims(u);
    const outside = Math.abs(u.x) + hw > SP_HALF || Math.abs(u.z) + hd > SP_HALF;
    if (outside) { s += flag(u, "CROSSES PROPERTY LINE"); continue; }
    if (Math.abs(u.x) + hw > sb || Math.abs(u.z) + hd > sb) s += flag(u, `INSIDE ${setback}′ SETBACK`);
  }
  for (const u of units) if (overlapsDrive(u)) s += flag(u, "ON THE DRIVE", true);
  for (const u of units) {
    if (distanceToDrive(u) <= FIRE_ACCESS) continue;
    s += flag(u, `${Math.round(distanceToDrive(u))}′ FROM THE DRIVE`, true);
  }
  for (const u of units) {
    for (const d of drainfields) {
      const [hw, hd] = halfDims(u);
      if (Math.abs(u.x - d.x) < hw + DRAIN_W / 2 && Math.abs(u.z - d.z) < hd + DRAIN_L / 2) {
        s += flag(u, "OVER THE DRAINFIELD", true);
        break;
      }
    }
  }
  for (const w of wells) {
    for (const d of drainfields) {
      const gap = Math.hypot(w.x - d.x, w.z - d.z);
      if (gap >= WELL_CLEAR) continue;
      s += `<line x1="${X(w.x)}" y1="${Y(w.z)}" x2="${X(d.x)}" y2="${Y(d.z)}" stroke="#8c3b2e" stroke-width="${ss(2)}" stroke-dasharray="${D()}"/>`;
      s += warnLabel(X((w.x + d.x) / 2), Y((w.z + d.z) / 2) - ss(4),
        `${Math.round(gap)}′ WELL TO DRAINFIELD (100′)`, 9.5);
      break;
    }
  }
  return s;
}

// decks chain into runs the unit checks never saw, and the exemption reads
// per structure — twelve butted 8x8s is 768 sq ft of one platform
function deckClusters() {
  const decks = items.filter((i) => TYPE_BY_ID[i.typeId].deck);
  const seen = new Set();
  const out = [];
  for (const d of decks) {
    if (seen.has(d.id)) continue;
    const members = [d];
    seen.add(d.id);
    for (let grew = true; grew; ) {
      grew = false;
      for (const o of decks) {
        if (seen.has(o.id)) continue;
        if (members.some((m) => gapBetween(o, m) <= JOIN_EPS)) {
          members.push(o); seen.add(o.id); grew = true;
        }
      }
    }
    if (members.length < 2) continue;
    out.push({ members, sqft: members.reduce((a, m) =>
      a + TYPE_BY_ID[m.typeId].len * TYPE_BY_ID[m.typeId].wid, 0) });
  }
  return out;
}

const HATCH_DEF = `<pattern id="ch-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <line x1="0" y1="0" x2="0" y2="7" stroke="#c0574a" stroke-width="2" opacity="0.38"/></pattern>`;

function renderChrome() {
  if (mode !== "plan") { siteChromeEl.innerHTML = ""; return; }
  AK = sview.k;
  const X = spX, Y = spY, S = SP_S;
  let s = "";

  // Butted units move as one, so say so while one of them is selected —
  // previously the only cluster outline was a >256 SF violation marker, and
  // a legal cluster moved as a group with nothing on screen to predict it.
  if (selected && !TYPE_BY_ID[selected.typeId].deck) {
    const members = clusterOf(selected);
    if (members.length > 1) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const m of members) {
        const [hw, hd] = halfDims(m);
        x0 = Math.min(x0, m.x - hw); x1 = Math.max(x1, m.x + hw);
        z0 = Math.min(z0, m.z - hd); z1 = Math.max(z1, m.z + hd);
      }
      s += `<rect x="${X(x0) - ss(3)}" y="${Y(z0) - ss(3)}" width="${(x1 - x0) * S + ss(6)}" height="${(z1 - z0) * S + ss(6)}" rx="${ss(2)}" fill="none" stroke="#b3542e" stroke-width="${ss(1.4)}" stroke-dasharray="${dash(3, 3)}" opacity="0.75"/>`;
      s += `<text x="${X((x0 + x1) / 2)}" y="${Y(z0) - ss(9)}" text-anchor="middle" font-size="${ss(9)}" font-weight="700" fill="#b3542e" font-family="${FONT}">${document.body.classList.contains("breaking-out") ? "MOVING ALONE" : `${members.length} JOINED · MOVE TOGETHER`}</text>`;
    }
  }

  // selection halo
  if (selected) {
    const [hw, hd] = halfDims(selected);
    s += `<rect x="${X(selected.x - hw) - ss(5)}" y="${Y(selected.z - hd) - ss(5)}" width="${hw * 2 * S + ss(10)}" height="${hd * 2 * S + ss(10)}" rx="${ss(3)}" fill="none" stroke="#b3542e" stroke-width="${ss(2.4)}"/>`;
  }

  // in-flight: snap guides, then the gaps this move is creating
  if (planDrag && planDrag.moved && planDrag.kind === "unit") {
    s += guidesSVG();
    s += dragDimsSVG(planDrag.primary, new Set(planDrag.members));
  }

  // the unit being dragged out of the drawer
  if (ghost) {
    const hw = (ghost.rot % 2 ? ghost.type.wid : ghost.type.len) / 2;
    const hd = (ghost.rot % 2 ? ghost.type.len : ghost.type.wid) / 2;
    s += `<rect x="${X(ghost.x - hw)}" y="${Y(ghost.z - hd)}" width="${hw * 2 * S}" height="${hd * 2 * S}" fill="#2f6f9e" fill-opacity="0.13" stroke="#2f6f9e" stroke-width="${ss(2)}" stroke-dasharray="${dash(6, 4)}"/>`;
    s += `<text x="${X(ghost.x)}" y="${Y(ghost.z) + ss(4)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" fill="#2f6f9e" font-family="${FONT}">${(SHORT_NAME[ghost.type.id] || ghost.type.name).toUpperCase()}</text>`;
    s += guidesSVG();
  }

  siteChromeEl.innerHTML =
    `<svg width="${SP_W}" height="${SP_H}" viewBox="0 0 ${SP_W} ${SP_H}" xmlns="http://www.w3.org/2000/svg"><defs>${HATCH_DEF}</defs>${s}</svg>`;
  siteApply();
}

// snap guides, weighted so they read at any zoom
function guidesSVG() {
  let s = "";
  for (const g of snapGuides) {
    s += g.axis === "x"
      ? `<line x1="${spX(g.at)}" y1="0" x2="${spX(g.at)}" y2="${SP_H}" stroke="#b3542e" stroke-width="${ss(1.6)}" stroke-dasharray="${dash(9, 6)}" opacity="0.85"/>`
      : `<line x1="0" y1="${spY(g.at)}" x2="${SP_W}" y2="${spY(g.at)}" stroke="#b3542e" stroke-width="${ss(1.6)}" stroke-dasharray="${dash(9, 6)}" opacity="0.85"/>`;
  }
  return s;
}

// Live gap dimensions. The label carries the meaning: a gap in the 1-9 ft
// rated-wall band reads "RATED", because the previous cue was a shift from
// #b3542e to #c0574a — two reds 1.11:1 apart, which nobody can tell apart.
function dragDimsSVG(it, moving) {
  const X = spX, Y = spY;
  let s = "";
  const near = items
    .filter((o) => !moving.has(o) && !TYPE_BY_ID[o.typeId].deck)
    .map((o) => ({ o, gap: gapBetween(it, o) }))
    .filter((e) => e.gap < 30)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);
  for (const { o, gap } of near) {
    const b = gapBand(it, o);
    const danger = gap > JOIN_EPS && gap < SEP_CLEAR;
    const butt = gap <= JOIN_EPS;
    const col = butt ? "#2f7a4f" : danger ? "#8c3b2e" : "#55524c";
    const label = butt ? "BUTT" : danger ? `${Math.round(gap)}′ RATED` : `${Math.round(gap)}′`;
    const w = ss(label.length * 7 + 16), h = ss(17);
    const mx = b.axis === "x" ? (X(b.x0) + X(b.x1)) / 2 : X((b.x0 + b.x1) / 2);
    const my = b.axis === "x" ? Y((b.z0 + b.z1) / 2) : (Y(b.z0) + Y(b.z1)) / 2;
    const wt = ss(danger ? 2.4 : 1.4);
    if (b.axis === "x") {
      s += `<line x1="${X(b.x0)}" y1="${my}" x2="${X(b.x1)}" y2="${my}" stroke="${col}" stroke-width="${wt}"/>`;
      s += `<line x1="${X(b.x0)}" y1="${my - ss(5)}" x2="${X(b.x0)}" y2="${my + ss(5)}" stroke="${col}" stroke-width="${wt}"/>`;
      s += `<line x1="${X(b.x1)}" y1="${my - ss(5)}" x2="${X(b.x1)}" y2="${my + ss(5)}" stroke="${col}" stroke-width="${wt}"/>`;
    } else {
      s += `<line x1="${mx}" y1="${Y(b.z0)}" x2="${mx}" y2="${Y(b.z1)}" stroke="${col}" stroke-width="${wt}"/>`;
      s += `<line x1="${mx - ss(5)}" y1="${Y(b.z0)}" x2="${mx + ss(5)}" y2="${Y(b.z0)}" stroke="${col}" stroke-width="${wt}"/>`;
      s += `<line x1="${mx - ss(5)}" y1="${Y(b.z1)}" x2="${mx + ss(5)}" y2="${Y(b.z1)}" stroke="${col}" stroke-width="${wt}"/>`;
    }
    // sit the chip clear of the band, and of the finger holding the unit
    const oy = my - ss(26);
    s += `<rect x="${mx - w / 2}" y="${oy - h}" width="${w}" height="${h}" rx="${ss(4)}" fill="#fbfaf6" stroke="${col}" stroke-width="${ss(1.2)}"/>`;
    s += danger
      ? warnMark(mx - w / 2 + ss(9), oy - h / 2, 10, col)
        + `<text x="${mx + ss(5)}" y="${oy - h / 2 + ss(4)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" fill="${col}" font-family="${FONT}">${label}</text>`
      : `<text x="${mx}" y="${oy - h / 2 + ss(4)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" fill="${col}" font-family="${FONT}">${label}</text>`;
  }
  return s;
}

const driveTransform = () =>
  `translate(${spX(drive.x)} ${spY(drive.z)}) rotate(${-drive.rot * 90})`;

// ---- pointer handling ----

let sitePanning = false;
let pinching = false;
let lastTap = { t: 0, key: "" };
let breakoutTimer = null;

// A fingertip always jitters, so the threshold is measured from where the
// press began, not from the previous move event, and it is generous on touch.
const SLOP = (e) => (e.pointerType === "touch" ? 10 : 3);

// Held space is the pan modifier every drawing tool has. It used to fall
// through to whatever button had focus, so the key that means "get out of the
// way" instead rotated or deleted something.
let spaceHeld = false;
function setSpaceHeld(on) {
  if (spaceHeld === on) return;
  spaceHeld = on;
  document.body.classList.toggle("space-pan", on);
}
addEventListener("blur", () => setSpaceHeld(false));

function beginUnitDrag(it, p, solo, e) {
  const members = solo ? [it] : clusterOf(it);
  planDrag = {
    kind: "unit", primary: it, members, solo,
    offs: members.map((m) => ({ m, dx: m.x - it.x, dz: m.z - it.z })),
    grabX: it.x - p.x, grabZ: it.z - p.z,
    snapshot: JSON.stringify(serialize()),
    preBlocked: blockedPairs().length,
    preOverlap: overlappingPairs().length,
    moved: false,
    startX: e.clientX, startY: e.clientY, slop: SLOP(e),
  };
}

sitePanelEl.addEventListener("pointerdown", (e) => {
  if (placing && selected) { e.preventDefault(); return; } // handled on release
  // Right and middle button drag the paper, and the right button keeps its
  // context menu. Before this, a right-drag moved whatever was under it and
  // the menu never appeared, so the mouse had no non-destructive drag at all.
  if (e.button === 1 || e.button === 2 || spaceHeld) {
    sitePanelEl.setPointerCapture(e.pointerId);
    sitePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelPlanDrag();
    sitePanning = true;
    return;
  }
  if (e.button !== 0 && e.pointerType === "mouse") return;
  sitePanelEl.setPointerCapture(e.pointerId);
  sitePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (sitePtrs.size > 1) { // a second finger turns the gesture into a pinch
    cancelPlanDrag();
    sitePanning = false;
    pinching = true;
    return;
  }
  const p = clientToWorld(e.clientX, e.clientY);
  pinching = false;
  const it = unitAtWorld(p);
  if (it) {
    beginUnitDrag(it, p, e.altKey, e);
    // held still, a press breaks one unit out of its cluster
    breakoutTimer = setTimeout(() => {
      if (planDrag && planDrag.kind === "unit" && !planDrag.moved && !planDrag.solo
          && planDrag.members.length > 1) {
        document.body.classList.add("breaking-out");
        planDrag.members = [planDrag.primary];
        planDrag.offs = [{ m: planDrag.primary, dx: 0, dz: 0 }];
        planDrag.solo = true;
        toast("Breaking out — this unit moves alone");
      }
    }, 450);
    return;
  }
  const so = siteObjAt(p);
  if (so) {
    planDrag = { kind: "site", obj: so.obj, objKind: so.kind,
                 grabX: so.obj.x - p.x, grabZ: so.obj.z - p.z,
                 snapshot: JSON.stringify(serialize()), moved: false,
                 startX: e.clientX, startY: e.clientY, slop: SLOP(e) };
    return;
  }
  const tr = treeAtWorld(p);
  if (tr) {
    planDrag = { kind: "tree", tree: tr, grabX: tr.x - p.x, grabZ: tr.z - p.z,
                 snapshot: JSON.stringify(serialize()), moved: false,
                 startX: e.clientX, startY: e.clientY, slop: SLOP(e) };
    return;
  }
  if (driveAtWorld(p)) {
    planDrag = { kind: "drive", grabX: drive.x - p.x, grabZ: drive.z - p.z,
                 snapshot: JSON.stringify(serialize()), moved: false,
                 startX: e.clientX, startY: e.clientY, slop: SLOP(e) };
    return;
  }
  sitePanning = true;
});

sitePanelEl.addEventListener("pointermove", (e) => {
  if (!sitePtrs.has(e.pointerId)) {
    if (!planDrag && !sitePanning) hoverCursor(e);
    return;
  }
  const prev = sitePtrs.get(e.pointerId);
  const cur = { x: e.clientX, y: e.clientY };
  sitePtrs.set(e.pointerId, cur);

  if (sitePtrs.size === 2) {
    const other = [...sitePtrs.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (d0 > 0) siteZoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d1 / d0);
    }
    return;
  }

  if (planDrag) {
    if (!planDrag.moved) {
      const travel = Math.hypot(cur.x - planDrag.startX, cur.y - planDrag.startY);
      if (travel > planDrag.slop) clearTimeout(breakoutTimer); // committed to a drag
      if (travel <= planDrag.slop) return;
      planDrag.moved = true;
      pushUndo(planDrag.snapshot); // one undo step per drag
      document.body.classList.add("plan-dragging");
    }
    const p = clientToWorld(cur.x, cur.y);
    if (planDrag.kind === "unit") {
      // read live, so Alt can be taken or released mid-drag rather than only
      // being sampled once when the press landed
      planDrag.free = e.altKey;
      const moving = new Set(planDrag.members);
      const snapped = snapMove(planDrag.primary, p.x + planDrag.grabX, p.z + planDrag.grabZ, moving);
      for (const { m, dx, dz } of planDrag.offs) {
        m.x = clampX(snapped.x + dx);
        m.z = clampZ(snapped.z + dz);
        applyTransform(m);
      }
      scheduleDerived(); // one consistent re-emission per frame
    }
 else if (planDrag.kind === "tree") {
      planDrag.tree.x = clampX(p.x + planDrag.grabX);
      planDrag.tree.z = clampZ(p.z + planDrag.grabZ);
      scheduleDerived();
    } else if (planDrag.kind === "drive") {
      drive.x = clampX(p.x + planDrag.grabX);
      drive.z = clampZ(p.z + planDrag.grabZ);
      scheduleDerived();
    } else if (planDrag.kind === "site") {
      planDrag.obj.x = clampX(p.x + planDrag.grabX);
      planDrag.obj.z = clampZ(p.z + planDrag.grabZ);
      scheduleDerived();
    }
    // scenery has no bearing on the code checks, which only read unit
    // footprints, so a tree move does not need the compliance pass at all
    renderChrome();
    return;
  }

  if (sitePanning) {
    sview.x += cur.x - prev.x;
    sview.y += cur.y - prev.y;
    siteApply();
  }
});

function hoverCursor(e) {
  const p = clientToWorld(e.clientX, e.clientY);
  const over = !!unitAtWorld(p) || !!treeAtWorld(p) || !!siteObjAt(p) || driveAtWorld(p);
  sitePanelEl.classList.toggle("over-object", over);
}

// Drop every in-flight gesture without restoring anything. Used when the
// whole model is about to be replaced, where "restore" is meaningless and
// letting the gesture finish means it finishes against destroyed objects.
function abortGestures() {
  clearTimeout(breakoutTimer);
  planDrag = null;
  sitePanning = false;
  pinching = false;
  ghost = null;
  pendingAdd = null;
  snapGuides = [];
  if (typeof setPlacing === "function") setPlacing(false);
  document.body.classList.remove("plan-dragging", "breaking-out");
}

// Restore the pre-drag state. Selection survives by id, which only works now
// that loadFrom restarts ids from 1 — before, every restore minted fresh ids
// and the lookup could never match.
function restoreSnapshot(snapshot, keepId) {
  loadFrom(JSON.parse(snapshot));
  if (keepId != null) {
    const again = items.find((i) => i.id === keepId);
    if (again) select(again);
  }
}

function cancelPlanDrag() {
  const d = planDrag;
  const keep = selected && selected.id;
  abortGestures();
  if (d && d.moved) {
    restoreSnapshot(d.snapshot, keep);
    undoStack.pop();
    updateHistoryButtons();
  }
}

sitePanelEl.addEventListener("pointerup", (e) => {
  if (placing && selected) {
    const p = clientToWorld(e.clientX, e.clientY);
    setPlacing(false);
    placeSelectedAt(p.x, p.z);
    return;
  }
  sitePtrs.delete(e.pointerId);
  clearTimeout(breakoutTimer);
  const d = planDrag;
  planDrag = null;
  document.body.classList.remove("plan-dragging", "breaking-out");

  // lifting one finger of a pinch hands the gesture back to the other one
  if (sitePtrs.size === 1) { sitePanning = true; return; }
  sitePanning = false;
  const wasPinch = pinching;
  pinching = false;

  if (d && d.moved) {
    snapGuides = [];
    // a drag that travelled but changed nothing is a tap, not an edit
    if (JSON.stringify(serialize()) === d.snapshot) {
      undoStack.pop();
      updateHistoryButtons();
      if (d.kind === "unit") { select(d.primary); renderChrome(); }
      return;
    }
    if (d.kind === "unit" &&
        (blockedPairs().length > d.preBlocked ||
         overlappingPairs().length > d.preOverlap)) {
      const why = blockedPairs().length > d.preBlocked
        ? "That blocks a door wall — butt against solid sides only"
        : "Units cannot overlap — butt them edge to edge instead";
      undoStack.pop();
      updateHistoryButtons();
      restoreSnapshot(d.snapshot, d.primary && d.primary.id);
      toast(why);
      return;
    }
    if (d.kind !== "unit") rebuildScenery();
    save();
    updateStats();
    // the unit you just moved is the one you are working on
    if (d.kind === "unit") select(d.primary);
    else if (selected) select(selected); // refresh separation/plumbing hints
    renderSitePlan();
    return;
  }

  if (!d) { // a press on empty paper clears the selection — but the tail of a
    if (wasPinch) return; // pinch is not a press, and must not deselect
    const p = clientToWorld(e.clientX, e.clientY);
    if (!unitAtWorld(p)) { select(null); renderChrome(); }
    return;
  }

  // a press that did not move is a tap
  const key = d.kind === "unit" ? `u${d.primary.id}`
    : d.kind === "tree" ? `t${d.tree.id}`
    : d.kind === "site" ? `s${d.obj.id}` : "drive";
  const now = Date.now();
  const isDouble = now - lastTap.t < 380 && lastTap.key === key;
  lastTap = { t: now, key };

  if (d.kind === "unit") {
    // Clicking the unit you already have selected used to deselect it, so the
    // second click of a double-click threw away what the first had chosen.
    // Selecting stays selecting; Esc, the deselect button and empty paper are
    // the ways out. A double-click opens the floor plan, which is the thing
    // you would want a second look at.
    select(d.primary);
    renderChrome();
    // a deck has no interior to draw, so there is nothing to open
    if (isDouble && !TYPE_BY_ID[d.primary.typeId].deck) openPlan(TYPE_BY_ID[d.primary.typeId]);
  } else if (d.kind === "site" && isDouble) {
    pushUndo();
    if (d.objKind === "well") wells = wells.filter((w) => w !== d.obj);
    else drainfields = drainfields.filter((x) => x !== d.obj);
    rebuildScenery();
    updateStats();
    save();
    renderSitePlan();
    toast(`${d.objKind === "well" ? "Well" : "Drainfield"} removed — ↩ to undo`);
  } else if (d.kind === "site") {
    toast(FINE_POINTER ? "Drag to move · double-click to remove" : "Drag to move · double-tap to remove");
  } else if (d.kind === "tree" && isDouble) {
    pushUndo();
    trees = trees.filter((t) => t !== d.tree);
    rebuildScenery();
    updateStats();
    save();
    renderSitePlan();
    toast("Tree removed — ↩ to undo");
  } else if (d.kind === "drive" && isDouble) {
    pushUndo();
    drive.rot = (drive.rot + 1) % 4;
    rebuildScenery();
    save();
    renderSitePlan();
    toast("Drive rotated 90°");
  } else if (d.kind === "tree") {
    toast(FINE_POINTER ? "Drag to move · double-click to remove" : "Drag to move · double-tap to remove");
  } else {
    toast(FINE_POINTER ? "Drag to re-route · double-click to rotate" : "Drag to re-route · double-tap to rotate");
  }
});

const sitePtrEnd = (e) => {
  sitePtrs.delete(e.pointerId);
  cancelPlanDrag();
  sitePanning = false;
};
sitePanelEl.addEventListener("pointercancel", sitePtrEnd);

// Firefox reports wheel deltas in lines (deltaMode 1) and page-ups in pages
// (2), where every other browser reports pixels, so the same flick zoomed
// about 35x less there. Convert to pixels first.
const WHEEL_PX = [1, 16, 100];
sitePanelEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const dy = e.deltaY * (WHEEL_PX[e.deltaMode] || 1);
  siteZoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0018));
}, { passive: false });

// ---- adding by dragging out of the drawer ----

addEventListener("pointermove", (e) => {
  if (!pendingAdd) return;
  if (!pendingAdd.armed) {
    if (Math.hypot(e.clientX - pendingAdd.from.x, e.clientY - pendingAdd.from.y) < 8) return;
    pendingAdd.armed = true;
    closeAdd();
  }
  const p = clientToWorld(e.clientX, e.clientY);
  const probe = { typeId: pendingAdd.type.id, rot: 0, x: p.x, z: p.z };
  const snapped = pendingAdd.type.deck
    ? { x: Math.round(p.x), z: Math.round(p.z) }
    : snapMove(probe, p.x, p.z, new Set());
  ghost = { type: pendingAdd.type, x: snapped.x, z: snapped.z, rot: 0 };
  renderChrome();
});

// A cancelled pointer is an abort, never "nothing happened" — without this
// the ghost stayed painted and the placement fired on a later, unrelated touch.
addEventListener("pointercancel", () => {
  if (!pendingAdd && !ghost) return;
  pendingAdd = null;
  ghost = null;
  snapGuides = [];
  renderChrome();
});

addEventListener("pointerup", () => {
  if (!pendingAdd) return;
  const pa = pendingAdd;
  pendingAdd = null;
  if (!pa.armed) return; // a plain click; the row's click handler places it
  const g = ghost;
  ghost = null;
  snapGuides = [];
  if (!g) { renderChrome(); return; }
  pushUndo();
  if (pa.type.id.startsWith("__")) {
    placeSiteObject(pa.type.id, clampX(g.x), clampZ(g.z));
    save();
    renderSitePlan();
    return;
  }
  // Relative, like every other path. As an absolute test, one pre-existing
  // illegal butt — reachable from any shared layout — rejected every
  // subsequent drag-add, blaming a unit dropped on empty grass 100 ft away.
  const preBlocked = blockedPairs().length;
  const preOverlap = overlappingPairs().length;
  const item = addItem(pa.type.id, clampX(g.x), clampZ(g.z), 0);
  if (blockedPairs().length > preBlocked || overlappingPairs().length > preOverlap) {
    const why = blockedPairs().length > preBlocked
      ? "That blocks a door wall — butt against solid sides only"
      : "Units cannot overlap — butt them edge to edge instead";
    removeItem(item, { silent: true });
    undoStack.pop();
    updateHistoryButtons();
    toast(why);
  } else select(item);
  renderSitePlan();
});

// ------------------------------------------------------------- floor plans


function planSVG(t) {
  const S = 22, M = 46; // px per foot, margin
  const L = t.len, W = t.wid;
  // the outswing needs its own room, or the leaf is clipped by the viewBox
  const SW = 3.4 * S;
  const width = L * S + M * 2 + SW * 2, height = W * S + M * 2;
  const X = (x) => SW + M + (x + L / 2) * S;
  const Y = (z) => M + (z + W / 2) * S;
  let s = "";

  // steel shell + finished interior (spray foam line)
  s += `<rect x="${X(-L / 2)}" y="${Y(-W / 2)}" width="${L * S}" height="${W * S}" fill="#f7f5f1" stroke="#2b2b28" stroke-width="3"/>`;
  s += `<rect x="${X(-L / 2 + 0.55)}" y="${Y(-W / 2 + 0.42)}" width="${(L - 1.1) * S}" height="${(W - 0.84) * S}" fill="none" stroke="#b8b2a6" stroke-width="1.5" stroke-dasharray="6 5"/>`;

  // glazed apertures, entry door leaf + outswing, egress arrow
  const ends = t.variant === "tunnel" ? [1, -1] : [1];
  for (const e of ends) {
    const gx = X(e * (L / 2 - 0.5));
    s += `<line x1="${gx}" y1="${Y(-W / 2 + 0.5)}" x2="${gx}" y2="${Y(W / 2 - 0.5)}" stroke="#5aa9e6" stroke-width="4"/>`;
    const hx = X(e * L / 2), hy = Y(-3.1), dw = 3 * S;
    s += `<line x1="${hx}" y1="${hy}" x2="${hx + e * dw}" y2="${hy}" stroke="#4f4a42" stroke-width="3" stroke-linecap="round"/>`;
    s += `<path d="M ${hx + e * dw} ${hy} A ${dw} ${dw} 0 0 ${e === 1 ? 1 : 0} ${hx} ${Y(-0.1)}" fill="none" stroke="#4f4a42" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>`;
    s += `<line x1="${X(e * (L / 2 - 3.4))}" y1="${Y(-1.6)}" x2="${X(e * (L / 2 + 1.5))}" y2="${Y(-1.6)}" stroke="#c0574a" stroke-width="2" marker-end="url(#arr)"/>`;
  }
  if (t.variant === "openside") {
    s += `<line x1="${X(-L / 2 + 0.9)}" y1="${Y(W / 2 - 0.35)}" x2="${X(L / 2 - 0.9)}" y2="${Y(W / 2 - 0.35)}" stroke="#5aa9e6" stroke-width="4"/>`;
  }

  // furniture with labels
  const labels = PLAN_LABELS[t.id] || [];
  t.furniture.forEach((f, i) => {
    s += `<rect x="${X(f.x - f.w / 2)}" y="${Y(f.z - f.d / 2)}" width="${f.w * S}" height="${f.d * S}" rx="3" fill="#${f.color.toString(16).padStart(6, "0")}" stroke="rgba(0,0,0,0.28)"/>`;
    if (labels[i] && f.w * S > 34) {
      s += `<text x="${X(f.x)}" y="${Y(f.z) + 3.5}" text-anchor="middle" font-size="10.5" fill="#2b2b28" font-family="ui-sans-serif, system-ui">${labels[i]}</text>`;
    }
  });

  // dimension lines
  const tick = (x, y, dx, dy) => `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" stroke="#77746c" stroke-width="1.2"/>`;
  const dyH = Y(W / 2) + 22;
  s += `<line x1="${X(-L / 2)}" y1="${dyH}" x2="${X(L / 2)}" y2="${dyH}" stroke="#77746c" stroke-width="1.2"/>`;
  s += tick(X(-L / 2), dyH, 0, 5) + tick(X(L / 2), dyH, 0, 5);
  s += `<text x="${X(0)}" y="${dyH - 6}" text-anchor="middle" font-size="12" fill="#2b2b28" font-family="ui-sans-serif, system-ui">${L}′0″</text>`;
  const dxV = X(L / 2) + 22;
  s += `<line x1="${dxV}" y1="${Y(-W / 2)}" x2="${dxV}" y2="${Y(W / 2)}" stroke="#77746c" stroke-width="1.2"/>`;
  s += tick(dxV, Y(-W / 2), 5, 0) + tick(dxV, Y(W / 2), 5, 0);
  s += `<text x="${dxV + 6}" y="${Y(0)}" text-anchor="middle" font-size="12" fill="#2b2b28" font-family="ui-sans-serif, system-ui" transform="rotate(90 ${dxV + 6} ${Y(0)})">${W}′0″</text>`;
  s += `<text x="${X(0)}" y="${Y(-W / 2) - 10}" text-anchor="middle" font-size="11" fill="#77746c" font-family="ui-sans-serif, system-ui">interior ≈ 7′2″ wide × ${t.len === 20 ? "18′10″" : "8′10″"} after spray foam</text>`;

  return `<svg viewBox="0 0 ${width} ${height + 8}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#c0574a"/></marker></defs>
    ${s}</svg>`;
}

function openPlan(t) {
  document.getElementById("plan-title").textContent = `${t.name} — floor plan`;
  document.getElementById("plan-sub").textContent =
    `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · glazed apertures in blue · egress in red · dashed line is the finished interior`;
  document.getElementById("plan-svg").innerHTML = planSVG(t);
  openDialog(document.getElementById("plan-modal"));
}
document.getElementById("btn-plan").addEventListener("click", () => {
  if (selected) openPlan(TYPE_BY_ID[selected.typeId]);
});
document.getElementById("plan-close").addEventListener("click", () =>
  closeDialog(document.getElementById("plan-modal")));

// ---- zoom buttons: pinch was the only way in, and it is undiscoverable ----

// A 1.6x step overshot what you were looking at, and it was taken about the
// centre of the window — which on a desktop is not the centre of the paper,
// because the docked panel and the chrome sit on top of it.
const zoomBy = (f) => {
  const vp = sheetViewport();
  siteZoomAt(vp.x + vp.w / 2, vp.y + vp.h / 2, f);
};
document.getElementById("site-zoom-in").addEventListener("click", () => zoomBy(1.25));
document.getElementById("site-zoom-out").addEventListener("click", () => zoomBy(1 / 1.25));

// ---- moving a unit without a drag ----------------------------------------
//
// Dragging was the only way to reposition anything, which locks out keyboard,
// switch and voice control (WCAG 2.2 SC 2.5.7). Arrow keys nudge, and the
// Move button — which until now was a permanently-highlighted control with no
// listener at all — arms a tap-to-place.

let placing = false;
const toolMove = document.getElementById("tool-move");
function setPlacing(on) {
  placing = on && !!selected;
  toolMove.classList.toggle("active", placing);
  toolMove.setAttribute("aria-pressed", String(placing));
  document.body.classList.toggle("placing", placing);
}
toolMove.addEventListener("click", () => {
  if (!selected) return;
  setPlacing(!placing);
  toast(placing ? (FINE_POINTER ? "Click the plan to place this unit" : "Tap the plan to place this unit") : "Place mode off");
});

// move the selected unit (and anything butted to it) so its centre lands at x,z
function placeSelectedAt(x, z) {
  if (!selected) return;
  const anchor = selected;
  const members = clusterOf(anchor);
  const moving = new Set(members);
  const offs = members.map((m) => ({ m, dx: m.x - anchor.x, dz: m.z - anchor.z }));
  const before = JSON.stringify(serialize());
  tryEdit(() => {
    const snapped = snapMove(anchor, x, z, moving);
    for (const { m, dx, dz } of offs) {
      m.x = clampX(snapped.x + dx); m.z = clampZ(snapped.z + dz);
      applyTransform(m);
    }
    snapGuides = [];
  });
  // a tap that lands the unit exactly where it already was is not an edit
  if (JSON.stringify(serialize()) === before && undoStack[undoStack.length - 1] === before) {
    undoStack.pop();
    updateHistoryButtons();
  }
}

function nudgeSelected(dx, dz) {
  if (!selected || mode !== "plan" || anyOpenDialog()) return;
  const members = clusterOf(selected);
  tryEdit(() => {
    for (const m of members) {
      m.x = clampX(m.x + dx); m.z = clampZ(m.z + dz);
      applyTransform(m);
    }
  });
}

// ---- dialogs -------------------------------------------------------------
//
// None of the three was a dialog: focus never moved into them, Escape did not
// close them, a backdrop tap did not either, and the whole page stayed
// tabbable behind.

let dialogReturn = null;
function openDialog(el) {
  const already = anyOpenDialog();
  if (already && already !== el) already.classList.remove("open");
  else dialogReturn = document.activeElement;
  el.classList.add("open");
  const first = el.querySelector("button, [href], input");
  if (first) first.focus();
}
function closeDialog(el) {
  el.classList.remove("open");
  if (dialogReturn && dialogReturn.focus) dialogReturn.focus();
  dialogReturn = null;
}
function anyOpenDialog() {
  return ["parts-modal", "plan-modal", "va-modal", "key-modal"]
    .map((id) => document.getElementById(id))
    .find((el) => el.classList.contains("open"));
}
for (const id of ["parts-modal", "plan-modal", "va-modal", "key-modal"]) {
  const el = document.getElementById(id);
  el.addEventListener("pointerdown", (e) => { if (e.target === el) closeDialog(el); });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...el.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// ---- clearing the acre ---------------------------------------------------

document.getElementById("btn-clear").addEventListener("click", () => {
  document.body.classList.remove("menu-open");
  if (!confirm("Clear every unit from the acre?")) return;
  pushUndo();
  history.replaceState(null, "", location.pathname);
  loadFrom({ v: 2, items: [], trees: trees.map((t) => [t.x, t.z, t.s]),
             drive: [drive.x, drive.z, drive.rot] }, { refit: true });
  toast("Acre cleared — ↩ to undo");
});

// ------------------------------------------------------------------- boot

function hashLayout() {
  return location.hash.startsWith("#d=") ? decodeShare(location.hash.slice(3)) : null;
}

function showShared(data) {
  visiting = true;
  document.body.classList.add("visiting");
  loadFrom(data, { noSave: true, refit: true });
}

function init() {
  const hashData = hashLayout();
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch {}
  // A saved-but-empty acre is not the same as a first visit. Keying off
  // items.length silently threw away a cleared layout on every reload.
  const seeded = stored && typeof stored.v === "number" && Array.isArray(stored.items);
  if (hashData) showShared(hashData);
  else loadFrom(seeded ? stored : EXAMPLE, { refit: true });
}

// A throw in here used to decapitate the module — the boot was a bare
// statement, so everything below it, including the resize listener and the
// render loop, never ran, and the blank result reloaded blank forever.
try {
  init();
} catch (err) {
  console.error("Could not read the saved layout", err);
  try { localStorage.removeItem(LS_KEY); } catch {}
  history.replaceState(null, "", location.pathname);
  loadFrom(EXAMPLE, { refit: true });
  setTimeout(() => toast("That layout could not be read — showing the example"), 900);
}

// Pasting a link into an already-open tab did nothing: the hash was read once.
addEventListener("hashchange", () => {
  const data = hashLayout();
  if (data) showShared(data);
});

document.getElementById("visit-keep").addEventListener("click", () => {
  save();
  toast("Saved to this browser");
});

let resizeTimer = null;
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  // The plan used to ignore resizing entirely — the one event that only
  // happens on a desktop. Snap a window or plug in a monitor and the drawing
  // kept a transform framed for the old viewport.
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (mode === "plan") renderSitePlan({ fit: true });
  }, 120);
});

// The one teaching moment: spend it on what is not already obvious. Things
// drawn on a plan already look draggable; pinch and the add button do not.
setTimeout(() => toast(FINE_POINTER
  ? "Drag to move · scroll to zoom · + to add"
  : "Drag to move · pinch to zoom · + to add"), 700);

const clock = new THREE.Clock();
const needle = document.getElementById("needle");
let lastAzimuth = null;

// The plan sheet covers the canvas completely, so rendering behind it is pure
// battery and heat — and it costs enough main thread to starve the editor in
// front of it, which is what made double-tap on the sheet unreachable.
let looping = false;
function startLoop() {
  if (looping || mode !== "view" || document.hidden) return;
  looping = true;
  clock.getDelta(); // drop the time spent stopped
  requestAnimationFrame(animate);
}
function stopLoop() { looping = false; }
document.addEventListener("visibilitychange", () =>
  document.hidden ? stopLoop() : startLoop());

function animate() {
  if (!looping) return;
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const az = controls.getAzimuthalAngle();
  if (az !== lastAzimuth) {
    needle.style.transform = `rotate(${az}rad)`;
    lastAzimuth = az;
  }
  // peek: lift the roof and fade the walls, per unit or across the compound
  for (const it of items) {
    // toggle on opens every unit; off, selecting one still peeks that one
    const target = dollhouseOn || it === selected ? 1 : 0;
    if (Math.abs(it.peek - target) > 0.001) {
      it.peek += (target - it.peek) * Math.min(1, dt * 7);
      shadowDirty = true;
      const ud = it.group.userData;
      if (ud.roof) {
        ud.roof.position.y = it.peek * 8;
        // Fade the roof as it rises instead of switching it off midair at
        // 0.98, which used to make it wink out 6.9 ft up and fully solid. It
        // settles at a ghost rather than nothing, so the lid still reads as
        // parked above the box it came off.
        if (ud.roofMat) ud.roofMat.opacity = 1 - it.peek * 0.78;
      }
    }
  }
  if (shadowDirty) { sun.shadow.needsUpdate = true; shadowDirty = false; }
  controls.update();
  renderer.render(scene, camera);
}
startLoop();
