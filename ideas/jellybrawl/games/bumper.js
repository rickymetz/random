// Bumper Blobs — free-for-all. Bumper cars in a spiked pen: every collision
// is extra bouncy, and touching the spikes costs a life (then a short
// respawn shield). Three lives; last blob with lives wins.

import { arena, clock, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 60, LIVES = 3, SHIELD = 1.8;

export default {
  id: "bumper", title: "Bumper Blobs", command: "BUMP!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Bumper cars in a spiked pen. Knock them into the spikes.",
  controls: "Stick to drive, BOOST to ram",

  create(ctx) {
    const bounds = { x0: 170, y0: 230, x1: W - 170, y1: H - 80 };
    const A = arena(ctx, { R: 30, speed: 300, accel: 3.2, bounds, bounce: 1.65, wallBounce: 0.3, dash: { mul: 2.4, time: 0.3, cool: 1.8 } });
    const ck = clock(ctx, TIME), out = [], pops = [];
    let endAt = null;
    const n = A.bodies.length;
    for (const [i, b] of A.bodies.entries()) { const a = (i / n) * Math.PI * 2; b.x = W / 2 + Math.cos(a) * 380; b.y = 600 + Math.sin(a) * 250; b.lives = LIVES; b.shield = 1; }

    const inst = {
      result: null,
      describe: () => [`${LIVES} lives each`, "The spikes are the enemy. So is everyone."],
      start() { A.layoutAll("BOOST", "Ram people into the spikes. Don't touch them yourself!"); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0) A.tryDash(A.of(pid)); },
      bot(pid) {
        const b = A.of(pid); if (!b || b.out || ck.t < 0) return;
        const nearWall = Math.min(b.x - bounds.x0, bounds.x1 - b.x, b.y - bounds.y0, bounds.y1 - b.y);
        if (nearWall < 110) { A.steer(b, W / 2, 620); return; }
        // hunt whoever is closest to a wall
        const tgt = A.live().filter((o) => o !== b && o.shield <= 0).sort((a, c) => Math.min(a.x - bounds.x0, bounds.x1 - a.x, a.y - bounds.y0, bounds.y1 - a.y) - Math.min(c.x - bounds.x0, bounds.x1 - c.x, c.y - bounds.y0, bounds.y1 - c.y))[0];
        if (tgt) { const d = A.steer(b, tgt.x, tgt.y); if (d < 200 && Math.random() < 0.1) A.tryDash(b); }
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const b of A.bodies) b.shield = Math.max(0, b.shield - dt);
        const { hits, walls } = A.step(dt);
        for (const h of hits) if (h.speed > 200) { ctx.sfx.crunch(h.a); ctx.shake(Math.min(16, h.speed / 50)); }
        for (const w of walls) {
          const b = w.b;
          if (b.shield > 0 || b.out) continue;
          b.lives--; b.shield = SHIELD; ctx.sfx.hit(b); ctx.shake(20);
          pops.push({ x: b.x, y: b.y - 60, t: 0, word: b.lives > 0 ? "OUCH!" : "WRECKED!" });
          if (!b.ghost) ctx.buzz(b.pid, 300);
          if (b.lives <= 0) { b.out = true; out.push([b]); ctx.sfx.ko(b); if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: "WRECKED", sub: "Spiked. Watch the rest." }); }
          else { b.x = W / 2 + (Math.random() - 0.5) * 300; b.y = 620 + (Math.random() - 0.5) * 200; b.vx = b.vy = 0; }
        }
        const live = A.live();
        if (live.length <= 1 || ck.t >= TIME) {
          endAt = ck.t + 1.2;
          // survivors rank by lives left, then the wrecked by who lasted longest
          const byLives = {};
          for (const b of live) (byLives[b.lives] ||= []).push(b);
          const groups = [...Object.keys(byLives).sort((a, b) => b - a).map((k) => byLives[k]), ...out.slice().reverse()];
          inst.pending = A.ffaResult(groups, live.length === 1 ? `${live[0].p.name} rules the pen!` : "Time! Most lives wins.");
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#0d0221"; g.fillRect(0, 0, W, H);
        rrect(g, bounds.x0 - 40, bounds.y0 - 40, bounds.x1 - bounds.x0 + 80, bounds.y1 - bounds.y0 + 80, 20, "#3a1a2a", INK, 6);
        // spikes
        g.fillStyle = "#c9ced8"; g.strokeStyle = INK; g.lineWidth = 3;
        const spike = (x, y, dx, dy) => { g.beginPath(); g.moveTo(x - dy * 14, y + dx * 14); g.lineTo(x + dx * 32, y + dy * 32); g.lineTo(x + dy * 14, y - dx * 14); g.closePath(); g.fill(); g.stroke(); };
        for (let x = bounds.x0; x <= bounds.x1; x += 34) { spike(x, bounds.y0 - 36, 0, 1); spike(x, bounds.y1 + 36, 0, -1); }
        for (let y = bounds.y0; y <= bounds.y1; y += 34) { spike(bounds.x0 - 36, y, 1, 0); spike(bounds.x1 + 36, y, -1, 0); }
        g.fillStyle = "#1f1433"; g.fillRect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
        g.strokeStyle = "rgba(5,217,232,.12)"; g.lineWidth = 2;
        for (let x = bounds.x0; x < bounds.x1; x += 80) { g.beginPath(); g.moveTo(x, bounds.y0); g.lineTo(x, bounds.y1); g.stroke(); }
        for (let y = bounds.y0; y < bounds.y1; y += 80) { g.beginPath(); g.moveTo(bounds.x0, y); g.lineTo(bounds.x1, y); g.stroke(); }
        A.live().sort((a, b) => a.y - b.y).forEach((b) => {
          if (b.shield > 0) { g.beginPath(); g.arc(b.x, b.y, A.R + 12, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = `rgba(5,217,232,${0.4 + 0.4 * Math.sin(ck.t * 20)})`; g.stroke(); }
          A.drawBody(g, b);
          text(g, "♥".repeat(b.lives), b.x, b.y + A.R + 18, 18, "#ff2a6d", "center", 800);
        });
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1) shout(g, p.word, p.x, p.y, 44, "#ff2a6d", p.t); }
        rrect(g, 0, 0, W, 120, 0, "rgba(13,2,33,.85)");
        text(g, `STILL DRIVING ${A.live().length}/${A.bodies.length}`, 330, 60, 38, "#fff", "center", 900);
        outlined(g, String(ck.left()), W / 2, 60, 70, ck.ink());
        ck.overlay(g, "BUMP!");
      },
    };
    return inst;
  },
};
