// Board art: themed roads, chunky 3D space tiles with drawn icons, and
// helpers the map painters share. Static layers are painted once into a
// cached canvas by board.js; only the animated bits redraw each frame.

import { INK, circle } from "./gfx.js";

/** Deterministic random numbers, so a map's scenery is the same every time. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** How close (x, y) comes to any road segment (for keeping scenery off the paths). */
export function roadDist(nodes, x, y) {
  let best = Infinity;
  for (const a of nodes) for (const n of a.next) {
    const b = nodes[n], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L));
    best = Math.min(best, Math.hypot(a.x + dx * k - x, a.y + dy * k - y));
  }
  return best;
}

// each edge as a smooth cubic (Catmull-Rom through its neighbours along the arrows)
function edgePaths(nodes) {
  const prev = nodes.map(() => []);
  nodes.forEach((a, i) => a.next.forEach((n) => prev[n].push(i)));
  const out = [];
  nodes.forEach((a, i) => a.next.forEach((n) => {
    const b = nodes[n], p = nodes[prev[i].find((j) => nodes[j].next.length === 1) ?? prev[i][0]] || a, q = nodes[b.next[0]] || b;
    const c1 = [a.x + (b.x - p.x) / 6, a.y + (b.y - p.y) / 6], c2 = [b.x - (q.x - a.x) / 6, b.y - (q.y - a.y) / 6];
    out.push((g) => { g.moveTo(a.x, a.y); g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b.x, b.y); });
  }));
  return out;
}

/** Stroke the whole road network as layered passes: [[width, colour, dash?, glow?], …] */
export function drawRoads(g, nodes, passes) {
  const edges = edgePaths(nodes);
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  for (const [w, col, dash, glow] of passes) {
    g.lineWidth = w; g.strokeStyle = col; g.setLineDash(dash || []);
    g.shadowColor = glow || "transparent"; g.shadowBlur = glow ? 18 : 0;
    g.beginPath(); for (const e of edges) e(g); g.stroke();
  }
  g.restore();
}

const TILE = {
  B: ["#1fb6ff", "#0a5f9e"], R: ["#ff3b6b", "#8f1030"], $: ["#ffd400", "#a07800"], D: ["#b44dff", "#5a1a8f"],
  "?": ["#f2ecdf", "#9d937e"], T: ["#ff8a00", "#8f3f00"], P: ["#39e07a", "#13693a"], V: ["#ff5a1f", "#8f2200"],
};

/** A chunky tile: extruded disc, glossy top, and the space's icon. */
export function drawTile(g, x, y, k, big) {
  const rx = big ? 40 : 33, ry = big ? 32 : 26, depth = 9, [top, side] = TILE[k] || TILE.B;
  g.save();
  g.beginPath(); g.ellipse(x + 3, y + depth + 6, rx + 2, ry * 0.8, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.45)"; g.fill(); // shadow
  g.beginPath(); g.ellipse(x, y + depth, rx, ry, 0, 0, Math.PI); g.lineTo(x - rx, y); g.ellipse(x, y, rx, ry, 0, Math.PI, 0, true); g.closePath();
  g.fillStyle = side; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke(); // side wall
  const gr = g.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 2, x, y, rx);
  gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(0.35, top); gr.addColorStop(1, side);
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = gr; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.ellipse(x, y, rx * 0.72, ry * 0.68, 0, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = "rgba(255,255,255,.35)"; g.stroke();
  icon(g, x, y, k, big ? 1.2 : 1);
  g.restore();
}

