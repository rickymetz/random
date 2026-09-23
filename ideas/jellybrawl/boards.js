// The board maps. Each one is a directed graph of spaces: a node is
// { x, y, k, next: [ids], label? }, where k is the kind of space:
//   B blue +3 · R red −3 · $ shop · D duel · ? event · T toll (pay on passing)
//   P pipe (warps to its pair) · V volcano (erupts: every rival pays you 3)
// A node with two `next`s is a fork: the player picks a path on their phone.
// Each map also has a theme (colours plus a backdrop painter).

import { W, H, INK, circle, rrect, text } from "./gfx.js";

// ------------------------------------------------------------- building
function graph() {
  const nodes = [];
  const add = (x, y, k) => (nodes.push({ x, y, k, next: [] }), nodes.length - 1);
  return {
    nodes,
    add,
    link: (a, b) => nodes[a].next.push(b),
    // a chain of spaces along points; links them in order, returns ids
    chain(pts, kinds) {
      const ids = pts.map(([x, y], i) => add(x, y, kinds[i] || "B"));
      for (let i = 0; i + 1 < ids.length; i++) nodes[ids[i]].next.push(ids[i + 1]);
      return ids;
    },
  };
}
// n points along an ellipse arc from a0 to a1 (radians; +y is down), ends included
const arc = (cx, cy, rx, ry, a0, a1, n) => Array.from({ length: n }, (_, i) => { const a = a0 + ((a1 - a0) * i) / (n - 1); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
// n points strictly between p and q
const between = (p, q, n) => Array.from({ length: n }, (_, i) => { const k = (i + 1) / (n + 1); return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]; });
// n points strictly between p and q along a quadratic curve through control c
const curve = (p, c, q, n) => Array.from({ length: n }, (_, i) => { const k = (i + 1) / (n + 1), u = 1 - k; return [u * u * p[0] + 2 * u * k * c[0] + k * k * q[0], u * u * p[1] + 2 * u * k * c[1] + k * k * q[1]]; });

// ------------------------------------------------------------ Neon City
// A big loop, and a TOLL shortcut straight across the middle that skips the
// whole top half (6 coins every time you take it).
function neonCity() {
  const G = graph();
  // clockwise stadium: top row → right bend → bottom row → left bend
  const pts = [
    ...between([470, 270], [1450, 270], 10),
    ...arc(1450, 610, 300, 340, -Math.PI / 2, Math.PI / 2, 7).slice(0, 6),
    ...between([1450, 950], [470, 950], 10),
    ...arc(470, 610, 300, 340, Math.PI / 2, (3 * Math.PI) / 2, 7).slice(0, 6),
  ];
  const kinds = "BB$BR?BDBB" + "BRBBB?" + "BB$BDBRBBB" + "BB?BRB";
  const loop = G.chain(pts, kinds);
  G.link(loop[loop.length - 1], loop[0]);
  // left apex (leftmost) → right apex (rightmost), straight across
  const iL = loop.reduce((a, b) => (G.nodes[b].x < G.nodes[a].x ? b : a)), iR = loop.reduce((a, b) => (G.nodes[b].x > G.nodes[a].x ? b : a));
  const sc = G.chain(between([G.nodes[iL].x, 610], [G.nodes[iR].x, 610], 7), "TB?DBRB");
  G.link(iL, sc[0]); G.link(sc[sc.length - 1], iR);
  G.nodes[sc[0]].label = "Toll shortcut (6 coins)";
  G.nodes[G.nodes[iL].next[0]].label = "The long way round";
  return {
    name: "Neon City", start: loop[16], nodes: G.nodes,
    theme: { hue: 265, path: "#ff2a6d", glow: "#05d9e8" },
    backdrop(g, t, api) {
      api.bg(265, W / 2, H / 2, false);
      // skyline silhouettes inside the loop
      for (let i = 0; i < 16; i++) {
        const x = 470 + i * 64, h = 60 + ((i * 53) % 140);
        rrect(g, x, 880 - h, 52, h, 2, "rgba(13,2,33,.75)", "rgba(5,217,232,.35)", 2);
        for (let y = 880 - h + 12; y < 870; y += 22) { g.fillStyle = (i + y) % 3 ? "rgba(249,240,2,.35)" : "rgba(255,42,109,.35)"; g.fillRect(x + 10, y, 8, 8); g.fillRect(x + 32, y, 8, 8); }
      }
      rrect(g, 560, 340, 800, 160, 14, "rgba(13,2,33,.55)");
      text(g, "NEON CITY", 960, 420, 80, "rgba(255,42,109,.35)", "center", 900);
    },
  };
}

// ---------------------------------------------------------- Slime Sewers
// A figure-8 of two loops that meet at a junction: every lap you choose
// which loop to run. Two pairs of pipes warp you across.
function slimeSewers() {
  const G = graph();
  const hub = G.add(960, 610, "B");
  const L = G.chain(arc(580, 610, 360, 320, -0.5, -2 * Math.PI + 0.5, 13), "BB$BPB?BRBDBB");
  const R = G.chain(arc(1340, 610, 360, 320, Math.PI + 0.5, 3 * Math.PI - 0.5, 13), "BBRBDB?BPB$BB");
  G.link(hub, L[0]); G.link(L[L.length - 1], hub);
  G.link(hub, R[0]); G.link(R[R.length - 1], hub);
  G.nodes[L[0]].label = "West tunnel";
  G.nodes[R[0]].label = "East tunnel";
  // pipes: each P warps to its pair
  const pipes = [L, R].map((ids) => ids.find((i) => G.nodes[i].k === "P"));
  G.nodes[pipes[0]].pair = pipes[1]; G.nodes[pipes[1]].pair = pipes[0];
  return {
    name: "Slime Sewers", start: hub, nodes: G.nodes,
    theme: { hue: 140, path: "#39ff14", glow: "#39ff14" },
    backdrop(g, t) {
      g.fillStyle = "#06140c"; g.fillRect(0, 0, W, H);
      // brick courses and dripping slime
      g.strokeStyle = "rgba(57,255,20,.07)"; g.lineWidth = 3;
      for (let y = 160; y < H; y += 46) for (let x = (y / 46) % 2 ? 0 : 45; x < W; x += 90) g.strokeRect(x, y, 90, 46);
      for (let i = 0; i < 12; i++) {
        const x = 80 + i * 160, len = 30 + ((t * 40 + i * 37) % 90);
        g.fillStyle = "rgba(57,255,20,.35)"; g.fillRect(x, 150, 10, len); circle(g, x + 5, 150 + len, 9, "rgba(57,255,20,.35)");
      }
      // the sludge channels the loops run around
      for (const cx of [580, 1340]) { g.beginPath(); g.ellipse(cx, 610, 230, 200, 0, 0, Math.PI * 2); g.fillStyle = "rgba(57,255,20,.1)"; g.fill(); }
    },
  };
}

// ------------------------------------------------------------ Volcano Isle
// An island loop with a short, dangerous crater path through the volcano
// (red spaces, and a ▲ that erupts), and a long, safe beach detour.
function volcanoIsle() {
  const G = graph();
  const loopPts = arc(960, 590, 740, 300, -Math.PI / 2, (3 * Math.PI) / 2, 27).slice(0, 26);
  const loop = G.chain(loopPts, "B?BB$BRBDB" + "BB?BRB$B" + "DBB?BRBB");
  G.link(loop[loop.length - 1], loop[0]);
  // crater: from the top straight down through the volcano to the bottom
  const topI = loop[0], botI = loop[13];
  const cr = G.chain(between([960, 290], [960, 890], 5), "R?V?R");
  G.link(topI, cr[0]); G.link(cr[cr.length - 1], botI);
  G.nodes[cr[0]].label = "Through the crater!";
  G.nodes[G.nodes[topI].next[0]].label = "Around the island";
  // beach: bottom-right to bottom-left, bulging down to the shore
  const a = loop[9], b = loop[17];
  // drops straight toward the shore first, so it parts clearly from the inland path
  const A = [G.nodes[a].x, G.nodes[a].y], Bq = [G.nodes[b].x, G.nodes[b].y], shore = [960, 1010];
  const beach = G.chain([...curve(A, [1520, 1060], shore, 5), shore, ...curve(shore, [400, 1060], Bq, 5)], "BBB?BB$BBB?");
  G.link(a, beach[0]); G.link(beach[beach.length - 1], b);
  G.nodes[beach[0]].label = "Beach detour (long, safe)";
  G.nodes[G.nodes[a].next[0]].label = "Stay inland";
  return {
    name: "Volcano Isle", start: loop[20], nodes: G.nodes,
    theme: { hue: 15, path: "#ff6b00", glow: "#ff2a6d" },
    backdrop(g, t) {
      // sea, sand, and a smoking volcano
      const sea = g.createLinearGradient(0, 0, 0, H); sea.addColorStop(0, "#0a0626"); sea.addColorStop(1, "#092a3a");
      g.fillStyle = sea; g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(5,217,232,.18)"; g.lineWidth = 3;
      for (let y = 180; y < H; y += 60) { g.beginPath(); for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x / 60 + t * 2 + y) * 6); g.stroke(); }
      g.beginPath(); g.ellipse(960, 620, 830, 380, 0, 0, Math.PI * 2); g.fillStyle = "#3b2a1a"; g.fill();
      g.beginPath(); g.ellipse(960, 610, 780, 340, 0, 0, Math.PI * 2); g.fillStyle = "#1d3a1f"; g.fill();
      g.beginPath(); g.moveTo(760, 820); g.lineTo(900, 430); g.lineTo(1020, 430); g.lineTo(1160, 820); g.closePath(); g.fillStyle = "#3a1c14"; g.fill();
      g.save(); g.shadowColor = "#ff6b00"; g.shadowBlur = 40; g.beginPath(); g.ellipse(960, 440, 70, 20, 0, 0, Math.PI * 2); g.fillStyle = "#ff6b00"; g.fill(); g.restore();
      for (let i = 0; i < 5; i++) { const k = (t * 0.3 + i / 5) % 1; circle(g, 960 + Math.sin(i * 7 + t) * 30 * k, 420 - k * 260, 20 + k * 40, `rgba(90,80,100,${0.35 * (1 - k)})`); }
    },
  };
}

export const MAPS = { city: neonCity, sewers: slimeSewers, volcano: volcanoIsle };
export const MAP_NAMES = { city: "Neon City", sewers: "Slime Sewers", volcano: "Volcano Isle", random: "Random" };
