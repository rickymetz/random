// Microgame Gauntlet — WarioWare-style. Everyone plays the same tiny game at
// once: a one-word command slams in, you get a few seconds on a burning fuse,
// fail and you lose a life. Every 5 microgames it speeds up. Last blob
// standing wins; placements follow elimination order.

import { W, H, INK, POP, text, outlined, shout, rrect, circle, bomb, blob, tag, fit } from "../gfx.js";

const LIVES = 3, MAX_MICROS = 60, SHOW = 0.85, JUDGE = 1.5, SPEEDUP = 1.3;
const STAGE_TOP = 190, STAGE_BOT = 880;
const COLORS = [["red", "#ff2a6d"], ["blue", "#05d9e8"], ["yellow", "#f9f002"], ["green", "#39ff14"]];
const ARROWS = { up: "▲", down: "▼", left: "◀", right: "▶" };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffled = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

/*
 * A microgame: cmd (the shouted word), dur (seconds at speed 1) and hooks.
 *   setup(st)                 per-round state; st.p[pid] is per-player state
 *   layout(st, pid)           the phone's controls while playing
 *   input(st, pid, msg, t)    phone intents (only while playing)
 *   update(st, dt, t)         optional
 *   draw(g, st, t)            the stage (st.lanes gives per-player x)
 *   judge(st, pid) → bool     true = cleared
 *   bot(st, pid, t, dt)       drives bots and dropped phones
 */