// icons: white with an ink outline, drawn on the tile top
function icon(g, x, y, k, s) {
  const W_ = "#fff";
  g.lineJoin = "round"; g.lineCap = "round";
  const ink = (w) => { g.lineWidth = w; g.strokeStyle = INK; g.stroke(); };
  if (k === "B") { // a little coin
    g.beginPath(); g.ellipse(x, y, 11 * s, 9 * s, 0, 0, Math.PI * 2); g.fillStyle = "#ffe15a"; g.fill(); ink(3);
    g.beginPath(); g.ellipse(x, y, 5 * s, 4 * s, 0, 0, Math.PI * 2); g.strokeStyle = "#b88a00"; g.lineWidth = 2; g.stroke();
  } else if (k === "R") { // spiky minus: a hazard
    g.beginPath(); g.roundRect(x - 13 * s, y - 4 * s, 26 * s, 8 * s, 3); g.fillStyle = W_; g.fill(); ink(3);
  } else if (k === "$") { // money sack
    g.beginPath(); g.moveTo(x - 6 * s, y - 11 * s); g.quadraticCurveTo(x, y - 6 * s, x + 6 * s, y - 11 * s); g.lineTo(x + 4 * s, y - 6 * s);
    g.bezierCurveTo(x + 17 * s, y - 2 * s, x + 14 * s, y + 12 * s, x, y + 12 * s); g.bezierCurveTo(x - 14 * s, y + 12 * s, x - 17 * s, y - 2 * s, x - 4 * s, y - 6 * s); g.closePath();
    g.fillStyle = "#f2e2b8"; g.fill(); ink(3);
    g.font = `900 ${14 * s}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#1b8f3a"; g.fillText("$", x, y + 3 * s);
  } else if (k === "D") { // crossed swords
    for (const d of [-1, 1]) {
      g.beginPath(); g.moveTo(x - 12 * s * d, y - 11 * s); g.lineTo(x + 10 * s * d, y + 9 * s); g.lineWidth = 7 * s; g.strokeStyle = INK; g.stroke();
      g.lineWidth = 3.5 * s; g.strokeStyle = W_; g.stroke();
      g.beginPath(); g.moveTo(x + 4 * s * d, y + 10 * s); g.lineTo(x + 12 * s * d, y + 2 * s); g.lineWidth = 5 * s; g.strokeStyle = "#ffd400"; g.stroke();
    }
  } else if (k === "?") {
    g.font = `900 ${26 * s}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 5; g.strokeStyle = INK; g.strokeText("?", x, y + 1); g.fillStyle = "#b44dff"; g.fillText("?", x, y + 1);
  } else if (k === "T") { // striped barrier
    g.save(); g.beginPath(); g.roundRect(x - 17 * s, y - 6 * s, 34 * s, 12 * s, 3); g.clip();
    for (let i = -3; i < 4; i++) { g.fillStyle = i % 2 ? "#fff" : "#e0103a"; g.beginPath(); g.moveTo(x + i * 8 * s, y - 7 * s); g.lineTo(x + (i + 1) * 8 * s, y - 7 * s); g.lineTo(x + i * 8 * s, y + 7 * s); g.lineTo(x + (i - 1) * 8 * s, y + 7 * s); g.fill(); }
    g.restore(); g.beginPath(); g.roundRect(x - 17 * s, y - 6 * s, 34 * s, 12 * s, 3); ink(3);
  } else if (k === "P") { // pipe mouth
    g.beginPath(); g.ellipse(x, y, 17 * s, 12 * s, 0, 0, Math.PI * 2); g.fillStyle = "#9aa7a0"; g.fill(); ink(3);
    g.beginPath(); g.ellipse(x, y + 1, 11 * s, 7 * s, 0, 0, Math.PI * 2); g.fillStyle = "#08150d"; g.fill();
    g.beginPath(); g.ellipse(x, y + 3, 6 * s, 3 * s, 0, 0, Math.PI * 2); g.fillStyle = "#39ff14"; g.fill();
  } else if (k === "V") { // mini volcano
    g.beginPath(); g.moveTo(x - 18 * s, y + 10 * s); g.lineTo(x - 6 * s, y - 9 * s); g.lineTo(x + 6 * s, y - 9 * s); g.lineTo(x + 18 * s, y + 10 * s); g.closePath();
    g.fillStyle = "#5a2a1a"; g.fill(); ink(3);
    g.beginPath(); g.moveTo(x - 5 * s, y - 9 * s); g.lineTo(x - 2 * s, y + 4 * s); g.lineTo(x + 2 * s, y - 2 * s); g.lineTo(x + 5 * s, y - 9 * s); g.fillStyle = "#ffb000"; g.fill();
  }
}

/** A soft glowing blob of light. */
export function glow(g, x, y, r, col, a = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.save(); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
}

export { circle };
