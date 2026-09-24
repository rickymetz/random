// Tank vs Swarm — 2 vs rest (1 vs rest with 3 or fewer players). Two
// players share one jelly tank: the driver steers and can SHAKE off
// hangers-on; the gunner aims the turret and FIREs. Everyone else is a
// tiny, fast swarm blob that latches onto the tank and gnaws its armour;
// shot blobs splat and respawn at the edge. A few bot swarmers pad the swarm
// out. The tank wins by lasting 50 s, the swarm by eating through its armour.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 50, TANK_R = 70, TANK_SPEED = 210, SW_R = 20, SW_SPEED = 330, BULLET = 1150, FIRE_COOL = 0.28, ARMOUR = 58, GNAW = 0.45, SHAKE_COOL = 4, RESPAWN = 3;

export default {
  id: "tank", title: "Tank vs Swarm", command: "SWARM!", kind: "2 vs rest", min: 2, max: 8,
  blurb: "Two players drive and gun one tank. Everyone else swarms it.",
  controls: "Driver: stick + SHAKE. Gunner: stick aims + FIRE. Swarm: stick + DASH, latch on to gnaw",

  create(ctx) {
    const n = ctx.players.length;
    const dPid = ctx.pickOne(), gPid = n >= 4 ? ctx.pickOne() : null; // the tank needs a crew of two only once there's a real swarm
    const A = arena(ctx, { R: SW_R, speed: SW_SPEED });
    const F = A.bounds, ck = clock(ctx, TIME), pops = [], bullets = [];
    const driver = A.of(dPid), gunner = gPid ? A.of(gPid) : null;
    const swarm = A.bodies.filter((b) => b !== driver && b !== gunner);
    // bot swarmers so there's always a swarm; they never score
    for (let i = swarm.length; i < 6; i++) swarm.push({ p: { pid: `npc${i}`, name: "Bot", color: ["#8a8aa0", "#9a7aa0", "#7a9aa0"][i % 3] }, pid: `npc${i}`, ghost: true, npc: true, x: 0, y: 0, vx: 0, vy: 0, mx: 0, my: 0, face: [1, 0], dash: 0, dashCool: 0, hit: 0, bot: {}, team: -1 });
    const tank = { x: W / 2, y: (F.y0 + F.y1) / 2, vx: 0, vy: 0, ang: 0, turret: 0, hp: gunner ? ARMOUR : ARMOUR * 1.15, cool: 0, shakeCool: 0, shake: 0, mx: 0, my: 0, aim: [1, 0] };
    const edge = () => { const s = Math.floor(rnd(0, 4)); return s === 0 ? [F.x0 + 30, rnd(F.y0, F.y1)] : s === 1 ? [F.x1 - 30, rnd(F.y0, F.y1)] : s === 2 ? [rnd(F.x0, F.x1), F.y0 + 30] : [rnd(F.x0, F.x1), F.y1 - 30]; };
    for (const s of swarm) { [s.x, s.y] = edge(); Object.assign(s, { latch: null, dead: 0 }); }
    let endAt = null;
    const armour = tank.hp;

    function fire() {
      if (tank.cool > 0 || ck.t < 0 || endAt != null) return;
      let a = tank.turret;
      if (!gunner) { // solo crew: the turret auto-aims at the nearest swarmer
        const t = swarm.filter((s) => s.dead <= 0).sort((p, q) => Math.hypot(p.x - tank.x, p.y - tank.y) - Math.hypot(q.x - tank.x, q.y - tank.y))[0];
        if (t) a = tank.turret = Math.atan2(t.y - tank.y, t.x - tank.x);
      }
      tank.cool = gunner ? FIRE_COOL : FIRE_COOL * 0.7; // a solo crew fires faster
      bullets.push({ x: tank.x + Math.cos(a) * (TANK_R + 30), y: tank.y + Math.sin(a) * (TANK_R + 30), vx: Math.cos(a) * BULLET, vy: Math.sin(a) * BULLET, t: 0 });
      ctx.sfx.flap(); ctx.shake(3);
    }
    function shakeOff() {
      if (tank.shakeCool > 0 || ck.t < 0) return;
      tank.shakeCool = SHAKE_COOL; tank.shake = 0.5; ctx.sfx.slam(); ctx.shake(12);
      for (const s of swarm) if (s.latch) { const a = Math.atan2(s.y - tank.y, s.x - tank.x); s.latch = null; s.vx = Math.cos(a) * 900; s.vy = Math.sin(a) * 900; s.hit = 0.9; } // flung and dizzy
      pops.push({ x: tank.x, y: tank.y - 120, t: 0, word: "SHAKE!" });
    }
    function splat(s, by) {
      s.dead = RESPAWN; s.latch = null; pops.push({ x: s.x, y: s.y - 40, t: 0, word: "SPLAT!" }); ctx.sfx.pop();
      if (by && !by.ghost) ctx.stat(by.pid, "splatted", 1);
      if (!s.ghost) ctx.buzz(s.pid, 200);
    }
    function finish(tankWins, headline) {
      endAt = ck.t + 1.5; ctx.sfx.win();
      const crew = A.real([driver, gunner].filter(Boolean)), sw = A.real(swarm.filter((s) => !s.npc));
      inst.pending = tankWins ? { winners: crew, losers: sw, headline } : { winners: sw, losers: crew, headline };
    }

    const inst = {
      result: null,
      describe: () => [gunner ? `TANK: ${driver.p.name} drives, ${gunner.p.name} guns` : `TANK: ${driver.p.name} (auto-aim turret)`, `The swarm: ${swarm.filter((s) => !s.npc).map((s) => s.p.name).join(", ")} + bots`],
      start() {
        for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, b === driver
          ? { kind: "stick", radar: false, action: gunner ? "SHAKE" : "FIRE", role: gunner ? "🛞 TANK DRIVER" : "🛞 TANK (solo)", hint: gunner ? "Drive! SHAKE throws off the blobs chewing on you." : "Drive with the stick, FIRE auto-aims." }
          : b === gunner ? { kind: "stick", radar: false, action: "FIRE", role: "🎯 TANK GUNNER", hint: "The stick aims the turret. FIRE!" }
          : { kind: "stick", radar: false, action: "DASH", role: "Swarm", hint: "Latch onto the tank to gnaw its armour! Dodge the shots." });
      },
      input(pid, m) {
        const b = A.of(pid); if (!b) return;
        if (m.t === "move") {
          const x = +m.x || 0, y = +m.y || 0;
          if (b === driver) { tank.mx = x; tank.my = y; return; }
          if (b === gunner) { if (Math.hypot(x, y) > 0.3) tank.aim = [x, y]; return; }
        }
        const r = A.input(pid, m);
        if (r !== "action" || ck.t < 0) return;
        if (b === driver) gunner ? shakeOff() : fire();
        else if (b === gunner) fire();
        else if (b.dead <= 0 && !b.latch) A.tryDash(b);
      },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const s of swarm) if (s.npc) botPlay(s, dt);
        // the tank: heavy, slower with blobs hanging on
        const load = swarm.filter((s) => s.latch).length;
        const sp = TANK_SPEED * Math.max(0.45, 1 - load * 0.1), k = Math.min(1, 3 * dt);
        tank.vx += (tank.mx * sp - tank.vx) * k; tank.vy += (tank.my * sp - tank.vy) * k;
        tank.x = Math.max(F.x0 + TANK_R, Math.min(F.x1 - TANK_R, tank.x + tank.vx * dt)); tank.y = Math.max(F.y0 + TANK_R, Math.min(F.y1 - TANK_R, tank.y + tank.vy * dt));
        if (Math.hypot(tank.vx, tank.vy) > 20) tank.ang = Math.atan2(tank.vy, tank.vx);
        if (gunner) { const want = Math.atan2(tank.aim[1], tank.aim[0]), d = ((want - tank.turret + Math.PI * 3) % (Math.PI * 2)) - Math.PI; tank.turret += Math.max(-7 * dt, Math.min(7 * dt, d)); }
        tank.cool -= dt; tank.shakeCool -= dt; tank.shake = Math.max(0, tank.shake - dt);
        // swarm
        for (const s of swarm) {
          if (s.dead > 0) { s.dead -= dt; if (s.dead <= 0) [s.x, s.y] = edge(); continue; }
          s.hit = Math.max(0, s.hit - dt); s.dash = Math.max(0, s.dash - dt); s.dashCool -= dt;
          if (s.latch) {
            s.x = tank.x + s.latch[0]; s.y = tank.y + s.latch[1];
            tank.hp -= GNAW * dt; if (!s.ghost && Math.random() < dt) ctx.stat(s.pid, "gnaws", 1);
            continue;
          }
          const kk = Math.min(1, 8 * dt * (s.dash > 0 ? 0.25 : 1));
          s.vx += (s.mx * SW_SPEED - s.vx) * kk; s.vy += (s.my * SW_SPEED - s.vy) * kk;
          s.x = Math.max(F.x0 + SW_R, Math.min(F.x1 - SW_R, s.x + s.vx * dt)); s.y = Math.max(F.y0 + SW_R, Math.min(F.y1 - SW_R, s.y + s.vy * dt));
          const d = Math.hypot(s.x - tank.x, s.y - tank.y);
          if (d < TANK_R + SW_R && s.hit <= 0) { s.latch = [((s.x - tank.x) / d) * (TANK_R + 6), ((s.y - tank.y) / d) * (TANK_R + 6)]; ctx.sfx.dot(); }
        }
        // bullets
        for (const bl of bullets) {
          bl.t += dt; bl.x += bl.vx * dt; bl.y += bl.vy * dt;
          for (const s of swarm) if (s.dead <= 0 && Math.hypot(s.x - bl.x, s.y - bl.y) < SW_R + 10) { splat(s, gunner || driver); bl.t = 9; break; }
        }
        for (let i = bullets.length - 1; i >= 0; i--) { const bl = bullets[i]; if (bl.t > 1.2 || bl.x < F.x0 || bl.x > F.x1 || bl.y < F.y0 || bl.y > F.y1) bullets.splice(i, 1); }
        if (tank.hp <= 0) { ctx.shake(34); ctx.sfx.lose(); pops.push({ x: tank.x, y: tank.y - 100, t: 0, word: "DEVOURED!" }); return finish(false, "The swarm eats the tank!"); }
        if (ck.t >= TIME) return finish(true, "The tank survives the swarm!");
      },
      draw(g) {
        g.fillStyle = "#2b2418"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 12, "#4a3f2a", INK, 6);
        for (let i = 0; i < 70; i++) circle(g, F.x0 + ((i * 331) % (F.x1 - F.x0)), F.y0 + ((i * 197) % (F.y1 - F.y0)), 6 + (i % 4) * 3, "rgba(0,0,0,.12)");
        // tank
        const sh = tank.shake > 0 ? Math.sin(ck.t * 80) * 8 : 0;
        g.save(); g.translate(tank.x + sh, tank.y); g.rotate(tank.ang);
        rrect(g, -TANK_R - 6, -TANK_R + 4, TANK_R * 2 + 12, 24, 8, "#2a2a2a", INK, 4); rrect(g, -TANK_R - 6, TANK_R - 28, TANK_R * 2 + 12, 24, 8, "#2a2a2a", INK, 4); // treads
        rrect(g, -TANK_R + 6, -TANK_R + 20, TANK_R * 2 - 12, TANK_R * 2 - 40, 16, "#3f8a4a", INK, 5);
        g.restore();
        g.save(); g.translate(tank.x + sh, tank.y); g.rotate(tank.turret);
        rrect(g, 10, -11, TANK_R + 26, 22, 6, "#2f6a3a", INK, 4);
        g.restore();
        circle(g, tank.x + sh, tank.y, 36, "#56b064", INK, 5);
        if (driver) blob(g, driver.p, tank.x + sh - (gunner ? 14 : 0), tank.y - 4, 18);
        if (gunner) blob(g, gunner.p, tank.x + sh + 14, tank.y - 4, 18);
        for (const bl of bullets) circle(g, bl.x, bl.y, 9, "#f9f002", INK, 3);
        for (const s of swarm) if (s.dead <= 0) {
          g.beginPath(); g.ellipse(s.x, s.y + SW_R * 0.8, SW_R * 0.8, SW_R * 0.3, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.35)"; g.fill();
          blob(g, s.p, s.x, s.y, SW_R + 2, { sx: s.latch ? 1.2 : 1, sy: s.latch ? 0.85 : 1 });
          if (!s.npc) tag(g, s.ghost ? "BOT" : s.p.name, s.x, s.y - SW_R - 18, s.p.color, 14);
        }
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.8) shout(g, p.word, p.x, p.y, p.word === "SPLAT!" ? 36 : 70, "#f9f002", p.t); }
        rrect(g, 0, 0, W, 130, 0, "rgba(20,14,8,.92)");
        text(g, "ARMOUR", 250, 42, 28, "#56b064", "center", 900);
        rrect(g, 90, 66, 340, 34, 6, "#222"); rrect(g, 90, 66, 340 * Math.max(0, tank.hp / armour), 34, 6, tank.hp / armour > 0.3 ? "#56b064" : "#ff2a3d");
        outlined(g, String(ck.left()), W / 2, 66, 70, ck.ink());
        text(g, `CHEWING: ${swarm.filter((s) => s.latch).length}`, W - 330, 66, 40, "#ff6b00", "center", 900);
        ck.overlay(g, "SWARM!");
      },
    };

    // bots: the driver runs from the swarm's centre and shakes when crowded;
    // the gunner leads the nearest free swarmer; swarmers rush and zig-zag
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || endAt != null) return;
      b.bot.t = (b.bot.t ?? 0) - dt;
      if (b === driver) {
        const free = swarm.filter((s) => s.dead <= 0 && !s.latch);
        let cx = 0, cy = 0; for (const s of free) { cx += s.x; cy += s.y; }
        cx /= free.length || 1; cy /= free.length || 1;
        let dx = tank.x - cx, dy = tank.y - cy;
        dx += (W / 2 - tank.x) * 0.9; dy += ((F.y0 + F.y1) / 2 - tank.y) * 0.9; // but not into a corner
        const l = Math.hypot(dx, dy) || 1; tank.mx = dx / l; tank.my = dy / l;
        if (gunner && swarm.filter((s) => s.latch).length >= 2 && Math.random() < 3 * dt) shakeOff();
        if (!gunner && b.bot.t <= 0) { fire(); b.bot.t = rnd(0.3, 0.6); }
        return;
      }
      if (b === gunner) {
        const t = swarm.filter((s) => s.dead <= 0).sort((p, q) => (p.latch ? 1 : 0) - (q.latch ? 1 : 0) || Math.hypot(p.x - tank.x, p.y - tank.y) - Math.hypot(q.x - tank.x, q.y - tank.y))[0];
        if (t) { const tt = Math.hypot(t.x - tank.x, t.y - tank.y) / BULLET; tank.aim = [t.x + t.vx * tt - tank.x + rnd(-30, 30), t.y + t.vy * tt - tank.y + rnd(-30, 30)]; }
        if (b.bot.t <= 0) { fire(); b.bot.t = rnd(0.35, 0.7); }
        return;
      }
      if (b.dead > 0 || b.latch) return;
      const zig = Math.sin(ck.t * 5 + (b.bot.ph ??= rnd(0, 6))) * 0.6, dx = tank.x - b.x, dy = tank.y - b.y, l = Math.hypot(dx, dy) || 1;
      b.mx = dx / l - (dy / l) * zig; b.my = dy / l + (dx / l) * zig;
      const m = Math.hypot(b.mx, b.my); b.mx /= m; b.my /= m;
      if (l < 200 && Math.random() < 2 * dt) A.tryDash(b);
    }
    return inst;
  },
};
