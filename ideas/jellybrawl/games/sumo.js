// Sumo Ring — free-for-all. Shove everyone off a shrinking ring. BUMP is a
// heavy dash that sends people flying. Last blob on the ring wins.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";

const TIME = 50, CX = W / 2, CY = 610, R0 = 440, R1 = 110;

export default {
  id: "sumo", title: "Sumo Ring", command: "SHOVE!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Shove everyone off the shrinking ring. Last blob standing wins.",
  controls: "Stick to move, BUMP to shove",

  create(ctx) {
    const A = arena(ctx, { R: 32, speed: 250, accel: 6, round: true, bounce: 1.5, dash: { mul: 3, time: 0.25, cool: 1.4 } });
    const ck = clock(ctx, TIME), falling = [], out = [];
    let endAt = null;
    const n = A.bodies.length;
    A.bodies.forEach((b, i) => { const a = (i / n) * Math.PI * 2; b.x = CX + Math.cos(a) * 250; b.y = CY + Math.sin(a) * 250 * 0.62; });
    const radius = () => R0 - (R0 - R1) * Math.min(1, Math.max(0, ck.t) / (TIME * 0.8));
    // the ring is drawn as an ellipse (0.62 tall) for a bit of perspective
    const edge = (b) => Math.hypot(b.x - CX, (b.y - CY) / 0.62);

    const inst = {
      result: null,
      describe: () => [`${n} wrestlers · the ring shrinks`, "Last one on the ring wins"],
      start() { A.layoutAll("BUMP", "Shove them out! BUMP is a heavy charge."); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0) A.tryDash(A.of(pid)); },
      bot(pid) {
        const b = A.of(pid); if (!b || b.out || ck.t < 0) return;
        const others = A.live().filter((o) => o !== b);
        const rr = radius();
        if (edge(b) > rr - 55) { A.steer(b, CX, CY); return; } // back from the brink
        const tgt = others.sort((a, c) => (edge(c) - edge(a)) * 0.5 + Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
        if (!tgt) return;
        // line up so the shove pushes them outward
        const ox = tgt.x - CX, oy = tgt.y - CY, ol = Math.hypot(ox, oy) || 1;
        const d = A.steer(b, tgt.x - (ox / ol) * 60, tgt.y - (oy / ol) * 40);
        if (d < 130 && Math.random() < 0.12) A.tryDash(b);
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        const { hits } = A.step(dt);
        for (const h of hits) if (h.speed > 250) { ctx.sfx.hit(); ctx.shake(Math.min(20, h.speed / 40)); for (const b of [h.a, h.b]) if (b.dash > 0 && !b.ghost) ctx.stat(b.pid, "shoves", 1); }
        const rr = radius();
        for (const b of A.live()) if (edge(b) > rr + A.R * 0.4) {
          b.out = true; falling.push({ b, t: 0 }); out.push([b]);
          ctx.sfx.lose(); ctx.shake(14); if (!b.ghost) { ctx.buzz(b.pid, 400); ctx.layout(b.pid, { kind: "wait", text: "RING OUT!", sub: "Shoved into the void." }); }
        }
        const live = A.live();
        if (live.length <= 1 || ck.t >= TIME) {
          endAt = ck.t + 1.2;
          const groups = [live, ...out.slice().reverse()];
          inst.pending = A.ffaResult(groups, live.length === 1 ? `${live[0].p.name} is the sumo champion!` : live.length ? "Nobody got shoved out!" : "Everybody fell!");
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#12071f"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 40; i++) circle(g, (i * 397) % W, 150 + ((i * 211) % (H - 150)), 2, "rgba(255,255,255,.4)");
        const rr = radius();
        g.beginPath(); g.ellipse(CX, CY + 30, rr + 30, (rr + 30) * 0.62, 0, 0, Math.PI * 2); g.fillStyle = "#2b1433"; g.fill();
        g.beginPath(); g.ellipse(CX, CY, rr + 30, (rr + 30) * 0.62, 0, 0, Math.PI * 2); g.fillStyle = "#e7cf9a"; g.fill(); g.lineWidth = 8; g.strokeStyle = INK; g.stroke();
        g.beginPath(); g.ellipse(CX, CY, rr, rr * 0.62, 0, 0, Math.PI * 2); g.lineWidth = 12; g.strokeStyle = "#ff2a6d"; g.stroke();
        g.beginPath(); g.ellipse(CX, CY, 40, 25, 0, 0, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = "rgba(0,0,0,.3)"; g.stroke();
        for (const f of falling) { f.t += 1 / 60; if (f.t < 1) { const s = 1 - f.t; A.drawBody(g, Object.assign({}, f.b, { y: f.b.y + f.t * 160, out: false }), { alpha: s, noTag: true }); } }
        A.live().sort((a, b) => a.y - b.y).forEach((b) => A.drawBody(g, b));
        rrect(g, 0, 0, W, 120, 0, "rgba(13,2,33,.85)");
        text(g, `ON THE RING ${A.live().length}/${A.bodies.length}`, 330, 60, 40, "#fff", "center", 900);
        outlined(g, String(ck.left()), W / 2, 60, 70, "#fff");
        text(g, "THE RING IS SHRINKING", W - 360, 60, 30, "#ff2a6d", "center", 900);
        ck.overlay(g, "SHOVE!");
      },
    };
    return inst;
  },
};
