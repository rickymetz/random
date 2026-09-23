// INFECTION! — asymmetric, 1 vs the rest, flipping. One blob starts
// infected; anyone it touches turns and joins the hunt. Pillars to juke
// around, a DASH on a cooldown for everyone. Survivors win if anyone lasts
// the clock; patient zero earns a bonus for every tag. Placements: survivors
// first, then the infected, latest-turned first.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, tag, countdown, makeSplat, drawSplat } from "../gfx.js";

const TIME = 45, R = 28, SPEED = 230, ZERO_SPEED = 238, IT_SPEED = 205, DASH = 0.28, DASH_MUL = 2.4, DASH_COOL = 2.5;
const F = { x0: 100, y0: 150, x1: W - 100, y1: H - 60 };
// infected: near-black body with a toxic glow; no player colour looks like this
const ROT = "#241d2e", SLIME = "#39ff14";
const rnd = (a, b) => a + Math.random() * (b - a);

export default {
  id: "tag", title: "Infection", command: "INFECTION!", kind: "1 vs rest", min: 3, max: 8,
  blurb: "One blob is infected. Every touch spreads it. Last clean blob wins.",
  controls: "Stick to move, DASH to escape (or pounce)",

  create(ctx) {
    const zero = ctx.pickOne();
    const pillars = [];
    for (let tries = 0; pillars.length < 7 && tries < 300; tries++) {
      const r = rnd(45, 75), x = rnd(F.x0 + 200, F.x1 - 200), y = rnd(F.y0 + 150, F.y1 - 150);
      if (pillars.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 140)) pillars.push({ x, y, r });
    }
    const n = ctx.players.length;
    const blobs = ctx.players.map((p, i) => {
      const a = (i / n) * Math.PI * 2;
      const zeroMe = p.pid === zero;
      return { p, x: W / 2 + (zeroMe ? 0 : Math.cos(a) * 520), y: (F.y0 + F.y1) / 2 + (zeroMe ? 0 : Math.sin(a) * 330), mx: 0, my: 0, dash: 0, dashCool: 0, it: zeroMe, at: zeroMe ? 0 : null, tags: 0, bot: { think: 0, dir: [0, 0] } };
    });
    const splats = [], pops = [];
    let t = -3, lastTick = 3, endAt = null;
    const clean = () => blobs.filter((b) => !b.it);
    const layoutFor = (b) => ({ kind: "stick", radar: false, role: b.it ? "Infected" : "Clean", action: "DASH",
      hint: b.it ? "Touch the clean blobs to infect them!" : "Don't get touched. Dash away!" });

    function infect(b, by) {
      b.it = true; b.at = t; by.tags++;
      ctx.stat(by.p.pid, "tags", 1);
      splats.push(makeSplat(b.x, b.y, 30, SLIME));
      pops.push({ x: b.x, y: b.y - 70, word: "INFECTED!", t: 0 });
      ctx.sfx.hit(); ctx.shake(12); ctx.buzz(b.p.pid, 300);
      ctx.layout(b.p.pid, layoutFor(b));
    }

    const inst = {
      result: null,
      describe: () => [`Patient zero: ${blobs.find((b) => b.it).p.name}`, `Everyone else: survive ${TIME} seconds`],
      start() { for (const b of blobs) ctx.layout(b.p.pid, layoutFor(b)); },
      input(pid, m) {
        const b = blobs.find((b) => b.p.pid === pid);
        if (!b) return;
        if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0), k = l > 1 ? 1 / l : 1; b.mx = (+m.x || 0) * k; b.my = (+m.y || 0) * k; }
        else if (m.t === "action" && b.dashCool <= 0) { b.dash = DASH; b.dashCool = DASH_COOL; ctx.sfx.flap(); }
      },
      bot(pid, dt) {
        const b = blobs.find((b) => b.p.pid === pid);
        if (!b || t < 0) return;
        b.bot.think -= dt;
        if (b.bot.think > 0) { [b.mx, b.my] = b.bot.dir; return; }
        b.bot.think = rnd(0.1, 0.25);
        let dx = 0, dy = 0;
        if (b.it) {
          const prey = clean().sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
          if (prey) { dx = prey.x - b.x; dy = prey.y - b.y; if (Math.hypot(dx, dy) < 170 && Math.random() < 0.3) inst.input(pid, { t: "action" }); }
        } else {
          for (const h of blobs) if (h.it) { const ex = b.x - h.x, ey = b.y - h.y, d = Math.hypot(ex, ey) || 1; if (d < 500) { dx += (ex / d) * (500 - d); dy += (ey / d) * (500 - d); } }
          // push off walls only when close, where you get cornered
          const wall = (d) => (d < 220 ? (220 - d) * 1.6 : 0);
          dx += wall(b.x - F.x0) - wall(F.x1 - b.x); dy += wall(b.y - F.y0) - wall(F.y1 - b.y);
          if (blobs.some((h) => h.it && Math.hypot(h.x - b.x, h.y - b.y) < 140) && Math.random() < 0.25) inst.input(pid, { t: "action" });
        }
        const l = Math.hypot(dx, dy) || 1, wob = rnd(-0.35, 0.35);
        b.bot.dir = [dx / l + wob * (dy / l), dy / l - wob * (dx / l)];
        [b.mx, b.my] = b.bot.dir;
      },
      update(dt) {
        t += dt;
        if (t < 0) { if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); } return; }
        if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
        if (inst.result) return;
        if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        for (const b of blobs) {
          b.dash = Math.max(0, b.dash - dt); b.dashCool -= dt;
          const sp = (b.it ? (b.at === 0 ? ZERO_SPEED : IT_SPEED) : SPEED) * (b.dash > 0 ? DASH_MUL : 1);
          b.x = Math.max(F.x0 + R, Math.min(F.x1 - R, b.x + b.mx * sp * dt));
          b.y = Math.max(F.y0 + R, Math.min(F.y1 - R, b.y + b.my * sp * dt));
          for (const p of pillars) { const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < p.r + R) { b.x = p.x + (dx / d) * (p.r + R); b.y = p.y + (dy / d) * (p.r + R); } }
        }
        // touches spread it (patient zero's list grows as they go)
        for (const a of blobs) if (a.it) for (const b of blobs) if (!b.it && Math.hypot(a.x - b.x, a.y - b.y) < 1.7 * R) infect(b, a); // a real touch, not a graze
        // clean blobs bump off each other
        const cl = clean();
        for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
          const a = cl[i], b = cl[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
          if (d < 2 * R) { const push = (2 * R - d) / 2; a.x += (dx / d) * push; a.y += (dy / d) * push; b.x -= (dx / d) * push; b.y -= (dy / d) * push; }
        }
        const left = clean();
        if (left.length <= 1 && blobs.length > 2 || left.length === 0 || t >= TIME) {
          endAt = t + 1.2;
          const infected = blobs.filter((b) => b.it).sort((a, b) => b.at - a.at);
          const ranking = [];
          if (left.length) ranking.push(left.map((b) => b.p.pid));
          for (const b of infected) ranking.push([b.p.pid]);
          const z = blobs.find((b) => b.at === 0);
          inst.pending = {
            ranking, bonus: z && z.tags ? { [z.p.pid]: 2 * z.tags } : null,
            headline: left.length === 1 ? `${left[0].p.name} is the last clean blob!` : left.length ? "The survivors hold out!" : "Total infection!",
          };
          (left.length ? ctx.sfx.win : ctx.sfx.lose)();
        }
      },
      draw(g) {
        g.fillStyle = "#0d0221"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 20, "#150830", "#39ff14", 5);
        g.strokeStyle = "rgba(57,255,20,.12)"; g.lineWidth = 2;
        for (let x = F.x0; x < F.x1; x += 90) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
        for (let y = F.y0; y < F.y1; y += 90) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        for (const sp of splats) drawSplat(g, sp);
        for (const p of pillars) { circle(g, p.x + 6, p.y + 8, p.r, "rgba(0,0,0,.45)"); circle(g, p.x, p.y, p.r, "#2a1450", "#39ff14", 5); }
        for (const b of [...blobs].sort((a, c) => a.y - c.y)) {
          const moving = Math.hypot(b.mx, b.my) > 0.1, bob = moving ? Math.abs(Math.sin(t * 14 + b.x)) * 5 : 0;
          if (b.it) { g.save(); g.shadowColor = SLIME; g.shadowBlur = 34; circle(g, b.x, b.y - bob, R + 5, "rgba(57,255,20,.3)"); g.restore(); }
          blob(g, b.p, b.x, b.y - bob, R, { tint: b.it ? ROT : undefined, sx: b.dash > 0 ? 1.25 : 1, sy: b.dash > 0 ? 0.8 : 1 });
          tag(g, b.it ? `☣ ${b.p.name}` : b.p.name, b.x, b.y - R - 28, b.it ? SLIME : b.p.color, 18);
        }
        for (const pp of pops) { pp.t += 1 / 60; if (pp.t < 1.1) shout(g, pp.word, pp.x, pp.y, 46, SLIME, pp.t); }
        rrect(g, 0, 0, W, 120, 0, "rgba(13,2,33,.85)");
        text(g, `CLEAN ${clean().length}`, 300, 60, 44, "#fff", "center", 900);
        text(g, `INFECTED ${blobs.length - clean().length}`, W - 300, 60, 44, SLIME, "center", 900);
        outlined(g, `${Math.max(0, Math.ceil(TIME - Math.max(0, t)))}`, W / 2, 60, 70, "#fff");
        countdown(g, -t);
        if (t >= 0 && t < 0.6) shout(g, "RUN!", W / 2, H / 2, 260, "#39ff14", t);
      },
    };
    return inst;
  },
};
