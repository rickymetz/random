// Container Compound — compose a tiny-home compound from purpose-built
// shipping-container units on a rural Virginia acre. World units are feet.

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

// ---------------------------------------------------------------- unit data

const WALL_T = 0.35; // container wall thickness for rendering
const H = 9.5; // high cube exterior height
const WET_RADIUS = 30; // advisory short-plumbing-run radius around the utility core, ft
const SEP_CLEAR = 10; // gap giving both units >=5 ft to the imaginary line (VRC R302.1)
const JOIN_EPS = 0.75; // gaps at or under this read as butted/joined
const TRENCH_PER_FT = 40; // ballpark $/ft for a utility trench with supply + drain

// Furniture pieces are boxes in unit-local feet, centered at the unit origin,
// x along the container length, z across the 8' width. y is the base height.
const TYPES = [
  {
    id: "sleeping", name: "Sleeping unit", len: 20, wid: 8, color: 0x96a48e,
    cost: 29000, variant: "tunnel", hvac: "minisplit",
    desc: "Queen bed, wardrobe and a reading bench. Tunnel container: glazed door-walls at both ends give two exits and cross-ventilation.",
    va: "Both egress paths are outswing glazed doors inside factory apertures (VRC R310) — zero cuts.",
    furniture: [
      { x: -5.8, z: 0, w: 6.6, d: 5.2, h: 2.0, color: 0xd9cfc0 },        // bed
      { x: -9.2, z: -3.0, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },     // nightstand
      { x: -9.2, z: 3.0, w: 1.4, d: 1.6, h: 2.0, color: 0x9c7c58 },      // nightstand
      { x: 7.5, z: -2.4, w: 4.0, d: 2.2, h: 6.6, color: 0x8a6f4f },      // wardrobe
      { x: 5.5, z: 2.9, w: 6.0, d: 1.6, h: 1.5, color: 0xb08d63 },       // bench
    ],
  },
  {
    id: "kitchen", name: "Kitchen unit", len: 20, wid: 8, color: 0xc9ac7f,
    cost: 38000, variant: "standard", wet: true, hvac: "minisplit",
    desc: "Full galley run with range and sink, tall fridge, pantry and a small eat-at counter. Supply and drains rise through the floor.",
    va: "Plumbing, gas and electrical need trade permits even under 256 sq ft.",
    furniture: [
      { x: -1.5, z: -2.9, w: 15.0, d: 2.2, h: 3.0, color: 0xdad2c4 },    // counter run
      { x: 8.4, z: -2.6, w: 2.6, d: 2.7, h: 6.6, color: 0xb9b3a7 },      // fridge
      { x: -8.4, z: -2.6, w: 2.6, d: 2.7, h: 6.6, color: 0x8a6f4f },     // pantry
      { x: 1.5, z: 2.4, w: 6.0, d: 2.2, h: 3.1, color: 0x9c7c58 },       // island / eat-at
    ],
  },
  {
    id: "bathhouse", name: "Bathhouse unit", len: 20, wid: 8, color: 0x7e97a6,
    cost: 37000, variant: "tunnel", wet: true, hvac: "panel",
    desc: "Two shower stalls, a soaking tub and a changing bench. Tunnel container so steam vents straight through with both door-walls open.",
    va: "Wet unit: plumbing permits and inspections apply; vented per VRC.",
    furniture: [
      { x: -8.2, z: -2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower 1
      { x: -8.2, z: 2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },      // shower 2
      { x: 3.0, z: -2.5, w: 6.0, d: 2.8, h: 2.0, color: 0xe8e4da },      // soaking tub
      { x: 4.0, z: 2.8, w: 7.0, d: 1.6, h: 1.5, color: 0xb08d63 },       // bench
    ],
  },
  {
    id: "bath-laundry", name: "Bath + laundry unit", len: 20, wid: 8, color: 0xa092a8,
    cost: 34000, variant: "standard", wet: true, hvac: "panel",
    desc: "Full bath on one end, washer-dryer pair and folding counter on the other. All water through the floor.",
    va: "Wet unit: plumbing and electrical permits apply.",
    furniture: [
      { x: -8.2, z: -2.2, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: -8.6, z: 2.6, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },      // toilet
      { x: -4.6, z: -2.8, w: 3.2, d: 1.8, h: 3.0, color: 0xdad2c4 },     // vanity
      { x: 6.0, z: -2.7, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // washer
      { x: 8.6, z: -2.7, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },      // dryer
      { x: 6.5, z: 2.8, w: 6.0, d: 1.8, h: 3.0, color: 0x9c7c58 },       // folding counter
    ],
  },
  {
    id: "dining", name: "Dining unit", len: 20, wid: 8, color: 0xb78d7b,
    cost: 24000, variant: "openside", hvac: "minisplit",
    desc: "A table for eight and a sideboard. Open-side container: the factory side doors become a full glazed wall that spills onto a deck.",
    va: "Unplumbed gathering space — simplest permit path of the set.",
    furniture: [
      { x: 0, z: 0, w: 9.0, d: 3.4, h: 2.5, color: 0x9c7c58 },           // table
      { x: -3.4, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 0, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 3.4, z: 2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: -3.4, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 0, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 3.4, z: -2.6, w: 1.5, d: 1.5, h: 1.5, color: 0xd9cfc0 },
      { x: 8.6, z: 0, w: 1.8, d: 5.0, h: 3.0, color: 0x8a6f4f },         // sideboard
    ],
  },
  {
    id: "living", name: "Living unit", len: 20, wid: 8, color: 0xa5a184,
    cost: 26000, variant: "openside", hvac: "minisplit",
    desc: "Deep sofa, media wall and a small wood stove behind an open-side glazed wall — the den.",
    va: "Solid-fuel stove needs mechanical permit + clearances (VRC ch. 10); flue uses the factory vent position, not a new roof cut.",
    furniture: [
      { x: -3.0, z: -2.3, w: 7.5, d: 3.0, h: 2.2, color: 0xd9cfc0 },     // sofa
      { x: -3.0, z: 1.6, w: 4.0, d: 2.0, h: 1.4, color: 0x9c7c58 },      // coffee table
      { x: 4.5, z: 2.8, w: 6.0, d: 1.5, h: 2.0, color: 0x8a6f4f },       // media console
      { x: 8.5, z: -2.6, w: 1.8, d: 1.8, h: 4.0, color: 0x4a4a48 },      // wood stove
    ],
  },
  {
    id: "bathroom", name: "Bathroom unit", len: 10, wid: 8, color: 0x8fa0ad,
    cost: 17000, variant: "standard", wet: true, hvac: "panel",
    desc: "Compact three-fixture bath in a mini: shower, toilet, vanity. Drains drop straight through the floor.",
    va: "Wet unit: plumbing permits apply. 80 sq ft, one story.",
    furniture: [
      { x: -3.0, z: -1.9, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: 3.4, z: -2.4, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },      // toilet
      { x: 2.6, z: 2.7, w: 3.4, d: 1.8, h: 3.0, color: 0xdad2c4 },       // vanity
    ],
  },
  {
    id: "laundry", name: "Laundry / utility unit", len: 10, wid: 8, color: 0xb0a08d,
    cost: 15000, variant: "standard", hvac: "panel", core: true,
    desc: "Washer, dryer, water heater and the compound's mechanical closet — the utility core. Wet units want to sit inside its ring.",
    va: "Houses water heater + panel; trade permits apply.",
    furniture: [
      { x: -3.2, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // washer
      { x: -0.6, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // dryer
      { x: 3.4, z: -2.3, w: 2.0, d: 2.0, h: 5.0, color: 0xbdb8ae },      // water heater
      { x: 0.5, z: 2.8, w: 7.0, d: 1.4, h: 6.0, color: 0x8a6f4f },       // shelving
    ],
  },
  {
    id: "office", name: "Office / studio unit", len: 20, wid: 8, color: 0x8fa695,
    cost: 24000, variant: "standard", hvac: "minisplit",
    desc: "Desk facing the glazed door-wall, a bookshelf wall and a reading corner. Sized up to a 20' box to clear the habitable-room minimum.",
    va: "Habitable space: ~131 sq ft interior clears VRC R304.1's 70 sq ft minimum.",
    furniture: [
      { x: 6.2, z: 0, w: 2.5, d: 5.5, h: 2.5, color: 0x9c7c58 },         // desk facing the glazed end
      { x: 3.8, z: 0, w: 1.7, d: 1.7, h: 1.6, color: 0x6b6b66 },         // chair
      { x: -2.0, z: -2.9, w: 9.0, d: 1.3, h: 6.6, color: 0x8a6f4f },     // bookshelf wall
      { x: -6.5, z: 2.3, w: 2.6, d: 2.6, h: 2.0, color: 0xd9cfc0 },      // reading chair
      { x: -8.8, z: -1.0, w: 1.6, d: 2.2, h: 3.0, color: 0x9c7c58 },     // cabinet
    ],
  },
  {
    id: "hobby", name: "Hobby / storage unit", len: 10, wid: 8, color: 0x8d919c,
    cost: 12000, variant: "standard", hvac: "none",
    desc: "Workbench, deep shelving and gear storage in a mini — deliberately non-habitable, so the small interior is fine by code.",
    va: "Not habitable space, so VRC R304's 70 sq ft / 7 ft minimums don't apply.",
    furniture: [
      { x: -2.6, z: -2.6, w: 3.6, d: 2.2, h: 3.0, color: 0x9c7c58 },     // workbench
      { x: 2.6, z: -2.7, w: 3.4, d: 1.4, h: 6.0, color: 0x8a6f4f },      // shelving
      { x: 0.6, z: 2.6, w: 5.5, d: 1.6, h: 2.2, color: 0xbdb8ae },       // bins
    ],
  },
  {
    id: "deck", name: "Deck section", len: 8, wid: 8, color: 0xb78e5f,
    cost: 1200, deck: true,
    desc: "8×8 ground-level wood platform. Chain them to link units into one compound.",
    va: "Decks under 30\" above grade are exempt from permits (VRC R105.2).",
    furniture: [],
  },
];
const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

// ------------------------------------------------------------------- scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde7ee);
scene.fog = new THREE.Fog(0xdde7ee, 320, 620);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 1200);
// portrait phones need to sit further back to frame the compound
if (innerHeight > innerWidth) camera.position.set(115, 95, 170);
else camera.position.set(85, 70, 125);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

scene.add(new THREE.HemisphereLight(0xe8f0f8, 0x8a9a74, 0.85));
// north is -z; the sun arcs east (+x) -> south (+z) -> west (-x)
const SUNS = [
  { name: "Morning", pos: [150, 55, 45], color: 0xffe4bd, intensity: 1.8 },
  { name: "Midday", pos: [25, 170, 95], color: 0xfff3e0, intensity: 2.1 },
  { name: "Evening", pos: [-150, 50, 45], color: 0xffd2a4, intensity: 1.6 },
];
let sunIdx = 1;
const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160;
sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160;
sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0004;
scene.add(sun);

function applySun() {
  const s = SUNS[sunIdx];
  sun.position.set(...s.pos);
  sun.color.set(s.color);
  sun.intensity = s.intensity;
  document.getElementById("btn-sun").textContent = `☀ ${s.name}`;
}
applySun();

// The acre: ~209' square of grass, gravel drive, scattered trees.
const ACRE = 209;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(560, 560),
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

// gravel drive: a strip from the south edge toward the center
const drive = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 96),
  new THREE.MeshLambertMaterial({ color: 0xb6ae9f })
);
drive.rotation.x = -Math.PI / 2;
drive.position.set(52, 0.04, 56);
drive.receiveShadow = true;
scene.add(drive);
const drivePad = new THREE.Mesh(
  new THREE.CircleGeometry(16, 24),
  new THREE.MeshLambertMaterial({ color: 0xb6ae9f })
);
drivePad.rotation.x = -Math.PI / 2;
drivePad.position.set(52, 0.045, 10);
drivePad.receiveShadow = true;
scene.add(drivePad);

function tree(x, z, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5 * s, 0.7 * s, 7 * s, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5c3e })
  );
  trunk.position.y = 3.5 * s;
  trunk.castShadow = true;
  g.add(trunk);
  const tones = [0x5e7d4f, 0x6b8a55, 0x557246];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry((4.6 - i * 0.9) * s, 1),
      new THREE.MeshLambertMaterial({ color: tones[i], flatShading: true })
    );
    puff.position.set((i - 1) * 1.6 * s, (8.5 + i * 2.6) * s, ((i % 2) - 0.5) * 1.8 * s);
    puff.castShadow = true;
    g.add(puff);
  }
  g.position.set(x, 0, z);
  scene.add(g);
}
[
  [-88, -78, 1.5], [-70, -92, 1.1], [-95, -30, 1.2], [-84, 30, 1.6], [-92, 72, 1.0],
  [-60, 88, 1.3], [-10, 94, 1.1], [24, 90, 1.5], [88, 84, 1.2], [94, 40, 1.0],
  [92, -32, 1.4], [80, -80, 1.6], [40, -92, 1.0], [-30, -95, 1.3], [8, -88, 0.9],
].forEach(([x, z, s]) => tree(x, z, s));

