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

// ------------------------------------------------------------------- scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde7ee);
scene.fog = new THREE.Fog(0xdde7ee, 320, 620);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 1200);
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
  document.getElementById("btn-sun").title = s.name;
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

// ---- editable scenery: the gravel drive and the trees ----
// Both are saved state, not fixtures: they move with the layout, ride the
// share link and sit on the undo stack. The parcel itself stays a fixed acre.

const DRIVE_LEN = 96, DRIVE_WID = 14, PAD_R = 16, PAD_OFF = -46;
const DEFAULT_DRIVE = { x: 52, z: 56, rot: 0 };
const DEFAULT_TREES = [
  [-88, -78, 1.5], [-70, -92, 1.1], [-95, -30, 1.2], [-84, 30, 1.6], [-92, 72, 1.0],
  [-60, 88, 1.3], [-10, 94, 1.1], [24, 90, 1.5], [88, 84, 1.2], [94, 40, 1.0],
  [92, -32, 1.4], [80, -80, 1.6], [40, -92, 1.0], [-30, -95, 1.3], [8, -88, 0.9],
];

let drive = { ...DEFAULT_DRIVE };
let trees = DEFAULT_TREES.map(([x, z, s], i) => ({ id: i + 1, x, z, s }));
let nextTreeId = trees.length + 1;

// the drive's turnaround pad, in world feet, for hit tests and the plan
function padCenter(d = drive) {
  const [dx, dz] = DIRS[d.rot % 4];
  // local +z maps to world by the same rotation the mesh group uses
  return { x: d.x - dz * PAD_OFF, z: d.z + dx * PAD_OFF };
}

const sceneryRoot = new THREE.Group();
scene.add(sceneryRoot);

const gravelMat = shared(new THREE.MeshLambertMaterial({ color: 0xb6ae9f }));

function buildTree(t) {
  const g = new THREE.Group();
  const s = t.s;
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
  g.position.set(t.x, 0, t.z);
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

const roofMat = shared(new THREE.MeshLambertMaterial({ color: 0xf5f3ee }));
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
  markShadowDirty();
  item.group.position.set(item.x, 0, item.z);
  item.group.rotation.y = (item.rot * Math.PI) / 2;
}

function removeItem(item) {
  unitRoot.remove(item.group);
  item.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !Array.isArray(o.material) && !o.material.userData.shared)
      o.material.dispose();
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
  document.getElementById("sel-name").textContent = t.name;
  // plan: selection shows the tool strip; the sheet opens via the name chip.
  // 3D: a tap goes straight to the (read-only) sheet.
  if (mode === "view") document.body.classList.add("sheet-open");
  updateSelDims();
}
document.getElementById("btn-info").addEventListener("click", () =>
  document.body.classList.add("sheet-open"));
document.getElementById("btn-desel").addEventListener("click", () => select(null));

// find an open spot near the center for a newly added unit
function findSpot(type, ox = 0, oz = 0) {
  const step = 4;
  for (let r = 0; r < 26; r++) {
    for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      const x = Math.round(ox + Math.cos(ang) * r * step);
      const z = Math.round(oz + Math.sin(ang) * r * step);
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
  };
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
  // v1 payloads carry no scenery — every share link already in the wild, and
  // every browser still holding a v1 layout, falls back to the default acre.
  if (Array.isArray(data?.trees)) {
    trees = data.trees.map(([x, z, s], i) => ({ id: i + 1, x, z, s: s || 1.2 }));
    nextTreeId = trees.length + 1;
  } else {
    trees = DEFAULT_TREES.map(([x, z, s], i) => ({ id: i + 1, x, z, s }));
    nextTreeId = trees.length + 1;
  }
  if (Array.isArray(data?.drive)) {
    const [x, z, rot] = data.drive;
    drive = { x, z, rot: (rot | 0) % 4 };
  } else {
    drive = { ...DEFAULT_DRIVE };
  }
  rebuildScenery();
  save();
  updateStats();
  if (mode === "plan") renderSitePlan();
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
  clearDragLabels();
  document.body.classList.remove("sheet-open");
  // selection survives the switch, so you land on the same unit
  if (m === "plan") { stopLoop(); renderSitePlan(); }
  else { markShadowDirty(); startLoop(); updateSelDims(); renderChrome(); }
}
for (const b of document.querySelectorAll("#tabbar button"))
  b.addEventListener("click", () => setMode(b.dataset.mode));

