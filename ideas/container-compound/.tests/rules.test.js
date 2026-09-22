import test from "node:test";
import assert from "node:assert/strict";
import { TYPES } from "../data.js";
import {
  DIRS, apertureFaces, blockedPairs, overlappingPairs, normalizePayload,
} from "../rules.js";

const T = Object.fromEntries(TYPES.map((t) => [t.id, t]));
const u = (typeId, x, z, rot = 0) => ({ typeId, x, z, rot });

// "sleeping" is a tunnel box: door ends at both ends.
// "office" is open-side: one door end plus a glazed long side.
// "hobby" (Workshop) is standard: one door end. 10 x 8.
// "deck" is a platform with no openings at all.
const EAST = [1, 0], WEST = [-1, 0], NORTH = [0, -1], SOUTH = [0, 1];

test("a deck has no apertures to block", () => {
  assert.deepEqual(apertureFaces(u("deck", 0, 0), T), []);
});

test("a standard box opens at one end, and the end turns with it", () => {
  assert.deepEqual(apertureFaces(u("hobby", 0, 0, 0), T), [EAST]);
  assert.deepEqual(apertureFaces(u("hobby", 0, 0, 1), T), [NORTH]);
  assert.deepEqual(apertureFaces(u("hobby", 0, 0, 2), T), [WEST]);
  assert.deepEqual(apertureFaces(u("hobby", 0, 0, 3), T), [SOUTH]);
});

test("a tunnel box opens at both ends", () => {
  assert.deepEqual(apertureFaces(u("sleeping", 0, 0, 0), T), [EAST, WEST]);
});

test("an open-side box opens at one end and along one side", () => {
  const faces = apertureFaces(u("office", 0, 0, 0), T);
  assert.equal(faces.length, 2);
  assert.deepEqual(faces[0], EAST);
  assert.deepEqual(faces[1], DIRS[3]); // the glazed local +z side
});

test("butting a solid side to a solid side is legal", () => {
  // two Workshop minis side by side across their 8 ft dimension: both door
  // ends face east, neither faces the other
  const a = u("hobby", 0, 0), b = u("hobby", 0, 8);
  assert.deepEqual(blockedPairs([a, b], T), []);
});

test("butting anything against a door end is not", () => {
  // Workshop is 10 x 8 with its door end east; park another right on it
  const a = u("hobby", 0, 0), b = u("hobby", 10, 0);
  assert.equal(blockedPairs([a, b], T).length, 1);
});

test("a tunnel box is blocked from either end", () => {
  const a = u("sleeping", 0, 0);            // door ends east and west
  // a Workshop turned a quarter gives half-dims [4, 5]: 10 + 4 = 14 ft of
  // centres puts them face to face
  assert.equal(blockedPairs([a, u("hobby", 14, 0, 1)], T).length, 1, "east end");
  assert.equal(blockedPairs([a, u("hobby", -14, 0, 1)], T).length, 1, "west end");
});

test("units that are not touching are never blocked, whatever they face", () => {
  const a = u("hobby", 0, 0), b = u("hobby", 40, 0, 2); // door ends staring at each other
  assert.deepEqual(blockedPairs([a, b], T), []);
});

test("a deck can be butted to a door end: that is what a deck is for", () => {
  const a = u("hobby", 0, 0), d = u("deck", 9, 0);
  assert.deepEqual(blockedPairs([a, d], T), []);
});

test("overlappingPairs finds two boxes on top of each other", () => {
  assert.equal(overlappingPairs([u("hobby", 0, 0), u("hobby", 2, 0)], T).length, 1);
});

test("overlappingPairs lets a butt-join alone", () => {
  assert.deepEqual(overlappingPairs([u("hobby", 0, 0), u("hobby", 10, 0)], T), []);
});

test("a deck may tuck under a container, but not under another deck", () => {
  assert.deepEqual(overlappingPairs([u("hobby", 0, 0), u("deck", 0, 0)], T), []);
  assert.equal(overlappingPairs([u("deck", 0, 0), u("deck", 2, 0)], T).length, 1);
});

// ---- the untrusted-payload boundary ----

const clamp = (v) => Math.max(-100, Math.min(100, v));
const DRIVE = { x: 60, z: 60, rot: 0 };
const norm = (raw) => normalizePayload(raw, T, clamp, DRIVE);

test("garbage in gives an empty layout, not a throw", () => {
  for (const bad of [null, undefined, 0, "", "nope", [], true]) {
    const out = norm(bad);
    assert.deepEqual(out.items, []);
    assert.equal(out.name, "Container Compound");
  }
});

test("rows that are not four-tuples are dropped", () => {
  const out = norm({ items: [["hobby", 1, 2, 0], ["hobby", 1], "hobby", null, {}, []] });
  assert.equal(out.items.length, 1);
});

test("a type id that is not a type is dropped, including inherited ones", () => {
  // `TYPE_BY_ID[typeId]` used to be truthy for these
  const out = norm({ items: [
    ["toString", 0, 0, 0], ["constructor", 0, 0, 0], ["__proto__", 0, 0, 0],
    ["hobby", 0, 0, 0],
  ] });
  assert.deepEqual(out.items, [["hobby", 0, 0, 0]]);
});

test("positions are clamped onto the sheet and rotations wrapped", () => {
  const out = norm({ items: [["hobby", 1e9, -1e9, 7], ["hobby", NaN, "x", -1]] });
  assert.deepEqual(out.items[0], ["hobby", 100, -100, 3]);
  assert.deepEqual(out.items[1], ["hobby", 0, 0, 3]);
});

test("a v1 payload with no scenery reports none rather than inventing some", () => {
  const out = norm({ v: 1, items: [["hobby", 0, 0, 0]] });
  assert.equal(out.trees, null, "the caller falls back to the default acre");
  assert.equal(out.drive, null);
  assert.deepEqual(out.wells, []);
});

test("tree scale is held inside something a tree could be", () => {
  const out = norm({ trees: [[0, 0, 1e6], [0, 0, -5], [0, 0, "big"]] });
  assert.deepEqual(out.trees.map((t) => t[2]), [3, 0.3, 1.2]);
});

test("the setback is held inside a plausible range", () => {
  assert.equal(norm({ setback: -5 }).setback, 0);
  assert.equal(norm({ setback: 1e9 }).setback, 80);
  assert.equal(norm({ setback: "25" }).setback, 25);
  assert.equal(norm({}).setback, 25);
});

test("a name is a short string or the default", () => {
  assert.equal(norm({ name: 42 }).name, "Container Compound");
  assert.equal(norm({ name: "x".repeat(500) }).name.length, 60);
  assert.equal(norm({ name: "North Meadow" }).name, "North Meadow");
});

test("an enormous payload is truncated rather than loaded", () => {
  // the pair passes are O(n^2) and run per render, so the cap is what keeps a
  // hostile share link from freezing first paint
  const out = norm({ items: Array.from({ length: 5000 }, () => ["hobby", 0, 0, 0]) });
  assert.equal(out.items.length, 120);
});

test("a normalized payload round-trips through normalize unchanged", () => {
  const once = norm({
    items: [["hobby", 12.4, -3.6, 5]],
    trees: [[10, 10, 1.2]],
    drive: [1, 2, 9],
    wells: [[5, 5]],
    drains: [[6, 6]],
    setback: 30,
    name: "Round Trip",
  });
  assert.deepEqual(norm(once), once);
});
