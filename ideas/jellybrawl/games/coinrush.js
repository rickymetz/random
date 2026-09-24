// Coin Rush — free-for-all. Coins rain into the arena; grab as many as you
// can. Spiked rollers knock coins out of you, and a DASH into a rival
// makes them drop one too. Most coins after 45 s wins.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 45, COIN_R = 16;

export default {
  id: "coinrush", title: "Coin Rush", command: "GRAB IT!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Coins rain down. Grab the most. Dodge the spike rollers.",
  controls: "Stick to run, DASH to barge (they drop a coin)",

  create(ctx) {
    const A = arena(ctx, { R: 28, speed: 280, bounce: 0.9, dash: { mul: 2.2, time: 0.22, cool: 2 } });
    const F = A.bounds, ck = clock(ctx, TIME), coins = [], pops = [];
    const rollers = [0, 1, 2].map((i) => ({ x: 400 + i * 560, y: 350 + (i % 2) * 450, vx: rnd(-1, 1) * 260, vy: rnd(-1, 1) * 220, r: 40, rot: 0 }));
    let rain = 0, endAt = null;
    const n = A.bodies.length;
    A.bodies.forEach((b, i) => { b.x = W / 2 + ((i % 4) - 1.5) * 200; b.y = 520 + Math.floor(i / 4) * 180; b.coins = 0; b.hurt = 0; });

    function drop(b, k) {
      const lost = Math.min(k, b.coins);
      b.coins -= lost;
      for (let i = 0; i < lost; i++) { const a = rnd(0, Math.PI * 2); coins.push({ x: b.x, y: b.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, z: 0, vz: 300, t: 0 }); }
      if (lost) pops.push({ x: b.x, y: b.y - 60, t: 0, word: `−${lost}` });
    }

    const inst = {
      result: null,
      describe: () => [`${n} blobs · ${TIME} seconds`, "Spike rollers knock your coins loose"],
      start() { A.layoutAll("DASH", "Grab coins! Dash into rivals to make them drop one."); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0) A.tryDash(A.of(pid)); },
      bot(pid) {
        const b = A.of(pid); if (!b || ck.t < 0) return;
        const danger = rollers.find((r) => Math.hypot(r.x - b.x, r.y - b.y) < 170);
        if (danger) { A.steer(b, b.x + (b.x - danger.x), b.y + (b.y - danger.y)); return; }
        const c = coins.filter((c) => c.z <= 0).sort((a, c2) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c2.x - b.x, c2.y - b.y))[0];
        if (c) A.steer(b, c.x, c.y); else A.steer(b, W / 2, 600);
        const rich = A.bodies.find((o) => o !== b && o.coins > 3 && Math.hypot(o.x - b.x, o.y - b.y) < 120);
        if (rich && Math.random() < 0.05) { A.steer(b, rich.x, rich.y); A.tryDash(b); }
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        const { hits } = A.step(dt);
        for (const h of hits) for (const [x, y] of [[h.a, h.b], [h.b, h.a]]) if (x.dash > 0 && y.hurt <= 0 && h.speed > 200) { drop(y, 1); y.hurt = 0.6; ctx.sfx.crunch(y); }
        for (const b of A.bodies) b.hurt = Math.max(0, b.hurt - dt);
        // coins rain faster as time runs out
        rain -= dt;
        if (rain <= 0) { coins.push({ x: rnd(F.x0 + 60, F.x1 - 60), y: rnd(F.y0 + 60, F.y1 - 60), vx: 0, vy: 0, z: 500, vz: 0, t: 0 }); rain = Math.max(0.12, 0.45 - ck.t * 0.006); }
        for (const c of coins) {
          c.t += dt;
          if (c.z > 0 || c.vz > 0) { c.vz -= 1400 * dt; c.z = Math.max(0, c.z + c.vz * dt); if (c.z === 0) c.vz = 0; }
          c.vx *= Math.exp(-3 * dt); c.vy *= Math.exp(-3 * dt);
          c.x = Math.max(F.x0 + 20, Math.min(F.x1 - 20, c.x + c.vx * dt)); c.y = Math.max(F.y0 + 20, Math.min(F.y1 - 20, c.y + c.vy * dt));
        }
        for (const b of A.bodies) for (let i = coins.length - 1; i >= 0; i--) {
          const c = coins[i];
          if (c.z > 10 || c.t < 0.3 || Math.hypot(c.x - b.x, c.y - b.y) > A.R + COIN_R) continue;
          coins.splice(i, 1); b.coins++; if (!b.ghost) ctx.stat(b.pid, "coins", 1); ctx.sfx.dot(b);
        }
        for (const r of rollers) {
          r.x += r.vx * dt; r.y += r.vy * dt; r.rot += dt * 6;
          if (r.x < F.x0 + r.r || r.x > F.x1 - r.r) r.vx *= -1;
          if (r.y < F.y0 + r.r || r.y > F.y1 - r.r) r.vy *= -1;
          for (const b of A.bodies) {
            const d = Math.hypot(b.x - r.x, b.y - r.y);
            if (d < r.r + A.R && b.hurt <= 0) { drop(b, 3); b.hurt = 1; b.vx += ((b.x - r.x) / d) * 700; b.vy += ((b.y - r.y) / d) * 700; ctx.sfx.hit(b); ctx.shake(10); if (!b.ghost) ctx.buzz(b.pid, 200); }
          }
        }
        if (ck.t >= TIME) {
          endAt = ck.t + 1.2;
          const by = {};
          for (const b of A.bodies) (by[b.coins] ||= []).push(b);
          const groups = Object.keys(by).sort((a, b) => b - a).map((k) => by[k]);
          inst.pending = A.ffaResult(groups, groups[0].length === 1 ? `${groups[0][0].p.name} is loaded!` : "A tie at the top!");
          ctx.sfx.win();
        }
      },
      draw(g) {
        g.fillStyle = "#1a0d2e"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 14, "#2a1640", "#f9f002", 6);
        for (let x = F.x0 + 60; x < F.x1; x += 120) for (let y = F.y0 + 60; y < F.y1; y += 120) circle(g, x, y, 3, "rgba(249,240,2,.15)");
        const items = [];
        for (const c of coins) items.push([c.y, () => {
          g.beginPath(); g.ellipse(c.x, c.y + 8, 12 + Math.min(10, c.z / 40), 5, 0, 0, Math.PI * 2); g.fillStyle = `rgba(0,0,0,${0.4 - Math.min(0.3, c.z / 1500)})`; g.fill();
          const w = Math.abs(Math.cos(c.t * 5)) * COIN_R + 4;
          g.beginPath(); g.ellipse(c.x, c.y - c.z, w, COIN_R, 0, 0, Math.PI * 2); g.fillStyle = "#ffd400"; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
        }]);
        for (const r of rollers) items.push([r.y, () => {
          g.save(); g.translate(r.x, r.y); g.rotate(r.rot);
          for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a - 0.2) * r.r * 0.8, Math.sin(a - 0.2) * r.r * 0.8); g.lineTo(Math.cos(a) * r.r * 1.35, Math.sin(a) * r.r * 1.35); g.lineTo(Math.cos(a + 0.2) * r.r * 0.8, Math.sin(a + 0.2) * r.r * 0.8); g.fillStyle = "#c9ced8"; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); }
          circle(g, 0, 0, r.r * 0.85, "#5b6072", INK, 5); g.restore();
        }]);
        for (const b of A.bodies) items.push([b.y, () => { A.drawBody(g, b, { alpha: b.hurt > 0 && Math.floor(ck.t * 12) % 2 ? 0.5 : 1 }); text(g, `● ${b.coins}`, b.x, b.y + A.R + 18, 20, "#ffd400", "center", 900); }]);
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 40, "#ff2a6d", p.t); }
        rrect(g, 0, 0, W, 120, 0, "rgba(13,2,33,.85)");
        const lead = [...A.bodies].sort((a, b) => b.coins - a.coins)[0];
        text(g, `LEADER: ${lead.ghost ? "BOT" : lead.p.name} · ${lead.coins}`, 360, 60, 36, "#ffd400", "center", 900);
        outlined(g, String(ck.left()), W / 2, 60, 70, ck.ink());
        ck.overlay(g, "GRAB IT!");
      },
    };
    return inst;
  },
};
