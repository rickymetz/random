// node --test ideas/container-compound/.tests/
//
// The directory is dotfile-prefixed on purpose: scripts/build.js filters
// dotfiles out of the copy into _site, so the tests never reach Pages.

import test from "node:test";
import assert from "node:assert/strict";
import { TYPES } from "../data.js";
import {
  JOIN_EPS, SNAP_FT,
  halfDims, gapBetween, overlapDepth, gapBand,
  clusterOf, snapMove, isFree, findSpot, unitExtents,
  stepHeading, shortWay,
} from "../geometry.js";

const T = Object.fromEntries(TYPES.map((t) => [t.id, t]));
// a 20' x 8' standard box, and the 8' x 8' deck
const u = (typeId, x, z, rot = 0) => ({ typeId, x, z, rot });
const box = (x, z, rot = 0) => u("sleeping", x, z, rot); // 20 x 8, tunnel
const deck = (x, z) => u("deck", x, z);

test("halfDims turns the footprint with the unit", () => {
  assert.deepEqual(halfDims(box(0, 0, 0), T), [10, 4]);
  assert.deepEqual(halfDims(box(0, 0, 1), T), [4, 10]);
  assert.deepEqual(halfDims(box(0, 0, 2), T), [10, 4]);
  assert.deepEqual(halfDims(box(0, 0, 3), T), [4, 10]);
});

test("gapBetween measures the clear ground between footprints", () => {
  // two 20' boxes on the same centreline, centres 30 ft apart: 10 ft clear
  assert.equal(gapBetween(box(0, 0), box(30, 0), T), 10);
  // butted end to end
  assert.equal(gapBetween(box(0, 0), box(20, 0), T), 0);
  // side by side, centres 12 ft apart across the 8' dimension: 4 ft clear
  assert.equal(gapBetween(box(0, 0), box(0, 12), T), 4);
  // diagonal: the gap is the corner-to-corner distance, not either axis.
  // 23 ft of centres is 3 ft clear on x; 12 ft is 4 ft clear on z.
  assert.equal(gapBetween(box(0, 0), box(23, 12), T), 5);
});

test("gapBetween cannot tell a butt from a stack, which is why overlapDepth exists", () => {
  assert.equal(gapBetween(box(0, 0), box(20, 0), T), 0);   // butted
  assert.equal(gapBetween(box(0, 0), box(2, 0), T), 0);    // nearly on top
  assert.ok(overlapDepth(box(0, 0), box(20, 0), T) <= 0);  // butted: no penetration
  assert.equal(overlapDepth(box(0, 0), box(2, 0), T), 8);  // 18 ft of overlap on x, 8 on z
  assert.equal(overlapDepth(box(0, 0), box(0, 0), T), 8);  // exactly on top
});

test("gapBand describes the strip of ground between two units", () => {
  const b = gapBand(box(0, 0), box(30, 0), T);
  assert.equal(b.axis, "x");
  assert.equal(b.gap, 10);
  assert.equal(b.x0, 10);
  assert.equal(b.x1, 20);
  assert.equal(b.overlap, 8); // fully overlapping across the 8 ft dimension
});

test("gapBand picks the axis with the larger gap", () => {
  // 40 ft apart on x, 2 ft on z -> the band runs along x
  assert.equal(gapBand(box(0, 0), box(40, 10), T).axis, "x");
  // 1 ft apart on x, 20 ft on z -> along z
  assert.equal(gapBand(box(0, 0), box(21, 40), T).axis, "z");
});

test("clusterOf follows butt-joins and stops at a real gap", () => {
  const a = box(0, 0), b = box(20, 0), c = box(40, 0);
  const far = box(200, 0);
  const items = [a, b, c, far];
  assert.equal(clusterOf(a, items, T).length, 3);
  assert.equal(clusterOf(far, items, T).length, 1);
});

test("clusterOf treats a gap just inside JOIN_EPS as joined", () => {
  const a = box(0, 0);
  const near = box(20 + JOIN_EPS - 0.01, 0);
  const past = box(20 + JOIN_EPS + 0.01, 0);
  assert.equal(clusterOf(a, [a, near], T).length, 2);
  assert.equal(clusterOf(a, [a, past], T).length, 1);
});

test("a deck is never part of a cluster", () => {
  const a = box(0, 0), d = deck(14, 0);
  assert.deepEqual(clusterOf(d, [a, d], T), [d]);
  assert.equal(clusterOf(a, [a, d], T).length, 1);
});

test("snapMove lands a free drag on whole feet", () => {
  const r = snapMove(box(0, 0), 12.4, -7.6, new Set(), [], T);
  assert.deepEqual([r.x, r.z], [12, -8]);
  assert.deepEqual(r.guides, []);
});

test("snapMove takes a centreline and reports the guide", () => {
  const other = box(40, 0);
  const moving = new Set();
  const r = snapMove(box(0, 0), 25, 0.9, moving, [other], T);
  assert.equal(r.z, 0, "snapped onto the other unit's centreline");
  assert.ok(r.guides.some((g) => g.axis === "z" && g.at === 0));
});

test("snapMove butts two units when they already overlap on the other axis", () => {
  const other = box(0, 0);
  // dragged to 19 ft: within SNAP_FT of the 20 ft butt position
  const r = snapMove(box(0, 0), 19.2, 0, new Set(), [other], T);
  assert.equal(r.x, 20);
});

