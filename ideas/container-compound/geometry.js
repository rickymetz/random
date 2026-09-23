// Footprint geometry and snapping. Everything here is a pure function of the
// items you hand it — no DOM, no THREE, no module state — so it can be
// exercised directly by `node --test` instead of only through a browser.
//
// An "item" is { typeId, x, z, rot }: a centre in feet and a quarter-turn
// count. A "types" argument is the id -> type lookup from data.js.

export const JOIN_EPS = 0.75;  // gaps at or under this read as butted/joined
export const SNAP_FT = 1.8;    // how close a drag has to come to take a snap
export const OVERLAP_EPS = 0.5; // penetration under this is a butt, not a stack

// half the footprint, along world x and z, with the unit's rotation applied
export function halfDims(it, types) {
  const t = types[it.typeId];
  return it.rot % 2 ? [t.wid / 2, t.len / 2] : [t.len / 2, t.wid / 2];
}

// gap between two axis-aligned footprints (0 = touching or overlapping)
export function gapBetween(a, b, types) {
  const [aw, ad] = halfDims(a, types), [bw, bd] = halfDims(b, types);
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
export function overlapDepth(a, b, types) {
  const [aw, ad] = halfDims(a, types), [bw, bd] = halfDims(b, types);
  return Math.min((aw + bw) - Math.abs(a.x - b.x), (ad + bd) - Math.abs(a.z - b.z));
}

// the band of empty ground between two footprints, for dimensions and hatching
export function gapBand(a, b, types) {
  const [aw, ad] = halfDims(a, types), [bw, bd] = halfDims(b, types);
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

// Every unit reachable from `root` by butt-joins, `root` included. Decks are
// never part of a cluster: one is meant to tuck against a container.
export function clusterOf(root, items, types) {
  if (types[root.typeId].deck) return [root];
  const units = items.filter((i) => !types[i.typeId].deck);
  const set = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of units) {
      if (set.has(u)) continue;
      for (const m of set) {
        if (gapBetween(u, m, types) <= JOIN_EPS) { set.add(u); grew = true; break; }
      }
    }
  }
  return [...set];
}

// Where a dragged unit wants to land: centrelines, flush edges and butt-joins
// against anything not moving with it, whichever is nearest within SNAP_FT.
// Returns the snapped centre plus the guide lines worth drawing.
export function snapMove(primary, rawX, rawZ, moving, items, types) {
  const [hw, hd] = halfDims(primary, types);
  const guides = [];
  let bestX = null, bestZ = null;
  for (const o of items) {
    if (moving.has(o)) continue;
    const [ow, od] = halfDims(o, types);
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
  if (bestX && bestX.line !== undefined) guides.push({ axis: "x", at: bestX.line });
  if (bestZ && bestZ.line !== undefined) guides.push({ axis: "z", at: bestZ.line });
  return {
    x: bestX ? bestX.v : Math.round(rawX),
    z: bestZ ? bestZ.v : Math.round(rawZ),
    guides,
  };
}

// Is there room for `type` centred here? `pad` clears the rated-wall band
// rather than a courtesy foot, so an auto-placed unit is not already
// redlined the moment it lands.
export function isFree(x, z, type, items, types, pad) {
  const clear = type.deck ? 1 : pad;
  const hw = type.len / 2 + clear, hd = type.wid / 2 + clear;
  for (const it of items) {
    const t = types[it.typeId];
    const ihw = (it.rot % 2 ? t.wid : t.len) / 2;
    const ihd = (it.rot % 2 ? t.len : t.wid) / 2;
    if (Math.abs(x - it.x) < hw + ihw && Math.abs(z - it.z) < hd + ihd) return false;
  }
  return true;
}

// The nearest free spot to (ox, oz), searched outwards in rings. `clampX` and
// `clampZ` keep the result on the sheet.
export function findSpot(type, ox, oz, items, types, pad, clampX, clampZ) {
  ox = clampX(ox); oz = clampZ(oz);
  const step = 4;
  for (let r = 0; r < 26; r++) {
    for (let a = 0; a < Math.max(1, r * 8); a++) {
      const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
      const x = clampX(ox + Math.cos(ang) * r * step);
      const z = clampZ(oz + Math.sin(ang) * r * step);
      if (isFree(x, z, type, items, types, pad)) return { x, z };
    }
  }
  return { x: Math.round(ox), z: Math.round(oz) };
}

// the bounding box of everything built, in feet
export function unitExtents(items, types) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const it of items) {
    const [hw, hd] = halfDims(it, types);
    x0 = Math.min(x0, it.x - hw); x1 = Math.max(x1, it.x + hw);
    z0 = Math.min(z0, it.z - hd); z1 = Math.max(z1, it.z + hd);
  }
  return { x0, x1, z0, z1 };
}

// Stepping a camera heading round a compass grid, one mark at a time.
//
// three.js measures the azimuth as atan2(x, z) about the target, so the view
// turning clockwise is the azimuth going *down*: the next mark clockwise is the
// next multiple of `step` below where you are. A heading that is off the grid
// lands on the first mark it passes, which is what makes one press both a snap
// and a step.
//
// `tol` is the whole trick. A damped camera never settles exactly on a mark —
// it comes to rest a few hundredths of a degree either side — and an exact test
// puts a heading that drifted past the mark back onto the mark it is already
// at, which reads as a dead button. Anything within `tol` counts as on the
// mark and steps on to the next one.
export function stepHeading(az, step, tol = 0) {
  return (Math.ceil((az - tol) / step) - 1) * step;
}

// the shortest signed way round from `az` to `to`, so a step across the ±180°
// seam is still a step and not a lap
export function shortWay(az, to) {
  const d = to - az;
  return Math.atan2(Math.sin(d), Math.cos(d));
}
