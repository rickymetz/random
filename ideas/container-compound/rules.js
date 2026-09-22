// The code checks, and the boundary where an untrusted payload becomes a
// layout. Pure functions of their arguments, for the same reason geometry.js
// is: these are the rules the drawing asserts, and a rule that is only ever
// exercised by clicking around is a rule nobody has checked.

import { halfDims, JOIN_EPS, OVERLAP_EPS, overlapDepth } from "./geometry.js";

export const SEP_CLEAR = 10; // gap giving both units >=5 ft to the imaginary line (VRC R302.1)
export const EXEMPT_SF = 256; // VCC 108.2 / VRC R105.2 accessory exemption

// local +x rotated into world by rot steps (rotation.y = rot * PI/2)
export const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];

// World-axis directions of a unit's aperture faces. Nothing is ever cut into a
// container, so every opening is at a factory door end — or, on an open-side
// box, the factory side.
export function apertureFaces(it, types) {
  const t = types[it.typeId];
  if (t.deck) return [];
  const r = it.rot % 4;
  const px = DIRS[r]; // door end at local +x on every variant
  const faces = [px];
  // DIRS[(r + 2) % 4] rather than negating px: negating gives -0 for the
  // zero component, which compares equal but reads as a different vector
  if (t.variant === "tunnel") faces.push(DIRS[(r + 2) % 4]);
  if (t.variant === "openside") faces.push(DIRS[(it.rot + 3) % 4]); // glazed local +z side
  return faces;
}

// Pairs butted against one another's aperture face: entry and egress blocked.
export function blockedPairs(items, types) {
  const units = items.filter((i) => !types[i.typeId].deck);
  const out = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      const [aw, ad] = halfDims(a, types), [bw, bd] = halfDims(b, types);
      const gx = Math.abs(a.x - b.x) - (aw + bw);
      const gz = Math.abs(a.z - b.z) - (ad + bd);
      if (gx > JOIN_EPS || gz > JOIN_EPS) continue; // not touching
      const axis = gx >= gz ? "x" : "z";
      const s = axis === "x" ? Math.sign(b.x - a.x) || 1 : Math.sign(b.z - a.z) || 1;
      const faceA = axis === "x" ? [s, 0] : [0, s]; // A's face toward B
      const hit = (it, f) => apertureFaces(it, types).some((d) => d[0] === f[0] && d[1] === f[1]);
      if (hit(a, faceA) || hit(b, [-faceA[0], -faceA[1]])) out.push([a, b]);
    }
  }
  return out;
}

// Pairs whose footprints genuinely intersect. A deck tucking under a container
// is the one legal interpenetration; two of either kind is not.
export function overlappingPairs(items, types) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (types[a.typeId].deck !== types[b.typeId].deck) continue;
      if (overlapDepth(a, b, types) > OVERLAP_EPS) out.push([a, b]);
    }
  }
  return out;
}

// ---- the untrusted-payload boundary ---------------------------------------
//
// Share links and localStorage both arrive here. A malformed payload used to
// brick the app permanently: it was written back to storage on the way past,
// so every reload replayed the same crash.

export const MAX_ITEMS = 400, MAX_TREES = 200, MAX_POINTS = 20;

export const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
export const rot4 = (v) => (((v | 0) % 4) + 4) % 4;

// Keep only what is recognisably a layout, and clamp the rest onto the sheet.
// `onSheet` is the caller's clamp to the drawable area; `driveDefault` is what
// a payload with no drive falls back to.
export function normalizePayload(raw, types, onSheet, driveDefault) {
  const out = { v: 2, items: [], trees: null, drive: null };
  const data = raw && typeof raw === "object" ? raw : null;
  if (!data) return { ...out, wells: [], drains: [], setback: 25, name: "Container Compound" };
  if (Array.isArray(data.items)) {
    for (const row of data.items.slice(0, MAX_ITEMS)) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const [typeId, x, z, rot] = row;
      // a plain object inherits toString/constructor/__proto__, all of which
      // used to pass `if (types[typeId])` and reach buildUnit
      if (typeof typeId !== "string" || !Object.hasOwn(types, typeId)) continue;
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
    ? rows.slice(0, MAX_POINTS).filter((r) => Array.isArray(r) && r.length >= 2)
        .map((r) => [onSheet(num(r[0])), onSheet(num(r[1]))])
    : [];
  out.wells = pts(data.wells);
  out.drains = pts(data.drains);
  out.setback = Math.max(0, Math.min(80, num(data.setback, 25)));
  out.name = typeof data.name === "string" ? data.name.slice(0, 60) : "Container Compound";
  if (Array.isArray(data.drive) && data.drive.length >= 3) {
    out.drive = [onSheet(num(data.drive[0], driveDefault.x)),
                 onSheet(num(data.drive[1], driveDefault.z)),
                 rot4(num(data.drive[2]))];
  }
  return out;
}