// ------------------------------------------------------------ unit meshes

const roofMat = new THREE.MeshLambertMaterial({ color: 0xf5f3ee });
const floorMat = new THREE.MeshLambertMaterial({ color: 0xd8cdbb });
const doorMat = new THREE.MeshLambertMaterial({ color: 0x4f4a42 });
const glassWallMat = new THREE.MeshLambertMaterial({
  color: 0xbcd6e2, transparent: true, opacity: 0.55,
});
const condMat = new THREE.MeshLambertMaterial({ color: 0xd9d9d4 });
const deckMat = new THREE.MeshLambertMaterial({ color: 0xb78e5f });

function buildUnit(type) {
  const g = new THREE.Group();
  g.userData.typeId = type.id;
  const L = type.len, W = type.wid;

  if (type.deck) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, W), deckMat);
    slab.position.y = 0.45;
    slab.castShadow = slab.receiveShadow = true;
    g.add(slab);
    // plank lines
    const lines = new THREE.Group();
    for (let i = 1; i < 8; i++) {
      const li = new THREE.Mesh(
        new THREE.BoxGeometry(L - 0.2, 0.02, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x9c744c })
      );
      li.position.set(0, 0.92, -W / 2 + (W / 8) * i);
      lines.add(li);
    }
    g.add(lines);
    g.userData.pickBox = new THREE.Box3(
      new THREE.Vector3(-L / 2, 0, -W / 2),
      new THREE.Vector3(L / 2, 1, W / 2)
    );
    return g;
  }

  const wallMat = new THREE.MeshLambertMaterial({ color: type.color, transparent: true });
  const leafMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(type.color).multiplyScalar(0.86),
    transparent: true,
  });
  g.userData.wallMats = [wallMat, leafMat];

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
  const ribMat = new THREE.MeshLambertMaterial({ color: type.color, transparent: true });
  g.userData.wallMats.push(ribMat);
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

  // roof group — lifts on peek
  const roofG = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, 0.6, W + 0.3), roofMat);
  roof.position.y = base + wallH + 0.3;
  roof.castShadow = true;
  roofG.add(roof);
  g.add(roofG);
  g.userData.roof = roofG;

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
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xb3542e, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
});
const sepRingMat = new THREE.MeshBasicMaterial({
  color: 0xc0574a, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
});
const sepLineMat = new THREE.LineBasicMaterial({ color: 0xc0574a });
const trenchMat = new THREE.LineDashedMaterial({
  color: 0x5f7a8a, dashSize: 1.6, gapSize: 1.1,
});

