// Jelly Dodgeball — teams (2v2, 3v3, 4v4). Each team keeps to its half.
// Roll over a ball to pick it up, THROW it along your stick (with a little
// aim assist). A live ball from the other team costs a life (two each); a ball goes
// dead when it slows down or hits a wall. Last team standing, or more players
// left after 75 s.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 75, BALL_R = 20, THROW = 1050, LIVE_MIN = 380, ASSIST = 0.4, LIVES = 2;

export default {
  id: "dodgeball", title: "Jelly Dodgeball", command: "DODGE!", kind: "Teams", min: 2, max: 8,
  blurb: "Stay on your side. Grab a ball, throw it, knock them out.",
  controls: "Stick to move and aim, THROW when holding a ball",

  create(ctx) {
    const A = arena(ctx, { R: 30, speed: 300, teams: true, bounce: 0.6, dash: { mul: 1, time: 0, cool: 99 } });
    const F = A.bounds, midX = W / 2, midY = (F.y0 + F.y1) / 2, ck = clock(ctx, TIME), pops = [], out = [[], []];
    const nb = Math.max(3, Math.min(6, A.bodies.length - 1));
    const balls = Array.from({ length: nb }, (_, i) => ({ x: midX, y: F.y0 + ((i + 0.5) / nb) * (F.y1 - F.y0), vx: 0, vy: 0, held: null, live: null, spin: 0 }));
    let endAt = null;
    for (const t of [0, 1]) A.teams[t].forEach((b, i, arr) => { b.x = t === 0 ? F.x0 + 160 : F.x1 - 160; b.y = midY + (i - (arr.length - 1) / 2) * 160; b.face = [t === 0 ? 1 : -1, 0]; b.lives = LIVES; b.safe = 0; });
    const half = (b) => (b.team === 0 ? [F.x0, midX - 8] : [midX + 8, F.x1]);

    function throwBall(b) {
      const ball = balls.find((x) => x.held === b); if (!ball) return;
      let [fx, fy] = Math.hypot(b.mx, b.my) > 0.2 ? [b.mx, b.my] : b.face;
      let a = Math.atan2(fy, fx);
      // aim assist: snap toward the enemy nearest the aim line
      let best = null, bd = ASSIST;
      for (const o of A.live()) if (o.team !== b.team) {
        const d = Math.abs(((Math.atan2(o.y - b.y, o.x - b.x) - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { const tt = Math.hypot(best.x - b.x, best.y - b.y) / THROW; a = Math.atan2(best.y + best.vy * tt * 0.5 - b.y, best.x + best.vx * tt * 0.5 - b.x); }
      ball.held = null; ball.live = b; ball.x = b.x + Math.cos(a) * (A.R + BALL_R + 4); ball.y = b.y + Math.sin(a) * (A.R + BALL_R + 4);
      ball.vx = Math.cos(a) * THROW; ball.vy = Math.sin(a) * THROW;
      ctx.sfx.whoosh(); ctx.shake(4);
      relayout(b);
    }
    function relayout(b) {
      if (b.ghost || b.out) return;
      const has = balls.some((x) => x.held === b);
      ctx.layout(b.pid, { kind: "stick", radar: false, action: has ? "THROW" : "—", role: `${TEAM[b.team].name} team`, hint: has ? "Aim with the stick, THROW!" : "Roll over a ball to grab it. Dodge!" });
    }
    function knockOut(v, by) {
      if (!by.ghost) ctx.stat(by.pid, "hits", 1);
      if (--v.lives > 0) {
        v.safe = 1.2; ctx.sfx.crunch(); ctx.shake(12);
        pops.push({ x: v.x, y: v.y - 60, t: 0, word: "OOF!", c: TEAM[by.team].color });
        if (!v.ghost) ctx.buzz(v.pid, 200);
        return;
      }
      v.out = true; out[v.team].push(v);
      for (const x of balls) if (x.held === v) { x.held = null; x.vx = x.vy = 0; }
      pops.push({ x: v.x, y: v.y - 60, t: 0, word: "OUT!", c: TEAM[by.team].color });
      ctx.sfx.hit(); ctx.shake(22);
      if (!v.ghost) { ctx.buzz(v.pid, 400); ctx.layout(v.pid, { kind: "wait", text: "OUT!", sub: "Cheer your team on." }); }
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { for (const b of A.bodies) relayout(b); },
      input(pid, m) { const b = A.of(pid); if (A.input(pid, m) === "action" && ck.t >= 0) throwBall(b); },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        A.step(dt);
        for (const b of A.bodies) b.safe = Math.max(0, b.safe - dt);
        for (const b of A.live()) { // keep to your own half
          const [lo, hi] = half(b);
          if (b.x < lo + A.R) { b.x = lo + A.R; b.vx = Math.max(0, b.vx); }
          if (b.x > hi - A.R) { b.x = hi - A.R; b.vx = Math.min(0, b.vx); }
        }
        for (const ball of balls) {
          if (ball.held) { const h = ball.held; ball.x = h.x + h.face[0] * 26; ball.y = h.y - 8 + h.face[1] * 18; continue; }
          ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.spin += Math.hypot(ball.vx, ball.vy) * dt * 0.02;
          const f = ball.live ? 0.35 : 2.2; ball.vx *= Math.exp(-f * dt); ball.vy *= Math.exp(-f * dt);
          if (ball.x < F.x0 + BALL_R || ball.x > F.x1 - BALL_R) { ball.vx *= -0.6; ball.x = Math.max(F.x0 + BALL_R, Math.min(F.x1 - BALL_R, ball.x)); ball.live = null; }
          if (ball.y < F.y0 + BALL_R || ball.y > F.y1 - BALL_R) { ball.vy *= -0.6; ball.y = Math.max(F.y0 + BALL_R, Math.min(F.y1 - BALL_R, ball.y)); ball.live = null; }
          if (ball.live && Math.hypot(ball.vx, ball.vy) < LIVE_MIN) ball.live = null;
          for (const b of A.live()) {
            if (Math.hypot(b.x - ball.x, b.y - ball.y) > A.R + BALL_R) continue;
            if (ball.live && ball.live.team !== b.team) { if (b.safe > 0) continue; knockOut(b, ball.live); ball.live = null; ball.vx *= -0.3; ball.vy *= -0.3; break; }
            if (!ball.live && !balls.some((x) => x.held === b)) { ball.held = b; ctx.sfx.pop(); relayout(b); break; }
          }
        }
        const left = [0, 1].map((t) => A.teams[t].filter((b) => !b.out).length);
        if (left[0] === 0 || left[1] === 0 || ck.t >= TIME) {
          endAt = ck.t + 1.4;
          // more players standing wins; then more lives left between them
          const hp = [0, 1].map((t) => left[t] * 10 + A.teams[t].reduce((s, b) => s + (b.out ? 0 : b.lives), 0));
          const w = hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1;
          inst.pending = A.teamResult(w, w < 0 ? "Even at the whistle!" : left[1 - w] === 0 ? `${TEAM[w].name} wipes the court!` : left[0] === left[1] ? `${TEAM[w].name} wins on lives!` : `${TEAM[w].name} has more standing!`);
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#140a1e"; g.fillRect(0, 0, W, H);
        // gym floor: planks, key lines, a center stripe
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 8, "#6b3f22", INK, 8);
        g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 2;
        for (let y = F.y0 + 36; y < F.y1; y += 36) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        for (const t of [0, 1]) { g.fillStyle = TEAM[t].color + "22"; g.fillRect(t === 0 ? F.x0 : midX, F.y0, midX - F.x0, F.y1 - F.y0); }
        g.fillStyle = "#fff"; g.fillRect(midX - 6, F.y0, 12, F.y1 - F.y0);
        g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 5; g.beginPath(); g.arc(midX, midY, 110, 0, Math.PI * 2); g.stroke();
        const items = [];
        for (const b of A.live()) items.push([b.y, () => {
          A.drawBody(g, b, { alpha: b.safe > 0 && Math.floor(ck.t * 12) % 2 ? 0.4 : 1 });
          text(g, "♥".repeat(b.lives), b.x, b.y + A.R + 18, 18, TEAM[b.team].color, "center", 800);
        }]);
        for (const ball of balls) items.push([ball.y + (ball.held ? 1 : 0), () => {
          if (!ball.held) { g.beginPath(); g.ellipse(ball.x, ball.y + 16, 18, 6, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.35)"; g.fill(); }
          if (ball.live) for (let k = 1; k <= 3; k++) circle(g, ball.x - ball.vx * 0.012 * k, ball.y - ball.vy * 0.012 * k, BALL_R * (1 - k * 0.2), TEAM[ball.live.team].color + "55");
          circle(g, ball.x, ball.y, BALL_R, ball.live ? TEAM[ball.live.team].color : "#f25c05", INK, 5);
          g.beginPath(); g.arc(ball.x, ball.y, BALL_R * 0.6, ball.spin, ball.spin + 2); g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.35)"; g.stroke();
        }]);
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 56, p.c, p.t); }
        // HUD: players left per side as pips
        rrect(g, W / 2 - 420, 20, 840, 100, 12, "rgba(13,2,33,.9)", "#fff", 4);
        for (const t of [0, 1]) A.teams[t].forEach((b, i) => circle(g, t === 0 ? W / 2 - 110 - i * 44 : W / 2 + 110 + i * 44, 70, 16, b.out ? "rgba(255,255,255,.12)" : TEAM[t].color, INK, 3));
        text(g, String(ck.left()), W / 2, 70, 44, "#fff", "center", 900);
        ck.overlay(g, "DODGE!");
      },
    };

    // bots: grab the nearest ball on our half, then line up and throw; with
    // no ball, sidestep incoming live balls
    function botPlay(b, dt) {
      if (!b || b.out || ck.t < 0) return;
      const [lo, hi] = half(b), bot = b.bot;
      const threat = balls.find((x) => x.live && x.live.team !== b.team && ((x.vx > 0) === (b.x > x.x)) && Math.abs((b.y - x.y) - (x.vy / (x.vx || 1)) * (b.x - x.x)) < 90 && Math.abs(b.x - x.x) < 700);
      if (threat && Math.random() < 0.8) { const s = b.y > threat.y ? 1 : -1; A.steer(b, b.x, Math.max(F.y0 + 60, Math.min(F.y1 - 60, b.y + s * 200))); return; }
      const mine = balls.find((x) => x.held === b);
      if (mine) {
        bot.hold = (bot.hold ?? rnd(0.6, 1.8)) - dt;
        const foe = A.live().filter((o) => o.team !== b.team).sort((a, c) => Math.abs(a.y - b.y) - Math.abs(c.y - b.y))[0];
        if (foe) { A.steer(b, b.team === 0 ? midX - 240 : midX + 240, foe.y); b.face = [foe.x - b.x, foe.y - b.y].map((v, _, arr) => v / Math.hypot(...arr)); }
        if (bot.hold <= 0) { b.mx = b.my = 0; bot.hold = null; throwBall(b); }
        return;
      }
      const reach = A.R + BALL_R - 6, free = balls.filter((x) => !x.held && !x.live && x.x > lo - reach && x.x < hi + reach).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
      if (free) A.steer(b, free.x, free.y);
      else {
        bot.t = (bot.t ?? 0) - dt;
        if (bot.t <= 0) { bot.wx = rnd(lo + 80, hi - 80); bot.wy = rnd(F.y0 + 80, F.y1 - 80); bot.t = rnd(0.6, 1.5); }
        A.steer(b, bot.wx, bot.wy);
      }
    }
    return inst;
  },
};
