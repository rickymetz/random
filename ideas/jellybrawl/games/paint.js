// Paint the Town — teams (2v2, 3v3, 4v4). Everywhere you roll gets painted
// your team's color. SPLAT paints a big blob around you, and splatting into
// a rival stuns them and paints over their spot. Most ground after 60 s wins.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";

const TIME = 60, CELL = 30, STUN = 1.2;

export default {
  id: "paint", title: "Paint the Town", command: "PAINT IT!", kind: "Teams", min: 2, max: 8,
  blurb: "Roll around to paint the floor. Most ground covered wins.",
  controls: "Stick to roll, SPLAT for a paint burst",

  create(ctx) {
    const A = arena(ctx, { R: 28, speed: 290, teams: true, bounce: 1.1, dash: { mul: 2.2, time: 0.25, cool: 2.4 } });
    const F = A.bounds, ck = clock(ctx, TIME), pops = [];
    const cols = Math.floor((F.x1 - F.x0) / CELL), rows = Math.floor((F.y1 - F.y0) / CELL);
    const ox = F.x0 + ((F.x1 - F.x0) - cols * CELL) / 2, oy = F.y0 + ((F.y1 - F.y0) - rows * CELL) / 2;
    const cells = new Int8Array(cols * rows).fill(-1), count = [0, 0];
    let endAt = null;

    for (const t of [0, 1]) A.teams[t].forEach((b, i, arr) => {
      b.x = t === 0 ? F.x0 + 120 : F.x1 - 120; b.y = (F.y0 + F.y1) / 2 + (i - (arr.length - 1) / 2) * 140; b.stun = 0;
    });

    function paint(x, y, r, team) {
      const c0 = Math.max(0, Math.floor((x - r - ox) / CELL)), c1 = Math.min(cols - 1, Math.floor((x + r - ox) / CELL));
      const r0 = Math.max(0, Math.floor((y - r - oy) / CELL)), r1 = Math.min(rows - 1, Math.floor((y + r - oy) / CELL));
      let n = 0;
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const px = ox + (cx + 0.5) * CELL, py = oy + (cy + 0.5) * CELL;
        if (Math.hypot(px - x, py - y) > r) continue;
        const i = cy * cols + cx, was = cells[i];
        if (was === team) continue;
        if (was >= 0) count[was]--;
        cells[i] = team; count[team]++; n++;
      }
      return n;
    }
    function splat(b) {
      if (!A.tryDash(b)) return;
      const n = paint(b.x, b.y, 120, b.team);
      if (!b.ghost) ctx.stat(b.pid, "painted", n);
      ctx.sfx.pop(); ctx.shake(6);
      pops.push({ x: b.x, y: b.y, t: 0, c: TEAM[b.team].color });
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { A.layoutAll("SPLAT", "Roll to paint. SPLAT into rivals to stun them!"); },
      input(pid, m) { const b = A.of(pid); if (A.input(pid, m) === "action" && ck.t >= 0 && b.stun <= 0) splat(b); },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        for (const b of A.bodies) if (b.stun > 0) { b.stun -= dt; b.mx = b.my = 0; }
        const { hits } = A.step(dt);
        for (const h of hits) for (const [x, y] of [[h.a, h.b], [h.b, h.a]]) {
          if (x.dash > 0 && x.team !== y.team && y.stun <= 0) {
            y.stun = STUN; paint(y.x, y.y, 90, x.team); ctx.sfx.crunch(); ctx.shake(12);
            pops.push({ x: y.x, y: y.y, t: 0, c: TEAM[x.team].color, word: "SPLAT!" });
            if (!y.ghost) ctx.buzz(y.pid, 250);
            if (!x.ghost) ctx.stat(x.pid, "splats", 1);
          }
        }
        for (const b of A.bodies) if (b.stun <= 0) { const n = paint(b.x, b.y, A.R + 6, b.team); if (n && !b.ghost) ctx.stat(b.pid, "painted", n); }
        if (ck.t >= TIME) {
          endAt = ck.t + 1.6;
          const pct = count.map((c) => Math.round((c / cells.length) * 100));
          const w = count[0] === count[1] ? -1 : count[0] > count[1] ? 0 : 1;
          inst.pending = A.teamResult(w, w < 0 ? "A dead-even paint job!" : `${TEAM[w].name} painted ${pct[w]}% of town!`);
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#12071f"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0 - 10, F.y0 - 10, F.x1 - F.x0 + 20, F.y1 - F.y0 + 20, 16, "#241a33", INK, 8);
        // street grid under the paint
        g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 3;
        for (let x = ox; x <= ox + cols * CELL; x += CELL * 4) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
        for (let y = oy; y <= oy + rows * CELL; y += CELL * 4) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        // paint: one path per team of overlapping dots, so it reads as goo
        for (const t of [0, 1]) {
          g.beginPath();
          for (let i = 0; i < cells.length; i++) if (cells[i] === t) {
            const x = ox + ((i % cols) + 0.5) * CELL, y = oy + (Math.floor(i / cols) + 0.5) * CELL;
            g.moveTo(x + CELL * 0.72, y); g.arc(x, y, CELL * 0.72, 0, Math.PI * 2);
          }
          g.fillStyle = TEAM[t].color + "cc"; g.fill();
        }
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.5) circle(g, p.x, p.y, 40 + p.t * 220, `rgba(255,255,255,${0.5 - p.t})`); if (p.word && p.t < 0.9) shout(g, p.word, p.x, p.y - 70, 48, p.c, p.t); }
        A.live().sort((a, b) => a.y - b.y).forEach((b) => {
          A.drawBody(g, b, { alpha: b.stun > 0 && Math.floor(ck.t * 12) % 2 ? 0.5 : 1 });
          if (b.stun > 0) text(g, "✶ ✶", b.x, b.y - A.R - 44, 22, "#f9f002", "center", 900);
        });
        // HUD: a tug bar of coverage
        const tot = cells.length, k0 = count[0] / tot, k1 = count[1] / tot;
        rrect(g, W / 2 - 520, 24, 1040, 54, 10, "rgba(13,2,33,.9)", "#fff", 4);
        rrect(g, W / 2 - 514, 30, 1028 * k0, 42, 6, TEAM[0].color);
        rrect(g, W / 2 + 514 - 1028 * k1, 30, 1028 * k1, 42, 6, TEAM[1].color);
        outlined(g, `${Math.round(k0 * 100)}%`, W / 2 - 600, 52, 44, TEAM[0].color);
        outlined(g, `${Math.round(k1 * 100)}%`, W / 2 + 600, 52, 44, TEAM[1].color);
        text(g, String(ck.left()), W / 2, 52, 40, "#fff", "center", 900);
        ck.overlay(g, "PAINT IT!");
      },
    };

    // bots: head for the nearest patch that isn't ours (probing a few random
    // spots and keeping the best), splat rivals that wander close
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || b.stun > 0) return;
      b.bot.t = (b.bot.t ?? 0) - dt;
      if (b.bot.t <= 0 || Math.hypot(b.bot.x - b.x, b.bot.y - b.y) < 30) {
        let best = null, bs = -1e9;
        for (let k = 0; k < 14; k++) {
          const x = rnd(F.x0 + 60, F.x1 - 60), y = rnd(F.y0 + 60, F.y1 - 60);
          const cx = Math.floor((x - ox) / CELL), cy = Math.floor((y - oy) / CELL), c = cells[cy * cols + cx];
          const s = (c === b.team ? -400 : c >= 0 ? 150 : 0) - Math.hypot(x - b.x, y - b.y) * 0.5;
          if (s > bs) { bs = s; best = { x, y }; }
        }
        Object.assign(b.bot, best, { t: rnd(1, 2.2) });
      }
      A.steer(b, b.bot.x, b.bot.y);
      const foe = A.bodies.find((o) => o.team !== b.team && o.stun <= 0 && Math.hypot(o.x - b.x, o.y - b.y) < 110);
      if (foe) { A.steer(b, foe.x, foe.y); if (Math.random() < 0.15) splat(b); }
      else if (Math.random() < 0.01) splat(b);
    }
    return inst;
  },
};
