// Haunted House — 1 vs rest. The house is dark: everyone else carries a
// flashlight (it points where you walk) and only what's in a beam shows on
// the TV. One player is the ghost: invisible except in a beam, faster, and
// able to drift through furniture. Its phone shows where everyone is.
// Touching a blob spooks it out of the game. Beams drain the ghost's
// ectoplasm; VANISH makes it immune for a moment. Hunters win by draining the
// ghost; the ghost wins by spooking everyone or lasting 60 s.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 60, BEAM = 330, CONE = 0.42, DRAIN = 1.2, VANISH = 2, VANISH_COOL = 9, GHOST_SPEED = 290, SPOOK_T = 0.7, CHILL = 260;

export default {
  id: "haunted", title: "Haunted House", command: "BOO!", kind: "1 vs rest", min: 3, max: 8,
  blurb: "One invisible ghost. Everyone else has a flashlight. Light it up before it spooks you.",
  controls: "Hunters: stick (your beam points where you walk). Ghost: stick + VANISH, map on your phone",

  create(ctx) {
    const gPid = ctx.pickOne();
    const A = arena(ctx, { R: 26, speed: 250, bounce: 0.4 });
    const F = A.bounds, ck = clock(ctx, TIME), pops = [], out = [];
    const ghost = A.of(gPid), hunters = A.bodies.filter((b) => b !== ghost);
    const h = hunters.length, hpMax = 1.6 + h * 1.3 + Math.max(0, h - 4) * 0.9, spookT = SPOOK_T + 1.2 / h; // a lone hunter gets more grace
    Object.assign(ghost, { hp: hpMax, vanish: 0, vcool: 0, lit: 0, seen: 0, drip: 0 });
    const drips = [];
    for (const b of A.bodies) b.touch = 0;
    let endAt = null;
    // furniture: solid for hunters, the ghost floats through
    const furn = [];
    for (let tries = 0; furn.length < 9 && tries < 300; tries++) {
      const w = rnd(110, 220), h = rnd(70, 140), x = rnd(F.x0 + 60, F.x1 - 60 - w), y = rnd(F.y0 + 60, F.y1 - 60 - h);
      if (furn.every((f) => x > f.x + f.w + 90 || x + w < f.x - 90 || y > f.y + f.h + 90 || y + h < f.y - 90) && Math.hypot(x + w / 2 - W / 2, y + h / 2 - (F.y0 + F.y1) / 2) > 200)
        furn.push({ x, y, w, h, kind: Math.floor(rnd(0, 3)) });
    }
    ghost.x = W / 2; ghost.y = (F.y0 + F.y1) / 2;
    hunters.forEach((b, i) => { const c = [[F.x0 + 80, F.y0 + 80], [F.x1 - 80, F.y0 + 80], [F.x0 + 80, F.y1 - 80], [F.x1 - 80, F.y1 - 80]][i % 4]; b.x = c[0] + (i >> 2) * 40; b.y = c[1]; b.face = [W / 2 - b.x, 0].map((v) => Math.sign(v) || 1); b.face[1] = 0; });
    const nx = (x) => (x - F.x0) / (F.x1 - F.x0), ny = (y) => (y - F.y0) / (F.y1 - F.y0);
    const map = { walls: furn.map((f) => [nx(f.x), ny(f.y), f.w / (F.x1 - F.x0), f.h / (F.y1 - F.y0)]) };

    // is (x, y) inside hunter b's beam?
    const inBeam = (b, x, y) => {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
      if (d > BEAM || d < 1) return d < 1;
      const [fx, fy] = b.face, l = Math.hypot(fx, fy) || 1;
      return (dx * fx + dy * fy) / (d * l) > Math.cos(CONE);
    };

    function spook(b) {
      b.out = true; out.push(b); ctx.sfx.ko(b); ctx.shake(18); if (!b.ghost) ctx.buzz(b.pid, 400);
      pops.push({ x: b.x, y: b.y - 60, t: 0, word: "BOO!", c: "#b9f6ff" });
      if (!ghost.ghost) ctx.stat(gPid, "spooks", 1);
      if (!b.ghost) { ctx.buzz(b.pid, 500); ctx.layout(b.pid, { kind: "wait", text: "SPOOKED", sub: "You're a goner. Cheer them on." }); }
    }
    function finish(ghostWins, headline) {
      endAt = ck.t + 1.5; ctx.sfx.win();
      const hp = A.real(hunters);
      inst.pending = ghostWins ? { winners: [gPid], losers: hp, headline } : { winners: hp, losers: [gPid], headline };
    }

    const inst = {
      result: null,
      describe: () => [`${ghost.p.name} is the GHOST`, `${hunters.length} ghost hunter${hunters.length > 1 ? "s" : ""} with flashlights`],
      start() {
        for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, b === ghost
          ? { kind: "stick", action: "VANISH", map, role: "👻 THE GHOST", hint: "Touch them to spook them. Stay out of the beams! VANISH = immune for 2 s." }
          : { kind: "stick", radar: false, action: null, role: "Ghost hunter", hint: "Your beam points where you walk. Light up the ghost!" });
      },
      input(pid, m) {
        const b = A.of(pid); if (!b || b.out) return;
        if (A.input(pid, m) === "action" && b === ghost && ck.t >= 0 && ghost.vcool <= 0) { ghost.vanish = VANISH; ghost.vcool = VANISH_COOL; ctx.sfx.whoosh(); }
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || b.out || ck.t < 0) return;
        if (b === ghost) {
          // stalk the hunter whose back is turned; flee if lit, vanish if it's bad
          if (ghost.lit > 0.3 && ghost.vcool <= 0 && Math.random() < 3 * dt) { ghost.vanish = VANISH; ghost.vcool = VANISH_COOL; }
          const lit = hunters.some((h) => !h.out && inBeam(h, b.x, b.y));
          const tgt = A.live().filter((h) => h !== ghost).sort((a, c) => score(a) - score(c))[0];
          if (!tgt) return;
          if (lit && ghost.vanish <= 0) { const h = hunters.find((h) => !h.out && inBeam(h, b.x, b.y)); const dx = b.x - h.x, dy = b.y - h.y, fx = h.face[0], fy = h.face[1]; A.steer(b, b.x - fy * 200 * Math.sign(dx * -fy + dy * fx || 1), b.y + fx * 200 * Math.sign(dx * -fy + dy * fx || 1)); return; }
          A.steer(b, tgt.x - tgt.face[0] * 60, tgt.y - tgt.face[1] * 60);
          return;
        }
        // hunters: sweep toward where the ghost was last seen, else wander;
        // keep near the pack
        b.bot.t = (b.bot.t ?? 0) - dt;
        if (ghost.seen > 0 && Math.random() < 0.9) { A.steer(b, ghost.lx, ghost.ly); return; }
        if (b.bot.t <= 0) { b.bot.x = rnd(F.x0 + 100, F.x1 - 100); b.bot.y = rnd(F.y0 + 100, F.y1 - 100); b.bot.t = rnd(1, 2.5); }
        if (b.chill) { A.steer(b, ghost.x, ghost.y); return; } // feels a chill: turn the beam on it
        const fresh = drips.filter((d) => d.t < 1.2 && Math.hypot(d.x - b.x, d.y - b.y) < 700).pop();
        if (fresh) { A.steer(b, fresh.x, fresh.y); return; }
        A.steer(b, b.bot.x, b.bot.y);
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        ghost.speedMul = GHOST_SPEED / 250 * (ghost.lit > 0 && ghost.vanish <= 0 ? 0.45 : 1); // light slows it
        ghost.vanish = Math.max(0, ghost.vanish - dt); ghost.vcool -= dt; ghost.seen -= dt;
        // the ghost floats through furniture: step it apart from the others
        const saved = ghost.out; ghost.out = true;
        A.step(dt);
        ghost.out = saved;
        const k = Math.min(1, 9 * dt), sp = 250 * ghost.speedMul;
        ghost.vx += (ghost.mx * sp - ghost.vx) * k; ghost.vy += (ghost.my * sp - ghost.vy) * k;
        ghost.x = Math.max(F.x0 + 30, Math.min(F.x1 - 30, ghost.x + ghost.vx * dt)); ghost.y = Math.max(F.y0 + 30, Math.min(F.y1 - 30, ghost.y + ghost.vy * dt));
        // hunters bump into furniture
        for (const b of hunters) if (!b.out) for (const f of furn) {
          const cx = Math.max(f.x, Math.min(f.x + f.w, b.x)), cy = Math.max(f.y, Math.min(f.y + f.h, b.y)), dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
          if (d < A.R && d > 0) { b.x = cx + (dx / d) * A.R; b.y = cy + (dy / d) * A.R; }
        }
        // beams
        const beams = hunters.filter((h) => !h.out && inBeam(h, ghost.x, ghost.y));
        ghost.lit = beams.length ? ghost.lit + dt : 0;
        if (beams.length && ghost.vanish <= 0) {
          ghost.hp -= DRAIN * beams.length * dt; ghost.seen = 1.2; ghost.lx = ghost.x; ghost.ly = ghost.y;
          for (const h of beams) if (!h.ghost && Math.random() < dt * 4) ctx.stat(h.pid, "zaps", 1);
          if (Math.random() < dt * 8) ctx.sfx.dot();
          if (ghost.hp <= 0) return finish(false, `The hunters bust ${ghost.p.name}!`);
        }
        // drips and chills
        ghost.drip -= dt;
        if (ghost.drip <= 0 && ghost.vanish <= 0) { drips.push({ x: ghost.x + rnd(-10, 10), y: ghost.y + 20, t: 0 }); ghost.drip = 0.35; }
        for (const d of drips) d.t += dt;
        while (drips.length && drips[0].t > 3) drips.shift();
        for (const b of hunters) if (!b.out) {
          const d = Math.hypot(b.x - ghost.x, b.y - ghost.y);
          b.chill = d < CHILL;
          if (b.chill && !b.ghost && Math.floor(ck.t * 2) !== Math.floor((ck.t - dt) * 2)) ctx.buzz(b.pid, 60);
          // a spook takes a moment of contact
          b.touch = d < A.R * 2 + 6 ? b.touch + dt : 0;
          if (b.touch >= spookT) spook(b);
        }
        if (hunters.every((b) => b.out)) return finish(true, `${ghost.p.name} spooked everyone!`);
        if (ck.t >= TIME) return finish(true, `${ghost.p.name} haunts on!`);
        // the ghost's private map
        if (!ghost.ghost && Math.floor(ck.t * 10) !== Math.floor((ck.t - dt) * 10))
          ctx.send(gPid, { t: "radar", x: nx(ghost.x), y: ny(ghost.y), dots: hunters.filter((h) => !h.out).map((h) => [nx(h.x), ny(h.y), h.p.color, 7]) });
      },
      draw(g) {
        const scene = (lit) => {
          g.fillStyle = lit ? "#3b2a3f" : "#150d1a"; g.fillRect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
          if (lit) { g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 3; for (let x = F.x0; x < F.x1; x += 60) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); } }
          for (const f of furn) {
            rrect(g, f.x, f.y, f.w, f.h, 8, lit ? ["#6b3a2a", "#4a3a5a", "#2f4a3a"][f.kind] : "#261a2c", INK, 5);
            if (lit && f.kind === 0) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(f.x + 10, f.y + 10, f.w - 20, 8); }
            if (lit && f.kind === 1) circle(g, f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) / 3, "#6a5a7a", INK, 3);
          }
          if (lit && ghost.vanish <= 0) drawGhost(g, 1);
        };
        g.fillStyle = "#050206"; g.fillRect(0, 0, W, H);
        scene(false);
        // the beams: redraw the lit room clipped to the union of cones
        g.save(); g.beginPath();
        for (const b of hunters) if (!b.out) {
          const a = Math.atan2(b.face[1], b.face[0]);
          g.moveTo(b.x, b.y); g.arc(b.x, b.y, BEAM, a - CONE, a + CONE); g.closePath();
          g.moveTo(b.x + 60, b.y); g.arc(b.x, b.y, 60, 0, Math.PI * 2);
        }
        g.clip(); scene(true); g.restore();
        for (const b of hunters) if (!b.out) { const a = Math.atan2(b.face[1], b.face[0]); g.beginPath(); g.moveTo(b.x, b.y); g.arc(b.x, b.y, BEAM, a - CONE, a + CONE); g.closePath(); g.fillStyle = "rgba(255,240,170,.08)"; g.fill(); }
        for (const d of drips) circle(g, d.x, d.y, 7 * (1 - d.t / 3) + 2, `rgba(120,255,200,${0.7 * (1 - d.t / 3)})`);
        // a faint shimmer so the room knows it's there when it spooks close
        if (ghost.vanish <= 0 && ghost.lit <= 0) drawGhost(g, 0.06);
        A.live().filter((b) => b !== ghost).sort((a, b) => a.y - b.y).forEach((b) => {
          A.drawBody(g, b.chill ? Object.assign({}, b, { x: b.x + Math.sin(ck.t * 60) * 3 }) : b);
          if (b.chill) text(g, "❄", b.x + 30, b.y - 40, 26, "#b9f6ff", "center", 900);
        });
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1) shout(g, p.word, p.x, p.y, 70, p.c, p.t); }
        // HUD: ectoplasm bar
        rrect(g, 0, 0, W, 130, 0, "rgba(5,2,6,.92)");
        text(g, "ECTOPLASM", 250, 45, 28, "#b9f6ff", "center", 900);
        rrect(g, 100, 70, 300, 30, 6, "#222"); rrect(g, 100, 70, 300 * Math.max(0, ghost.hp / hpMax), 30, 6, "#b9f6ff");
        outlined(g, String(ck.left()), W / 2, 66, 70, "#fff");
        text(g, `HUNTERS LEFT ${hunters.filter((b) => !b.out).length}/${hunters.length}`, W - 330, 66, 36, "#fff", "center", 900);
        ck.overlay(g, "BOO!");
      },
    };

    function drawGhost(g, alpha) {
      const x = ghost.x, y = ghost.y - 10 + Math.sin(ck.t * 4) * 6;
      g.save(); g.globalAlpha = alpha;
      g.beginPath(); g.moveTo(x - 34, y + 30);
      g.arc(x, y - 6, 34, Math.PI, 0);
      for (let k = 0; k <= 4; k++) g.lineTo(x + 34 - k * 17, y + 30 + (k % 2 ? -10 : 6) + Math.sin(ck.t * 8 + k) * 3);
      g.closePath(); g.fillStyle = "#e8fbff"; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
      circle(g, x - 12, y - 8, 6, INK); circle(g, x + 12, y - 8, 6, INK);
      g.beginPath(); g.ellipse(x, y + 10, 7, 10, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
      g.restore();
      if (alpha > 0.5) tag(g, ghost.ghost ? "BOT" : ghost.p.name, x, y - 60, "#b9f6ff", 16);
    }
    // ghost bot: prefers hunters facing away from it
    function score(h) { const dx = ghost.x - h.x, dy = ghost.y - h.y, d = Math.hypot(dx, dy) || 1; return d * (1.3 + (dx * h.face[0] + dy * h.face[1]) / d); }
    return inst;
  },
};