const btnDoll = document.getElementById("btn-doll");
btnDoll.addEventListener("click", () => {
  dollhouseOn = !dollhouseOn;
  markShadowDirty();
  btnDoll.classList.toggle("on", dollhouseOn);
  btnDoll.setAttribute("aria-pressed", String(dollhouseOn));
  btnDoll.textContent = dollhouseOn ? "⊔" : "⌂"; // open box vs roofed
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
      ? `8' × 8' platform · 64 sq ft · ~$${(t.cost / 1000).toFixed(1)}k`
      : `${t.len}' ${t.len === 10 ? "mini " : ""}high cube · ${t.len * t.wid} sq ft · ~$${Math.round(t.cost / 1000)}k`;
    const badge = BADGES[t.variant] ? `<span class="badge">${BADGES[t.variant]}</span>` : "";
    row.innerHTML = `<span class="add-chip${t.len === 10 || t.deck ? " mini" : ""}" style="background:#${t.color.toString(16).padStart(6, "0")}"></span>
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

// a tree is scenery, not a unit, so it gets its own row under Site
{
  const row = document.createElement("button");
  row.className = "add-row";
  row.innerHTML = `<span class="add-chip mini" style="background:#6b8a55"></span>
    <span>
      <div class="add-name">Tree</div>
      <div class="add-meta">Existing canopy · shade and screening</div>
      <div class="add-desc">Drag onto the plan to place. Drag a tree to move it, double-tap to clear it.</div>
    </span>`;
  const TREE_TYPE = { id: "__tree", name: "Tree", deck: true, len: 12, wid: 12 };
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    pendingAdd = { type: TREE_TYPE, from: { x: e.clientX, y: e.clientY }, armed: false };
  });
  row.addEventListener("click", () => {
    pushUndo();
    const c = viewCenterWorld();
    trees.push({ id: nextTreeId++, x: Math.round(c.x), z: Math.round(c.z), s: 1.2 });
    rebuildScenery();
    closeAdd();
    save();
    renderSitePlan();
  });
  addList.appendChild(row);
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

document.getElementById("btn-dup").addEventListener("click", () => {
  if (!selected || mode !== "plan") return;
  pushUndo();
  const t = TYPE_BY_ID[selected.typeId];
  const spot = findSpot(t, selected.x, selected.z); // land beside the original
  const item = addItem(selected.typeId, spot.x, spot.z, selected.rot);
  select(item);
  renderSitePlan();
});

document.getElementById("btn-rotate").addEventListener("click", rotateSelected);
document.getElementById("btn-delete").addEventListener("click", () => {
  if (!selected || mode !== "plan") return;
  pushUndo();
  removeItem(selected);
  renderSitePlan();
  toast("Deleted — ↩ to undo");
});
document.getElementById("btn-close").addEventListener("click", () => {
  document.body.classList.remove("sheet-open");
  if (mode === "view") select(null);
});
document.getElementById("stats-pill").addEventListener("click", () =>
  document.getElementById("stats-pop").classList.toggle("open"));
document.getElementById("btn-va").addEventListener("click", () =>
  openDialog(document.getElementById("va-modal")));
document.getElementById("btn-va-close").addEventListener("click", () =>
  closeDialog(document.getElementById("va-modal")));
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
  if (!selected || mode !== "plan") return;
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
  if (mode === "plan") renderSitePlan();
}

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
    e.preventDefault(); redo();
  } else if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
  else if (e.key === "r" || e.key === "R") rotateSelected();
  else if ((e.key === "Delete" || e.key === "Backspace") && selected && mode === "plan") {
    e.preventDefault();
    pushUndo();
    removeItem(selected);
    renderSitePlan();
    toast("Deleted — ↩ to undo");
  } else if (e.key.startsWith("Arrow") && selected && mode === "plan") {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") nudgeSelected(-step, 0);
    else if (e.key === "ArrowRight") nudgeSelected(step, 0);
    else if (e.key === "ArrowUp") nudgeSelected(0, -step);
    else if (e.key === "ArrowDown") nudgeSelected(0, step);
  } else if (e.key === "Escape") {
    const dlg = anyOpenDialog();
    if (dlg) { closeDialog(dlg); return; }
    if (document.body.classList.contains("menu-open")) {
      document.body.classList.remove("menu-open");
      document.getElementById("btn-menu").focus();
      return;
    }
    if (placing) { setPlacing(false); return; }
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

  // Every class of finding the drawing redlines, not just the separations —
  // the badge used to say 2 on a layout showing 5 problems.
  let over = 0;
  const counted = new Set();
  for (const u of units) {
    const j = joined.get(u.id);
    if (!j || j.sqft <= 256) continue;
    const key = clusterOf(u).map((m) => m.id).sort().join(",");
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
  findings = { sep: sepPairs.length, over, stranded,
               total: sepPairs.length + over + stranded };
}
let findings = { sep: 0, over: 0, stranded: 0, total: 0 };

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
  const fRow = document.getElementById("st-findings");
  if (fRow) {
    fRow.textContent = findings.total
      ? [findings.sep && `${findings.sep} separation`,
         findings.over && `${findings.over} over 256 sq ft`,
         findings.stranded && `${findings.stranded} stranded`]
        .filter(Boolean).join(" · ")
      : "None";
    fRow.parentElement.classList.toggle("warn", findings.total > 0);
  }
  const pill = document.getElementById("stats-pill");
  pill.textContent =
    `${hc20 + hc10} units · ${(sqft + deckSqft).toLocaleString()} ft² · ~$${Math.round(cost / 1000)}k` +
    (findings.total ? ` · ⚠${findings.total}` : "");
  pill.setAttribute("aria-label",
    `${hc20 + hc10} units, ${(sqft + deckSqft).toLocaleString()} square feet, about $${cost.toLocaleString()}, ` +
    (findings.total ? `${findings.total} code finding${findings.total > 1 ? "s" : ""}` : "no code findings") +
    ". Opens the summary.");
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
// footprint dimensions of the selected unit
function updateSelDims() {
  for (const c of [...selDimGroup.children]) selDimGroup.remove(c);
  if (!selected || mode !== "view") return;
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
    g += `<rect x="${-hw + 3}" y="${-hd + 3}" width="${hw * 2 - 6}" height="${hd * 2 - 6}" fill="#${t.color.toString(16).padStart(6, "0")}" fill-opacity="0.16" stroke="#55524c" stroke-width="0.8"/>`;

    // the finished interior after spray foam, only worth drawing up close
    if (detail) {
      g += `<rect x="${(-t.len / 2 + 0.55) * S}" y="${(-t.wid / 2 + 0.42) * S}" width="${(t.len - 1.1) * S}" height="${(t.wid - 0.84) * S}" fill="none" stroke="#b8b2a6" stroke-width="0.9" stroke-dasharray="4 3"/>`;
    }

    // furniture outlines, labelled once there is room for the words
    const labels = PLAN_LABELS[t.id] || [];
    t.furniture.forEach((f, i) => {
      g += `<rect x="${(f.x - f.w / 2) * S}" y="${(f.z - f.d / 2) * S}" width="${f.w * S}" height="${f.d * S}" rx="1.5" fill="#f2efe9" stroke="#55524c" stroke-width="0.9"/>`;
      if (detail && labels[i] && f.w * S > 30) {
        g += `<text x="${f.x * S}" y="${f.z * S + ss(2.8)}" text-anchor="middle" font-size="${ss(8)}" fill="#55524c" font-family="${FONT}">${labels[i]}</text>`;
      }
    });

    // glazed apertures + door swings
    const ends = t.variant === "tunnel" ? [1, -1] : [1];
    for (const e of ends) {
      g += `<line x1="${e * (hw - 2)}" y1="${-hd + 4}" x2="${e * (hw - 2)}" y2="${hd - 4}" stroke="#4a90c2" stroke-width="2.2"/>`;
      const hy = -3.1 * S, r = 3 * S;
      g += `<line x1="${e * hw}" y1="${hy}" x2="${e * (hw + r * 0.6)}" y2="${hy + r * 0.6}" stroke="#55524c" stroke-width="1.4"/>`;
      g += `<path d="M ${e * (hw + r * 0.6)} ${hy + r * 0.6} A ${r} ${r} 0 0 ${e === 1 ? 0 : 1} ${e * hw} ${hy + r}" fill="none" stroke="#55524c" stroke-width="0.8" stroke-dasharray="3 3"/>`;
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

function renderSitePlan(opts = {}) {
  updateCompliance();
  const S = SP_S, M = SP_M, HALF = SP_HALF;
  const minX = SP_MINX, maxX = SP_MAXX, minZ = SP_MINZ, maxZ = SP_MAXZ;
  const X = spX, Y = spY;
  const width = SP_W, height = SP_H;
  rendering = true;

  // The fit has to settle before anything is emitted: annotation is sized in
  // screen pixels, so building the markup first and zooming afterwards writes
  // every label at the wrong scale.
  let uMinX = Infinity, uMaxX = -Infinity, uMinZ = Infinity, uMaxZ = -Infinity;
  for (const it of items) {
    const [hw, hd] = halfDims(it);
    uMinX = Math.min(uMinX, it.x - hw); uMaxX = Math.max(uMaxX, it.x + hw);
    uMinZ = Math.min(uMinZ, it.z - hd); uMaxZ = Math.max(uMaxZ, it.z + hd);
  }
  siteFitBox = items.length
    ? { x0: X(uMinX) - 30, x1: X(uMaxX) + 40, y0: Y(uMinZ) - 30, y1: Y(uMaxZ) + 45 }
    : { x0: 0, x1: SP_W, y0: 0, y1: SP_H };
  if (!exportScale && (opts.fit || !siteFitted)) { siteFitted = true; siteFitView(); }

  detailOn = exportScale ? true : (detailOn ? sview.k >= detailOut() : sview.k >= detailIn());
  AK = exportScale ? 1 : sview.k;
  let s = "";

  // paper sheet with a soft shadow, sitting on the workspace
  s += `<rect x="10" y="12" width="${width - 14}" height="${height - 14}" fill="#22201c" opacity="0.10"/>`;
  s += `<rect x="4" y="4" width="${width - 14}" height="${height - 14}" fill="#fbfaf6" stroke="#c9c4b8" stroke-width="1.5"/>`;

  // fine 10 ft grid, heavier every 50 ft
  for (let gx = Math.ceil(minX / 10) * 10; gx <= maxX; gx += 10) {
    const major = gx % 50 === 0;
    s += `<line x1="${X(gx)}" y1="${Y(minZ)}" x2="${X(gx)}" y2="${Y(maxZ)}" stroke="${major ? "#ddd8cc" : "#eceae1"}" stroke-width="1"/>`;
  }
  for (let gz = Math.ceil(minZ / 10) * 10; gz <= maxZ; gz += 10) {
    const major = gz % 50 === 0;
    s += `<line x1="${X(minX)}" y1="${Y(gz)}" x2="${X(maxX)}" y2="${Y(gz)}" stroke="${major ? "#ddd8cc" : "#eceae1"}" stroke-width="1"/>`;
  }

  // property line (dash-dot) — the one-acre parcel
  s += `<rect x="${X(-HALF)}" y="${Y(-HALF)}" width="${HALF * 2 * S}" height="${HALF * 2 * S}" fill="none" stroke="#8a867c" stroke-width="1.6" stroke-dasharray="16 6 3 6"/>`;

  // gravel drive (editable: the strip and its turnaround move together)
  // one translated group so a drag is a transform, not a re-render
  s += `<g id="drive-layer" transform="${driveTransform()}">`
    + `<circle cx="0" cy="${PAD_OFF * S}" r="${PAD_R * S}" fill="#e7e2d6" stroke="#b9b1a0" stroke-width="1"/>`
    + `<rect x="${-DRIVE_WID / 2 * S}" y="${-DRIVE_LEN / 2 * S}" width="${DRIVE_WID * S}" height="${DRIVE_LEN * S}" fill="#e7e2d6" stroke="#b9b1a0" stroke-width="1"/>`
    + `</g>`;

  // tree canopies
  for (const t of trees) {
    s += `<g id="tree${t.id}" transform="translate(${X(t.x)} ${Y(t.z)})">`
      + `<circle cx="0" cy="0" r="${6 * t.s * S}" fill="#7c9464" fill-opacity="0.14" stroke="#7c9464" stroke-width="1"/>`
      + `<circle cx="0" cy="0" r="2" fill="#5f7350"/></g>`;
  }

  // utility core rings + trench runs
  for (const it of items) {
    if (!TYPE_BY_ID[it.typeId].core) continue;
    s += `<circle cx="${X(it.x)}" cy="${Y(it.z)}" r="${WET_RADIUS * S}" fill="none" stroke="#7e97a6" stroke-width="1.4" stroke-dasharray="8 6" opacity="0.6"/>`;
  }
  const cores = items.filter((i) => TYPE_BY_ID[i.typeId].core);
  if (cores.length) {
    for (const w of items.filter((i) => TYPE_BY_ID[i.typeId].wet)) {
      let best = cores[0], bd = Infinity;
      for (const c of cores) {
        const d = Math.hypot(c.x - w.x, c.z - w.z);
        if (d < bd) { bd = d; best = c; }
      }
      s += `<line x1="${X(w.x)}" y1="${Y(w.z)}" x2="${X(best.x)}" y2="${Y(best.z)}" stroke="#5f7a8a" stroke-width="1.4" stroke-dasharray="5 5" opacity="0.7"/>`;
    }
  }

  // units: decks underneath, then containers, world rotation -> screen rotation
  const drawOrder = [...items].sort((a, b) =>
    (TYPE_BY_ID[a.typeId].deck ? 0 : 1) - (TYPE_BY_ID[b.typeId].deck ? 0 : 1));
  for (const it of drawOrder) {
    s += `<g id="u${it.id}" transform="translate(${X(it.x)} ${Y(it.z)}) rotate(${-it.rot * 90})">${unitPlanGroup(it, detailOn)}</g>`;
  }
  // labels drawn unrotated, above everything. Zoomed in, the room name moves
  // off the footprint so it stops sitting on top of the furniture labels.
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    if (t.deck) continue;
    const label = SHORT_NAME[it.typeId] || t.name;
    // the label rides in its own group so a drag carries it with the unit
    let inner;
    if (detailOn) {
      const [, hd] = halfDims(it);
      inner = `<text x="0" y="${-hd * S - ss(7)}" text-anchor="middle" font-size="${ss(10)}" font-weight="700" letter-spacing="${ss(1.1)}" fill="#23231f" font-family="${FONT}">${label.toUpperCase()} · ${t.len * t.wid} SF</text>`;
    } else {
      inner = `<text x="0" y="${-ss(2)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" letter-spacing="${ss(1.1)}" fill="#23231f" font-family="${FONT}">${label.toUpperCase()}</text>`
        + `<text x="0" y="${ss(10)}" text-anchor="middle" font-size="${ss(9)}" fill="#6b6861" font-family="${FONT}">${t.len * t.wid} SF</text>`;
    }
    s += `<g id="ul${it.id}" transform="translate(${X(it.x)} ${Y(it.z)})">${inner}</g>`;
  }

  // fire-separation conflicts
  // Drawn along the gap itself rather than centre-to-centre, which used to
  // strike the line and its label straight through the units it annotates.
  s += `<g id="sep-layer">`;
  for (const p of sepPairs) {
    const b = gapBand(p.a, p.b);
    const mx = b.axis === "x" ? (X(b.x0) + X(b.x1)) / 2 : X((b.x0 + b.x1) / 2);
    const my = b.axis === "x" ? Y((b.z0 + b.z1) / 2) : (Y(b.z0) + Y(b.z1)) / 2;
    if (b.axis === "x") {
      s += `<line x1="${X(b.x0)}" y1="${my}" x2="${X(b.x1)}" y2="${my}" stroke="#c0574a" stroke-width="${ss(1.6)}"/>`;
    } else {
      s += `<line x1="${mx}" y1="${Y(b.z0)}" x2="${mx}" y2="${Y(b.z1)}" stroke="#c0574a" stroke-width="${ss(1.6)}"/>`;
    }
    s += `<text x="${mx}" y="${my - ss(6)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" fill="#8c3b2e" font-family="${FONT}">⚠ ${Math.max(1, Math.round(p.gap))}′ RATED</text>`;
  }

  s += `</g>`;
  // the findings ride on the drawing, so they survive export
  s += `<g id="findings-layer">${findingsMarkup()}</g>`;

  // compound extent dimension strings
  if (items.length) {
    s += `<g id="dim-layer">`;
    const tick = (x, y, dx, dy) => `<line x1="${x - dx}" y1="${y - dy}" x2="${x + dx}" y2="${y + dy}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
    const dy = Y(uMaxZ) + ss(30);
    s += `<line x1="${X(uMinX)}" y1="${dy}" x2="${X(uMaxX)}" y2="${dy}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
    s += tick(X(uMinX), dy, 0, ss(5)) + tick(X(uMaxX), dy, 0, ss(5));
    s += `<line x1="${X(uMinX)}" y1="${Y(uMaxZ) + ss(6)}" x2="${X(uMinX)}" y2="${dy + ss(4)}" stroke="#a9a397" stroke-width="${ss(0.9)}"/>`;
    s += `<line x1="${X(uMaxX)}" y1="${Y(uMaxZ) + ss(6)}" x2="${X(uMaxX)}" y2="${dy + ss(4)}" stroke="#a9a397" stroke-width="${ss(0.9)}"/>`;
    s += `<text x="${(X(uMinX) + X(uMaxX)) / 2}" y="${dy - ss(6)}" text-anchor="middle" font-size="${ss(10)}" fill="#23231f" font-family="${FONT}">${Math.round(uMaxX - uMinX)}′-0″</text>`;
    const dx2 = X(uMaxX) + ss(30);
    s += `<line x1="${dx2}" y1="${Y(uMinZ)}" x2="${dx2}" y2="${Y(uMaxZ)}" stroke="#6b6861" stroke-width="${ss(1.1)}"/>`;
    s += tick(dx2, Y(uMinZ), ss(5), 0) + tick(dx2, Y(uMaxZ), ss(5), 0);
    s += `<text x="${dx2 + ss(9)}" y="${(Y(uMinZ) + Y(uMaxZ)) / 2}" text-anchor="middle" font-size="${ss(10)}" fill="#23231f" font-family="${FONT}" transform="rotate(90 ${dx2 + ss(9)} ${(Y(uMinZ) + Y(uMaxZ)) / 2})">${Math.round(uMaxZ - uMinZ)}′-0″</text>`;
    s += `</g>`;
  }

  // north arrow (north = up)
  const nx = X(maxX) - 34, ny = Y(minZ) + 36;
  s += `<circle cx="${nx}" cy="${ny}" r="22" fill="#fbfaf6" stroke="#55524c" stroke-width="1.4"/>`;
  s += `<path d="M ${nx} ${ny - 15} L ${nx - 7} ${ny + 9} L ${nx} ${ny + 3} L ${nx + 7} ${ny + 9} Z" fill="#23231f"/>`;
  s += `<text x="${nx}" y="${ny + 38}" text-anchor="middle" font-size="12" font-weight="700" fill="#23231f" font-family="${FONT}">N</text>`;

  // title block, bottom-right of the sheet
  let hc20 = 0, hc10 = 0, sqft = 0, deckSf = 0;
  for (const it of items) {
    const t = TYPE_BY_ID[it.typeId];
    if (t.deck) { deckSf += 64; continue; }
    if (t.len === 20) hc20++; else hc10++;
    sqft += t.len * t.wid;
  }
  const tbw = 340, tbh = 132;
  const tbx = width - tbw - 40, tby = height - tbh - 42;
  s += `<rect x="${tbx}" y="${tby}" width="${tbw}" height="${tbh}" fill="#ffffff" stroke="#23231f" stroke-width="1.6"/>`;
  s += `<line x1="${tbx}" y1="${tby + 36}" x2="${tbx + tbw}" y2="${tby + 36}" stroke="#23231f" stroke-width="1"/>`;
  s += `<text x="${tbx + 14}" y="${tby + 24}" font-size="14" font-weight="700" letter-spacing="2" fill="#23231f" font-family="${FONT}">CONTAINER COMPOUND</text>`;
  s += `<text x="${tbx + 14}" y="${tby + 54}" font-size="10" letter-spacing="1" fill="#55524c" font-family="${FONT}">SITE PLAN · VIRGINIA · 1.0 AC PARCEL</text>`;
  s += `<text x="${tbx + 14}" y="${tby + 70}" font-size="8.5" fill="#55524c" font-family="${FONT}">${hc20 + hc10} UNITS (${hc20}× 20′ HC, ${hc10}× 10′ MINI) · ${sqft.toLocaleString()} SF ENCLOSED · ${deckSf} SF DECK</text>`;
  // split across two lines: as one line this ran 68 px off the sheet's own
  // viewBox, so every export lost the key to its colour language
  s += `<text x="${tbx + 14}" y="${tby + 85}" font-size="7.5" fill="#6b6861" font-family="${FONT}">BLUE = GLAZED APERTURE · DASHED = UTILITY RUN / CORE RING</text>`;
  s += `<text x="${tbx + 14}" y="${tby + 97}" font-size="7.5" fill="#6b6861" font-family="${FONT}">RED = CODE FINDING (R302.1 GAP · &gt;256 SF CLUSTER · STRANDED WET UNIT)</text>`;
  s += `<line x1="${tbx + 14}" y1="${tby + 117}" x2="${tbx + 14 + 20 * S}" y2="${tby + 117}" stroke="#23231f" stroke-width="3"/>`;
  s += `<line x1="${tbx + 14 + 10 * S}" y1="${tby + 113}" x2="${tbx + 14 + 10 * S}" y2="${tby + 121}" stroke="#23231f" stroke-width="1.2"/>`;
  s += `<text x="${tbx + 22 + 20 * S}" y="${tby + 121}" font-size="9" fill="#55524c" font-family="${FONT}">20 FT</text>`;

  const svgW = Math.round(width), svgH = Math.round(height);
  const defs = `<defs><marker id="sp-arr" markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#c0574a"/></marker>${HATCH_DEF}</defs>`;
  document.getElementById("site-svg").innerHTML =
    `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">${defs}${s}</svg>`;
  siteApply();
  renderChrome();
  rendering = false;
}
let siteFitted = false;
let rendering = false;

