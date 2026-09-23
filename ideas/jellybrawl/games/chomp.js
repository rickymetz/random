// Chomp Chase — asymmetric, 1 vs the rest. One chomper eats dots; everyone
// else hunts it. The chomper wins by clearing the maze or lasting 60 s; the
// hunters win with 3 catches. Power pellets turn the tables for a few seconds.
// The chomper role rotates to whoever has been "the one" least.

import { W, H, text, outlined, rrect, circle, blob, tag, countdown } from "../gfx.js";

const MAP = [
  "#####################",
  "#o........#........o#",
  "#.###.###.#.###.###.#",
  "#...................#",
  "#.###.#.#####.#.###.#",
  "#.....#...#...#.....#",
  "#####.###.#.###.#####",
  "#####.#..GGG..#.#####",
  "#####.#.#####.#.#####",
  "#.........P.........#",
  "#.###.###.#.###.###.#",
  "#o..#.....#.....#..o#",
  "###.#.#.#####.#.#.###",
  "#.....#...#...#.....#",
  "#####################",
];
const COLS = MAP[0].length, ROWS = MAP.length, C = 62;
const OX = (W - COLS * C) / 2, OY = 118;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const TIME = 60, LIVES = 3;

export default {
  id: "chomp", title: "Chomp Chase", kind: "1 vs rest", min: 2, max: 5,
  blurb: "One chomper eats dots. Everyone else hunts it down.",
  controls: "Swipe or use the d-pad",

  create(ctx) {
    const one = ctx.pickOne();
    const grid = MAP.map((r) => r.split(""));
    let dotsLeft = 0;
    for (const r of grid) for (const c of r) if (c === "." || c === "o") dotsLeft++;
    const find = (ch) => { const out = []; grid.forEach((r, y) => r.forEach((c, x) => c === ch && out.push([x, y]))); return out; };
    const [pstart] = find("P"), houses = find("G");
    const mk = (p, kind, [x, y]) => ({ p, kind, x, y, sx: x, sy: y, dir: [0, 0], want: null, stun: 0 });
    const chomper = mk(ctx.players.find((p) => p.pid === one), "chomp", pstart);
    const hunters = ctx.players.filter((p) => p.pid !== one).map((p, i) => mk(p, "hunt", houses[i % houses.length]));
    const all = [chomper, ...hunters];
    let t = -3, lives = LIVES, power = 0, invuln = 0, freeze = 0, lastTick = 3, endAt = null, dotSfx = 0;
    const hunterSpeed = 5.7 - 0.25 * (hunters.length - 1);

    const open = (x, y, e) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y][x] !== "#" && !(e.kind === "chomp" && grid[y][x] === "G");
    const next = (v, d) => (d > 0 ? Math.floor(v + 1e-9) + 1 : Math.ceil(v - 1e-9) - 1);

    function move(e, step) {
      for (let guard = 0; step > 1e-9 && guard < 8; guard++) {
        const cx = Math.round(e.x), cy = Math.round(e.y);
        const atC = Math.abs(e.x - cx) < 1e-6 && Math.abs(e.y - cy) < 1e-6;
        if (atC) {
          e.x = cx; e.y = cy;
          if (e.want && open(cx + e.want[0], cy + e.want[1], e)) e.dir = e.want;
          if (!open(cx + e.dir[0], cy + e.dir[1], e)) { e.dir = [0, 0]; return; }
        } else if (e.want && e.want[0] === -e.dir[0] && e.want[1] === -e.dir[1]) e.dir = e.want;
        if (!e.dir[0] && !e.dir[1]) return;
        const nx = e.dir[0] ? next(e.x, e.dir[0]) : e.x, ny = e.dir[1] ? next(e.y, e.dir[1]) : e.y;
        const d = Math.abs(nx - e.x) + Math.abs(ny - e.y);
        if (step >= d) { e.x = nx; e.y = ny; step -= d; if (e.kind === "chomp") eat(nx, ny); }
        else { e.x += e.dir[0] * step; e.y += e.dir[1] * step; step = 0; }
      }
    }

    function eat(x, y) {
      const c = grid[y][x];
      if (c !== "." && c !== "o") return;
      grid[y][x] = " ";
      dotsLeft--;
      ctx.stat(chomper.p.pid, "dots", 1);
      if (c === "o") { power = 6; ctx.sfx.power(); for (const h of hunters) ctx.buzz(h.p.pid, 120); }
      else if (dotSfx <= 0) { ctx.sfx.dot(); dotSfx = 0.09; }
    }

    function reset() {
      for (const e of all) { e.x = e.sx; e.y = e.sy; e.dir = [0, 0]; e.want = null; }
      invuln = 2; freeze = 1; power = 0;
    }

    // first step of a shortest path from e toward the best-scoring cell
    function bfsStep(e, goal) {
      const sx = Math.round(e.x), sy = Math.round(e.y);
      const seen = new Map([[sx + "," + sy, null]]);
      const q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.shift();
        if (goal(x, y) && !(x === sx && y === sy)) {
          let k = x + "," + y, prev = seen.get(k), cur = [x, y];
          while (prev && !(prev[0] === sx && prev[1] === sy)) { cur = prev; prev = seen.get(prev[0] + "," + prev[1]); }
          return [cur[0] - sx, cur[1] - sy];
        }
        for (const d of Object.values(DIRS)) {
          const nx = x + d[0], ny = y + d[1], k = nx + "," + ny;
          if (!seen.has(k) && open(nx, ny, e)) { seen.set(k, [x, y]); q.push([nx, ny]); }
        }
      }
      return null;
    }

    const inst = {
      result: null,
      describe: () => [`Chomper: ${chomper.p.name}`, `Hunters: ${hunters.map((h) => h.p.name).join(", ")}`],
      start() {
        ctx.layout(chomper.p.pid, { kind: "dpad", hint: "You're the CHOMPER! Eat dots, dodge hunters.", role: "Chomper" });
        for (const h of hunters) ctx.layout(h.p.pid, { kind: "dpad", hint: `Hunt ${chomper.p.name}! 3 catches wins.`, role: "Hunter" });
      },
      input(pid, m) {
        if (m.t !== "dir" || !DIRS[m.d]) return;
        const e = all.find((e) => e.p.pid === pid);
        if (e) e.want = DIRS[m.d];
      },
      bot(pid) {
        const e = all.find((e) => e.p.pid === pid);
        if (!e || t < 0 || Math.random() < 0.7) return;
        let step;
        if (e.kind === "chomp") {
          const threat = hunters.filter((h) => !h.stun && Math.abs(h.x - e.x) + Math.abs(h.y - e.y) < 4);
          if (threat.length && power <= 0) {
            let best = -1;
            for (const d of Object.values(DIRS)) {
              const nx = Math.round(e.x) + d[0], ny = Math.round(e.y) + d[1];
              if (!open(nx, ny, e)) continue;
              const s = Math.min(...threat.map((h) => Math.abs(h.x - nx) + Math.abs(h.y - ny))) + Math.random() * 0.5;
              if (s > best) { best = s; step = d; }
            }
          } else step = bfsStep(e, (x, y) => grid[y][x] === "." || grid[y][x] === "o");
        } else {
          const tx = Math.round(chomper.x), ty = Math.round(chomper.y);
          step = power > 0 ? bfsStep(e, (x, y) => Math.abs(x - tx) + Math.abs(y - ty) > 7) : bfsStep(e, (x, y) => x === tx && y === ty);
          if (Math.random() < 0.08) step = Object.values(DIRS)[Math.floor(Math.random() * 4)];
        }
        if (step) e.want = step;
      },
      update(dt) {
        t += dt; dotSfx -= dt;
        if (t < 0) { if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); } return; }
        if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
        if (inst.result || endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        if (freeze > 0) { freeze -= dt; return; }
        power = Math.max(0, power - dt); invuln = Math.max(0, invuln - dt);
        move(chomper, 6.3 * dt);
        for (const h of hunters) {
          if (h.stun > 0) { h.stun -= dt; continue; }
          move(h, (power > 0 ? 3.6 : hunterSpeed) * dt);
        }
        for (const h of hunters) {
          if (h.stun > 0 || Math.abs(h.x - chomper.x) + Math.abs(h.y - chomper.y) > 0.75) continue;
          if (power > 0) {
            h.stun = 3; h.x = h.sx; h.y = h.sy; h.dir = [0, 0];
            ctx.stat(chomper.p.pid, "gulps", 1); ctx.sfx.pop(); ctx.buzz(h.p.pid, 300);
          } else if (invuln <= 0) {
            lives--; ctx.stat(h.p.pid, "catches", 1); ctx.sfx.hit(); ctx.buzz(chomper.p.pid, 400);
            if (lives > 0) reset();
            break;
          }
        }
        const hPids = hunters.map((h) => h.p.pid);
        const finish = (chomperWins, headline) => {
          endAt = t + 1;
          inst.pending = chomperWins ? { winners: [chomper.p.pid], losers: hPids, headline } : { winners: hPids, losers: [chomper.p.pid], headline };
          (chomperWins ? ctx.sfx.win : ctx.sfx.lose)();
        };
        if (lives <= 0) finish(false, "The hunters got their chomp!");
        else if (dotsLeft <= 0) finish(true, `${chomper.p.name} cleared the maze!`);
        else if (t >= TIME) finish(true, `${chomper.p.name} survived!`);
      },
      draw(g) {
        g.fillStyle = "#0d1030"; g.fillRect(0, 0, W, H);
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
          const c = grid[y][x], px = OX + x * C, py = OY + y * C;
          if (c === "#") rrect(g, px + 3, py + 3, C - 6, C - 6, 12, "#2a3ad6", "#6f86ff", 3);
          else if (c === ".") circle(g, px + C / 2, py + C / 2, 6, "#ffe9a8");
          else if (c === "o") circle(g, px + C / 2, py + C / 2, 13 + 3 * Math.sin(t * 8), "#ffd23f");
          else if (c === "G") rrect(g, px + 4, py + 4, C - 8, C - 8, 10, "rgba(255,126,182,.15)");
        }
        const at = (e) => [OX + e.x * C + C / 2, OY + e.y * C + C / 2];
        for (const h of hunters) {
          const [x, y] = at(h);
          blob(g, h.p, x, y, C * 0.46, { skirt: t, tint: power > 0 ? "#3b56ff" : undefined, alpha: h.stun > 0 ? 0.35 : 1 });
          tag(g, h.p.name, x, y - C * 0.7, h.p.color, 18);
        }
        const [cx, cy] = at(chomper);
        const d = chomper.dir[0] || chomper.dir[1] ? chomper.dir : chomper.want || [1, 0];
        blob(g, chomper.p, cx, cy, C * 0.5, { mouth: Math.atan2(d[1], d[0]), alpha: invuln > 0 && Math.floor(t * 10) % 2 ? 0.4 : 1 });
        tag(g, chomper.p.name + " (chomper)", cx, cy - C * 0.75, "#ffd23f", 18);
        rrect(g, OX, 24, COLS * C, 76, 38, "rgba(255,255,255,.08)");
        text(g, `⏱ ${Math.max(0, Math.ceil(TIME - Math.max(0, t)))}`, OX + 110, 62, 38);
        text(g, "Lives " + "♥".repeat(lives) + "♡".repeat(LIVES - lives), W / 2, 62, 38, "#ff7eb6");
        text(g, `Dots left ${dotsLeft}`, OX + COLS * C - 170, 62, 34, "#ffe9a8");
        if (power > 0) outlined(g, "POWER!", W / 2, OY + 7 * C + C / 2, 60 + 6 * Math.sin(t * 12), "#ffd23f");
        if (freeze > 0 && t > 0) outlined(g, "CAUGHT!", W / 2, H / 2, 110, "#ff5a5f");
        countdown(g, -t);
      },
    };
    return inst;
  },
};
