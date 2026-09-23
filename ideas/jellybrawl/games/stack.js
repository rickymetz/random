// Tower Stack — teams (2v2, 3v3, 4v4). Each team stacks jelly slabs that
// swing back and forth over its tower; teammates take turns on DROP. Whatever
// hangs over the edge gets sliced off, so slabs shrink as you go. A perfect
// drop (within a few pixels) keeps the full width. Tallest tower after 45 s,
// or the first to 16, wins. Miss completely and you lose a few seconds.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 45, GOAL = 16, SLAB_H = 44, W0 = 300, BASE_Y = 1000, PERFECT = 8, MISS_WAIT = 1.6;

export default {
  id: "stack", title: "Tower Stack", command: "STACK!", kind: "Teams", min: 2, max: 8,
  blurb: "Take turns dropping slabs. Overhang gets sliced off. Tallest tower wins.",
  controls: "Tap DROP when it's your turn",

  create(ctx) {
    const A = arena(ctx, { teams: true });
    const ck = clock(ctx, TIME), pops = [], cx = [W / 4 + 40, (W * 3) / 4 - 40];
    const towers = [0, 1].map((t) => ({
      slabs: [{ x: cx[t], w: W0, c: TEAM[t].color }], turn: 0, wait: 0, swing: { x: cx[t], dir: 1, w: W0 }, falling: [], cam: 0,
    }));
    let endAt = null;
    const turnOf = (t) => A.teams[t][towers[t].turn % A.teams[t].length];
    const speed = (t) => 360 + towers[t].slabs.length * 38;

    function relayout(t) {
      const who = turnOf(t);
      for (const b of A.teams[t]) if (!b.ghost) ctx.layout(b.pid, b === who
        ? { kind: "button", label: "DROP", hint: "Your turn! Drop it right on top.", role: `${TEAM[t].name} team` }
        : { kind: "wait", text: "NEXT UP…", sub: `${who.ghost ? "The bot" : who.p.name} is dropping.`, role: `${TEAM[t].name} team` });
    }
    function drop(t) {
      const T = towers[t], top = T.slabs[T.slabs.length - 1], s = T.swing, b = turnOf(t);
      if (T.wait > 0 || endAt != null) return;
      let l = Math.max(s.x - s.w / 2, top.x - top.w / 2), r = Math.min(s.x + s.w / 2, top.x + top.w / 2);
      const y = BASE_Y - T.slabs.length * SLAB_H;
      if (r - l <= 4) { // clean miss
        T.falling.push({ x: s.x, y, w: s.w, vy: 0, rot: 0, c: slabColor(t, T.slabs.length) });
        T.wait = MISS_WAIT; ctx.sfx.lose(); ctx.shake(10);
        pops.push({ x: cx[t], y: y - 120 + T.cam, t: 0, word: "MISS!" });
        if (!b.ghost) ctx.buzz(b.pid, 300);
      } else {
        if (Math.abs(s.x - top.x) <= PERFECT) { l = top.x - top.w / 2; r = top.x + top.w / 2; pops.push({ x: cx[t], y: y - 110 + T.cam, t: 0, word: "PERFECT!" }); ctx.sfx.power(); if (!b.ghost) ctx.stat(b.pid, "perfects", 1); }
        else {
          ctx.sfx.pop();
          // the sliced-off bit tumbles away
          const cutL = s.x - s.w / 2 < l, cw = s.w - (r - l);
          if (cw > 2) T.falling.push({ x: cutL ? l - cw / 2 : r + cw / 2, y, w: cw, vy: 0, rot: 0, spin: cutL ? -2 : 2, c: slabColor(t, T.slabs.length) });
        }
        T.slabs.push({ x: (l + r) / 2, w: r - l, c: slabColor(t, T.slabs.length) });
        ctx.shake(3);
        if (!b.ghost) ctx.stat(b.pid, "slabs", 1);
        if (T.slabs.length - 1 >= GOAL) return finish(t);
      }
      T.turn++;
      const nt = T.slabs[T.slabs.length - 1];
      T.swing = { x: nt.x + (Math.random() < 0.5 ? -1 : 1) * 320, dir: Math.random() < 0.5 ? 1 : -1, w: nt.w };
      relayout(t);
    }
    const slabColor = (t, i) => (i % 2 ? TEAM[t].color : shade(TEAM[t].color));

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { relayout(0); relayout(1); },
      input(pid, m) {
        const b = A.of(pid); if (!b || m.t !== "btn" || !m.down || ck.t < 0) return;
        if (turnOf(b.team) === b) drop(b.team);
      },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        for (const t of [0, 1]) {
          const T = towers[t], s = T.swing;
          T.wait = Math.max(0, T.wait - dt);
          s.x += s.dir * speed(t) * dt;
          if (s.x > cx[t] + 380) { s.x = cx[t] + 380; s.dir = -1; }
          if (s.x < cx[t] - 380) { s.x = cx[t] - 380; s.dir = 1; }
          for (const f of T.falling) { f.vy += 1800 * dt; f.y += f.vy * dt; f.rot += (f.spin ?? 0) * dt; }
          T.falling = T.falling.filter((f) => f.y < H + 400);
          // camera follows the top of the tower
          const want = Math.max(0, T.slabs.length * SLAB_H - 560);
          T.cam += (want - T.cam) * Math.min(1, 4 * dt);
        }
        if (ck.t >= TIME) {
          const h = towers.map((T) => T.slabs.length);
          finish(h[0] === h[1] ? -1 : h[0] > h[1] ? 0 : 1);
        }
      },
      draw(g) {
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#0d0221"); sky.addColorStop(1, "#3a0d4a"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(W / 2 - 3, 140, 6, H - 140);
        for (const t of [0, 1]) {
          const T = towers[t];
          g.save(); g.translate(0, T.cam);
          // height marks every 4 slabs
          for (let k = 4; k <= GOAL; k += 4) { const y = BASE_Y - k * SLAB_H; g.strokeStyle = k === GOAL ? "#f9f002" : "rgba(255,255,255,.12)"; g.lineWidth = k === GOAL ? 4 : 2; g.setLineDash([14, 10]); g.beginPath(); g.moveTo(cx[t] - 420, y); g.lineTo(cx[t] + 420, y); g.stroke(); g.setLineDash([]); text(g, k === GOAL ? "GOAL" : String(k), cx[t] - 440, y, 24, k === GOAL ? "#f9f002" : "rgba(255,255,255,.3)", "right", 900); }
          rrect(g, cx[t] - 360, BASE_Y + SLAB_H, 720, 200, 0, "#1b0f26", INK, 6);
          T.slabs.forEach((sl, i) => slab(g, sl.x, BASE_Y - i * SLAB_H, sl.w, sl.c, i === 0));
          if (endAt == null) {
            const y = BASE_Y - T.slabs.length * SLAB_H - (T.wait > 0 ? 60 : 0), s = T.swing;
            // crane rope
            g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 3; g.beginPath(); g.moveTo(s.x, y - 400); g.lineTo(s.x, y - SLAB_H / 2); g.stroke();
            g.globalAlpha = T.wait > 0 ? 0.3 : 1;
            slab(g, s.x, y, s.w, slabColor(t, T.slabs.length));
            g.globalAlpha = 1;
          }
          for (const f of T.falling) { g.save(); g.translate(f.x, f.y); g.rotate(f.rot); slab(g, 0, 0, f.w, f.c); g.restore(); }
          g.restore();
          // team header + whose turn
          const who = turnOf(t);
          rrect(g, cx[t] - 300, 20, 600, 96, 12, "rgba(13,2,33,.9)", TEAM[t].color, 5);
          outlined(g, String(T.slabs.length - 1), cx[t] - 220, 68, 64, TEAM[t].color);
          text(g, `${TEAM[t].name.toUpperCase()} TOWER`, cx[t] + 40, 50, 30, "#fff", "center", 900);
          text(g, endAt == null ? `▶ ${who.ghost ? "BOT" : who.p.name}` : "", cx[t] + 40, 88, 28, who.ghost ? "#aaa" : who.p.color, "center", 900);
        }
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 54, "#f9f002", p.t); }
        outlined(g, String(ck.left()), W / 2, 70, 60, "#fff");
        ck.overlay(g, "STACK!");
      },
    };

    function slab(g, x, y, w, c, base) {
      rrect(g, x - w / 2, y - SLAB_H / 2, w, SLAB_H, 8, base ? "#5a4a70" : c, INK, 5);
      g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(x - w / 2 + 8, y - SLAB_H / 2 + 6, Math.max(0, w - 16), 6);
    }
    function finish(w) {
      endAt = ck.t + 1.6; ctx.sfx.win();
      const h = towers.map((T) => T.slabs.length - 1);
      inst.pending = A.teamResult(w, w < 0 ? `Level pegging at ${h[0]}!` : h[w] >= GOAL ? `${TEAM[w].name} tops out first!` : `${TEAM[w].name} builds higher: ${h[w]} to ${h[1 - w]}!`);
    }

    // bots drop when the swing is close to lined up, with a per-bot wobble
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || endAt != null) return;
      const t = b.team, T = towers[t];
      if (turnOf(t) !== b || T.wait > 0) return;
      const top = T.slabs[T.slabs.length - 1], s = T.swing;
      b.bot.err ??= rnd(4, 40) * (Math.random() < 0.5 ? -1 : 1);
      b.bot.delay = (b.bot.delay ?? rnd(0.3, 0.7)) - dt;
      if (b.bot.delay > 0) return;
      if (Math.abs(s.x - (top.x + b.bot.err)) < speed(t) * dt * 1.2) { b.bot.err = null; b.bot.delay = null; drop(t); }
    }
    return inst;
  },
};

// a darker tone of a #rrggbb color
function shade(c) {
  const v = parseInt(c.slice(1), 16), f = (s) => Math.round(((v >> s) & 255) * 0.7);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}