let siteFitBox = null;

// The floating chrome used to be two magic numbers (118 top, 34 bottom) tuned
// on a desktop, so on a phone the fit ran the drawing under the export pills
// and the add button, where it could not be pressed. Measure what is actually
// on screen instead.
function chromeBand() {
  const box = (id) => {
    const el = document.getElementById(id);
    if (!el || getComputedStyle(el).display === "none") return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  let top = 12;
  for (const id of ["topbar", "tabbar"]) {
    const r = box(id);
    if (r) top = Math.max(top, r.bottom + 12);
  }
  let bottom = 12;
  for (const id of ["site-actions", "fab", "stats-pill", "toolstrip", "edge-tools"]) {
    const r = box(id);
    if (r) bottom = Math.max(bottom, innerHeight - r.top + 12);
  }
  return { top, bottom };
}

// Below this the units stop being touchable — an 8 ft side has to stay near a
// finger's width — so the compound is allowed to overflow and be panned
// rather than shrunk until the drawing is a row of grey slabs.
const MIN_FIT_K = 0.5;

function siteFitView() {
  if (!siteFitBox) return;
  const { x0, x1, y0, y1 } = siteFitBox;
  const vw = innerWidth, vh = innerHeight;
  const { top, bottom } = chromeBand();
  const pad = 20;
  const band = Math.max(120, vh - top - bottom);
  const k = Math.min(
    Math.max(MIN_FIT_K, Math.min((vw - pad * 2) / (x1 - x0), band / (y1 - y0))),
    2.5);
  sview.k = k;
  fitK = k;
  sview.x = (vw - k * (x0 + x1)) / 2;
  sview.y = top + (band - k * (y1 - y0)) / 2 - k * y0;
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
  exportScale = true;
  renderSitePlan();
  const svg = document.querySelector("#site-svg svg");
  const clone = svg ? svg.cloneNode(true) : null;
  exportScale = false;
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
function siteApply() {
  siteStageEl.style.transform = `translate(${sview.x}px, ${sview.y}px)`;
  const w = Math.round(SP_W * sview.k), h = Math.round(SP_H * sview.k);
  for (const svg of siteStageEl.querySelectorAll("svg")) {
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
  }
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
  const k2 = Math.min(6, Math.max(0.1, sview.k * f));
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
function clusterOf(root) {
  if (TYPE_BY_ID[root.typeId].deck) return [root];
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
  let s = "";
  for (const p of sepPairs) {
    const b = gapBand(p.a, p.b);
    if (b.overlap <= 0) continue;
    s += `<rect x="${X(b.x0)}" y="${Y(b.z0)}" width="${Math.max(1, (b.x1 - b.x0) * S)}" height="${Math.max(1, (b.z1 - b.z0) * S)}" fill="url(#ch-hatch)" stroke="#c0574a" stroke-width="${ss(1)}" stroke-dasharray="${dash(4, 3)}"/>`;
  }
  const seen = new Set();
  for (const it of items) {
    const j = joined.get(it.id);
    if (!j || j.sqft <= 256) continue;
    const members = clusterOf(it);
    const key = members.map((m) => m.id).sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of members) {
      const [hw, hd] = halfDims(m);
      x0 = Math.min(x0, m.x - hw); x1 = Math.max(x1, m.x + hw);
      z0 = Math.min(z0, m.z - hd); z1 = Math.max(z1, m.z + hd);
    }
    s += `<rect x="${X(x0) - ss(6)}" y="${Y(z0) - ss(6)}" width="${(x1 - x0) * S + ss(12)}" height="${(z1 - z0) * S + ss(12)}" fill="none" stroke="#c0574a" stroke-width="${ss(1.8)}" stroke-dasharray="${dash(10, 5)}"/>`;
    s += `<text x="${X((x0 + x1) / 2)}" y="${Y(z0) - ss(13)}" text-anchor="middle" font-size="${ss(10)}" font-weight="700" fill="#8c3b2e" font-family="${FONT}">⚠ ${j.sqft} SF &gt; 256 SF EXEMPTION</text>`;
  }
  const cores = items.filter((i) => TYPE_BY_ID[i.typeId].core);
  for (const w of items.filter((i) => TYPE_BY_ID[i.typeId].wet)) {
    const near = cores.length
      ? Math.min(...cores.map((c) => Math.hypot(c.x - w.x, c.z - w.z))) : Infinity;
    if (near <= WET_RADIUS) continue;
    const [, hd] = halfDims(w);
    s += `<text x="${X(w.x)}" y="${Y(w.z + hd) + ss(16)}" text-anchor="middle" font-size="${ss(10)}" font-weight="700" fill="#8c3b2e" font-family="${FONT}">⚠ ${cores.length ? `${Math.round(near)}′ TO CORE` : "NO UTILITY CORE"}</text>`;
  }
  return s;
}

const HATCH_DEF = `<pattern id="ch-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <line x1="0" y1="0" x2="0" y2="7" stroke="#c0574a" stroke-width="2" opacity="0.38"/></pattern>`;

function renderChrome() {
  if (mode !== "plan") { siteChromeEl.innerHTML = ""; return; }
  AK = sview.k;
  const X = spX, Y = spY, S = SP_S;
  let s = "";

  // mid-drag the sheet's settled findings are stale, so redraw them live here
  if (planDrag && planDrag.moved) s += findingsMarkup();

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
    const label = butt ? "BUTT" : danger ? `⚠ ${Math.round(gap)}′ RATED` : `${Math.round(gap)}′`;
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
    s += `<text x="${mx}" y="${oy - h / 2 + ss(4)}" text-anchor="middle" font-size="${ss(11)}" font-weight="700" fill="${col}" font-family="${FONT}">${label}</text>`;
  }
  return s;
}

const driveTransform = () =>
  `translate(${spX(drive.x)} ${spY(drive.z)}) rotate(${-drive.rot * 90})`;
function moveSceneryGroup(id, x, z) {
  const g = document.getElementById(id);
  if (g) g.setAttribute("transform", `translate(${spX(x)} ${spY(z)})`);
}

// move one unit's group on the sheet without redrawing the whole thing
function moveUnitGroup(it) {
  const g = document.getElementById(`u${it.id}`);
  if (g) g.setAttribute("transform",
    `translate(${spX(it.x)} ${spY(it.z)}) rotate(${-it.rot * 90})`);
  const lab = document.getElementById(`ul${it.id}`);
  if (lab) lab.setAttribute("transform", `translate(${spX(it.x)} ${spY(it.z)})`);
}

// ---- pointer handling ----

let sitePanning = false;
let pinching = false;
let lastTap = { t: 0, key: "" };
let breakoutTimer = null;

// A fingertip always jitters, so the threshold is measured from where the
// press began, not from the previous move event, and it is generous on touch.
const SLOP = (e) => (e.pointerType === "touch" ? 10 : 3);

function beginUnitDrag(it, p, solo, e) {
  const members = solo ? [it] : clusterOf(it);
  planDrag = {
    kind: "unit", primary: it, members, solo,
    offs: members.map((m) => ({ m, dx: m.x - it.x, dz: m.z - it.z })),
    grabX: it.x - p.x, grabZ: it.z - p.z,
    snapshot: JSON.stringify(serialize()),
    preBlocked: blockedPairs().length,
    moved: false,
    startX: e.clientX, startY: e.clientY, slop: SLOP(e),
  };
}

sitePanelEl.addEventListener("pointerdown", (e) => {
  if (placing && selected) { e.preventDefault(); return; } // handled on release
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
    beginUnitDrag(it, p, e.altKey || e.shiftKey, e);
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
      undoStack.push(planDrag.snapshot); // one undo step per drag
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      updateHistoryButtons();
      document.body.classList.add("plan-dragging");
    }
    const p = clientToWorld(cur.x, cur.y);
    if (planDrag.kind === "unit") {
      const moving = new Set(planDrag.members);
      const snapped = snapMove(planDrag.primary, p.x + planDrag.grabX, p.z + planDrag.grabZ, moving);
      for (const { m, dx, dz } of planDrag.offs) {
        m.x = snapped.x + dx;
        m.z = snapped.z + dz;
        applyTransform(m);
        moveUnitGroup(m);
      }
      updateCompliance(); // live separation + trench feedback
    }
 else if (planDrag.kind === "tree") {
      planDrag.tree.x = Math.round(p.x + planDrag.grabX);
      planDrag.tree.z = Math.round(p.z + planDrag.grabZ);
      moveSceneryGroup(`tree${planDrag.tree.id}`, planDrag.tree.x, planDrag.tree.z);
    } else if (planDrag.kind === "drive") {
      drive.x = Math.round(p.x + planDrag.grabX);
      drive.z = Math.round(p.z + planDrag.grabZ);
      const g = document.getElementById("drive-layer");
      if (g) g.setAttribute("transform", driveTransform());
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
  const over = !!unitAtWorld(p) || !!treeAtWorld(p) || driveAtWorld(p);
  sitePanelEl.classList.toggle("over-object", over);
}

function cancelPlanDrag() {
  clearTimeout(breakoutTimer);
  if (planDrag && planDrag.moved) {
    // loadFrom rebuilds every item, so hold the selection by id across it
    const keep = selected && selected.id;
    loadFrom(JSON.parse(planDrag.snapshot));
    undoStack.pop();
    updateHistoryButtons();
    if (keep) { const again = items.find((i) => i.id === keep); if (again) select(again); }
  }
  planDrag = null;
  snapGuides = [];
  document.body.classList.remove("plan-dragging", "breaking-out");
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
      if (d.kind === "unit") { select(selected === d.primary ? null : d.primary); renderChrome(); }
      return;
    }
    if (d.kind === "unit" && blockedPairs().length > d.preBlocked) {
      undoStack.pop();
      updateHistoryButtons();
      loadFrom(JSON.parse(d.snapshot));
      toast("That blocks a door wall — butt against solid sides only");
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
    : d.kind === "tree" ? `t${d.tree.id}` : "drive";
  const now = Date.now();
  const isDouble = now - lastTap.t < 380 && lastTap.key === key;
  lastTap = { t: now, key };

  if (d.kind === "unit") {
    select(selected === d.primary ? null : d.primary);
    renderChrome();
  } else if (d.kind === "tree" && isDouble) {
    pushUndo();
    trees = trees.filter((t) => t !== d.tree);
    rebuildScenery();
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
    toast("Drag to move · double-tap to remove");
  } else {
    toast("Drag to re-route · double-tap to rotate");
  }
});

const sitePtrEnd = (e) => {
  sitePtrs.delete(e.pointerId);
  cancelPlanDrag();
  sitePanning = false;
};
sitePanelEl.addEventListener("pointercancel", sitePtrEnd);

sitePanelEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  siteZoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0018));
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
  if (pa.type.id === "__tree") {
    trees.push({ id: nextTreeId++, x: g.x, z: g.z, s: 1.2 });
    rebuildScenery();
    save();
    renderSitePlan();
    return;
  }
  const item = addItem(pa.type.id, g.x, g.z, 0);
  if (blockedPairs().length) {
    removeItem(item);
    undoStack.pop();
    updateHistoryButtons();
    toast("That blocks a door wall — butt against solid sides only");
  } else select(item);
  renderSitePlan();
});