// ------------------------------------------------------------------ state

let items = []; // { id, typeId, x, z, rot, group, ring, peek }
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
  item.group.position.set(item.x, 0, item.z);
  item.group.rotation.y = (item.rot * Math.PI) / 2;
}

function removeItem(item) {
  unitRoot.remove(item.group);
  item.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !Array.isArray(o.material)) o.material.dispose();
  });
  items = items.filter((i) => i !== item);
  if (selected === item) select(null);
  save();
  updateStats();
}

function select(item) {
  if (selected) selected.ring.visible = false;
  selected = item;
  document.body.classList.toggle("has-selection", !!item);
  const info = document.getElementById("info");
  if (!item) {
    info.classList.remove("open");
    if (typeof updateSelDims === "function") updateSelDims();
    return;
  }
  item.ring.visible = true;
  const t = TYPE_BY_ID[item.typeId];
  document.getElementById("info-name").textContent = t.name;
  document.getElementById("info-sub").textContent = t.deck
    ? `8' × 8' platform · 64 sq ft deck · ~$${t.cost.toLocaleString()}`
    : `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · ${t.len}' × 8' × 9'6" · ${t.len * t.wid} sq ft · ~$${t.cost.toLocaleString()}`;
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
  const wetEl = document.getElementById("info-wet");
  if (t.wet) {
    const cores = items.filter((i) => i.typeId === "laundry");
    if (!cores.length) {
      wetEl.textContent = "No utility core on site — add a laundry / utility unit to serve water and drains.";
    } else {
      const d = Math.min(...cores.map((c) => Math.hypot(c.x - item.x, c.z - item.z)));
      wetEl.textContent = d <= WET_RADIUS
        ? `✓ ${Math.round(d)} ft to the utility core — short plumbing runs.`
        : `△ ${Math.round(d)} ft to the utility core — expect a long trench.`;
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
      msgs.push(`△ ${Math.max(1, Math.round(p.gap))} ft to the ${TYPE_BY_ID[other.typeId].name.toLowerCase()} — 1–9 ft gaps need rated walls and limit glazing (VRC R302.1). Butt them together or open to 10 ft.`);
    }
    const j = joined.get(item.id);
    if (j && j.sqft > 256) {
      msgs.push(`△ Butted with ${j.count - 1} other unit${j.count > 2 ? "s" : ""}: ${j.sqft} sq ft as one structure — over the 256 sq ft permit exemption.`);
    }
  }
  sepEl.textContent = msgs.join(" ");
  sepEl.style.display = msgs.length ? "block" : "none";
  document.getElementById("btn-plan").style.display = t.deck ? "none" : "block";
  info.classList.add("open");
  updateSelDims();
}

