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
        if (s.d) outlined(g, ARROWS[s.d], x, y - 80, 50, s.d === st.dir ? "#39ff14" : "#ff2a6d");
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
        if (s.pick) rrect(g, x - 22, y - 110, 44, 44, 4, COLORS.find(([id]) => id === s.pick)[1], s.pick === st.target ? "#39ff14" : "#ff2a6d", 6);
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
        if (s.pick != null) tag(g, String(s.pick), x, STAGE_BOT - 30, s.pick === st.n ? "#39ff14" : "#ff2a6d", 30);
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
    setup(st) { for (const pid of st.pids) st.p[pid] = { y: (STAGE_TOP + STAGE_BOT) / 2, vy: 0, dead: false, cool: 0, aim: rnd(-60, 60) }; },
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
      if (!s.dead && s.cool <= 0 && s.y > (STAGE_TOP + STAGE_BOT) / 2 + s.aim && s.vy > 0) { st.input(pid, { t: "btn", down: true }); s.cool = 0.18; }
    },
  },
];

export default {
  id: "gauntlet", title: "Microgame Gauntlet", command: "GAUNTLET!", kind: "Everyone · 3 lives", min: 1, max: 8,
  blurb: "Tiny games, back to back, faster and faster. Fail one and lose a life.",
  controls: "Do whatever the screen shouts. Fast.",

  create(ctx) {
    const players = Object.fromEntries(ctx.players.map((p) => [p.pid, p]));
    const lives = Object.fromEntries(ctx.players.map((p) => [p.pid, LIVES]));
    const outAt = {};
    let n = 0, phase = "idle", t = 0, st = null, last = null, bag = [], marks = {}, speedLevel = 0;
    const alive = () => ctx.players.filter((p) => lives[p.pid] > 0).map((p) => p.pid);
    const sp = () => 1 + 0.18 * speedLevel;

    function nextMicro() {
      if (!bag.length) bag = shuffled(MICROS.filter((m) => m !== last));
      const def = bag.pop();
      last = def;
      const pids = alive(), gap = Math.min(230, 1640 / Math.max(1, pids.length));
      st = { def, sp: sp(), D: def.dur / sp(), pids, p: {}, players, ctx };
      st.lanes = pids.map((pid, i) => [pid, W / 2 + (i - (pids.length - 1) / 2) * gap]);
      st.relayout = () => { for (const pid of st.pids) ctx.layout(pid, { ...def.layout(st, pid), command: def.cmd, lives: lives[pid] }); };
      st.input = (pid, m) => phase === "play" && st.p[pid] && def.input(st, pid, m, t);
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
        if (ok) { ctx.stat(pid, "cleared", 1); continue; }
        anyFail = true;
        lives[pid]--;
        if (lives[pid] <= 0) outAt[pid] = n;
        ctx.buzz(pid, 250);
      }
      (anyFail ? ctx.sfx.hit : ctx.sfx.join)();
      if (anyFail) ctx.shake(18);
      for (const pid of st.pids) ctx.layout(pid, lives[pid] <= 0
        ? { kind: "wait", text: "OUT!", sub: "So close. Not really." }
        : { kind: "wait", text: marks[pid] ? "CLEARED" : "−1 LIFE", sub: "♥".repeat(lives[pid]) + "♡".repeat(LIVES - lives[pid]) });
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
      state: () => ({ phase, micro: st?.def.id, n, p: st?.p, lives }), // read-only, for tests
      describe: () => [`${LIVES} lives each · speeds up every 5 microgames`, "Last blob standing wins"],
      start() { nextMicro(); },
      input(pid, m) { st?.input(pid, m); },
      bot(pid, dt) { if (phase === "play" && st.p[pid]) st.def.bot(st, pid, t, dt); },
      update(dt) {
        if (inst.result) return;
        t += dt;
        if (phase === "show" && t >= SHOW / st.sp) { phase = "play"; t = 0; st.relayout(); }
        else if (phase === "play") { st.def.update?.(st, dt, t); if (t >= st.D) judge(); }
        else if (phase === "judge" && t >= JUDGE) {
          const a = alive();
          if (a.length === 0 || (ctx.players.length > 1 && a.length <= 1) || n >= MAX_MICROS) return finish();
          if (n % 5 === 0) { speedLevel++; phase = "speedup"; t = 0; ctx.sfx.power(); for (const pid of a) ctx.layout(pid, { kind: "wait", text: "SPEED UP!", shout: true }); }
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
          text(g, `MICROGAME ${n}`, W / 2, H / 2 + 140, 40, "#05d9e8", "center", 900);
        }
        if (phase === "speedup") shout(g, "SPEED UP!", W / 2, H / 2 - 40, 220, "#f9f002", t);
        // lives strip
        const list = ctx.players, w = Math.min(230, 1800 / list.length), y = 990;
        rrect(g, 0, y - 60, W, 150, 0, "rgba(0,0,0,.55)");
        list.forEach((p, i) => {
          const x = W / 2 - (list.length * w) / 2 + i * w + w / 2, l = lives[p.pid];
          blob(g, p, x - 50, y, 30, { alpha: l > 0 ? 1 : 0.3 });
          text(g, l > 0 ? "♥".repeat(l) + "♡".repeat(LIVES - l) : "OUT", x + 20, y - 12, l > 0 ? 30 : 26, l > 0 ? "#ff2a6d" : "#888", "center", l > 0 ? 800 : 900);
          text(g, p.name, x + 20, y + 24, 22, "#fff", "center", 900);
        });
        text(g, `SPEED ×${sp().toFixed(2)}`, W - 150, 95, 30, "#f9f002", "center", 900);
      },
    };
    return inst;
  },
};