// ------------------------------------------------------------- floor plans


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
  openDialog(document.getElementById("plan-modal"));
}
document.getElementById("btn-plan").addEventListener("click", () => {
  if (selected) openPlan(TYPE_BY_ID[selected.typeId]);
});
document.getElementById("plan-close").addEventListener("click", () =>
  closeDialog(document.getElementById("plan-modal")));

// ---- zoom buttons: pinch was the only way in, and it is undiscoverable ----

const zoomBy = (f) => siteZoomAt(innerWidth / 2, innerHeight / 2, f);
document.getElementById("site-zoom-in").addEventListener("click", () => zoomBy(1.6));
document.getElementById("site-zoom-out").addEventListener("click", () => zoomBy(1 / 1.6));

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
  toast(placing ? "Tap the plan to place this unit" : "Tap-to-place off");
});

// move the selected unit (and anything butted to it) so its centre lands at x,z
function placeSelectedAt(x, z) {
  if (!selected) return;
  const members = clusterOf(selected);
  const moving = new Set(members);
  const offs = members.map((m) => ({ m, dx: m.x - selected.x, dz: m.z - selected.z }));
  const before = JSON.stringify(serialize());
  const preBlocked = blockedPairs().length;
  const snapped = snapMove(selected, x, z, moving);
  for (const { m, dx, dz } of offs) { m.x = snapped.x + dx; m.z = snapped.z + dz; applyTransform(m); }
  snapGuides = [];
  if (blockedPairs().length > preBlocked) {
    loadFrom(JSON.parse(before));
    toast("That blocks a door wall — butt against solid sides only");
    return;
  }
  pushUndo.replace(before);
  save();
  updateStats();
  select(selected);
  renderSitePlan();
}
// a variant of pushUndo that records a state captured before the change
pushUndo.replace = (snapshot) => {
  undoStack.push(snapshot);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
};