// find an open spot near the center for a newly added unit
function findSpot(type) {
  const step = 4;
  for (let r = 0; r < 26; r++) {
    for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      const x = Math.round((Math.cos(ang) * r * step) / 1) * 1;
      const z = Math.round((Math.sin(ang) * r * step) / 1) * 1;
      if (isFree(x, z, type)) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}
function isFree(x, z, type) {
  const hw = type.len / 2 + 1, hd = type.wid / 2 + 1;
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
  return { v: 1, items: items.map((i) => [i.typeId, i.x, i.z, i.rot]) };
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch {}
}
function loadFrom(data) {
  for (const it of [...items]) removeItem(it);
  items = [];
  select(null);
  if (data && Array.isArray(data.items)) {
    for (const [typeId, x, z, rot] of data.items) {
      if (TYPE_BY_ID[typeId]) addItem(typeId, x, z, rot | 0, { silent: true });
    }
  }
  save();
  updateStats();
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
// walls), and the utility core butts the bath+laundry unit — legal joining,
// 240 sq ft combined, still under the 256 sq ft permit exemption.
const EXAMPLE = {
  v: 1,
  items: [
    ["dining", -16, 14, 0],
    ["kitchen", 16, 14, 0],
    ["deck", 0, 14, 0],
    ["sleeping", -16, -16, 0],
    ["bathhouse", 16, -16, 0],
    ["deck", -4, -1, 0],
    ["deck", 4, -1, 0],
    ["office", -41, -1, 1],
    ["bath-laundry", 41, -1, 3],
    ["laundry", 41, -16, 1],
  ],
};

// --------------------------------------------------------------------- UI

// ---- modes: compose (edit) / dollhouse (inspect) / parts (list) ----
let mode = "compose";
document.body.dataset.mode = "compose";
function setMode(m) {
  if (mode === m) return;
  mode = m;
  document.body.dataset.mode = m;
  for (const b of document.querySelectorAll("#tabbar button"))
    b.classList.toggle("active", b.dataset.mode === m);
  select(null);
  closeAdd();
  clearDragLabels();
  if (m === "parts") renderParts();
}
for (const b of document.querySelectorAll("#tabbar button"))
  b.addEventListener("click", () => setMode(b.dataset.mode));

const addList = document.getElementById("add-list");
const openAdd = () => { select(null); document.body.classList.add("add-open"); };
const closeAdd = () => document.body.classList.remove("add-open");
document.getElementById("fab").addEventListener("click", openAdd);
document.getElementById("add-close").addEventListener("click", closeAdd);
document.getElementById("add-backdrop").addEventListener("click", closeAdd);

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
      ? `8' × 8' platform · 64 sq ft · ~$${(t.cost / 1000).toFixed(1)}k`
      : `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · ${t.len * t.wid} sq ft · ~$${Math.round(t.cost / 1000)}k`;
    const badge = BADGES[t.variant] ? `<span class="badge">${BADGES[t.variant]}</span>` : "";
    row.innerHTML = `<span class="add-chip${t.len === 10 || t.deck ? " mini" : ""}" style="background:#${t.color.toString(16).padStart(6, "0")}"></span>
      <span>
        <div class="add-name">${t.name}${badge}</div>
        <div class="add-meta">${meta}</div>
        <div class="add-desc">${t.desc}</div>
      </span>`;
    row.addEventListener("click", () => {
      pushUndo();
      const spot = findSpot(t);
      const item = addItem(t.id, spot.x, spot.z, 0);
      closeAdd();
      select(item);
    });
    addList.appendChild(row);
  }
}

