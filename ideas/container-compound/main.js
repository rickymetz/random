// Container Compound — compose a tiny-home compound from purpose-built
// shipping-container units on a rural Virginia acre. World units are feet.

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

// ---------------------------------------------------------------- unit data

const WALL_T = 0.35; // container wall thickness for rendering
const H = 9.5; // high cube exterior height

// Furniture pieces are boxes in unit-local feet, centered at the unit origin,
// x along the container length, z across the 8' width. y is the base height.
const TYPES = [
  {
    id: "sleeping", name: "Sleeping unit", len: 20, wid: 8, color: 0x96a48e,
    cost: 28000,
    desc: "Queen bed, wardrobe, reading bench and a mini-split. The private core of the compound.",
    va: "Egress-sized awning window at the bed (VRC R310). 160 sq ft, one story.",
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
    cost: 38000,
    desc: "Full galley run with range and sink, tall fridge, pantry and a small eat-at counter.",
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
    cost: 36000,
    desc: "Two shower stalls, a soaking tub and a changing bench — the shared spa of the compound.",
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
    cost: 34000,
    desc: "Full bath on one end, stacked washer-dryer pair and folding counter on the other.",
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
    cost: 22000,
    desc: "A table for eight and a sideboard, with wide openings meant to spill onto a deck.",
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
    cost: 24000,
    desc: "Deep sofa, media wall and a small wood stove — the den.",
    va: "Solid-fuel stove needs mechanical permit + clearances (VRC ch. 10).",
    furniture: [
      { x: -3.0, z: -2.3, w: 7.5, d: 3.0, h: 2.2, color: 0xd9cfc0 },     // sofa
      { x: -3.0, z: 1.6, w: 4.0, d: 2.0, h: 1.4, color: 0x9c7c58 },      // coffee table
      { x: 4.5, z: 2.8, w: 6.0, d: 1.5, h: 2.0, color: 0x8a6f4f },       // media console
      { x: 8.5, z: -2.6, w: 1.8, d: 1.8, h: 4.0, color: 0x4a4a48 },      // wood stove
    ],
  },
  {
    id: "bathroom", name: "Bathroom unit", len: 10, wid: 8, color: 0x8fa0ad,
    cost: 17000,
    desc: "Compact three-fixture bath in a mini: shower, toilet, vanity.",
    va: "Wet unit: plumbing permits apply. 80 sq ft, one story.",
    furniture: [
      { x: -3.0, z: -1.9, w: 3.2, d: 3.2, h: 7.0, color: 0xcfd8dc },     // shower
      { x: 3.4, z: -2.4, w: 1.6, d: 2.4, h: 1.4, color: 0xf2efe8 },      // toilet
      { x: 2.6, z: 2.7, w: 3.4, d: 1.8, h: 3.0, color: 0xdad2c4 },       // vanity
    ],
  },
  {
    id: "laundry", name: "Laundry / utility unit", len: 10, wid: 8, color: 0xb0a08d,
    cost: 15000,
    desc: "Washer, dryer, water heater and the compound's mechanical closet.",
    va: "Houses water heater + panel; trade permits apply.",
    furniture: [
      { x: -3.2, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // washer
      { x: -0.6, z: -2.5, w: 2.4, d: 2.4, h: 3.2, color: 0xe8e6e0 },     // dryer
      { x: 3.4, z: -2.3, w: 2.0, d: 2.0, h: 5.0, color: 0xbdb8ae },      // water heater
      { x: 0.5, z: 2.8, w: 7.0, d: 1.4, h: 6.0, color: 0x8a6f4f },       // shelving
    ],
  },
  {
    id: "office", name: "Office / studio unit", len: 10, wid: 8, color: 0x8fa695,
    cost: 18000,
    desc: "Desk under a picture window, bookshelves, room for a reading chair.",
    va: "Unplumbed work space — simple permit path.",
    furniture: [
      { x: -1.0, z: -2.5, w: 5.5, d: 2.4, h: 2.5, color: 0x9c7c58 },     // desk
      { x: -1.0, z: -0.4, w: 1.7, d: 1.7, h: 1.6, color: 0x6b6b66 },     // chair
      { x: 3.9, z: 0.6, w: 1.4, d: 5.5, h: 6.6, color: 0x8a6f4f },       // bookshelf
      { x: -3.4, z: 2.5, w: 2.6, d: 2.6, h: 2.0, color: 0xd9cfc0 },      // reading chair
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
camera.position.set(85, 70, 125);

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
const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
sun.position.set(-90, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160;
sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160;
sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0004;
scene.add(sun);

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
const glassMat = new THREE.MeshLambertMaterial({ color: 0xbcd6e2 });
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
  g.userData.wallMats = [wallMat];

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

  // walls (roof lifts away, so model them as four slabs)
  const base = 1.3, wallH = H - 1.3 - 0.6;
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, base + wallH / 2, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  mkWall(L, WALL_T, 0, -W / 2 + WALL_T / 2);
  mkWall(L, WALL_T, 0, W / 2 - WALL_T / 2);
  mkWall(WALL_T, W - WALL_T * 2, -L / 2 + WALL_T / 2, 0);
  mkWall(WALL_T, W - WALL_T * 2, L / 2 - WALL_T / 2, 0);

  // corrugation hint: vertical ribs on the long faces
  const ribMat = new THREE.MeshLambertMaterial({ color: type.color, transparent: true });
  g.userData.wallMats.push(ribMat);
  const ribs = Math.floor(L / 2);
  for (let i = 0; i <= ribs; i++) {
    const x = -L / 2 + (L / ribs) * i;
    for (const zs of [-1, 1]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, wallH - 0.4, 0.14), ribMat);
      rib.position.set(x * 0.96, base + wallH / 2, zs * (W / 2 + 0.02));
      g.add(rib);
    }
  }

  // door + windows on the front (south, +z) face
  const door = new THREE.Mesh(new THREE.BoxGeometry(3, 6.8, 0.12), doorMat);
  door.position.set(-L / 2 + 2.6, base + 3.4, W / 2 + 0.1);
  g.add(door);
  const winW = type.id === "sleeping" ? 5.2 : 4.2; // egress-sized for sleeping
  const win = new THREE.Mesh(new THREE.BoxGeometry(winW, 3.4, 0.12), glassMat);
  win.position.set(L / 4 - 0.5, base + 4.4, W / 2 + 0.1);
  g.add(win);
  const win2 = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 0.12), glassMat);
  win2.position.set(0, base + 4.6, -W / 2 - 0.1);
  g.add(win2);

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
  const item = { id: nextId++, typeId, x, z, rot, group, ring, peek: 0 };
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
  if (!item) { info.classList.remove("open"); return; }
  item.ring.visible = true;
  const t = TYPE_BY_ID[item.typeId];
  document.getElementById("info-name").textContent = t.name;
  document.getElementById("info-sub").textContent = t.deck
    ? `8' × 8' platform · 64 sq ft deck · ~$${t.cost.toLocaleString()}`
    : `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · ${t.len}' × 8' × 9'6" · ${t.len * t.wid} sq ft · ~$${t.cost.toLocaleString()}`;
  document.getElementById("info-desc").textContent = t.desc;
  document.getElementById("info-va").textContent = t.va;
  info.classList.add("open");
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

const EXAMPLE = {
  v: 1,
  items: [
    ["kitchen", -14, 12, 0],
    ["dining", 14, 12, 0],
    ["deck", 0, 12, 0],
    ["sleeping", -14, -14, 0],
    ["bathhouse", 14, -14, 0],
    ["deck", -4, -1, 0],
    ["deck", 4, -1, 0],
    ["bath-laundry", 34, -1, 1],
    ["office", -32, -1, 1],
  ],
};

// --------------------------------------------------------------------- UI

const palette = document.getElementById("palette");
for (const t of TYPES) {
  const btn = document.createElement("button");
  btn.className = "pal-btn";
  const sub = t.deck
    ? "8'×8' deck · ~$1.2k"
    : `${t.len}' ${t.len === 10 ? "mini " : ""}HC · ${t.len * t.wid} sq ft · ~$${Math.round(t.cost / 1000)}k`;
  btn.innerHTML = `<span class="pal-chip${t.len === 10 || t.deck ? " mini" : ""}" style="background:#${t.color.toString(16).padStart(6, "0")}"></span>
    <span><div class="pal-name">${t.name}</div><div class="pal-sub">${sub}</div></span>`;
  btn.addEventListener("click", () => {
    const spot = findSpot(t);
    const item = addItem(t.id, spot.x, spot.z, 0);
    select(item);
  });
  palette.appendChild(btn);
}

document.getElementById("btn-rotate").addEventListener("click", rotateSelected);
document.getElementById("btn-delete").addEventListener("click", () => selected && removeItem(selected));
document.getElementById("btn-va").addEventListener("click", () =>
  document.getElementById("va-modal").classList.add("open"));
document.getElementById("btn-va-close").addEventListener("click", () =>
  document.getElementById("va-modal").classList.remove("open"));
document.getElementById("btn-reset").addEventListener("click", () => {
  if (confirm("Reset to the example compound?")) {
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
  if (!selected) return;
  selected.rot = (selected.rot + 1) % 4;
  applyTransform(selected);
  save();
}

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "r" || e.key === "R") rotateSelected();
  else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
    e.preventDefault();
    removeItem(selected);
  } else if (e.key === "Escape") select(null);
});

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function updateStats() {
  let hc20 = 0, hc10 = 0, sqft = 0, deckSqft = 0, cost = 0;
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
  document.getElementById("st-cost").textContent = `$${cost.toLocaleString()}`;
}

// ------------------------------------------------------- picking & dragging

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = null;
let dragOffset = new THREE.Vector3();
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
  if (it) {
    dragging = it;
    controls.enabled = false;
    const p = groundPoint(e.clientX, e.clientY);
    if (p) dragOffset.set(it.x - p.x, 0, it.z - p.z);
    renderer.domElement.setPointerCapture(e.pointerId);
  }
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging || !downPos) return;
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) moved = true;
  if (!moved) return;
  const p = groundPoint(e.clientX, e.clientY);
  if (!p) return;
  dragging.x = Math.round(p.x + dragOffset.x);
  dragging.z = Math.round(p.z + dragOffset.z);
  applyTransform(dragging);
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (dragging) {
    if (moved) save();
    else select(selected === dragging ? null : dragging);
    dragging = null;
    controls.enabled = true;
  } else if (downPos && !moved) {
    // clicked empty ground
    const it = itemAt(e.clientX, e.clientY);
    if (!it) select(null);
  }
  downPos = null;
});

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

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  // peek: lift roof + fade walls on the selected unit
  for (const it of items) {
    const target = it === selected ? 1 : 0;
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