const MICROS = [
  {
    id: "mash", cmd: "MASH!", dur: 4,
    setup(st) { st.need = Math.round((st.D) * (4.6 + st.sp)); for (const pid of st.pids) st.p[pid] = { n: 0, clock: 0, rate: rnd(4.2, 8.5) }; },
    layout: () => ({ kind: "button", label: "MASH" }),
    input(st, pid, m) { if (m.t === "btn" && m.down) st.p[pid].n++; },
    draw(g, st) {
      text(g, `${st.need} TAPS`, W / 2, STAGE_TOP + 10, 40, "#05d9e8", "center", 900);
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], k = Math.min(1, s.n / st.need), top = STAGE_TOP + 60, h = STAGE_BOT - top - 110;
        rrect(g, x - 34, top, 68, h, 6, "rgba(0,0,0,.45)", "#05d9e8", 4);
        rrect(g, x - 28, top + 6 + (h - 12) * (1 - k), 56, (h - 12) * k, 4, k >= 1 ? "#39ff14" : st.players[pid].color);
        blob(g, st.players[pid], x, STAGE_BOT - 40, 34, { sy: 1 - 0.15 * Math.abs(Math.sin(s.n)), sx: 1 + 0.15 * Math.abs(Math.sin(s.n)) });
      }
    },
    judge: (st, pid) => st.p[pid].n >= st.need,
    bot(st, pid, t, dt) { const s = st.p[pid]; s.clock += dt * s.rate; while (s.clock >= 1) { s.clock--; s.n++; } },
  },
  {
    id: "notap", cmd: "DON'T TAP!", dur: 3,
    setup(st) { for (const pid of st.pids) st.p[pid] = { tapped: false, botAt: Math.random() < 0.12 ? rnd(0.3, 0.9) * st.D : Infinity }; },
    layout: () => ({ kind: "button", label: "TAP ME" }),
    input(st, pid, m) { if (m.t === "btn" && m.down) st.p[pid].tapped = true; },
    draw(g, st, t) {
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid];
        blob(g, st.players[pid], x, (STAGE_TOP + STAGE_BOT) / 2, 50, { sx: 1 + Math.sin(t * 30) * 0.03 });
        if (s.tapped) outlined(g, "✗", x, (STAGE_TOP + STAGE_BOT) / 2 - 100, 90, "#ff2a6d");
        else text(g, "…", x, (STAGE_TOP + STAGE_BOT) / 2 - 90, 60, "#fff", "center", 900);
      }
    },
    judge: (st, pid) => !st.p[pid].tapped,
    bot(st, pid, t) { if (t >= st.p[pid].botAt) st.p[pid].tapped = true; },
  },
  {
    id: "wait", cmd: "WAIT FOR IT…", dur: 4,
    setup(st) { st.go = rnd(0.35, 0.65) * st.D; st.fired = false; for (const pid of st.pids) st.p[pid] = { at: null, botAt: Math.random() < 0.07 ? rnd(0.1, 0.9) * st.go : st.go + rnd(0.18, 0.55) }; },
    layout: (st) => ({ kind: "button", label: st.fired ? "NOW!" : "WAIT…" }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t === "btn" && m.down && s.at == null) s.at = t; },
    update(st, dt, t) { if (!st.fired && t >= st.go) { st.fired = true; st.relayout(); st.ctx.sfx.go(); } },
    draw(g, st, t) {
      const go = st.fired, cy = STAGE_TOP + 170;
      circle(g, W / 2, cy, 120, go ? "#39ff14" : "#ff2a6d", INK, 10);
      outlined(g, go ? "NOW!" : "WAIT", W / 2, cy, 80, "#fff");
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], y = STAGE_BOT - 90;
        blob(g, st.players[pid], x, y, 40);
        if (s.at != null) outlined(g, s.at < st.go ? "TOO SOON" : `${Math.round((s.at - st.go) * 1000)}ms`, x, y - 80, 30, s.at < st.go ? "#ff2a6d" : "#39ff14");
      }
    },
    judge: (st, pid) => st.p[pid].at != null && st.p[pid].at >= st.go,
    bot(st, pid, t) { const s = st.p[pid]; if (s.at == null && t >= s.botAt) s.at = t; },
  },
  {
    id: "swipe", cmd: "SWIPE!", dur: 3,
    setup(st) { st.dir = pick(Object.keys(ARROWS)); for (const pid of st.pids) st.p[pid] = { d: null, botAt: rnd(0.35, 1.1) / st.sp, botOk: Math.random() < 0.86 }; },
    layout: () => ({ kind: "dpad", hint: "Swipe the way the arrow points" }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "dir" && s.d == null) s.d = m.d; },
    draw(g, st, t) {
      outlined(g, ARROWS[st.dir], W / 2, STAGE_TOP + 220 + Math.sin(t * 12) * 8, 300, "#f9f002");
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], y = STAGE_BOT - 70;
        blob(g, st.players[pid], x, y, 36);
        if (s.d) outlined(g, ARROWS[s.d] + (s.d === st.dir ? "✓" : "✗"), x, y - 80, 50, s.d === st.dir ? "#39ff14" : "#ff2a6d");
      }
    },
    judge: (st, pid) => st.p[pid].d === st.dir,
    bot(st, pid, t) { const s = st.p[pid]; if (s.d == null && t >= s.botAt) s.d = s.botOk ? st.dir : pick(Object.keys(ARROWS).filter((d) => d !== st.dir)); },
  },
  {
    id: "match", cmd: "MATCH!", dur: 3,
    setup(st) { st.target = pick(COLORS)[0]; for (const pid of st.pids) st.p[pid] = { pick: null, order: shuffled(COLORS), botAt: rnd(0.4, 1.2) / st.sp, botOk: Math.random() < 0.85 }; },
    layout: (st, pid) => ({ kind: "pads", hint: "Tap the matching colour", pads: st.p[pid].order.map(([id, color]) => ({ id, color, label: "" })) }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "pad" && s.pick == null) s.pick = m.id; },
    draw(g, st, t) {
      const c = COLORS.find(([id]) => id === st.target)[1];
      g.save(); g.shadowColor = c; g.shadowBlur = 60;
      rrect(g, W / 2 - 150, STAGE_TOP + 60, 300, 300, 10, c, INK, 10);
      g.restore();
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], y = STAGE_BOT - 70;
        blob(g, st.players[pid], x, y, 36);
        if (s.pick) { rrect(g, x - 22, y - 110, 44, 44, 4, COLORS.find(([id]) => id === s.pick)[1], s.pick === st.target ? "#39ff14" : "#ff2a6d", 6); text(g, s.pick === st.target ? "✓" : "✗", x, y - 110 - 26, 30, s.pick === st.target ? "#39ff14" : "#ff2a6d", "center", 900); }
      }
    },
    judge: (st, pid) => st.p[pid].pick === st.target,
    bot(st, pid, t) { const s = st.p[pid]; if (s.pick == null && t >= s.botAt) s.pick = s.botOk ? st.target : pick(COLORS.filter(([id]) => id !== st.target))[0]; },
  },
  {
    id: "count", cmd: "COUNT!", dur: 4,
    setup(st) {
      st.n = 3 + Math.floor(Math.random() * 7);
      st.dots = [];
      while (st.dots.length < st.n) {
        const d = [rnd(W / 2 - 520, W / 2 + 520), rnd(STAGE_TOP + 60, STAGE_BOT - 230), Math.random() * 6];
        if (st.dots.every(([x, y]) => Math.hypot(x - d[0], y - d[1]) > 110)) st.dots.push(d);
      }
      const opts = new Set([st.n]);
      while (opts.size < 4) opts.add(Math.max(2, st.n + Math.floor(rnd(-3, 4))));
      st.opts = shuffled([...opts]);
      for (const pid of st.pids) st.p[pid] = { pick: null, botAt: rnd(0.8, 1.8) / st.sp, botOk: Math.random() < 0.8 };
    },
    layout: (st) => ({ kind: "pads", hint: "How many blobs?", pads: st.opts.map((n, i) => ({ id: String(n), label: String(n), color: ["#ff2a6d", "#05d9e8", "#f9f002", "#39ff14"][i] })) }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "pad" && s.pick == null) s.pick = +m.id; },
    draw(g, st, t) {
      const who = Object.values(st.players);
      st.dots.forEach(([x, y, ph], i) => blob(g, who[i % who.length], x + Math.sin(t * 5 + ph) * 18, y + Math.cos(t * 4 + ph) * 12, 40));
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid];
        if (s.pick != null) tag(g, `${s.pick} ${s.pick === st.n ? "✓" : "✗"}`, x, STAGE_BOT - 30, s.pick === st.n ? "#39ff14" : "#ff2a6d", 30);
      }
    },
    judge: (st, pid) => st.p[pid].pick === st.n,
    bot(st, pid, t) { const s = st.p[pid]; if (s.pick == null && t >= s.botAt) s.pick = s.botOk ? st.n : pick(st.opts.filter((n) => n !== st.n)); },
  },
  {
    id: "stop", cmd: "STOP!", dur: 4,
    setup(st) {
      st.c = rnd(0.25, 0.75); st.w = 0.2; st.freq = 0.75 * st.sp;
      st.needle = (t) => (1 - Math.cos(t * Math.PI * 2 * st.freq)) / 2;
      for (const pid of st.pids) st.p[pid] = { v: null, botOk: Math.random() < 0.7, botAt: rnd(0.8, 3) / st.sp };
    },
    layout: () => ({ kind: "button", label: "STOP" }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t === "btn" && m.down && s.v == null) s.v = st.needle(t); },
    draw(g, st, t) {
      const needle = st.needle(t), top = STAGE_TOP + 40, h = STAGE_BOT - top - 120;
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], v = s.v ?? needle;
        rrect(g, x - 30, top, 60, h, 4, "rgba(0,0,0,.5)", "#05d9e8", 4);
        g.fillStyle = "rgba(57,255,20,.45)"; g.fillRect(x - 26, top + h * (1 - st.c - st.w / 2), 52, h * st.w);
        g.fillStyle = s.v == null ? "#fff" : Math.abs(s.v - st.c) < st.w / 2 ? "#39ff14" : "#ff2a6d";
        g.fillRect(x - 40, top + h * (1 - v) - 5, 80, 10);
        if (s.v != null) { const hit = Math.abs(s.v - st.c) < st.w / 2; text(g, hit ? "✓" : "✗", x + 60, top + h * (1 - v), 34, hit ? "#39ff14" : "#ff2a6d", "center", 900); }
        blob(g, st.players[pid], x, STAGE_BOT - 45, 32);
      }
    },
    judge: (st, pid) => st.p[pid].v != null && Math.abs(st.p[pid].v - st.c) < st.w / 2,
    bot(st, pid, t) {
      const s = st.p[pid];
      if (s.v != null) return;
      const v = st.needle(t);
      if ((s.botOk && Math.abs(v - st.c) < st.w / 4 && t > 0.3) || (!s.botOk && t >= s.botAt)) s.v = v;
    },
  },
  {
    id: "hold", cmd: "HOLD IT!", dur: 3.5,
    setup(st) { for (const pid of st.pids) st.p[pid] = { down: false, ever: false, released: false, late: false, botAt: rnd(0.05, 0.3) * st.D, botDrop: Math.random() < 0.1 ? rnd(0.5, 0.9) * st.D : Infinity }; },
    layout: () => ({ kind: "button", label: "HOLD" }),
    input(st, pid, m) {
      const s = st.p[pid];
      if (m.t !== "btn") return;
      if (m.down) { s.down = true; s.ever = true; } else if (s.down) { s.down = false; s.released = true; }
    },
    update(st, dt, t) { for (const pid of st.pids) { const s = st.p[pid]; if (!s.ever && t > 0.45 * st.D) s.late = true; } },
    draw(g, st, t) {
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], y = (STAGE_TOP + STAGE_BOT) / 2 + 60, ok = s.ever && !s.released && !s.late;
        blob(g, st.players[pid], x, y + (s.down ? 18 : 0), 50, { sx: s.down ? 1.25 : 1, sy: s.down ? 0.72 : 1 });
        if (s.released || s.late) outlined(g, "✗", x, y - 110, 80, "#ff2a6d");
        else if (ok) text(g, "HOLDING", x, y - 100, 26, "#39ff14", "center", 900);
      }
    },
    judge: (st, pid) => { const s = st.p[pid]; return s.ever && !s.released && !s.late; },
    bot(st, pid, t) {
      const s = st.p[pid];
      if (!s.ever && t >= s.botAt) { s.down = s.ever = true; }
      if (s.down && t >= s.botDrop) { s.down = false; s.released = true; }
    },
  },
  {
    id: "float", cmd: "FLOAT!", dur: 4,
    setup(st) { for (const pid of st.pids) st.p[pid] = { y: (STAGE_TOP + STAGE_BOT) / 2, vy: 0, dead: false, cool: 0, aim: rnd(-60, 60), lapse: Math.random() < 0.15 ? rnd(0.3, 0.9) * st.D : Infinity }; },
    layout: () => ({ kind: "button", label: "FLAP" }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "btn" && m.down && !s.dead) { s.vy = -620; st.ctx.sfx.flap(); } },
    update(st, dt) {
      for (const pid of st.pids) {
        const s = st.p[pid];
        if (s.dead) continue;
        s.vy = Math.min(900, s.vy + 1500 * st.sp * dt);
        s.y += s.vy * dt;
        if (s.y > STAGE_BOT - 80 || s.y < STAGE_TOP + 70) { s.dead = true; st.ctx.shake(10); }
      }
    },
    draw(g, st, t) {
      g.fillStyle = "#ff6b00"; g.fillRect(0, STAGE_BOT - 60, W, 60);
      for (let x = 0; x < W; x += 60) circle(g, x + ((t * 80) % 60), STAGE_BOT - 60, 16 + 6 * Math.sin(t * 6 + x), "#ff2a6d");
      g.fillStyle = "#05d9e8";
      for (let x = 0; x < W; x += 50) { g.beginPath(); g.moveTo(x, STAGE_TOP + 20); g.lineTo(x + 25, STAGE_TOP + 60); g.lineTo(x + 50, STAGE_TOP + 20); g.fill(); }
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid];
        blob(g, st.players[pid], x, s.y, 32, { wings: t * 20, alpha: s.dead ? 0.35 : 1 });
      }
    },
    judge: (st, pid) => !st.p[pid].dead,
    bot(st, pid, t, dt) {
      const s = st.p[pid];
      s.cool -= dt;
      if (!s.dead && t < s.lapse && s.cool <= 0 && s.y > (STAGE_TOP + STAGE_BOT) / 2 + s.aim && s.vy > 0) { st.input(pid, { t: "btn", down: true }); s.cool = 0.18; }
    },
  },
  // ------------------------------------------------------------- set two
  {
    id: "exact", cmd: "TAP EXACTLY!", dur: 3.5,
    setup(st) {
      st.need = 3 + Math.floor(Math.random() * 5);
      for (const pid of st.pids) { const off = Math.random() < 0.8 ? 0 : pick([-1, 1]); st.p[pid] = { n: 0, botN: st.need + off, next: rnd(0.3, 0.6) }; }
    },
    layout: (st) => ({ kind: "button", label: "TAP", hint: `Exactly ${st.need}. Not ${st.need + 1}.` }),
    input(st, pid, m) { if (m.t === "btn" && m.down) st.p[pid].n++; },
    draw(g, st, t) {
      outlined(g, String(st.need), W / 2, STAGE_TOP + 170, 240, "#f9f002");
      text(g, "TAPS · NO MORE, NO LESS", W / 2, STAGE_TOP + 330, 34, "#fff", "center", 900);
      for (const [pid, x] of st.lanes) {
        blob(g, st.players[pid], x, STAGE_BOT - 70, 36);
        tag(g, t >= st.D - 0.01 ? String(st.p[pid].n) : "?", x, STAGE_BOT - 140, "#fff", 28);
      }
    },
    judge: (st, pid) => st.p[pid].n === st.need,
    bot(st, pid, t) { const s = st.p[pid]; if (s.n < s.botN && t >= s.next) { s.n++; s.next = t + rnd(0.15, 0.3); } },
  },
  {
    id: "bigger", cmd: "BIGGER!", dur: 2.6,
    setup(st) {
      st.a = 10 + Math.floor(Math.random() * 90);
      do st.b = 10 + Math.floor(Math.random() * 90); while (st.b === st.a);
      st.ans = st.a > st.b ? "left" : "right";
      for (const pid of st.pids) st.p[pid] = { d: null, botAt: rnd(0.5, 1.3) / st.sp, botOk: Math.random() < 0.86 };
    },
    layout: () => ({ kind: "dpad", hint: "Swipe toward the bigger number" }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "dir" && s.d == null && (m.d === "left" || m.d === "right")) s.d = m.d; },
    draw(g, st) {
      outlined(g, String(st.a), W / 2 - 330, STAGE_TOP + 220, 220, "#05d9e8");
      outlined(g, String(st.b), W / 2 + 330, STAGE_TOP + 220, 220, "#ff2a6d");
      text(g, "◀  OR  ▶", W / 2, STAGE_TOP + 220, 50, "#fff", "center", 900);
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36);
        if (s.d) outlined(g, (s.d === "left" ? "◀" : "▶") + (s.d === st.ans ? "✓" : "✗"), x, STAGE_BOT - 150, 50, s.d === st.ans ? "#39ff14" : "#ff2a6d");
      }
    },
    judge: (st, pid) => st.p[pid].d === st.ans,
    bot(st, pid, t) { const s = st.p[pid]; if (s.d == null && t >= s.botAt) s.d = s.botOk ? st.ans : st.ans === "left" ? "right" : "left"; },
  },
  {
    id: "simon", cmd: "SIMON SAYS!", dur: 5.5,
    setup(st) {
      st.seq = Array.from({ length: st.sp > 1.3 ? 4 : 3 }, () => pick(Object.keys(ARROWS)));
      st.show = st.D * 0.45;
      for (const pid of st.pids) st.p[pid] = { got: [], next: st.show + rnd(0.3, 0.6), botOk: Math.random() < 0.8 };
    },
    layout: () => ({ kind: "dpad", hint: "Watch the arrows, then swipe them back in order" }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t === "dir" && t >= st.show && s.got.length < st.seq.length) s.got.push(m.d); },
    draw(g, st, t) {
      if (t < st.show) {
        const i = Math.floor((t / st.show) * st.seq.length), k = ((t / st.show) * st.seq.length) % 1;
        if (k < 0.75) outlined(g, ARROWS[st.seq[i]], W / 2, STAGE_TOP + 230, 280, "#f9f002");
        text(g, `WATCH · ${i + 1}/${st.seq.length}`, W / 2, STAGE_TOP + 420, 34, "#05d9e8", "center", 900);
      } else outlined(g, "YOUR TURN", W / 2, STAGE_TOP + 230, 120, "#fff");
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36);
        s.got.forEach((d, i) => text(g, ARROWS[d] + (d === st.seq[i] ? "" : "✗"), x - 40 + i * 27, STAGE_BOT - 140, 26, d === st.seq[i] ? "#39ff14" : "#ff2a6d", "center", 800));
      }
    },
    judge: (st, pid) => st.p[pid].got.join() === st.seq.join(),
    bot(st, pid, t) {
      const s = st.p[pid];
      if (t >= s.next && s.got.length < st.seq.length) {
        const want = st.seq[s.got.length];
        s.got.push(s.botOk || s.got.length < st.seq.length - 1 ? want : pick(Object.keys(ARROWS).filter((d) => d !== want)));
        s.next = t + rnd(0.25, 0.45);
      }
    },
  },
  {
    id: "dodge", cmd: "DODGE!", dur: 3,
    setup(st) {
      st.safe = Math.floor(Math.random() * 3); st.drop = st.D * 0.8;
      for (const pid of st.pids) st.p[pid] = { slot: 1, botAt: rnd(0.5, 1.4) / st.sp, botOk: Math.random() < 0.85 };
    },
    layout: () => ({ kind: "dpad", hint: "Swipe left/right into the safe spot" }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t === "dir" && t < st.drop) s.slot = Math.max(0, Math.min(2, s.slot + (m.d === "left" ? -1 : m.d === "right" ? 1 : 0))); },
    draw(g, st, t) {
      const k = Math.min(1, t / st.drop);
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], y = STAGE_BOT - 70, w = Math.min(64, (st.lanes.length > 1 ? Math.abs(st.lanes[1][1] - st.lanes[0][1]) : 200) / 3);
        for (let i = 0; i < 3; i++) {
          const sx = x + (i - 1) * w;
          if (i === st.safe) continue;
          g.save(); g.globalAlpha = 0.3 + 0.5 * k; g.beginPath(); g.ellipse(sx, y + 22, w * 0.45 * (0.4 + 0.6 * k), 10, 0, 0, Math.PI * 2); g.fillStyle = "#000"; g.fill(); g.restore();
          // rocks hang over the unsafe spots, wobbling, then drop
          const ry = t < st.drop ? y - 260 + Math.sin(t * 20 + i) * 4 * k : y - 260 + Math.min(1, (t - st.drop) / 0.25) * 260;
          circle(g, sx, ry, w * 0.42, "#6d6682", INK, 4);
        }
        blob(g, st.players[pid], x + (s.slot - 1) * w, y, Math.min(28, w * 0.45));
      }
    },
    judge: (st, pid) => st.p[pid].slot === st.safe,
    bot(st, pid, t) { const s = st.p[pid]; if (t >= s.botAt && t < st.drop) { const goal = s.botOk ? st.safe : (st.safe + 1) % 3; if (s.slot !== goal) { s.slot += Math.sign(goal - s.slot); s.botAt = t + 0.2; } } },
  },
  {
    id: "pump", cmd: "PUMP IT!", dur: 4,
    setup(st) { st.lo = rnd(0.5, 0.62); st.hi = st.lo + 0.2; for (const pid of st.pids) st.p[pid] = { v: 0, popped: false, next: rnd(0.2, 0.5), aim: rnd(-0.05, 0.1) }; },
    layout: () => ({ kind: "button", label: "PUMP", hint: "Fill to the green band. Don't pop it!" }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "btn" && m.down && !s.popped) { s.v += 0.085; if (s.v > 1) { s.popped = true; st.ctx.sfx.pop(); } } },
    update(st, dt) { for (const pid of st.pids) { const s = st.p[pid]; if (!s.popped) s.v = Math.max(0, s.v - 0.1 * dt); } },
    draw(g, st) {
      // a pressure meter per player (green band = the target) with the balloon above it
      const top = STAGE_TOP + 150, h = STAGE_BOT - top - 90;
      for (const [pid, x] of st.lanes) {
        const s = st.p[pid], v = Math.min(1, s.v), c = st.players[pid].color;
        rrect(g, x - 24, top, 48, h, 6, "rgba(0,0,0,.5)", "#05d9e8", 4);
        g.fillStyle = "rgba(57,255,20,.35)"; g.fillRect(x - 20, top + h * (1 - st.hi), 40, h * (st.hi - st.lo));
        g.fillStyle = c; g.fillRect(x - 16, top + h * (1 - v), 32, h * v);
        if (s.popped) outlined(g, "POP!", x, top - 60, 50, "#ff2a6d");
        else {
          const r = 18 + 52 * v;
          g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top - 30); g.stroke();
          circle(g, x, top - 30 - r, r, c, INK, 5);
          g.beginPath(); g.ellipse(x - r * 0.35, top - 30 - r * 1.35, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.5)"; g.fill();
        }
        blob(g, st.players[pid], x, STAGE_BOT - 40, 28);
      }
    },
    judge: (st, pid) => { const s = st.p[pid]; return !s.popped && s.v >= st.lo && s.v <= st.hi; },
    bot(st, pid, t) { const s = st.p[pid]; if (t >= s.next && s.v < st.lo + s.aim) { st.input(pid, { t: "btn", down: true }); s.next = t + rnd(0.15, 0.3); } },
  },
  {
    id: "math", cmd: "MATH!", dur: 4,
    setup(st) {
      const a = 2 + Math.floor(Math.random() * 12), b = 2 + Math.floor(Math.random() * 9), plus = Math.random() < 0.6;
      st.q = `${a} ${plus ? "+" : "−"} ${b}`; st.ans = plus ? a + b : a - b;
      const opts = new Set([st.ans]);
      while (opts.size < 4) opts.add(st.ans + pick([-3, -2, -1, 1, 2, 10, -10]));
      st.opts = shuffled([...opts]);
      for (const pid of st.pids) st.p[pid] = { pick: null, botAt: rnd(0.9, 2) / st.sp, botOk: Math.random() < 0.82 };
    },
    layout: (st) => ({ kind: "pads", hint: "Tap the answer", pads: st.opts.map((n, i) => ({ id: String(n), label: String(n), color: ["#ff2a6d", "#05d9e8", "#f9f002", "#39ff14"][i] })) }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "pad" && s.pick == null) s.pick = +m.id; },
    draw(g, st) {
      outlined(g, `${st.q} = ?`, W / 2, STAGE_TOP + 220, 200, "#fff");
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36); if (s.pick != null) tag(g, `${s.pick} ${s.pick === st.ans ? "✓" : "✗"}`, x, STAGE_BOT - 140, s.pick === st.ans ? "#39ff14" : "#ff2a6d", 28); }
    },
    judge: (st, pid) => st.p[pid].pick === st.ans,
    bot(st, pid, t) { const s = st.p[pid]; if (s.pick == null && t >= s.botAt) s.pick = s.botOk ? st.ans : pick(st.opts.filter((n) => n !== st.ans)); },
  },
  {
    id: "odd", cmd: "ODD ONE OUT!", dur: 3.5,
    setup(st) {
      const [base, other] = shuffled(COLORS).map((c) => c[1]);
      st.odd = Math.floor(Math.random() * 4);
      st.cols = [0, 1, 2, 3].map((i) => (i === st.odd ? other : base));
      for (const pid of st.pids) st.p[pid] = { pick: null, botAt: rnd(0.6, 1.5) / st.sp, botOk: Math.random() < 0.85 };
    },
    layout: () => ({ kind: "pads", hint: "Which blob is different?", pads: [1, 2, 3, 4].map((n) => ({ id: String(n - 1), label: String(n), color: "#efe6d2" })) }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "pad" && s.pick == null) s.pick = +m.id; },
    draw(g, st, t) {
      st.cols.forEach((c, i) => {
        const x = W / 2 + (i - 1.5) * 260, y = STAGE_TOP + 220 + Math.sin(t * 6 + i) * 10;
        blob(g, { color: c, name: "" }, x, y, 80);
        text(g, String(i + 1), x, y + 130, 50, "#fff", "center", 900);
      });
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 50, 30); if (s.pick != null) tag(g, `${s.pick + 1} ${s.pick === st.odd ? "✓" : "✗"}`, x, STAGE_BOT - 110, s.pick === st.odd ? "#39ff14" : "#ff2a6d", 26); }
    },
    judge: (st, pid) => st.p[pid].pick === st.odd,
    bot(st, pid, t) { const s = st.p[pid]; if (s.pick == null && t >= s.botAt) s.pick = s.botOk ? st.odd : (st.odd + 1 + Math.floor(Math.random() * 3)) % 4; },
  },
  {
    id: "beat", cmd: "ON THE BEAT!", dur: 4,
    setup(st) {
      const gap = 0.6 / st.sp;
      st.beats = [0, 1, 2, 3].map((i) => 0.9 + i * gap);
      for (const pid of st.pids) st.p[pid] = { hit: [false, false, false, false], miss: 0, plan: st.beats.filter(() => Math.random() < 0.88).map((b) => b + rnd(-0.12, 0.16)) };
    },
    layout: () => ({ kind: "button", label: "TAP", hint: "Tap when the ring hits the dot" }),
    input(st, pid, m, t) {
      if (m.t !== "btn" || !m.down) return;
      const s = st.p[pid], i = st.beats.findIndex((b, k) => !s.hit[k] && Math.abs(t - b) < 0.22);
      if (i >= 0) s.hit[i] = true; else s.miss++;
    },
    draw(g, st, t) {
      const cx = W / 2, cy = STAGE_TOP + 220;
      circle(g, cx, cy, 30, "#f9f002", INK, 6);
      for (const b of st.beats) { const k = (b - t) / 0.8; if (k > -0.1 && k < 1) circle(g, cx, cy, 30 + Math.max(0, k) * 190, null, k < 0.08 ? "#39ff14" : "#ff2a6d", 8); }
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36); text(g, s.hit.map((h) => (h ? "●" : "○")).join(" "), x, STAGE_BOT - 140, 24, "#39ff14", "center", 800); }
    },
    judge: (st, pid) => { const s = st.p[pid]; return s.hit.filter(Boolean).length >= 3 && s.miss <= 1; },
    bot(st, pid, t) { const s = st.p[pid]; while (s.plan.length && t >= s.plan[0]) { s.plan.shift(); st.input(pid, { t: "btn", down: true }); } },
  },
  {
    id: "stroop", cmd: "SWIPE THE WORD!", dur: 3,
    setup(st) {
      const dirs = Object.keys(ARROWS);
      st.word = pick(dirs); st.arrow = Math.random() < 0.7 ? pick(dirs.filter((d) => d !== st.word)) : st.word;
      for (const pid of st.pids) st.p[pid] = { d: null, botAt: rnd(0.5, 1.4) / st.sp, botOk: Math.random() < 0.78 };
    },
    layout: () => ({ kind: "dpad", hint: "Follow the WORD, not the arrow" }),
    input(st, pid, m) { const s = st.p[pid]; if (m.t === "dir" && s.d == null) s.d = m.d; },
    draw(g, st) {
      outlined(g, ARROWS[st.arrow], W / 2, STAGE_TOP + 200, 300, "#ff2a6d");
      outlined(g, st.word.toUpperCase(), W / 2, STAGE_TOP + 210, 130, "#fff");
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36); if (s.d) outlined(g, ARROWS[s.d] + (s.d === st.word ? "✓" : "✗"), x, STAGE_BOT - 150, 50, s.d === st.word ? "#39ff14" : "#ff2a6d"); }
    },
    judge: (st, pid) => st.p[pid].d === st.word,
    bot(st, pid, t) { const s = st.p[pid]; if (s.d == null && t >= s.botAt) s.d = s.botOk ? st.word : st.arrow !== st.word ? st.arrow : pick(Object.keys(ARROWS)); },
  },
  {
    id: "memory", cmd: "REMEMBER!", dur: 4,
    setup(st) {
      st.target = pick(COLORS)[0]; st.show = st.D * 0.3;
      for (const pid of st.pids) st.p[pid] = { pick: null, order: shuffled(COLORS), botAt: st.show + rnd(0.4, 1.2) / st.sp, botOk: Math.random() < 0.8 };
    },
    layout: (st, pid) => ({ kind: "pads", hint: "Which colour flashed?", pads: st.p[pid].order.map(([id, color]) => ({ id, color, label: "" })) }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t === "pad" && s.pick == null && t >= st.show) s.pick = m.id; },
    draw(g, st, t) {
      if (t < st.show) rrect(g, W / 2 - 150, STAGE_TOP + 60, 300, 300, 10, COLORS.find(([id]) => id === st.target)[1], INK, 10);
      else { rrect(g, W / 2 - 150, STAGE_TOP + 60, 300, 300, 10, "#1b1030", INK, 10); outlined(g, "?", W / 2, STAGE_TOP + 210, 200, "#fff"); }
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36); if (s.pick) { rrect(g, x - 22, STAGE_BOT - 180, 44, 44, 4, COLORS.find(([id]) => id === s.pick)[1], s.pick === st.target ? "#39ff14" : "#ff2a6d", 6); text(g, s.pick === st.target ? "✓" : "✗", x, STAGE_BOT - 180 - 26, 30, s.pick === st.target ? "#39ff14" : "#ff2a6d", "center", 900); } }
    },
    judge: (st, pid) => st.p[pid].pick === st.target,
    bot(st, pid, t) { const s = st.p[pid]; if (s.pick == null && t >= s.botAt) s.pick = s.botOk ? st.target : pick(COLORS.filter(([id]) => id !== st.target))[0]; },
  },
  {
    id: "green", cmd: "GREEN LIGHT!", dur: 4.5,
    setup(st) {
      // alternating green/red windows; tap on green (need a few), freeze on red
      st.flips = [0]; let x = 0;
      while (x < st.D) { x += rnd(0.55, 1.1) / st.sp; st.flips.push(x); }
      st.need = 5;
      for (const pid of st.pids) st.p[pid] = { n: 0, bad: false, next: 0, slow: Math.random() < 0.22 ? rnd(0.4, 0.6) : rnd(0.15, 0.3) }; // some bots are slow off the mark
    },
    green(st, t) { let i = 0; while (i + 1 < st.flips.length && t >= st.flips[i + 1]) i++; return i % 2 === 0; },
    // just turned red? reaction time (and lag) gets a 0.35 s grace: taps then neither count nor fail
    grace(st, t) { return !st.def.green(st, t) && st.def.green(st, t - 0.35); },
    layout: () => ({ kind: "button", label: "TAP", hint: "Tap on GREEN. Freeze on RED." }),
    input(st, pid, m, t) { const s = st.p[pid]; if (m.t !== "btn" || !m.down) return; if (st.def.green(st, t)) s.n++; else if (!st.def.grace(st, t)) s.bad = true; },
    draw(g, st, t) {
      const on = st.def.green(st, t);
      circle(g, W / 2, STAGE_TOP + 190, 130, on ? "#39ff14" : "#ff2a6d", INK, 10);
      outlined(g, on ? "GO" : "STOP", W / 2, STAGE_TOP + 190, 90, "#fff");
      for (const [pid, x] of st.lanes) { const s = st.p[pid]; blob(g, st.players[pid], x, STAGE_BOT - 70, 36); text(g, s.bad ? "✗" : `${Math.min(s.n, st.need)}/${st.need}`, x, STAGE_BOT - 140, 30, s.bad ? "#ff2a6d" : "#fff", "center", 900); }
    },
    judge: (st, pid) => { const s = st.p[pid]; return !s.bad && s.n >= st.need; },
    bot(st, pid, t) {
      const s = st.p[pid];
      if (t < s.next) return;
      // reacts a beat late to the light (so it sometimes taps into a red)
      if (st.def.green(st, t - s.slow)) { st.input(pid, { t: "btn", down: true }); s.next = t + rnd(0.14, 0.26); }
    },
  },

  // ---------------------------------------------------------------- bosses
  // every 10th microgame; longer and harder; clearing one wins a life back
  {
    id: "boss_simon", cmd: "BOSS: MEGA SIMON!", dur: 9, boss: true,
    setup(st) { MICROS_BY_ID.simon.setup(st); st.seq = Array.from({ length: 6 }, () => pick(Object.keys(ARROWS))); st.show = st.D * 0.5; for (const pid of st.pids) Object.assign(st.p[pid], { next: st.show + rnd(0.4, 0.8), botOk: Math.random() < 0.6 }); },
    layout: (st, pid) => MICROS_BY_ID.simon.layout(st, pid),
    input: (st, pid, m, t) => MICROS_BY_ID.simon.input(st, pid, m, t),
    draw: (g, st, t) => MICROS_BY_ID.simon.draw(g, st, t),
    judge: (st, pid) => MICROS_BY_ID.simon.judge(st, pid),
    bot: (st, pid, t) => MICROS_BY_ID.simon.bot(st, pid, t),
  },
  {
    id: "boss_mash", cmd: "BOSS: MEGA MASH!", dur: 6, boss: true,
    setup(st) { MICROS_BY_ID.mash.setup(st); st.need = Math.round(st.D * (6.2 + st.sp)); },
    layout: (st, pid) => MICROS_BY_ID.mash.layout(st, pid),
    input: (st, pid, m, t) => MICROS_BY_ID.mash.input(st, pid, m, t),
    draw: (g, st, t) => MICROS_BY_ID.mash.draw(g, st, t),
    judge: (st, pid) => MICROS_BY_ID.mash.judge(st, pid),
    bot: (st, pid, t, dt) => MICROS_BY_ID.mash.bot(st, pid, t, dt),
  },

];
const MICROS_BY_ID = Object.fromEntries(MICROS.map((m) => [m.id, m]));
export { MICROS }; // for tests