// ---- undo / redo ----
const undoStack = [];
const redoStack = [];
function updateHistoryButtons() {
  document.getElementById("btn-undo").disabled = !undoStack.length;
  document.getElementById("btn-redo").disabled = !redoStack.length;
}
function pushUndo() {
  undoStack.push(JSON.stringify(serialize()));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0; // a new action invalidates the redo branch
  updateHistoryButtons();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) { toast("Nothing to undo"); return; }
  redoStack.push(JSON.stringify(serialize()));
  loadFrom(JSON.parse(prev));
  updateHistoryButtons();
  toast("Undone");
}
function redo() {
  const next = redoStack.pop();
  if (!next) { toast("Nothing to redo"); return; }
  undoStack.push(JSON.stringify(serialize()));
  loadFrom(JSON.parse(next));
  updateHistoryButtons();
  toast("Redone");
}
document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);

document.getElementById("btn-sun").addEventListener("click", () => {
  sunIdx = (sunIdx + 1) % SUNS.length;
  applySun();
});

document.getElementById("btn-dup").addEventListener("click", () => {
  if (!selected || mode !== "compose") return;
  pushUndo();
  const t = TYPE_BY_ID[selected.typeId];
  const spot = findSpot(t);
  const item = addItem(selected.typeId, spot.x, spot.z, selected.rot);
  select(item);
});

