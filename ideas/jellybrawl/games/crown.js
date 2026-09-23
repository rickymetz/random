// Capture the Crown — teams (2v2, 3v3, 4v4). Grab the crown and keep it:
// your team scores every second it's on your head. The carrier is slower and
// can't dash; any hard bump knocks the crown loose. First to 25, or the most
// crown-time after 75 s.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";

const TIME = 75, GOAL = 25, KNOCK = 180;

export default {
  id: "crown", title: "Capture the Crown", command: "GRAB IT!", kind: "Teams", min: 2, max: 8,
  blurb: "Keep the crown on your team's head. Bump it off theirs.",
  controls: "Stick to run, DASH to knock the crown loose",

  create(ctx) {
    const A = arena(ctx, { R: 30, speed: 280, teams: true, bounce: 1.2, dash: { mul: 2.5, time: 0.24, cool: 1.8 } });
    const F = A.bounds, midX = W / 2, midY = (F.y0 + F.y1) / 2, ck = clock(ctx, TIME), pops = [];
    const crown = { x: midX, y: midY, vx: 0, vy: 0, z: 0, holder: null, lock: null, lockT: 0 };
    const score = [0, 0], pillars = [[midX - 420, midY - 150], [midX + 420, midY + 150], [midX - 420, midY + 150], [midX + 420, midY - 150]].map(([x, y]) => ({ x, y, vx: 0, vy: 0, r: 56, mass: 1e9, px: x, py: y }));
    let endAt = null;
    for (const t of [0, 1]) A.teams[t].forEach((b, i, arr) => { b.x = t === 0 ? F.x0 + 140 : F.x1 - 140; b.y = midY + (i - (arr.length - 1) / 2) * 150; });

    function drop(by) {
      const h = crown.holder; if (!h) return;
      crown.holder = null; h.speedMul = 1;
      const a = by ? Math.atan2(h.y - by.y, h.x - by.x) + rnd(-0.6, 0.6) : rnd(0, 6.28);
      crown.x = h.x; crown.y = h.y; crown.vx = Math.cos(a) * 520; crown.vy = Math.sin(a) * 520; crown.z = 40;
      crown.lock = h; crown.lockT = 0.8;
      pops.push({ x: h.x, y: h.y - 70, t: 0, word: "KNOCKED!" }); ctx.sfx.crunch(); ctx.shake(14);
      if (!h.ghost) ctx.buzz(h.pid, 300);
      if (by && !by.ghost) ctx.stat(by.pid, "knocks", 1);
      relayout();
    }
    function grab(b) {
      crown.holder = b; b.speedMul = 0.82; ctx.sfx.power(); ctx.shake(4);
      pops.push({ x: b.x, y: b.y - 70, t: 0, word: "GOT IT!" });
      relayout();
    }
    function relayout() {
      for (const b of A.bodies) if (!b.ghost) {
        const mine = crown.holder === b, ours = crown.holder && crown.holder.team === b.team;
        ctx.layout(b.pid, { kind: "stick", radar: false, action: "DASH", role: mine ? "👑 YOU HAVE IT" : `${TEAM[b.team].name} team`, hint: mine ? "Run! You can't dash while wearing it." : ours ? "Guard your crown carrier!" : "Get the crown! Bump the carrier to knock it loose." });
      }
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { relayout(); },
      input(pid, m) { const b = A.of(pid); if (A.input(pid, m) === "action" && ck.t >= 0 && crown.holder !== b) A.tryDash(b); },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        const { hits } = A.step(dt, pillars);
        for (const p of pillars) { p.x = p.px; p.y = p.py; p.vx = p.vy = 0; }
        for (const h of hits) {
          const c = crown.holder;
          if (!c || (h.a !== c && h.b !== c)) continue;
          const o = h.a === c ? h.b : h.a;
          if (o.team !== undefined && o.team !== c.team && (h.speed > KNOCK || o.dash > 0)) { drop(o); break; }
        }
        // loose crown: slide, bounce, and get picked up
        if (!crown.holder) {
          crown.lockT -= dt; if (crown.lockT <= 0) crown.lock = null;
          crown.vx *= Math.exp(-2.5 * dt); crown.vy *= Math.exp(-2.5 * dt); crown.z = Math.max(0, crown.z - 140 * dt);
          crown.x += crown.vx * dt; crown.y += crown.vy * dt;
          if (crown.x < F.x0 + 30 || crown.x > F.x1 - 30) { crown.vx *= -1; crown.x = Math.max(F.x0 + 30, Math.min(F.x1 - 30, crown.x)); }
          if (crown.y < F.y0 + 30 || crown.y > F.y1 - 30) { crown.vy *= -1; crown.y = Math.max(F.y0 + 30, Math.min(F.y1 - 30, crown.y)); }
          const b = A.bodies.filter((b) => b !== crown.lock && Math.hypot(b.x - crown.x, b.y - crown.y) < A.R + 26).sort((a, c) => Math.hypot(a.x - crown.x, a.y - crown.y) - Math.hypot(c.x - crown.x, c.y - crown.y))[0];
          if (b) grab(b);
        } else {
          const h = crown.holder; crown.x = h.x; crown.y = h.y;
          const before = Math.floor(score[h.team]);
          score[h.team] += dt;
          if (Math.floor(score[h.team]) > before) { ctx.sfx.dot(); if (!h.ghost) ctx.stat(h.pid, "crown", 1); }
          if (score[h.team] >= GOAL) return finish();
        }
        if (ck.t >= TIME) finish();
      },
      draw(g) {
        g.fillStyle = "#1a0d24"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 24, "#2b1a3a", "#ffd400", 6);
        // checkered throne-room floor
        for (let x = F.x0 + 20, i = 0; x < F.x1 - 20; x += 100, i++) for (let y = F.y0 + 20, j = 0; y < F.y1 - 20; y += 100, j++) if ((i + j) % 2) { g.fillStyle = "rgba(255,212,0,.05)"; g.fillRect(x, y, 100, 100); }
        circle(g, midX, midY, 90, "rgba(255,212,0,.08)", "rgba(255,212,0,.3)", 4);
        const items = [];
        for (const p of pillars) items.push([p.y, () => { g.beginPath(); g.ellipse(p.x, p.y + 30, p.r, p.r * 0.4, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.4)"; g.fill(); rrect(g, p.x - p.r, p.y - 90, p.r * 2, 110, 10, "#5a4a70", INK, 5); circle(g, p.x, p.y - 90, p.r, "#7a6a90", INK, 5); }]);
        for (const b of A.live()) items.push([b.y, () => {
          A.drawBody(g, b);
          if (crown.holder === b) drawCrown(g, b.x, b.y - A.R - 50 + Math.sin(ck.t * 8) * 3, 1);
        }]);
        if (!crown.holder) items.push([crown.y, () => { g.beginPath(); g.ellipse(crown.x, crown.y + 16, 26, 8, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.4)"; g.fill(); drawCrown(g, crown.x, crown.y - crown.z - Math.abs(Math.sin(ck.t * 4)) * 8, 1.2); }]);
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 44, "#ffd400", p.t); }
        // HUD: two fill bars toward GOAL
        rrect(g, W / 2 - 560, 20, 1120, 100, 12, "rgba(13,2,33,.9)", "#fff", 4);
        for (const t of [0, 1]) {
          const k = Math.min(1, score[t] / GOAL), x = t === 0 ? W / 2 - 540 : W / 2 + 120;
          rrect(g, x, 50, 420, 40, 6, "rgba(255,255,255,.08)");
          rrect(g, t === 0 ? x + 420 * (1 - k) : x, 50, 420 * k, 40, 6, TEAM[t].color);
          outlined(g, String(Math.floor(score[t])), t === 0 ? x - 10 : x + 430, 70, 40, TEAM[t].color, t === 0 ? "right" : "left");
        }
        text(g, String(ck.left()), W / 2, 70, 44, "#fff", "center", 900);
        ck.overlay(g, "GRAB IT!");
      },
    };

    function drawCrown(g, x, y, s) {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.beginPath(); g.moveTo(-26, 14); g.lineTo(-30, -14); g.lineTo(-14, 0); g.lineTo(0, -22); g.lineTo(14, 0); g.lineTo(30, -14); g.lineTo(26, 14); g.closePath();
      g.fillStyle = "#ffd400"; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
      for (const [cx, c] of [[-13, "#ff2a6d"], [0, "#05d9e8"], [13, "#39ff14"]]) circle(g, cx, 6, 4, c, INK, 2);
      g.restore();
    }

    function finish() {
      endAt = ck.t + 1.4;
      const w = score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
      inst.pending = A.teamResult(w, w < 0 ? "Nobody could keep the crown!" : `${TEAM[w].name} wears the crown!`);
      ctx.sfx.win();
    }

    // bots: carrier kites away from the nearest rival (and away from walls);
    // teammates body-block the rival closest to the carrier; the other team
    // chases the carrier and dashes in; a loose crown is a mad rush
    function botPlay(b, dt) {
      if (!b || ck.t < 0) return;
      const h = crown.holder;
      if (!h) { A.steer(b, crown.x + crown.vx * 0.2, crown.y + crown.vy * 0.2); return; }
      if (h === b) {
        const foes = A.bodies.filter((o) => o.team !== b.team);
        let fx = 0, fy = 0;
        for (const o of foes) { const d = Math.hypot(b.x - o.x, b.y - o.y) || 1; fx += (b.x - o.x) / (d * d); fy += (b.y - o.y) / (d * d); }
        fx += (midX - b.x) * 0.000004; fy += (midY - b.y) * 0.000006; // drift home, not into corners
        const l = Math.hypot(fx, fy) || 1;
        A.steer(b, b.x + (fx / l) * 150, b.y + (fy / l) * 150);
        return;
      }
      if (h.team === b.team) {
        const threat = A.bodies.filter((o) => o.team !== b.team).sort((a, c) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(c.x - h.x, c.y - h.y))[0];
        if (threat) A.steer(b, (threat.x + h.x) / 2, (threat.y + h.y) / 2, 90);
        return;
      }
      const d = A.steer(b, h.x + h.vx * 0.25, h.y + h.vy * 0.25);
      if (d < 170 && Math.random() < 6 * dt) A.tryDash(b);
    }
    return inst;
  },
};
