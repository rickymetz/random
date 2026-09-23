// Shared engine for the top-down arena games (soccer, sumo, bumpers, coin
// rush, hot potato, …): stick movement with acceleration and friction, a
// dash, bouncy blob-on-blob collisions, walls, team splitting (a bot evens
// out odd counts), and small helpers for drawing, bots and results.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, tag, countdown } from "../gfx.js";

export const TEAM = [
  { name: "Pink", color: "#ff2a6d" },
  { name: "Cyan", color: "#05d9e8" },
];
export const rnd = (a, b) => a + Math.random() * (b - a);
export const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

/**
 * opts: R (body radius), speed, accel (1/s), bounce (restitution, >1 = extra
 * shove), mass for dashing, dash {mul, time, cool}, bounds {x0,y0,x1,y1},
 * teams (true = split into two teams, a bot fills an odd count), wallBounce.
 */
export function arena(ctx, o) {
  const R = o.R ?? 30, speed = o.speed ?? 260, accel = o.accel ?? 9, bounce = o.bounce ?? 0.8;
  const dash = { mul: 2.3, time: 0.25, cool: 2.2, ...(o.dash || {}) };
  const bounds = o.bounds ?? { x0: 90, y0: 160, x1: W - 90, y1: H - 50 };
  const seats = shuffle(ctx.players.slice());
  let ghostN = 0;
  // pid is read through the player, so a seat reclaimed mid-game (new pid) follows along
  const makeBody = (p, team = -1) => ({ p, get pid() { return this.p.pid; }, team, x: 0, y: 0, vx: 0, vy: 0, mx: 0, my: 0, dash: 0, dashCool: 0, face: [1, 0], out: false, ghost: !!p.ghost, hit: 0, bot: {} });
  const bodies = [];
  if (o.teams) {
    const off = Math.random() < 0.5 ? 0 : 1; // which side gets the odd human varies
    seats.forEach((p, i) => bodies.push(makeBody(p, (i + off) % 2)));
    if (seats.length % 2) { // a bot evens the teams (on the short side); it plays but doesn't score
      const t = bodies.filter((b) => b.team === 0).length < bodies.filter((b) => b.team === 1).length ? 0 : 1;
      bodies.push(makeBody({ pid: `ghost${ghostN++}`, name: "Bot", color: "#8a8aa0", ghost: true }, t));
    }
  } else seats.forEach((p) => bodies.push(makeBody(p)));

  const A = {
    R, bounds, bodies, dash,
    teams: o.teams ? [0, 1].map((t) => bodies.filter((b) => b.team === t)) : null,
    live: () => bodies.filter((b) => !b.out),
    of: (pid) => bodies.find((b) => b.pid === pid),
    real: (list) => list.filter((b) => !b.ghost).map((b) => b.pid),

    // phone intents; returns "action" when the action button was pressed
    input(pid, m) {
      const b = A.of(pid);
      if (!b || b.out) return null;
      if (m.t === "move") {
        const x = +m.x || 0, y = +m.y || 0, l = Math.hypot(x, y), k = l > 1 ? 1 / l : 1;
        b.mx = x * k; b.my = y * k;
        if (l > 0.2) b.face = [x / l, y / l];
        return null;
      }
      if (m.t === "action") return "action";
      return null;
    },
    tryDash(b) {
      if (b.dashCool > 0 || b.out) return false;
      b.dash = dash.time; b.dashCool = dash.cool;
      const [fx, fy] = Math.hypot(b.mx, b.my) > 0.1 ? [b.mx, b.my] : b.face;
      const l = Math.hypot(fx, fy) || 1;
      b.vx += (fx / l) * speed * (dash.mul - 1); b.vy += (fy / l) * speed * (dash.mul - 1);
      ctx.sfx.flap();
      return true;
    },

    // physics step; returns collisions [{a, b, speed}] and wall hits [{b, speed}]
    step(dt, extra = []) {
      const hits = [], walls = [];
      for (const b of bodies) {
        if (b.out) continue;
        b.dash = Math.max(0, b.dash - dt); b.dashCool -= dt; b.hit = Math.max(0, b.hit - dt);
        const sp = (b.speedMul ?? 1) * speed;
        const k = Math.min(1, accel * dt * (b.dash > 0 ? 0.25 : 1));
        b.vx += (b.mx * sp - b.vx) * k; b.vy += (b.my * sp - b.vy) * k;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (o.round) continue; // round arenas handle their own edge
        for (const [ax, lo, hi, vk] of [["x", bounds.x0, bounds.x1, "vx"], ["y", bounds.y0, bounds.y1, "vy"]]) {
          if (b[ax] < lo + R) { b[ax] = lo + R; if (b[vk] < 0) { walls.push({ b, speed: -b[vk], side: ax + "0" }); b[vk] *= -(o.wallBounce ?? 0.5); } }
          if (b[ax] > hi - R) { b[ax] = hi - R; if (b[vk] > 0) { walls.push({ b, speed: b[vk], side: ax + "1" }); b[vk] *= -(o.wallBounce ?? 0.5); } }
        }
      }
      const all = [...bodies.filter((b) => !b.out), ...extra];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j], ra = a.r ?? R, rb = b.r ?? R;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= ra + rb) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d, ma = a.mass ?? (a.dash > 0 ? 2.2 : 1), mb = b.mass ?? (b.dash > 0 ? 2.2 : 1);
        const push = ra + rb - d;
        a.x -= nx * push * (mb / (ma + mb)); a.y -= ny * push * (mb / (ma + mb));
        b.x += nx * push * (ma / (ma + mb)); b.y += ny * push * (ma / (ma + mb));
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv >= 0) continue;
        const e = a.ball || b.ball ? 0.9 : bounce;
        const j2 = (-(1 + e) * rv) / (1 / ma + 1 / mb);
        a.vx -= (j2 / ma) * nx; a.vy -= (j2 / ma) * ny; b.vx += (j2 / mb) * nx; b.vy += (j2 / mb) * ny;
        a.hit = b.hit = Math.min(0.3, -rv / 900);
        hits.push({ a, b, speed: -rv });
      }
      return { hits, walls };
    },

    // simple bot steering: toward (x, y), optionally dashing when close
    steer(b, x, y, dashWithin = 0) {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
      if (d < 6) { b.mx = b.my = 0; return d; }
      b.mx = dx / d; b.my = dy / d; b.face = [b.mx, b.my];
      if (dashWithin && d < dashWithin && Math.random() < 0.05) A.tryDash(b);
      return d;
    },

    drawBody(g, b, opt = {}) {
      if (b.out && !opt.force) return;
      const sq = b.hit > 0 ? b.hit : 0, moving = Math.hypot(b.vx, b.vy) > 30;
      g.beginPath(); g.ellipse(b.x, b.y + R * 0.85, R * 0.9, R * 0.3, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.4)"; g.fill();
      if (b.team >= 0) { g.beginPath(); g.ellipse(b.x, b.y + R * 0.75, R * 1.05, R * 0.4, 0, 0, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = TEAM[b.team].color; g.stroke(); }
      const bob = moving ? Math.abs(Math.sin(performance.now() / 70 + b.x)) * 4 : 0;
      blob(g, b.p, b.x, b.y - bob, R, { sx: 1 + sq + (b.dash > 0 ? 0.2 : 0), sy: 1 - sq - (b.dash > 0 ? 0.15 : 0), alpha: opt.alpha, tint: opt.tint });
      if (!opt.noTag) tag(g, b.ghost ? "BOT" : b.p.name, b.x, b.y - R - 22, b.team >= 0 ? TEAM[b.team].color : b.p.color, 16);
    },

    // results
    teamResult(winner, headline) {
      if (winner < 0) return { tie: true, ranking: [A.real(bodies)], headline };
      return { winners: A.real(A.teams[winner]), losers: A.real(A.teams[1 - winner]), headline };
    },
    // groups: [[bodies…] best first]
    ffaResult(groups, headline) { return { ranking: groups.map((gr) => A.real(gr)).filter((gr) => gr.length), headline }; },

    // standard layouts
    layoutAll(action, hint, role) { for (const b of bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "stick", radar: false, action, hint, role: role ? role(b) : b.team >= 0 ? `${TEAM[b.team].name} team` : "" }); },
    ghosts: () => bodies.filter((b) => b.ghost),
  };
  return A;
}

/** Common countdown / clock / GO! wrapper for arena games. */
export function clock(ctx, total) {
  const c = { t: -3, lastTick: 3, total };
  c.tick = (dt) => {
    c.t += dt;
    if (c.t < 0) { if (Math.ceil(-c.t) < c.lastTick) { c.lastTick = Math.ceil(-c.t); ctx.sfx.tick(); } return false; }
    if (c.lastTick > 0) { c.lastTick = 0; ctx.sfx.go(); }
    return true;
  };
  c.left = () => Math.max(0, Math.ceil(total - Math.max(0, c.t)));
  c.overlay = (g, word = "GO!") => { countdown(g, -c.t); if (c.t >= 0 && c.t < 0.6) shout(g, word, W / 2, H / 2, 240, "#f9f002", c.t); };
  return c;
}

export { W, H, INK, text, outlined, shout, rrect, circle, blob, tag };