document.getElementById("btn-rotate").addEventListener("click", rotateSelected);
document.getElementById("btn-delete").addEventListener("click", () => {
  if (!selected || mode !== "compose") return;
  pushUndo();
  removeItem(selected);
});
document.getElementById("btn-close").addEventListener("click", () => select(null));
document.getElementById("stats-pill").addEventListener("click", () =>
  document.getElementById("stats-pop").classList.toggle("open"));
document.getElementById("btn-va").addEventListener("click", () =>
  document.getElementById("va-modal").classList.add("open"));
document.getElementById("btn-va-close").addEventListener("click", () =>
  document.getElementById("va-modal").classList.remove("open"));
document.getElementById("btn-reset").addEventListener("click", () => {
  if (confirm("Reset to the example compound?")) {
    pushUndo();
    history.replaceState(null, "", location.pathname);
    loadFrom(EXAMPLE);
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

function rotateSelected() {
  if (!selected || mode !== "compose") return;
  const preBlocked = blockedPairs().length;
  pushUndo();
  selected.rot = (selected.rot + 1) % 4;
  applyTransform(selected);
  if (blockedPairs().length > preBlocked) {
    const snap = undoStack.pop();
    loadFrom(JSON.parse(snap));
    updateHistoryButtons();
    toast("That blocks a door wall — keep apertures clear");
    return;
  }
  save();
  updateStats();
  select(selected); // refresh separation/plumbing hints
}

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
    e.preventDefault(); redo();
  } else if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
  else if (e.key === "r" || e.key === "R") rotateSelected();
  else if ((e.key === "Delete" || e.key === "Backspace") && selected && mode === "compose") {
    e.preventDefault();
    pushUndo();
    removeItem(selected);
  } else if (e.key === "Escape") { closeAdd(); select(null); }
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
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const sqft = members.reduce((s, m) => s + TYPE_BY_ID[m.typeId].len * TYPE_BY_ID[m.typeId].wid, 0);
    for (const m of members) joined.set(m.id, { count: members.length, sqft });
  }

  // utility trenches: each wet unit to its nearest core
  trenchFt = 0;
  const cores = units.filter((u) => TYPE_BY_ID[u.typeId].core);
  if (cores.length) {
    for (const w of units.filter((u) => TYPE_BY_ID[u.typeId].wet)) {
      let best = null, bestD = Infinity;
      for (const c of cores) {
        const d = Math.hypot(c.x - w.x, c.z - w.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      trenchFt += bestD;
      groundLine(w.x, w.z, best.x, best.z, trenchMat, true);
    }
  }
  trenchFt = Math.round(trenchFt);
  trenchCost = trenchFt * TRENCH_PER_FT;
}

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
  document.getElementById("st-sqft").textContent = `${sqft.toLocaleString()} sq ft`;
  document.getElementById("st-deck").textContent = `${deckSqft.toLocaleString()} sq ft`;
  document.getElementById("st-trench").textContent = trenchFt
    ? `${trenchFt} ft · $${trenchCost.toLocaleString()}` : "—";
  document.getElementById("st-cost").textContent = `$${cost.toLocaleString()}`;
  document.getElementById("stats-pill").textContent =
    `${hc20 + hc10} units · ${(sqft + deckSqft).toLocaleString()} ft² · ~$${Math.round(cost / 1000)}k` +
    (sepPairs.length ? ` · △${sepPairs.length}` : "");
}

// ------------------------------------------------- CAD-style dimension labels

const labelCache = new Map();
function dimSprite(text, danger) {
  const key = text + (danger ? "!" : "");
  let proto = labelCache.get(key);
  if (!proto) {
    const c = document.createElement("canvas");
    const measure = c.getContext("2d");
    measure.font = "600 34px ui-sans-serif, system-ui, sans-serif";
    const w = Math.ceil(measure.measureText(text).width) + 30;
    c.width = w;
    c.height = 54;
    const g = c.getContext("2d");
    g.fillStyle = danger ? "rgba(192, 87, 74, 0.92)" : "rgba(43, 43, 40, 0.85)";
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

const dragLabelGroup = new THREE.Group();
const selDimGroup = new THREE.Group();
scene.add(dragLabelGroup, selDimGroup);

function clearDragLabels() {
  for (const c of [...dragLabelGroup.children]) dragLabelGroup.remove(c);
}
// gap distances from the dragged unit to its nearest neighbors
function updateDragLabels(it) {
  clearDragLabels();
  if (TYPE_BY_ID[it.typeId].deck) return;
  const near = items
    .filter((o) => o !== it && !TYPE_BY_ID[o.typeId].deck)
    .map((o) => ({ o, gap: gapBetween(it, o) }))
    .filter((e) => e.gap < 26)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);
  for (const { o, gap } of near) {
    const danger = gap > JOIN_EPS && gap < SEP_CLEAR;
    const s = dimSprite(gap <= JOIN_EPS ? "butt" : `${Math.round(gap)}′`, danger);
    s.position.set((it.x + o.x) / 2, 6, (it.z + o.z) / 2);
    dragLabelGroup.add(s);
  }
}
// footprint dimensions of the selected unit
function updateSelDims() {
  for (const c of [...selDimGroup.children]) selDimGroup.remove(c);
  if (!selected || mode !== "compose") return;
  const t = TYPE_BY_ID[selected.typeId];
  if (t.deck) return;
  const [hw, hd] = halfDims(selected);
  const lenLabel = dimSprite(`${t.len}′`, false);
  const widLabel = dimSprite(`${t.wid}′`, false);
  if (selected.rot % 2 === 0) {
    lenLabel.position.set(selected.x, 4, selected.z + hd + 2.6);
    widLabel.position.set(selected.x + hw + 2.6, 4, selected.z);
  } else {
    lenLabel.position.set(selected.x + hw + 2.6, 4, selected.z);
    widLabel.position.set(selected.x, 4, selected.z + hd + 2.6);
  }
  selDimGroup.add(lenLabel, widLabel);
}

// ------------------------------------------------------- picking & dragging

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;
let dragOffset = new THREE.Vector3();
let downPos = null;
let moved = false;
let dragSnapshot = null;
let preBlocked = 0;

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

function groundPoint(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const it = itemAt(e.clientX, e.clientY);
  downPos = { x: e.clientX, y: e.clientY };
  moved = false;
  if (it && mode === "compose") {
    dragging = it;
    dragSnapshot = JSON.stringify(serialize());
    preBlocked = blockedPairs().length;
    controls.enabled = false;
    const p = groundPoint(e.clientX, e.clientY);
    if (p) dragOffset.set(it.x - p.x, 0, it.z - p.z);
    renderer.domElement.setPointerCapture(e.pointerId);
  }
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging || !downPos) return;
  if (!moved && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
    moved = true;
    undoStack.push(dragSnapshot); // pre-drag state, one undo step per drag
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }
  if (!moved) return;
  const p = groundPoint(e.clientX, e.clientY);
  if (!p) return;
  dragging.x = Math.round(p.x + dragOffset.x);
  dragging.z = Math.round(p.z + dragOffset.z);
  applyTransform(dragging);
  updateCompliance(); // live separation + trench feedback while dragging
  updateDragLabels(dragging);
  if (dragging === selected) updateSelDims();
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (dragging) {
    if (moved) {
      if (blockedPairs().length > preBlocked) {
        const snap = undoStack.pop(); // the pre-drag snapshot
        loadFrom(JSON.parse(snap));
        updateHistoryButtons();
        toast("That blocks a door wall — butt against solid sides only");
      } else {
        save();
        updateStats();
        if (selected) select(selected); // refresh plumbing/separation hints
      }
    } else select(selected === dragging ? null : dragging);
    clearDragLabels();
    dragging = null;
    controls.enabled = true;
  } else if (downPos && !moved) {
    // click without a drag: select in dollhouse, deselect on empty ground
    const it = itemAt(e.clientX, e.clientY);
    if (mode === "dollhouse") select(it && !TYPE_BY_ID[it.typeId].deck ? it : null);
    else if (!it) select(null);
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

// ------------------------------------------------------------- floor plans

// index-aligned with each type's furniture array
const PLAN_LABELS = {
  sleeping: ["bed", "", "", "wardrobe", "bench"],
  kitchen: ["counter run", "fridge", "pantry", "island"],
  bathhouse: ["shower", "shower", "soaking tub", "bench"],
  "bath-laundry": ["shower", "WC", "vanity", "washer", "dryer", "counter"],
  dining: ["table", "", "", "", "", "", "", "sideboard"],
  living: ["sofa", "table", "media", "stove"],
  bathroom: ["shower", "WC", "vanity"],
  laundry: ["washer", "dryer", "WH", "shelving"],
  office: ["desk", "", "bookshelves", "chair", "cab"],
  hobby: ["workbench", "shelving", "bins"],
};

function planSVG(t) {
  const S = 22, M = 46; // px per foot, margin
  const L = t.len, W = t.wid;
  const width = L * S + M * 2, height = W * S + M * 2;
  const X = (x) => M + (x + L / 2) * S;
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
    s += `<line x1="${hx}" y1="${hy}" x2="${hx + e * dw * 0.7}" y2="${hy - dw * 0.7}" stroke="#4f4a42" stroke-width="3" stroke-linecap="round"/>`;
    s += `<path d="M ${hx + e * dw * 0.7} ${hy - dw * 0.7} A ${dw} ${dw} 0 0 ${e === 1 ? 1 : 0} ${hx} ${hy + (0 * dw)}" fill="none" stroke="#4f4a42" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>`;
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
  s += `<text x="${X(0)}" y="${Y(-W / 2) - 10}" text-anchor="middle" font-size="11" fill="#77746c" font-family="ui-sans-serif, system-ui">interior ≈ 7′2″ wide × ${t.len === 20 ? "18′8″" : "8′7″"} after spray foam</text>`;

  return `<svg viewBox="0 0 ${width} ${height + 8}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#c0574a"/></marker></defs>
    ${s}</svg>`;
}

function openPlan(t) {
  document.getElementById("plan-title").textContent = `${t.name} — floor plan`;
  document.getElementById("plan-sub").textContent =
    `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · glazed apertures in blue · egress in red · dashed line is the finished interior`;
  document.getElementById("plan-svg").innerHTML = planSVG(t);
  document.getElementById("plan-modal").classList.add("open");
}
document.getElementById("btn-plan").addEventListener("click", () => {
  if (selected) openPlan(TYPE_BY_ID[selected.typeId]);
});
document.getElementById("plan-close").addEventListener("click", () =>
  document.getElementById("plan-modal").classList.remove("open"));

// ------------------------------------------------------------------- boot

const hashData = location.hash.startsWith("#d=") ? decodeShare(location.hash.slice(3)) : null;
let stored = null;
try { stored = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch {}
loadFrom(hashData || (stored && stored.items?.length ? stored : EXAMPLE));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

setTimeout(() => toast("+ adds units · drag to move · tap to peek inside"), 700);

const clock = new THREE.Clock();
const needle = document.getElementById("needle");
let lastAzimuth = null;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const az = controls.getAzimuthalAngle();
  if (az !== lastAzimuth) {
    needle.style.transform = `rotate(${az}rad)`;
    lastAzimuth = az;
  }
  // peek: lift roof + fade walls on the selected unit (all units in dollhouse)
  for (const it of items) {
    const target = mode === "dollhouse" || it === selected ? 1 : 0;
    if (Math.abs(it.peek - target) > 0.001) {
      it.peek += (target - it.peek) * Math.min(1, dt * 7);
      const ud = it.group.userData;
      if (ud.roof) {
        ud.roof.position.y = it.peek * 7;
        ud.roof.children[0].material = roofMat; // shared; opacity via scale illusion
        ud.roof.visible = it.peek < 0.98;
      }
      if (ud.wallMats) for (const m of ud.wallMats) m.opacity = 1 - it.peek * 0.72;
    }
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
