// The board maps. Each one is a directed graph of spaces: a node is
// { x, y, k, next: [ids], label? }, where k is the kind of space:
//   B blue +3 · R red −3 · $ shop · D duel · ? event · T toll (pay on passing)
//   P pipe (warps to its pair) · V volcano (erupts: every rival pays you 3)
// A node with two `next`s is a fork: the player picks a path on their phone.
// Each map also has a theme (colours plus a backdrop painter).

import { W, H, INK, circle, rrect } from "./gfx.js";
import { seeded, roadDist, glow } from "./boardart.js";

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
    // asphalt with neon kerbs and a dashed centre line
    roads: [[64, INK], [56, "#ff2a6d", null, "#ff2a6d"], [46, "#221c30"], [4, "#f9f002", [16, 18]]],
    paint(g) {
      const rnd = seeded(7);
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#12071f"); sky.addColorStop(1, "#1c0b2e");
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // sidewalk grid
      g.strokeStyle = "rgba(255,255,255,.04)"; g.lineWidth = 2;
      for (let x = 0; x < W; x += 48) { g.beginPath(); g.moveTo(x, 150); g.lineTo(x, H); g.stroke(); }
      for (let y = 150; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      // rooftops wherever the roads aren't (seen from above)
      this.signs = [];
      for (let y = 165; y < H - 40; y += 118) for (let x = 20; x < W - 80; x += 132) {
        const w = 90 + rnd() * 40, h = 70 + rnd() * 42, bx = x + rnd() * 20, by = y + rnd() * 16;
        if (roadDist(this.nodes, bx + w / 2, by + h / 2) < Math.max(w, h) / 2 + 52) continue;
        const hue = [265, 300, 200, 330][Math.floor(rnd() * 4)];
        g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(bx + 10, by + 12, w, h);
        rrect(g, bx, by, w, h, 4, `hsl(${hue} 35% 16%)`, INK, 4);
        rrect(g, bx + 6, by + 6, w - 12, h - 12, 3, `hsl(${hue} 30% 21%)`);
        const r2 = rnd();
        if (r2 < 0.35) { circle(g, bx + w * 0.7, by + h * 0.45, 14, "#3a3350", INK, 3); rrect(g, bx + w * 0.7 - 16, by + h * 0.45 + 10, 32, 8, 2, "#2a2438"); } // water tower
        else if (r2 < 0.7) for (let i = 0; i < 2; i++) { rrect(g, bx + 14 + i * 30, by + 14, 22, 18, 2, "#555068", INK, 2); circle(g, bx + 25 + i * 30, by + 23, 5, "#2a2438"); } // AC units
        else { g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(bx + 8, by + (h * i) / 4); g.lineTo(bx + w - 8, by + (h * i) / 4); g.stroke(); } }
        if (rnd() < 0.45) this.signs.push({ x: bx + 8, y: by + h - 22, w: w - 16, col: ["#ff2a6d", "#05d9e8", "#f9f002", "#b026ff"][Math.floor(rnd() * 4)], ph: rnd() * 10 });
      }
      // streetlights along the loop
      this.nodes.forEach((n, i) => { if (i % 3 === 0) glow(g, n.x, n.y, 90, "rgba(255,160,255,.18)"); });
    },
    animate(g, t) {
      // two searchlights sweeping the sky
      for (const [x, ph] of [[300, 0], [1620, 2]]) {
        const a = -Math.PI / 2 + Math.sin(t * 0.5 + ph) * 0.7;
        g.save(); g.globalAlpha = 0.035; g.fillStyle = "#e8e0ff";
        g.beginPath(); g.moveTo(x, H); g.lineTo(x + Math.cos(a - 0.08) * 1400, H + Math.sin(a - 0.08) * 1400); g.lineTo(x + Math.cos(a + 0.08) * 1400, H + Math.sin(a + 0.08) * 1400); g.fill(); g.restore();
      }
      // neon signs on the rooftops, flickering
      for (const s of this.signs || []) {
        const on = Math.sin(t * 13 + s.ph) > -0.92 && Math.sin(t * 2.1 + s.ph * 3) > -0.97;
        g.save(); g.shadowColor = s.col; g.shadowBlur = on ? 18 : 0; g.globalAlpha = on ? 1 : 0.25;
        rrect(g, s.x, s.y, s.w, 12, 6, s.col); g.restore();
      }
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
    // riveted steel walkways, slatted, with a slime glow underneath
    roads: [[66, "rgba(57,255,20,.35)", null, "#39ff14"], [58, INK], [50, "#56645e"], [40, "#3b4742", [4, 9]]],
    paint(g) {
      const rnd = seeded(11);
      g.fillStyle = "#0a1410"; g.fillRect(0, 0, W, H);
      // big flagstones
      for (let y = 150; y < H; y += 70) for (let x = (y / 70) % 2 ? -50 : 0; x < W; x += 100) {
        const l = 12 + rnd() * 6;
        rrect(g, x + 3, y + 3, 94, 64, 6, `hsl(150 12% ${l}%)`, "rgba(0,0,0,.6)", 3);
      }
      // moss patches and grates
      for (let i = 0; i < 40; i++) { const x = rnd() * W, y = 160 + rnd() * (H - 160); if (roadDist(this.nodes, x, y) > 60) glow(g, x, y, 30 + rnd() * 40, "rgba(57,200,60,.35)"); }
      for (let i = 0; i < 6; i++) { const x = 100 + rnd() * (W - 200), y = 200 + rnd() * (H - 300); if (roadDist(this.nodes, x, y) < 90) continue; rrect(g, x - 34, y - 22, 68, 44, 4, "#1d2622", INK, 4); for (let k = -24; k <= 24; k += 12) { g.fillStyle = "#050907"; g.fillRect(x + k - 3, y - 16, 6, 32); } }
      // big pipes along the top and bottom edges, bolted
      for (const y of [168, H - 24]) {
        const gr = g.createLinearGradient(0, y - 22, 0, y + 22); gr.addColorStop(0, "#7d8c86"); gr.addColorStop(0.5, "#46534d"); gr.addColorStop(1, "#1e2723");
        g.fillStyle = gr; g.fillRect(0, y - 22, W, 44); g.strokeStyle = INK; g.lineWidth = 4; g.strokeRect(-4, y - 22, W + 8, 44);
        for (let x = 60; x < W; x += 240) { rrect(g, x - 14, y - 27, 28, 54, 4, "#5b6a63", INK, 3); circle(g, x, y - 16, 4, "#1e2723"); circle(g, x, y + 16, 4, "#1e2723"); }
      }
      // slime pools in the middle of each loop
      for (const cx of [580, 1340]) {
        g.beginPath(); g.ellipse(cx, 610, 225, 195, 0, 0, Math.PI * 2); g.fillStyle = "#2c3a33"; g.fill(); g.lineWidth = 10; g.strokeStyle = "#1a221e"; g.stroke();
        g.beginPath(); g.ellipse(cx, 614, 205, 176, 0, 0, Math.PI * 2);
        const sl = g.createRadialGradient(cx - 50, 560, 10, cx, 614, 210); sl.addColorStop(0, "#9bff5a"); sl.addColorStop(0.5, "#39d414"); sl.addColorStop(1, "#146b0c");
        g.fillStyle = sl; g.fill();
      }
    },
    animate(g, t) {
      for (const cx of [580, 1340]) {
        // surface ripples and bubbles
        g.save(); g.beginPath(); g.ellipse(cx, 614, 205, 176, 0, 0, Math.PI * 2); g.clip();
        g.strokeStyle = "rgba(210,255,170,.35)"; g.lineWidth = 3;
        for (let k = 0; k < 6; k++) { const y = 470 + k * 50 + Math.sin(t * 1.3 + k) * 8; g.beginPath(); for (let x = cx - 210; x <= cx + 210; x += 14) g.lineTo(x, y + Math.sin(x / 40 + t * 2 + k) * 6); g.stroke(); }
        for (let k = 0; k < 7; k++) { const f = (t * 0.5 + k / 7) % 1, x = cx + Math.sin(k * 9.1) * 150, y = 614 + Math.cos(k * 4.3) * 120; circle(g, x, y, 4 + f * 14, `rgba(200,255,150,${0.55 * (1 - f)})`, `rgba(20,80,10,${0.6 * (1 - f)})`, 2); }
        g.restore();
      }
      // drips from the top pipe
      for (let i = 0; i < 10; i++) { const x = 130 + i * 180, f = (t * 0.6 + i * 0.37) % 1; g.fillStyle = "rgba(57,255,20,.8)"; g.beginPath(); g.ellipse(x, 192 + f * 120, 5, 8, 0, 0, Math.PI * 2); g.fill(); }
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
    // a sandy trail with pebbles
    roads: [[60, "rgba(40,20,10,.8)"], [50, "#d8a868"], [40, "#e8c088"], [24, "#b88450", [2, 16]]],
    paint(g) {
      const rnd = seeded(23);
      const sea = g.createLinearGradient(0, 0, 0, H); sea.addColorStop(0, "#0b1e4a"); sea.addColorStop(1, "#0d4a6a");
      g.fillStyle = sea; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(160,230,255,${0.08 + rnd() * 0.12})`; g.fillRect(rnd() * W, 150 + rnd() * (H - 150), 10 + rnd() * 24, 3); }
      // island: surf, sand, grass
      const isle = (rx, ry, col) => { g.beginPath(); g.ellipse(960, 640, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
      isle(900, 470, "rgba(120,220,255,.25)"); isle(860, 440, "#e9cf95"); isle(800, 380, "#d9b877");
      isle(770, 345, "#3f8a3a");
      for (let i = 0; i < 500; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); g.fillStyle = rnd() < 0.5 ? "#4f9e45" : "#357a31"; g.fillRect(960 + Math.cos(a) * r * 740, 640 + Math.sin(a) * r * 330, 6, 3); }
      // the volcano: shaded cone, crater, lava rivers
      g.beginPath(); g.moveTo(740, 850); g.quadraticCurveTo(860, 560, 890, 440); g.lineTo(1030, 440); g.quadraticCurveTo(1060, 560, 1180, 850); g.closePath();
      const cone = g.createLinearGradient(740, 0, 1180, 0); cone.addColorStop(0, "#6b3a26"); cone.addColorStop(0.55, "#4a2519"); cone.addColorStop(1, "#2b150e");
      g.fillStyle = cone; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
      g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 4; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(900 + i * 25, 450); g.lineTo(790 + i * 70, 840); g.stroke(); }
      g.lineCap = "round";
      for (const [x1, x2] of [[925, 860], [1000, 1080]]) { g.beginPath(); g.moveTo(x1, 450); g.quadraticCurveTo((x1 + x2) / 2 + 20, 620, x2, 800); g.lineWidth = 16; g.strokeStyle = "#8f2200"; g.stroke(); g.lineWidth = 8; g.strokeStyle = "#ff8a00"; g.stroke(); }
      g.beginPath(); g.ellipse(960, 442, 74, 20, 0, 0, Math.PI * 2); g.fillStyle = "#ff6b00"; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
      // palms and rocks away from the trail
      const palm = (x, y, s) => {
        g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10 * s, y - 40 * s, x + 4 * s, y - 70 * s); g.lineWidth = 10 * s; g.strokeStyle = INK; g.stroke(); g.lineWidth = 6 * s; g.strokeStyle = "#8a5a2b"; g.stroke();
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.7; g.beginPath(); g.moveTo(x + 4 * s, y - 70 * s); g.quadraticCurveTo(x + 4 * s + Math.cos(a) * 30 * s, y - 70 * s + Math.sin(a) * 30 * s - 10 * s, x + 4 * s + Math.cos(a) * 55 * s, y - 70 * s + Math.sin(a) * 40 * s + 12 * s); g.lineWidth = 12 * s; g.strokeStyle = INK; g.stroke(); g.lineWidth = 8 * s; g.strokeStyle = "#2fa84a"; g.stroke(); }
      };
      for (let i = 0; i < 40; i++) {
        const a = rnd() * Math.PI * 2, r = 0.25 + rnd() * 0.75, x = 960 + Math.cos(a) * r * 760, y = 640 + Math.sin(a) * r * 360;
        if (roadDist(this.nodes, x, y) < 75 || Math.abs(x - 960) < 240 && y > 420 && y < 860) continue;
        if (rnd() < 0.55) palm(x, y, 0.8 + rnd() * 0.4); else { g.beginPath(); g.ellipse(x, y, 16, 11, 0, 0, Math.PI * 2); g.fillStyle = "#7d7266"; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); }
      }
    },
    animate(g, t) {
      // foam round the shore, lava glow, smoke and embers
      g.save(); g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 1.5); g.beginPath(); g.ellipse(960, 640, 870 + Math.sin(t * 1.5) * 10, 450 + Math.sin(t * 1.5) * 6, 0, 0, Math.PI * 2); g.lineWidth = 8; g.strokeStyle = "#ffffff"; g.stroke(); g.restore();
      glow(g, 960, 440, 140 + Math.sin(t * 3) * 20, "rgba(255,120,0,.55)");
      for (let i = 0; i < 6; i++) { const k = (t * 0.25 + i / 6) % 1; circle(g, 960 + Math.sin(i * 7 + t * 0.7) * 50 * k, 420 - k * 250, 22 + k * 50, `rgba(80,70,80,${0.4 * (1 - k)})`); }
      for (let i = 0; i < 14; i++) { const k = (t * 0.6 + i / 14) % 1; g.fillStyle = `rgba(255,${120 + i * 8},0,${1 - k})`; g.fillRect(960 + Math.sin(i * 3.7) * 90 * k, 440 - k * 200, 5, 5); }
    },
  };
}

export const MAPS = { city: neonCity, sewers: slimeSewers, volcano: volcanoIsle };
export const MAP_NAMES = { city: "Neon City", sewers: "Slime Sewers", volcano: "Volcano Isle", random: "Random" };