export default {
  id: "gauntlet", title: "Microgame Gauntlet", command: "GAUNTLET!", kind: "Everyone · 3 lives", min: 1, max: 8,
  blurb: "Tiny games, back to back, faster and faster. Fail one and lose a life.",
  controls: "Do whatever the screen shouts. Fast.",

  create(ctx) {
    const players = Object.fromEntries(ctx.players.map((p) => [p.pid, p]));
    // a duel (board mode): one life each, a single microgame, then done
    const LIVES_ = ctx.duel ? 1 : LIVES;
    const lives = Object.fromEntries(ctx.players.map((p) => [p.pid, LIVES_]));
    const outAt = {};
    let n = 0, phase = "idle", t = 0, st = null, last = null, bag = [], marks = {}, speedLevel = 0;
    const alive = () => ctx.players.filter((p) => lives[p.pid] > 0).map((p) => p.pid);
    const sp = () => 1 + 0.18 * speedLevel;

    function nextMicro() {
      if (!bag.length) bag = shuffled(MICROS.filter((m) => m !== last && !m.boss));
      const boss = !ctx.duel && (n + 1) % 10 === 0;
      const def = boss ? pick(MICROS.filter((m) => m.boss)) : bag.pop();
      last = def;
      const pids = alive(), gap = Math.min(230, 1640 / Math.max(1, pids.length));
      st = { def, sp: sp(), D: def.dur / sp(), pids, p: {}, players, ctx };
      st.lanes = pids.map((pid, i) => [pid, W / 2 + (i - (pids.length - 1) / 2) * gap]);
      st.relayout = () => { for (const pid of st.pids) ctx.layout(pid, { ...def.layout(st, pid), command: def.cmd, lives: lives[pid] }); };
      // judge a tap by when it left the phone, not when it arrived
      st.input = (pid, m) => phase === "play" && st.p[pid] && def.input(st, pid, m, t - (ctx.lag?.(pid) ?? 0));
      def.setup(st);
      n++;
      phase = "show"; t = 0;
      for (const p of ctx.players) ctx.layout(p.pid, lives[p.pid] > 0
        ? { kind: "wait", text: def.cmd, shout: true, sub: "♥".repeat(lives[p.pid]) }
        : { kind: "wait", text: "OUT", sub: "Cheer (or jeer) from the couch." });
      ctx.sfx.slam();
    }

    function judge() {
      marks = {};
      let anyFail = false;
      for (const pid of st.pids) {
        const ok = !!st.def.judge(st, pid);
        marks[pid] = ok;
        if (ok) {
          ctx.stat(pid, "cleared", 1);
          if (st.def.boss && lives[pid] < LIVES_) { lives[pid]++; ctx.stat(pid, "bosses", 1); } // beat the boss: a life back
          continue;
        }
        anyFail = true;
        lives[pid]--;
        if (lives[pid] <= 0) outAt[pid] = n;
        ctx.buzz(pid, 250);
      }
      (anyFail ? ctx.sfx.hit : ctx.sfx.join)();
      if (anyFail) ctx.shake(18);
      for (const pid of st.pids) ctx.layout(pid, lives[pid] <= 0
        ? { kind: "wait", text: "OUT!", sub: "So close. Not really." }
        : { kind: "wait", text: marks[pid] ? "CLEARED" : "−1 LIFE", sub: "♥".repeat(lives[pid]) + "♡".repeat(LIVES_ - lives[pid]) });
      phase = "judge"; t = 0;
    }

    function finish() {
      const a = alive();
      const ranking = a.length ? [a] : [];
      const outs = [...new Set(Object.values(outAt))].sort((x, y) => y - x);
      for (const at of outs) ranking.push(Object.keys(outAt).filter((pid) => outAt[pid] === at));
      const first = ranking[0].map((pid) => players[pid].name);
      inst.result = { ranking, headline: first.length === 1 ? `${first[0]} is the last blob standing!` : `${first.join(" & ")} share the crown!` };
    }

    const inst = {
      result: null,
      players: ctx.players,
      state: () => ({ phase, micro: st?.def.id, n, p: st?.p, lives }), // read-only, for tests
      describe: () => [`${LIVES} lives each · speeds up every 5 microgames`, "Last blob standing wins"],
      start() { nextMicro(); },
      input(pid, m) { st?.input(pid, m); },
      bot(pid, dt) { if (phase === "play" && st.p[pid]) st.def.bot(st, pid, t, dt); },
      update(dt) {
        if (inst.result) return;
        t += dt;
        if (phase === "show" && t >= (st.def.boss ? 1.8 : SHOW / st.sp)) { phase = "play"; t = 0; st.relayout(); }
        else if (phase === "play") { st.def.update?.(st, dt, t); if (t >= st.D) judge(); }
        else if (phase === "judge" && t >= JUDGE) {
          const a = alive();
          if (ctx.duel || a.length === 0 || (ctx.players.length > 1 && a.length <= 1) || n >= MAX_MICROS) return finish();
          if (a.length === 2 && ctx.players.length > 2) ctx.music?.hot(); // the last two
          if (n % 5 === 0) { speedLevel++; phase = "speedup"; t = 0; ctx.sfx.power(); ctx.music?.speed(speedLevel); for (const pid of a) ctx.layout(pid, { kind: "wait", text: "SPEED UP!", shout: true }); }
          else nextMicro();
        } else if (phase === "speedup" && t >= SPEEDUP) nextMicro();
      },
      draw(g) {
        const hue = (n * 47) % 360;
        g.fillStyle = `hsl(${hue} 70% 8%)`; g.fillRect(0, 0, W, H);
        g.strokeStyle = `hsl(${hue + 40} 100% 60% / .18)`; g.lineWidth = 3;
        for (let i = -H; i < W; i += 90) { g.beginPath(); g.moveTo(i + ((t * 60) % 90), 0); g.lineTo(i + H + ((t * 60) % 90), H); g.stroke(); }
        if (!st) return;
        if (phase === "play" || phase === "judge") {
          st.def.draw(g, st, phase === "play" ? t : st.D);
          outlined(g, st.def.cmd, W / 2, 95, fit(g, st.def.cmd, 90, 900), "#fff", "center", -0.03);
          if (phase === "play") bomb(g, 120, 100, 44, 1 - t / st.D);
        }
        if (phase === "judge") {
          for (const [pid, x] of st.lanes) outlined(g, marks[pid] ? "✓" : "✗", x, STAGE_TOP + 40 + Math.max(0, 0.25 - t) * 400, 90, marks[pid] ? "#39ff14" : "#ff2a6d");
        }
        if (phase === "show") {
          g.fillStyle = `hsl(${hue} 90% 45% / .35)`; g.fillRect(0, 0, W, H);
          shout(g, st.def.cmd, W / 2, H / 2 - 40, fit(g, st.def.cmd, 260, W - 160), "#fff", t);
          text(g, st.def.boss ? "BOSS STAGE · CLEAR IT TO WIN A LIFE BACK" : `MICROGAME ${n}`, W / 2, H / 2 + 140, 40, st.def.boss ? "#ff2a6d" : "#05d9e8", "center", 900);
        }
        if (phase === "speedup") shout(g, "SPEED UP!", W / 2, H / 2 - 40, 220, "#f9f002", t);
        // lives strip
        const list = ctx.players, w = Math.min(230, 1800 / list.length), y = 990;
        rrect(g, 0, y - 60, W, 150, 0, "rgba(0,0,0,.55)");
        list.forEach((p, i) => {
          const x = W / 2 - (list.length * w) / 2 + i * w + w / 2, l = lives[p.pid];
          blob(g, p, x - 50, y, 30, { alpha: l > 0 ? 1 : 0.3 });
          text(g, l > 0 ? "♥".repeat(l) + "♡".repeat(LIVES_ - l) : "OUT", x + 20, y - 12, l > 0 ? 30 : 26, l > 0 ? "#ff2a6d" : "#888", "center", l > 0 ? 800 : 900);
          text(g, p.name, x + 20, y + 24, 22, "#fff", "center", 900);
        });
        text(g, `SPEED ×${sp().toFixed(2)}`, W - 150, 95, 30, "#f9f002", "center", 900);
      },
    };
    return inst;
  },
};