function nudgeSelected(dx, dz) {
  if (!selected || mode !== "plan") return;
  const before = JSON.stringify(serialize());
  const preBlocked = blockedPairs().length;
  for (const m of clusterOf(selected)) { m.x += dx; m.z += dz; applyTransform(m); }
  if (blockedPairs().length > preBlocked) { loadFrom(JSON.parse(before)); toast("That blocks a door wall"); return; }
  pushUndo.replace(before);
  save();
  updateStats();
  select(selected);
  renderSitePlan();
}

// ---- dialogs -------------------------------------------------------------
//
// None of the three was a dialog: focus never moved into them, Escape did not
// close them, a backdrop tap did not either, and the whole page stayed
// tabbable behind.

let dialogReturn = null;
function openDialog(el) {
  dialogReturn = document.activeElement;
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
  return ["parts-modal", "plan-modal", "va-modal"]
    .map((id) => document.getElementById(id))
    .find((el) => el.classList.contains("open"));
}
for (const id of ["parts-modal", "plan-modal", "va-modal"]) {
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
             drive: [drive.x, drive.z, drive.rot] });
  toast("Acre cleared — ↩ to undo");
});

// ------------------------------------------------------------------- boot

const hashData = location.hash.startsWith("#d=") ? decodeShare(location.hash.slice(3)) : null;
let stored = null;
try { stored = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch {}
// A saved-but-empty acre is not the same as a first visit. Keying off
// items.length silently threw away a cleared layout on every reload.
const seeded = stored && typeof stored.v === "number" && Array.isArray(stored.items);
loadFrom(hashData || (seeded ? stored : EXAMPLE));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// The one teaching moment: spend it on what is not already obvious. Things
// drawn on a plan already look draggable; pinch and the add button do not.
setTimeout(() => toast("Drag to move · pinch to zoom · + to add"), 700);

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
        ud.roof.position.y = it.peek * 7;
        ud.roof.children[0].material = roofMat; // shared; opacity via scale illusion
        ud.roof.visible = it.peek < 0.98;
      }
      if (ud.wallMats) for (const m of ud.wallMats) m.opacity = 1 - it.peek * 0.72;
    }
  }
  if (shadowDirty) { sun.shadow.needsUpdate = true; shadowDirty = false; }
  controls.update();
  renderer.render(scene, camera);
}
startLoop();
