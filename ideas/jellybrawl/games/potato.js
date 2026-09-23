// Hot Potato — free-for-all. Someone holds a lit bomb; bump into a rival to
// hand it over (no instant pass-backs). The fuse is secret and gets shorter
// every round. When it pops, the holder is out. Last blob standing wins.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { bomb } from "../gfx.js";

export default {
  id: "potato", title: "Hot Potato", command: "PASS IT!", kind: "Free-for-all", min: 3, max: 8,
  blurb: "Bump someone to hand them the bomb. Don't be holding it when it pops.",
  controls: "Stick to run, DASH to tag someone",

  create(ctx) {
    const A = arena(ctx, { R: 30, speed: 265, bounce: 0.7, dash: { mul: 2.3, time: 0.22, cool: 2.2 } });
    const ck = clock(ctx, 999), out = [], pops = [];
    let holder = null, fuse = 0, fuseMax = 0, noBack = null, noBackT = 0, gap = 0, round = 0, endAt = null;
    const n = A.bodies.length;
    A.bodies.forEach((b, i) => { const a = (i / n) * Math.PI * 2; b.x = W / 2 + Math.cos(a) * 420; b.y = 610 + Math.sin(a) * 260; });

    function newRound() {
      const live = A.live();
      holder = live[Math.floor(Math.random() * live.length)];
      fuseMax = fuse = Math.max(5, rnd(10, 15) - round * 1.3); round++;
      noBack = null;
      ctx.sfx.slam();
      relayout();
    }
    function relayout() {
      for (const b of A.bodies) if (!b.ghost && !b.out) ctx.layout(b.pid, { kind: "stick", radar: false, action: "DASH", role: b === holder ? "💣 YOU HAVE IT" : "Clean", hint: b === holder ? "Bump someone to pass the bomb!" : "Stay away from the bomb!" });
    }
    function pass(to) {
      noBack = holder; noBackT = 0.9;
      holder = to; ctx.sfx.pop(); ctx.shake(6);
      if (!to.ghost) ctx.buzz(to.pid, 150);
      if (!noBack.ghost) ctx.stat(noBack.pid, "passes", 1);
      relayout();
    }

    const inst = {
      result: null,
      describe: () => [`${n} blobs · one bomb`, "The fuse is secret. It gets shorter every round."],
      start() { newRound(); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0) A.tryDash(A.of(pid)); },
      bot(pid) {
        const b = A.of(pid); if (!b || b.out || ck.t < 0) return;
        if (b === holder) {
          const tgt = A.live().filter((o) => o !== b && o !== noBack).sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
          if (tgt) { const d = A.steer(b, tgt.x, tgt.y); if (d < 150 && Math.random() < 0.08) A.tryDash(b); }
        } else if (holder) {
          const dx = b.x - holder.x, dy = b.y - holder.y, d = Math.hypot(dx, dy) || 1;
          if (d < 420) { const F = A.bounds; A.steer(b, Math.max(F.x0 + 80, Math.min(F.x1 - 80, b.x + (dx / d) * 200)), Math.max(F.y0 + 80, Math.min(F.y1 - 80, b.y + (dy / d) * 200))); }
          else b.mx = b.my = 0;
        }
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        const { hits } = A.step(dt);
        noBackT -= dt; if (noBackT <= 0) noBack = null;
        if (gap > 0) { gap -= dt; if (gap <= 0) newRound(); return; }
        for (const h of hits) {
          const other = h.a === holder ? h.b : h.b === holder ? h.a : null;
          if (other && other !== noBack) { pass(other); break; }
        }
        fuse -= dt;
        if (fuse <= 0 && holder) {
          const b = holder; b.out = true; out.push([b]); holder = null;
          pops.push({ x: b.x, y: b.y - 60, t: 0 }); ctx.sfx.hit(); ctx.shake(34);
          for (const o of A.live()) { const d = Math.hypot(o.x - b.x, o.y - b.y) || 1; if (d < 260) { o.vx += ((o.x - b.x) / d) * 600; o.vy += ((o.y - b.y) / d) * 600; } }
          if (!b.ghost) { ctx.buzz(b.pid, 600); ctx.layout(b.pid, { kind: "wait", text: "KABOOM", sub: "You were holding it." }); }
          const live = A.live();
          if (live.length <= 1) {
            endAt = ck.t + 1.4;
            inst.pending = A.ffaResult([live, ...out.slice().reverse()], live.length ? `${live[0].p.name} survives the potato!` : "Nobody survives!");
            ctx.sfx.win();
          } else gap = 1.6;
        }
      },
      draw(g) {
        g.fillStyle = "#1f0a14"; g.fillRect(0, 0, W, H);
        const F = A.bounds;
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 30, "#3a1420", "#ff6b00", 6);
        const k = holder ? 1 - fuse / fuseMax : 0;
        if (holder) { g.fillStyle = `rgba(255,60,0,${0.05 + 0.25 * k * (0.5 + 0.5 * Math.sin(ck.t * (6 + k * 20)))})`; g.fillRect(0, 0, W, H); }
        for (const p of pops) { p.t += 1 / 60; if (p.t < 1.2) { circle(g, p.x, p.y + 60, 60 + p.t * 400, `rgba(255,140,0,${0.6 * (1 - p.t)})`); shout(g, "KABOOM!", p.x, p.y, 80, "#ff6b00", p.t); } }
        A.live().sort((a, b) => a.y - b.y).forEach((b) => {
          A.drawBody(g, b);
          if (b === holder) { // a shrunk-down HUD bomb; the fuse is only a rough hint, the real one is secret
            g.beginPath(); g.arc(b.x, b.y, A.R + 10 + 4 * Math.sin(ck.t * (8 + k * 20)), 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = "#ff6b00"; g.stroke();
            g.save(); g.translate(b.x - 6, b.y - A.R - 78 + Math.sin(ck.t * 20) * 3); g.scale(0.55, 0.55);
            bomb(g, 0, 0, 52, 0.05 + 0.2 * (1 - k)); g.restore();
          }
        });
        rrect(g, 0, 0, W, 120, 0, "rgba(13,2,33,.85)");
        text(g, `STILL STANDING ${A.live().length}/${n}`, 330, 60, 38, "#fff", "center", 900);
        outlined(g, holder ? `${holder.ghost ? "BOT" : holder.p.name} HAS IT!` : "…", W / 2 + 150, 60, 56, "#ff6b00");
        ck.overlay(g, "PASS IT!");
      },
    };
    return inst;
  },
};
