// King of the Hill Giant — free-for-all with a shifting 1-vs-rest. Whoever's
// been on the hill longest (a full second at least) is crowned: you score
// every second, but you grow
// huge, heavy and slow. Everyone else has to gang up and shove the giant off.
// Knocked off, you shrink back. Most seconds as king after 60 s wins.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";

const TIME = 60, HILL_R = 170, GROW = 0.35, MAX_S = 2.3, R0 = 28;

export default {
  id: "hill", title: "King of the Hill Giant", command: "CLIMB!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Hold the hill and you grow into a slow giant. Everyone else: topple them!",
  controls: "Stick to move, SHOVE to charge",

  create(ctx) {
    const A = arena(ctx, { R: R0, speed: 290, bounce: 1.35, dash: { mul: 2.8, time: 0.26, cool: 1.5 } });
    const F = A.bounds, cx = W / 2, cy = (F.y0 + F.y1) / 2, ck = clock(ctx, TIME), pops = [];
    const n = A.bodies.length;
    let king = null, endAt = null, crownT = 0;
    A.bodies.forEach((b, i) => { const a = (i / n) * Math.PI * 2; b.x = cx + Math.cos(a) * 560; b.y = cy + Math.sin(a) * 330; b.size = 1; b.score = 0; b.onT = 0; });
    const onHill = (b) => Math.hypot(b.x - cx, (b.y - cy) / 0.7) < HILL_R;
    function setSize(b, s) { b.size = s; b.r = R0 * s; b.mass = s > 1.05 ? s * s * 1.4 : undefined; b.speedMul = 1 / Math.sqrt(s); }
    function relayout() { for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "stick", radar: false, action: "SHOVE", role: b === king ? "👑 THE GIANT" : "", hint: b === king ? "Stay on the hill! You're big and slow now." : king ? `Topple ${king.ghost ? "the bot" : king.p.name}! Gang up!` : "Get on the hill and stay there!" }); }

    const inst = {
      result: null,
      describe: () => [`${n} climbers · one hill`, "Hold the hill longest and you become the giant"],
      start() { relayout(); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0) A.tryDash(A.of(pid)); },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || ck.t < 0) return;
        if (b === king) { // hold the middle, lean against whoever's pushing
          const foe = A.bodies.filter((o) => o !== b).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
          const tx = cx + (foe ? (foe.x - cx) * 0.25 : 0), ty = cy + (foe ? (foe.y - cy) * 0.25 : 0);
          A.steer(b, tx, ty);
          if (foe && Math.hypot(foe.x - b.x, foe.y - b.y) < b.r + A.R + 40 && Math.random() < 3 * dt) A.tryDash(b);
          return;
        }
        if (king) { // line up on the far side of the giant from the hill's centre and charge
          const dx = king.x - cx, dy = king.y - cy, l = Math.hypot(dx, dy) || 1, jitter = (b.bot.side ??= rnd(-0.8, 0.8));
          const ux = l > 5 ? dx / l : Math.cos(jitter * 4), uy = l > 5 ? dy / l : Math.sin(jitter * 4);
          const px = king.x - (ux * Math.cos(jitter) - uy * Math.sin(jitter)) * (king.r + 70), py = king.y - (uy * Math.cos(jitter) + ux * Math.sin(jitter)) * (king.r + 70);
          const d = A.steer(b, px, py);
          if (d < 50) { A.steer(b, king.x, king.y); if (Math.random() < 7 * dt) A.tryDash(b); }
          return;
        }
        A.steer(b, cx + rnd(-40, 40), cy + rnd(-30, 30), 180);
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        const { hits } = A.step(dt);
        for (const h of hits) if (h.speed > 260) { ctx.sfx.hit(); ctx.shake(Math.min(18, h.speed / 45)); for (const [x, y] of [[h.a, h.b], [h.b, h.a]]) if (x.dash > 0 && y === king && !x.ghost) ctx.stat(x.pid, "shoves", 1); }
        const on = A.bodies.filter(onHill);
        if (king && !onHill(king)) { // toppled
          pops.push({ x: king.x, y: king.y - king.r - 50, t: 0, word: "TOPPLED!" }); ctx.sfx.crunch(); ctx.shake(24);
          if (!king.ghost) ctx.buzz(king.pid, 400);
          king.shrink = true; king = null; relayout();
        }
        for (const b of A.bodies) b.onT = onHill(b) ? b.onT + dt : 0;
        const claim = on.filter((b) => b.onT >= 1).sort((p, q) => q.onT - p.onT)[0];
        if (!king && claim) { king = claim; crownT = 0; king.shrink = false; ctx.sfx.power(); pops.push({ x: king.x, y: king.y - 90, t: 0, word: "CROWNED!" }); relayout(); }
        for (const b of A.bodies) {
          if (b === king) {
            crownT += dt;
            setSize(b, Math.min(MAX_S, b.size + GROW * dt));
            const was = Math.floor(b.score); b.score += dt;
            if (Math.floor(b.score) > was) { ctx.sfx.dot(); if (!b.ghost) ctx.stat(b.pid, "reign", 1); }
          } else if (b.size > 1) setSize(b, Math.max(1, b.size - 1.4 * dt));
        }
        if (ck.t >= TIME) {
          endAt = ck.t + 1.4; ctx.sfx.win();
          const by = {};
          for (const b of A.bodies) (by[Math.floor(b.score)] ||= []).push(b);
          const groups = Object.keys(by).sort((a, b) => b - a).map((k) => by[k]);
          inst.pending = A.ffaResult(groups, groups[0].length === 1 ? `${groups[0][0].p.name} ruled the hill for ${Math.floor(groups[0][0].score)} s!` : "A shared throne!");
        }
      },
      draw(g) {
        g.fillStyle = "#1c2a14"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 20, "#2f4a22", INK, 6);
        for (let i = 0; i < 60; i++) { g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(F.x0 + ((i * 331) % (F.x1 - F.x0)), F.y0 + ((i * 173) % (F.y1 - F.y0)), 26, 5); }
        // the hill: stacked rings for height
        for (let k = 4; k >= 0; k--) { g.beginPath(); g.ellipse(cx, cy + k * 6, HILL_R + k * 40, (HILL_R + k * 40) * 0.7, 0, 0, Math.PI * 2); g.fillStyle = ["#6b8a3a", "#5a7a30", "#4a6a28", "#3f5a22", "#34501c"][k]; g.fill(); g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,.3)"; g.stroke(); }
        g.beginPath(); g.ellipse(cx, cy, HILL_R, HILL_R * 0.7, 0, 0, Math.PI * 2); g.setLineDash([16, 12]); g.lineWidth = 6; g.strokeStyle = king ? "#ffd400" : "#fff"; g.stroke(); g.setLineDash([]);
        rrect(g, cx - 6, cy - 120, 12, 100, 3, "#8a5a2b", INK, 3); g.fillStyle = king ? king.p.color : "#fff"; g.beginPath(); g.moveTo(cx + 6, cy - 120); g.lineTo(cx + 70, cy - 100); g.lineTo(cx + 6, cy - 80); g.closePath(); g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
        A.bodies.slice().sort((a, b) => a.y - b.y).forEach((b) => {
          const R = b.r ?? R0;
          g.beginPath(); g.ellipse(b.x, b.y + R * 0.85, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.4)"; g.fill();
          blob(g, b.p, b.x, b.y, R, { sx: 1 + (b.dash > 0 ? 0.2 : 0) + b.hit, sy: 1 - (b.dash > 0 ? 0.15 : 0) - b.hit });
          tag(g, b.ghost ? "BOT" : b.p.name, b.x, b.y - R - 22, b.p.color, 16);
          if (b === king) { g.save(); g.translate(b.x, b.y - R - 44); g.scale(b.size * 0.6, b.size * 0.6); g.beginPath(); g.moveTo(-26, 14); g.lineTo(-30, -14); g.lineTo(-14, 0); g.lineTo(0, -22); g.lineTo(14, 0); g.lineTo(30, -14); g.lineTo(26, 14); g.closePath(); g.fillStyle = "#ffd400"; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke(); g.restore(); }
        });
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 60, "#ffd400", p.t); }
        rrect(g, 0, 0, W, 130, 0, "rgba(14,20,10,.92)");
        const top = [...A.bodies].sort((a, b) => b.score - a.score).slice(0, 3);
        top.forEach((b, i) => text(g, `${i + 1}. ${b.ghost ? "BOT" : b.p.name} ${Math.floor(b.score)}s`, 150 + i * 260, 66, 30, b.p.color, "left", 900));
        outlined(g, String(ck.left()), W - 200, 66, 70, "#fff");
        if (king) text(g, `👑 ${king.ghost ? "BOT" : king.p.name} · ${Math.floor(crownT)}s`, W - 560, 66, 36, "#ffd400", "center", 900);
        ck.overlay(g, "CLIMB!");
      },
    };
    return inst;
  },
};
