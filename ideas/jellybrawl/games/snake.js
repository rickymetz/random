// Snake Pit — free-for-all. Every blob drags a jelly tail that grows when it
// eats. Steer with the stick (snakes never stop); run your head into a wall or
// someone else's tail and you're out, and your tail bursts into snacks. BOOST
// is a burst of speed that sheds tail. Last snake slithering, or the longest at 60 s.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 60, SPEED = 250, BOOST = 1.8, TURN = 4.2, GAP = 12, SEG_R = 15, HEAD_R = 22, START_LEN = 14, PELLET_R = 10;

export default {
  id: "snake", title: "Snake Pit", command: "SLITHER!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Grow your tail, cut them off. Don't bonk a tail.",
  controls: "Stick to steer, tap BOOST for a burst (costs tail)",

  create(ctx) {
    const A = arena(ctx, { R: HEAD_R });
    const F = A.bounds, ck = clock(ctx, TIME), out = [], pellets = [], pops = [];
    const n = A.bodies.length, cx = W / 2, cy = (F.y0 + F.y1) / 2;
    let endAt = null;
    A.bodies.forEach((b, i) => {
      const a = (i / n) * Math.PI * 2;
      b.x = cx + Math.cos(a) * 520; b.y = cy + Math.sin(a) * 300;
      b.ang = a + Math.PI * 0.6; b.len = START_LEN; b.boost = 0; b.eaten = 0;
      b.trail = Array.from({ length: START_LEN }, (_, k) => ({ x: b.x - Math.cos(b.ang) * GAP * (k + 1), y: b.y - Math.sin(b.ang) * GAP * (k + 1) }));
      b.dist = 0;
    });
    const spawnPellet = (x, y, big) => pellets.push({ x: x ?? rnd(F.x0 + 40, F.x1 - 40), y: y ?? rnd(F.y0 + 40, F.y1 - 40), v: big ? 2 : 1, t: rnd(0, 6) });
    for (let i = 0; i < 18 + n * 3; i++) spawnPellet();

    function kill(b, why) {
      b.out = true; out.push([b]);
      for (let k = 0; k < b.trail.length; k += 3) spawnPellet(b.trail[k].x + rnd(-8, 8), b.trail[k].y + rnd(-8, 8), true);
      pops.push({ x: b.x, y: b.y - 50, t: 0, word: why });
      ctx.sfx.ko(b); ctx.shake(18);
      if (!b.ghost) { ctx.buzz(b.pid, 400); ctx.layout(b.pid, { kind: "wait", text: "BONK!", sub: `Your tail was ${b.len} long.` }); }
    }

    const inst = {
      result: null,
      describe: () => [`${n} snakes · ${TIME} seconds`, "Eat to grow · bonk a tail and you're out"],
      start() { A.layoutAll("BOOST", "Steer with the stick. Snakes never stop! Tap BOOST for a burst."); },
      input(pid, m) {
        const b = A.of(pid); if (!b || b.out) return;
        if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0); if (l > 0.3) b.want = Math.atan2(+m.y, +m.x); return; }
        if (m.t === "action" && ck.t >= 0) b.boost = 0.6; // phones send taps; a tap boosts briefly
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || b.out || ck.t < 0) return;
        b.bot.think = (b.bot.think ?? 0) - dt; if (b.bot.think > 0) return; // 10 times a second is plenty
        b.bot.think = 0.1;
        // probe a fan of headings for danger; prefer the safe one closest to food
        const food = pellets.reduce((best, p) => { const d = Math.hypot(p.x - b.x, p.y - b.y) / p.v; return d < best.d ? { p, d } : best; }, { p: null, d: 1e9 }).p;
        const goal = food ? Math.atan2(food.y - b.y, food.x - b.x) : b.ang;
        let best = b.ang, bs = -1e9;
        for (let k = -4; k <= 4; k++) {
          const a = b.ang + k * 0.35, clear = probe(b, a);
          const s = clear * 2 - Math.abs(((goal - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 60;
          if (s > bs) { bs = s; best = a; }
        }
        b.want = best;
        if (food && Math.hypot(food.x - b.x, food.y - b.y) < 200 && probe(b, b.ang) > 200 && b.len > 12 && Math.random() < 0.02) b.boost = 0.5;
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const b of A.live()) {
          if (b.want != null) { const d = ((b.want - b.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI; b.ang += Math.max(-TURN * dt, Math.min(TURN * dt, d)); }
          b.face = [Math.cos(b.ang), Math.sin(b.ang)];
          const boosting = b.boost > 0 && b.len > 6; b.boost -= dt;
          const v = SPEED * (boosting ? BOOST : 1);
          b.vx = Math.cos(b.ang) * v; b.vy = Math.sin(b.ang) * v;
          b.x += b.vx * dt; b.y += b.vy * dt;
          b.dist += v * dt;
          while (b.dist >= GAP) { b.dist -= GAP; b.trail.unshift({ x: b.x, y: b.y }); }
          if (boosting) { b.shed = (b.shed ?? 0) + dt; if (b.shed > 0.25) { b.shed = 0; b.len--; const tl = b.trail[b.len]; if (tl) spawnPellet(tl.x, tl.y); } }
          b.trail.length = Math.min(b.trail.length, b.len);
        }
        // collisions: walls, then heads against every tail (your own included,
        // past the neck), then head-to-head (the shorter one loses)
        const live = A.live();
        for (const b of live) {
          if (b.x < F.x0 + HEAD_R || b.x > F.x1 - HEAD_R || b.y < F.y0 + HEAD_R || b.y > F.y1 - HEAD_R) { kill(b, "WALL!"); continue; }
          let hit = null;
          for (const o of live) {
            if (o.out) continue;
            const from = o === b ? 8 : 0;
            for (let k = from; k < o.trail.length; k++) if (Math.hypot(o.trail[k].x - b.x, o.trail[k].y - b.y) < HEAD_R + SEG_R - 6) { hit = o; break; }
            if (hit) break;
          }
          if (hit) { if (hit !== b && !hit.ghost) ctx.stat(hit.pid, "cutoffs", 1); kill(b, hit === b ? "OUROBOROS!" : "BONK!"); }
        }
        for (const a of A.live()) for (const b of A.live()) if (a !== b && !a.out && !b.out && Math.hypot(a.x - b.x, a.y - b.y) < HEAD_R * 2) {
          if (a.len === b.len) { kill(a, "HEADBUTT!"); kill(b, "HEADBUTT!"); } else kill(a.len < b.len ? a : b, "HEADBUTT!");
        }
        for (const b of A.live()) for (let i = pellets.length - 1; i >= 0; i--) {
          const p = pellets[i];
          if (Math.hypot(p.x - b.x, p.y - b.y) > HEAD_R + PELLET_R + 6) continue;
          pellets.splice(i, 1); b.len += p.v; b.eaten += p.v; ctx.sfx.dot();
          if (!b.ghost) ctx.stat(b.pid, "snacks", 1);
        }
        while (pellets.length < 14 + n * 2) spawnPellet();
        const left = A.live();
        if (left.length <= (n > 1 ? 1 : 0) || ck.t >= TIME) {
          endAt = ck.t + 1.4;
          const by = {};
          for (const b of left) (by[b.len] ||= []).push(b);
          const groups = [...Object.keys(by).sort((a, b) => b - a).map((k) => by[k]), ...out.slice().reverse()];
          inst.pending = A.ffaResult(groups, left.length === 1 ? `${left[0].p.name} rules the pit!` : left.length ? "Time! Longest tail wins." : "Nobody made it!");
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#08140c"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0 - 12, F.y0 - 12, F.x1 - F.x0 + 24, F.y1 - F.y0 + 24, 20, "#0f2416", "#39ff14", 6);
        g.strokeStyle = "rgba(57,255,20,.07)"; g.lineWidth = 2;
        for (let x = F.x0; x < F.x1; x += 60) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
        for (let y = F.y0; y < F.y1; y += 60) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        for (const p of pellets) { p.t += FX.dt; circle(g, p.x, p.y, PELLET_R * (p.v > 1 ? 1.3 : 1) + Math.sin(p.t * 4) * 2, p.v > 1 ? "#ff6b00" : "#f9f002", INK, 3); }
        for (const b of A.live()) {
          const c = b.p.color;
          for (let k = b.trail.length - 1; k >= 0; k--) { const s = b.trail[k], r = SEG_R * (1 - (k / b.trail.length) * 0.45); circle(g, s.x, s.y, r, k % 4 < 2 ? c : shadeHex(c), INK, 4); }
        }
        for (const b of A.live()) {
          blob(g, b.p, b.x, b.y, HEAD_R + 4, { sx: b.boost > 0 ? 1.15 : 1, sy: b.boost > 0 ? 0.9 : 1 });
          tag(g, b.ghost ? "BOT" : b.p.name, b.x, b.y - HEAD_R - 26, b.p.color, 16);
        }
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 48, "#39ff14", p.t); }
        rrect(g, 0, 0, W, 120, 0, "rgba(8,20,12,.9)");
        const lead = A.live().sort((a, b) => b.len - a.len)[0];
        if (lead) text(g, `LONGEST: ${lead.ghost ? "BOT" : lead.p.name} · ${lead.len}`, 380, 60, 36, "#39ff14", "center", 900);
        outlined(g, String(ck.left()), W / 2, 60, 70, ck.ink());
        text(g, `SLITHERING ${A.live().length}/${n}`, W - 360, 60, 36, "#fff", "center", 900);
        ck.overlay(g, "SLITHER!");
      },
    };

    // how far a head can go on heading a before it would hit something
    function probe(b, a) {
      const dx = Math.cos(a), dy = Math.sin(a);
      for (let d = 30; d <= 300; d += 30) {
        const x = b.x + dx * d, y = b.y + dy * d;
        if (x < F.x0 + HEAD_R || x > F.x1 - HEAD_R || y < F.y0 + HEAD_R || y > F.y1 - HEAD_R) return d;
        for (const o of A.live()) {
          for (let k = o === b ? 10 : 0; k < o.trail.length; k += 2) if (Math.abs(o.trail[k].x - x) < 36 && Math.abs(o.trail[k].y - y) < 36) return d;
          if (o !== b && Math.hypot(o.x - x, o.y - y) < 60) return d;
        }
      }
      return 330;
    }
    return inst;
  },
};

// a darker stripe of the same color (#rrggbb only)
function shadeHex(c) {
  const v = parseInt(c.slice(1), 16);
  const f = (s) => Math.round(((v >> s) & 255) * 0.72);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}