test("snapMove ignores anything moving with the drag", () => {
  const other = box(40, 0);
  const moving = new Set([other]);
  const r = snapMove(box(0, 0), 25, 0.9, moving, [other], T);
  assert.deepEqual([r.x, r.z], [25, 1], "no snap: the only neighbour is coming too");
});

test("snapMove will not reach further than SNAP_FT", () => {
  const other = box(40, 0);
  const r = snapMove(box(0, 0), 0, SNAP_FT + 0.5, new Set(), [other], T);
  assert.equal(r.z, Math.round(SNAP_FT + 0.5));
});

test("isFree keeps the rated-wall band clear, not just a courtesy foot", () => {
  const a = box(0, 0);
  const t = T.sleeping;
  // two 20 ft boxes end to end need 10 ft of half each, plus the 10 ft band:
  // 30 ft of centres before the candidate is clear
  assert.equal(isFree(29, 0, t, [a], T, 10), false);
  assert.equal(isFree(31, 0, t, [a], T, 10), true);
  // and one foot of pad would have let it land at 21, already redlined
  assert.equal(isFree(21, 0, t, [a], T, 1), true);
});

test("isFree lets a deck sit close, because it is meant to", () => {
  const a = box(0, 0);
  assert.equal(isFree(15, 0, T.deck, [a], T, 10), true);
});

test("findSpot returns somewhere free, and clamps onto the sheet", () => {
  const clamp = (v) => Math.round(Math.max(-100, Math.min(100, v)));
  const a = box(0, 0);
  const spot = findSpot(T.sleeping, 0, 0, [a], T, 10, clamp, clamp);
  assert.ok(isFree(spot.x, spot.z, T.sleeping, [a], T, 10));
  assert.ok(spot.x >= -100 && spot.x <= 100 && spot.z >= -100 && spot.z <= 100);
});

test("findSpot gives up gracefully rather than looping forever", () => {
  // a clamp so tight nothing can ever be free
  const clamp = () => 0;
  const a = box(0, 0);
  assert.deepEqual(findSpot(T.sleeping, 0, 0, [a], T, 10, clamp, clamp), { x: 0, z: 0 });
});

test("unitExtents is the bounding box of the footprints, not the centres", () => {
  const e = unitExtents([box(0, 0), box(30, 10)], T);
  assert.deepEqual(e, { x0: -10, x1: 40, z0: -4, z1: 14 });
});

test("unitExtents on an empty acre is empty, not zero", () => {
  const e = unitExtents([], T);
  assert.equal(e.x0, Infinity);
  assert.equal(e.x1, -Infinity);
});

// ---- compass stepping -------------------------------------------------------

const STEP = Math.PI / 4;
const TOL = 0.02;
const deg = (r) => Math.round((r * 180) / Math.PI);
const rad = (d) => (d * Math.PI) / 180;

test("stepHeading walks the grid clockwise, which is the azimuth going down", () => {
  assert.equal(deg(stepHeading(0, STEP, TOL)), -45);
  assert.equal(deg(stepHeading(rad(-45), STEP, TOL)), -90);
  assert.equal(deg(stepHeading(rad(-90), STEP, TOL)), -135);
  assert.equal(deg(stepHeading(rad(-135), STEP, TOL)), -180);
});

test("an off-grid heading lands on the first mark it passes, not the nearest", () => {
  // 11.8 deg is nearer 0 than 45, and 40 deg is nearer 45 than 0 — both step
  // down to 0, because the step is clockwise rather than to whichever is closer
  assert.equal(deg(stepHeading(rad(11.8), STEP, TOL)), 0);
  assert.equal(deg(stepHeading(rad(40), STEP, TOL)), 0);
  assert.equal(deg(stepHeading(rad(47.6), STEP, TOL)), 45);
});

test("the tolerance is what stops a press being a dead button", () => {
  // a damped camera comes to rest just past the mark it was sent to. Without a
  // tolerance the next mark below -44.7 deg is -45, the mark it is already on,
  // and the press moves the view a third of a degree and looks broken.
  assert.equal(deg(stepHeading(rad(-44.7), STEP, 0)), -45);
  assert.equal(deg(stepHeading(rad(-44.7), STEP, TOL)), -90);
  // and drift the other way is a step, not a double step
  assert.equal(deg(stepHeading(rad(-45.3), STEP, TOL)), -90);
});

test("stepHeading takes a whole turn to come back, in eight presses", () => {
  let az = 0;
  const seen = [];
  for (let i = 0; i < 8; i++) {
    az = stepHeading(az, STEP, TOL);
    seen.push(((deg(az) % 360) + 360) % 360);
  }
  assert.deepEqual(seen, [315, 270, 225, 180, 135, 90, 45, 0]);
});

test("shortWay never takes the long road round the seam", () => {
  // from just under +180 to just over -180 is two degrees, not 358
  assert.equal(deg(shortWay(rad(179), rad(-179))), 2);
  assert.equal(deg(shortWay(rad(-179), rad(179))), -2);
  assert.equal(deg(shortWay(0, rad(-45))), -45);
  // every step of a full turn is one mark wide, seam included
  let az = 0;
  for (let i = 0; i < 8; i++) {
    const d = shortWay(az, stepHeading(az, STEP, TOL));
    assert.ok(Math.abs(deg(d)) === 45, `step ${i} moved ${deg(d)} degrees`);
    az += d;
  }
});
