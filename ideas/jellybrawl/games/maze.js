// Tilt Maze — free-for-all. Tilt your phone to roll your blob through a
// maze (a thumbstick stands in without a motion sensor). Blobs roll through
// each other, so nobody can shove you in. Holes send you back
// to the last checkpoint you passed. First three to the goal place; everyone
// else ranks by how close they got. 60 s.

import { arena, clock, rnd, shuffle, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";

const TIME = 60, COLS = 15, ROWS = 7, CELL = 116, WALL = 14, R = 20, ACC = 900, MAXV = 430, HOLE_R = 24;

export default {
  id: "maze", title: "Tilt Maze", command: "TILT!", kind: "Free-for-all", min: 1, max: 8,
  blurb: "Tilt your phone to roll through the maze. Mind the holes.",
  controls: "Tilt the phone (or use the stick)",

  create(ctx) {
    const A = arena(ctx, { R });
    const ox = (W - COLS * CELL) / 2, oy = 180, ck = clock(ctx, TIME), pops = [], done = [];
    const cell = (c, r) => [ox + (c + 0.5) * CELL, oy + (r + 0.5) * CELL];
    // recursive-backtracker maze, then knock out a few extra walls for loops
    const open = Array.from({ length: COLS * ROWS }, () => ({ n: false, s: false, e: false, w: false }));
    const seen = new Set([0]), stack = [0];
    while (stack.length) {
      const i = stack[stack.length - 1], c = i % COLS, r = Math.floor(i / COLS);
      const nb = shuffle([[c, r - 1, "n", "s"], [c, r + 1, "s", "n"], [c + 1, r, "e", "w"], [c - 1, r, "w", "e"]]).filter(([x, y]) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !seen.has(y * COLS + x));
      if (!nb.length) { stack.pop(); continue; }
      const [x, y, d, back] = nb[0], j = y * COLS + x;
      open[i][d] = true; open[j][back] = true; seen.add(j); stack.push(j);
    }
    for (let k = 0; k < 16; k++) {
      const c = Math.floor(rnd(1, COLS - 1)), r = Math.floor(rnd(0, ROWS - 1)), i = r * COLS + c;
      open[i].s = true; open[i + COLS].n = true;
    }
    const start = [0, Math.floor(ROWS / 2)], goal = [COLS - 1, Math.floor(ROWS / 2)];
    // distance-to-goal field (BFS), for bots and for ranking the unfinished
    const dist = new Array(COLS * ROWS).fill(1e9), gi = goal[1] * COLS + goal[0];
    dist[gi] = 0;
    for (const q = [gi]; q.length;) {
      const i = q.shift(), c = i % COLS, r = Math.floor(i / COLS);
      for (const [d, dc, dr] of [["n", 0, -1], ["s", 0, 1], ["e", 1, 0], ["w", -1, 0]]) if (open[i][d]) { const j = (r + dr) * COLS + c + dc; if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); } }
    }
    // walls as rects: every closed cell edge, plus the border
    const walls = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const o = open[r * COLS + c], x = ox + c * CELL, y = oy + r * CELL;
      if (!o.n) walls.push([x - WALL / 2, y - WALL / 2, CELL + WALL, WALL]);
      if (!o.w) walls.push([x - WALL / 2, y - WALL / 2, WALL, CELL + WALL]);
      if (r === ROWS - 1 && !o.s) walls.push([x - WALL / 2, y + CELL - WALL / 2, CELL + WALL, WALL]);
      if (c === COLS - 1 && !o.e) walls.push([x + CELL - WALL / 2, y - WALL / 2, WALL, CELL + WALL]);
    }
    // holes only in straight corridors (never on a turn), pushed to one side
    // so there's always a lane past them
    const holes = [];
    const straight = (o) => (o.e && o.w && !o.n && !o.s ? "h" : o.n && o.s && !o.e && !o.w ? "v" : null);
    const holed = [];
    for (const i of shuffle([...open.keys()]).filter((i) => straight(open[i]) && dist[i] % 5 !== 0 && dist[i] > 1 && dist[i] < dist[start[1] * COLS] - 1)) {
      if (holed.length >= 12 || holed.some((j) => Math.abs((j % COLS) - (i % COLS)) + Math.abs(Math.floor(j / COLS) - Math.floor(i / COLS)) < 2)) continue; // never in neighbouring cells
      holed.push(i);
      const [x, y] = cell(i % COLS, Math.floor(i / COLS)), off = (Math.random() < 0.5 ? -1 : 1) * rnd(0.25, 0.28) * CELL;
      holes.push(straight(open[i]) === "h" ? { x, y: y + off } : { x: x + off, y });
    }
    // checkpoints: every 5 steps of distance along the way
    const n = A.bodies.length;
    A.bodies.forEach((b, i) => {
      const [x, y] = cell(...start);
      b.x = x + ((i % 2) - 0.5) * 36; b.y = y + (Math.floor(i / 2) - 1.5) * 26; b.best = dist[start[1] * COLS + start[0]]; b.cp = [b.x, b.y]; b.fall = 0; b.done = false;
    });

    const cellOf = (b) => [Math.max(0, Math.min(COLS - 1, Math.floor((b.x - ox) / CELL))), Math.max(0, Math.min(ROWS - 1, Math.floor((b.y - oy) / CELL)))];

    const inst = {
      result: null,
      describe: () => [`${n} blob${n > 1 ? "s" : ""} · one maze`, "Holes send you back to your last checkpoint"],
      start() { for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "tilt", hint: "Tilt to roll! Hold the phone flat-ish, tap LEVEL HERE to re-centre." }); },
      input(pid, m) { const b = A.of(pid); if (!b || b.done || m.t !== "move") return; b.mx = Math.max(-1, Math.min(1, +m.x || 0)); b.my = Math.max(-1, Math.min(1, +m.y || 0)); },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || b.done || ck.t < 0 || b.fall > 0) return;
        // head for the neighbouring cell that's closer to the goal. Line up
        // with the corridor first (so we don't scrape corners), on the lane
        // beside any hole in the way
        const [c, r] = cellOf(b), i = r * COLS + c, [cx, cy] = cell(c, r);
        let next = null;
        for (const [d, dc, dr] of [["n", 0, -1], ["s", 0, 1], ["e", 1, 0], ["w", -1, 0]]) if (open[i][d] && dist[(r + dr) * COLS + c + dc] < dist[i]) next = [dc, dr];
        let tx = cx, ty = cy;
        if (next) {
          const horiz = next[0] !== 0, a = horiz ? "x" : "y", pp = horiz ? "y" : "x", dir = next[0] || next[1], perpC = horiz ? cy : cx;
          // the nearest hole in this corridor we haven't rolled past yet
          const h = holes.filter((h) => Math.abs(h[pp] - perpC) < 40 && (h[a] - b[a]) * dir > -28 && (h[a] - b[a]) * dir < 170).sort((p, q) => (p[a] - q[a]) * dir)[0];
          if (b.bot.cell !== i) { b.bot.cell = i; b.bot.sloppy = Math.random() < 0.15; } // now and then a bot forgets to steer round
          const lane = perpC + (h ? Math.sign(h[pp] - perpC) * (b.bot.sloppy ? 10 : -22) : 0), t = {};
          if (Math.abs(b[pp] - lane) > 10) { t[a] = b[a] + dir * 6; t[pp] = lane; }
          else { t[a] = (horiz ? cx : cy) + dir * CELL; t[pp] = lane; }
          tx = t.x; ty = t.y;
        }
        const want = [tx - b.x - b.vx * 0.3, ty - b.y - b.vy * 0.3], l = Math.hypot(...want) || 1, k = Math.min(1, l / 30) * (b.bot.skill ??= rnd(0.6, 0.9));
        b.mx = (want[0] / l) * k + rnd(-0.08, 0.08); b.my = (want[1] / l) * k + rnd(-0.08, 0.08);
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        for (const b of A.bodies) {
          if (b.done) continue;
          if (b.fall > 0) { b.fall -= dt; if (b.fall <= 0) { [b.x, b.y] = b.cp; b.vx = b.vy = 0; } continue; }
          b.vx += b.mx * ACC * dt; b.vy += b.my * ACC * dt;
          b.vx *= Math.exp(-0.9 * dt); b.vy *= Math.exp(-0.9 * dt);
          const v = Math.hypot(b.vx, b.vy); if (v > MAXV) { b.vx *= MAXV / v; b.vy *= MAXV / v; }
          b.x += b.vx * dt; b.y += b.vy * dt;
          for (const [x, y, w, h] of walls) {
            const nx = Math.max(x, Math.min(x + w, b.x)), ny = Math.max(y, Math.min(y + h, b.y)), dx = b.x - nx, dy = b.y - ny, d = Math.hypot(dx, dy);
            if (d >= R || d === 0) continue;
            const ux = dx / d, uy = dy / d; b.x = nx + ux * R; b.y = ny + uy * R;
            const vn = b.vx * ux + b.vy * uy; if (vn < 0) { b.vx -= 1.4 * vn * ux; b.vy -= 1.4 * vn * uy; if (-vn > 250) ctx.sfx.dot(); }
          }
          const [c, r] = cellOf(b), dd = dist[r * COLS + c];
          if (dd < b.best) { b.best = dd; if (dd % 5 === 0) { const [x, y] = cell(c, r); b.cp = [x, y]; } }
          for (const h of holes) if (Math.hypot(h.x - b.x, h.y - b.y) < HOLE_R) {
            b.fall = 0.9; b.x = h.x; b.y = h.y; ctx.sfx.lose(); ctx.shake(6);
            pops.push({ x: h.x, y: h.y - 40, t: 0, word: "PLOP!" });
            if (!b.ghost) { ctx.buzz(b.pid, 250); ctx.stat(b.pid, "plops", 1); }
            break;
          }
          if (c === goal[0] && r === goal[1]) {
            b.done = true; done.push(b); b.mx = b.my = 0; ctx.sfx.win(); ctx.shake(10);
            pops.push({ x: b.x, y: b.y - 50, t: 0, word: ["1ST!", "2ND!", "3RD!"][done.length - 1] || "IN!" });
            if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: `#${done.length}!`, sub: "Made it! Watch the rest." });
          }
        }
        const need = Math.min(3, n);
        if (done.length >= need || ck.t >= TIME) {
          const rest = A.bodies.filter((b) => !b.done).sort((a, b) => a.best - b.best);
          const groups = [...done.map((b) => [b])];
          for (const b of rest) { const last = groups[groups.length - 1]; if (last && !last[0].done && last[0].best === b.best) last.push(b); else groups.push([b]); }
          inst.result = A.ffaResult(groups, done.length ? `${done[0].p.name} escapes the maze first!` : "Nobody escaped! Closest wins.");
        }
      },
      draw(g) {
        g.fillStyle = "#0a0f1f"; g.fillRect(0, 0, W, H);
        rrect(g, ox - 30, oy - 30, COLS * CELL + 60, ROWS * CELL + 60, 26, "#5a3a22", INK, 8); // the wooden box
        g.fillStyle = "#e9dcc0"; g.fillRect(ox, oy, COLS * CELL, ROWS * CELL);
        g.strokeStyle = "rgba(0,0,0,.05)"; g.lineWidth = 2;
        for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(ox + c * CELL, oy); g.lineTo(ox + c * CELL, oy + ROWS * CELL); g.stroke(); }
        const [sx, sy] = cell(...start), [gx, gy] = cell(...goal);
        rrect(g, sx - CELL / 2 + 8, sy - CELL / 2 + 8, CELL - 16, CELL - 16, 10, "rgba(5,217,232,.25)");
        rrect(g, gx - CELL / 2 + 8, gy - CELL / 2 + 8, CELL - 16, CELL - 16, 10, `rgba(57,255,20,${0.3 + 0.15 * Math.sin(ck.t * 5)})`);
        text(g, "GOAL", gx, gy, 30, "#0b3a0b", "center", 900);
        for (const h of holes) { circle(g, h.x, h.y, HOLE_R + 6, "#b9a47c"); circle(g, h.x, h.y, HOLE_R, "#140a06", INK, 3); }
        g.fillStyle = "#7a4a2a";
        for (const [x, y, w, h] of walls) g.fillRect(x, y, w, h);
        g.fillStyle = "rgba(0,0,0,.25)";
        for (const [x, y, w, h] of walls) g.fillRect(x + 4, y + h, w, 5);
        for (const b of A.bodies) {
          const s = b.fall > 0 ? Math.max(0.1, b.fall / 0.9) : 1;
          if (b.done) continue;
          A.drawBody(g, b, { noTag: s < 1, alpha: s });
        }
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 40, "#ff2a6d", p.t); }
        rrect(g, 0, 0, W, 130, 0, "rgba(10,15,31,.92)");
        text(g, `ESCAPED ${done.length}/${Math.min(3, n)}`, 330, 66, 38, "#39ff14", "center", 900);
        done.forEach((b, i) => text(g, `${i + 1}. ${b.p.name}`, W - 560 + i * 200, 66, 28, b.p.color, "center", 900));
        outlined(g, String(ck.left()), W / 2, 66, 70, "#fff");
        ck.overlay(g, "TILT!");
      },
    };
    return inst;
  },
};
