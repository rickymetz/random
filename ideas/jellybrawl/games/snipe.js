// The sniper games — asymmetric, 1 vs the rest, on one engine with two variants:
//
//   Sniper Plaza (crowd): runners wear their own colour (plain face) among NPC
//   lookalikes dealt evenly across the runners' colours, so colour narrows the
//   search but never gives anyone away. Hitting an innocent costs a long reload
//   and sends the crowd into a panic.
//
//   Sniper Blackout (cover): only the players, but the plaza is dark: outside
//   the scope the TV shows just a faint outline of the cover and ripples of
//   noise (bush rustles, coin grabs, sprints, bumps). Crates are solid, block
//   shots and hide whoever is behind them, and break after 2 hits; bushes can
//   be walked into and hide you partly, but rustle. Runners navigate by a phone
//   mini-map (cover, coins, themselves, the scope, recent shots) and can
//   SPRINT; the sniper has 2 flares that light the whole plaza for a second.
//
// Both: runners steal coins (only runners can) and find themselves on a
// private phone radar; the sniper drags a trackpad and fires. Runners win on
// the loot target or by surviving the clock; the sniper wins by hitting every
// runner. The sniper role rotates.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, tag, countdown, makeSplat, drawSplat } from "../gfx.js";
import { musicCues } from "./arena.js";
import { FX, fade } from "../gfx.js";

const BOUNCE = 0.7, KNOCK_DAMP = 5; // solid blobs: restitution, and how fast a shove fades (1/s)
const TIME = 75, R = 26, SPEED = 150, PANIC_SPEED = 260, RELOAD = 1.5, MISFIRE = 4, PANIC = 3;
const FLARES = 2, FLARE = 1, SPRINT = 1, SPRINT_COOL = 4, CRATE_HP = 2, SHOT_MARK = 2.5; // blackout
const F = { x0: 120, y0: 170, x1: W - 120, y1: H - 90 };               // the plaza
const rnd = (a, b) => a + Math.random() * (b - a);
const clampX = (x) => Math.max(F.x0 + R, Math.min(F.x1 - R, x));
const clampY = (y) => Math.max(F.y0 + R, Math.min(F.y1 - R, y));
const nx = (x) => (x - F.x0) / (F.x1 - F.x0), ny = (y) => (y - F.y0) / (F.y1 - F.y0);

const VARIANTS = {
  plaza: {
    id: "snipe", title: "Sniper Plaza", command: "BLEND IN!", kind: "1 vs rest", min: 2, max: 8,
    blurb: "Hide in the crowd and steal the loot. One sniper is watching.",
    controls: "Runners: stick + BLEND. Sniper: drag to aim, FIRE",
    crowd: true, cover: false, blackout: false, scopeR: 120, zoom: 1.6,
    hint: "Find your dot on the radar. Act natural.", action: "BLEND",
    sniperWins: (n) => `${n} cleaned the plaza!`,
  },
  blackout: {
    id: "blackout", title: "Sniper Blackout", command: "STAY HIDDEN!", kind: "1 vs rest", min: 2, max: 8,
    blurb: "Lights out. The sniper only sees through the scope. Use cover, watch your map.",
    controls: "Runners: stick + mini-map. Sniper: drag to aim, FIRE",
    crowd: false, cover: true, blackout: true, scopeR: 210, zoom: 1.35,
    hint: "Map shows the scope and shots. Crates stop 2 bullets; bushes only hide you. SPRINT is loud.", action: "SPRINT",
    sniperWins: (n) => `${n} owns the dark!`,
  },
};

// Cover for the blackout: solid crates (footprint + visible height) and
// walk-in bushes, placed so nothing overlaps and the edges stay clear.
function makeCover() {
  const crates = [], bushes = [];
  const free = (x, y, pad) => crates.every((c) => x < c.x - pad || x > c.x + c.w + pad || y < c.y - pad || y > c.y + c.h + pad)
    && bushes.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + pad);
  for (let tries = 0; crates.length < 9 && tries < 400; tries++) {
    const w = pick([90, 120, 160]), h = pick([60, 80]), x = rnd(F.x0 + 80, F.x1 - 80 - w), y = rnd(F.y0 + 100, F.y1 - 60 - h);
    if (free(x + w / 2, y + h / 2, Math.max(w, h) / 2 + 110)) crates.push({ x, y, w, h, ht: rnd(70, 110), holes: [], id: crates.length });
  }
  for (let tries = 0; bushes.length < 7 && tries < 400; tries++) {
    const r = rnd(70, 100), x = rnd(F.x0 + r + 20, F.x1 - r - 20), y = rnd(F.y0 + r + 20, F.y1 - r - 20);
    if (free(x, y, r + 60)) bushes.push({ x, y, r, shake: 0, rip: 0, seed: Math.random() * 10 });
  }
  return { crates, bushes };
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function makeSniper(V) {
  const SCOPE = V.scopeR, ZOOM = V.zoom, VIEW = SCOPE / ZOOM; // VIEW: world radius the scope shows
  return {
    id: V.id, title: V.title, command: V.command, kind: V.kind, min: V.min, max: V.max, blurb: V.blurb, controls: V.controls,

    create(ctx) {
    const cues = musicCues(ctx);
      const sniperPid = ctx.pickOne();
      const sniper = ctx.players.find((p) => p.pid === sniperPid);
      const runnersP = ctx.players.filter((p) => p !== sniper);
      const target = (V.crowd ? 3 : 2) + 2 * runnersP.length;
      const cover = V.cover ? makeCover() : { crates: [], bushes: [] };
      const inCrate = (x, y, pad = 0) => cover.crates.some((c) => x > c.x - pad && x < c.x + c.w + pad && y > c.y - pad && y < c.y + c.h + pad);
      const spot = () => { for (;;) { const s = [rnd(F.x0 + 60, F.x1 - 60), rnd(F.y0 + 60, F.y1 - 60)]; if (!inCrate(s[0], s[1], R + 10)) return s; } };
      // Plaza: runners wear their own colour; NPCs are dealt round-robin across
      // the runners' colours so each runner has about a dozen lookalikes (the
      // sniper's colour is left out: any blob wearing it would be a known NPC).
      // Blackout: no crowd, so everyone shows their real blob, selfie and all.
      const tints = [...new Set(runnersP.map((q) => q.color))];
      let dealt = 0;
      const look = (p) => (V.crowd ? { color: p ? p.color : tints[dealt++ % tints.length], face: null, name: "" } : p);
      const mk = (p) => { const [x, y] = spot(); return { p, look: look(p), x, y, vx: 0, vy: 0, goal: spot(), wait: rnd(0, 2), emote: 0, emoteCool: 0, dead: false, mx: 0, my: 0, loot: 0, pace: rnd(0.55, 1), kx: 0, ky: 0, bump: 0, sprint: 0, sprintCool: 0, noiseCool: 0, bot: { goal: null, think: 0 } }; };
      const runners = runnersP.map(mk);
      const npcs = V.crowd ? Array.from({ length: Math.min(45 - runners.length, 12 * runners.length + 6) }, () => mk(null)) : [];
      const everyone = [...runners, ...npcs];
      const splats = [], pops = [];
      let coins = [], coinClock = 0, stolen = 0;
      let t = -3, lastTick = 3, endAt = null, panic = 0, radarClock = 0;
      const scope = { x: W / 2, y: H / 2, cool: 0, coolMax: RELOAD, flash: 0, flares: V.blackout ? FLARES : 0, flare: 0, bot: { target: null, aimT: 0, seen: [], patrol: null } };
      const ripples = [], shots = [];
      let mapVersion = 0;
      // something audible in the dark: a ring spreads from it on the TV
      const noise = (x, y, loud = 1, color = "#05d9e8") => { if (V.blackout) ripples.push({ x, y, t: 0, loud, color }); };

      const alive = () => runners.filter((r) => !r.dead);
      const sendScope = () => ctx.layout(sniper.pid, { kind: "scope", role: "Sniper", hint: V.blackout ? "You only see what the scope sees · FLARE lights everything for 1 s" : "Drag to aim · FIRE to shoot", cool: scope.cool, flares: V.blackout ? scope.flares : null });
      const mapNow = () => V.cover ? { v: mapVersion, crates: cover.crates.map((c) => [nx(c.x), ny(c.y), c.w / (F.x1 - F.x0), c.h / (F.y1 - F.y0)]), bushes: cover.bushes.map((b) => [nx(b.x), ny(b.y), b.r / (F.x1 - F.x0)]) } : null;
      const inBush = (b) => cover.bushes.find((u) => Math.hypot(u.x - b.x, u.y - b.y) < u.r);
      // a crate between the viewer and a blob: the shot point is on the crate's
      // visible face, and the crate stands in front of (south of) the blob
      const crateInFront = (x, y, b) => cover.crates.find((c) => x > c.x && x < c.x + c.w && y > c.y - c.ht && y < c.y + c.h && c.y + c.h > b.y);

      function flare() {
        if (!scope.flares || scope.flare > 0 || t < 0 || endAt != null) return;
        scope.flares--; scope.flare = FLARE;
        ctx.sfx.power(); ctx.shake(8);
        for (const r of alive()) ctx.buzz(r.p.pid, 200);
        sendScope();
      }

      function spawnCoin() {
        if (coins.length >= 3) return;
        const [x, y] = spot();
        coins.push({ x, y, t: 0 });
      }

      function fire() {
        if (scope.cool > 0 || t < 0 || endAt != null) return;
        scope.flash = 0.15;
        ctx.sfx.hit(); ctx.shake(22);
        let best = null, bd = 34;
        for (const b of everyone) {
          if (b.dead) continue;
          const d = Math.hypot(b.x - scope.x, b.y - scope.y);
          if (d < bd) { bd = d; best = b; }
        }
        shots.push({ x: scope.x, y: scope.y, t });
        // a crate in front stops the bullet; crates break after CRATE_HP hits.
        // A shot at empty air that lands on a crate's face chips it too.
        const block = best ? crateInFront(scope.x, scope.y, best) : cover.crates.find((c) => scope.x > c.x && scope.x < c.x + c.w && scope.y > c.y - c.ht && scope.y < c.y + c.h);
        if (block) {
          block.holes.push([scope.x - block.x, scope.y - block.y]);
          ctx.sfx.crunch();
          scope.cool = RELOAD;
          if (block.holes.length >= CRATE_HP) {
            cover.crates.splice(cover.crates.indexOf(block), 1);
            mapVersion++;
            splats.push(makeSplat(block.x + block.w / 2, block.y + block.h / 2, 30, "#6b4020"));
            pops.push({ x: block.x + block.w / 2, y: block.y - 40, word: "SMASH!", color: "#ff6b00", t: 0 });
            noise(block.x + block.w / 2, block.y + block.h / 2, 1.6, "#ff6b00");
          } else pops.push({ x: scope.x, y: scope.y - 50, word: "THUNK!", color: "#fff", t: 0 });
        } else if (!best) { scope.cool = RELOAD; }
        else if (best.p) {
          best.dead = true;
          splats.push(makeSplat(best.x, best.y, 40, best.p.color));
          pops.push({ x: best.x, y: best.y - 70, word: `GOT ${best.p.name.toUpperCase()}`, color: best.p.color, t: 0 });
          ctx.stat(sniper.pid, "snipes", 1);
          ctx.buzz(best.p.pid, 500);
          ctx.layout(best.p.pid, { kind: "wait", text: "SNIPED", sub: V.crowd ? "Should have blended harder." : "Should have stayed in the dark." });
          scope.cool = RELOAD;
          ctx.sfx.pop();
        } else {
          best.dead = true;
          splats.push(makeSplat(best.x, best.y, 34, best.look.color));
          pops.push({ x: best.x, y: best.y - 70, word: "INNOCENT!", color: "#fff", t: 0 });
          scope.cool = MISFIRE; panic = PANIC;
          for (const n of npcs) if (!n.dead) { const a = Math.random() * Math.PI * 2; n.goal = [clampX(n.x + Math.cos(a) * 500), clampY(n.y + Math.sin(a) * 500)]; n.wait = 0; }
          ctx.buzz(sniper.pid, 300);
        }
        scope.coolMax = scope.cool;
        sendScope();
      }

      // NPC wandering: walk to a spot, pause, maybe emote; during a panic, run
      function wander(b, dt) {
        b.emote = Math.max(0, b.emote - dt);
        if (b.wait > 0) { b.wait -= dt; b.vx = b.vy = 0; if (Math.random() < dt * 0.25 && !b.emote) b.emote = 0.6; return; }
        const dx = b.goal[0] - b.x, dy = b.goal[1] - b.y, d = Math.hypot(dx, dy);
        if (d < 8) { b.goal = spot(); b.wait = panic > 0 ? 0 : rnd(0.3, 3); return; }
        const sp = panic > 0 ? PANIC_SPEED : SPEED * b.pace;
        b.vx = (dx / d) * sp; b.vy = (dy / d) * sp;
      }

      // Blobs are solid: overlapping pairs are pushed apart and bounce. The
      // bounce goes into a fading knockback (kx, ky) on top of each blob's own
      // walk, so a runner barrelling through a crowd visibly shoves it around.
      // Crates are solid too: blobs slide off their footprint.
      function collide() {
        const live = everyone.filter((b) => !b.dead);
        for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d >= 2 * R) continue;
          if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
          const ux = dx / d, uy = dy / d, push = (2 * R - d) / 2;
          a.x = clampX(a.x + ux * push); a.y = clampY(a.y + uy * push);
          b.x = clampX(b.x - ux * push); b.y = clampY(b.y - uy * push);
          const rv = (a.vx + a.kx - b.vx - b.kx) * ux + (a.vy + a.ky - b.vy - b.ky) * uy;
          if (rv >= 0) continue; // already separating
          const imp = (-rv * (1 + BOUNCE)) / 2;
          a.kx += imp * ux; a.ky += imp * uy;
          b.kx -= imp * ux; b.ky -= imp * uy;
          // a bumped NPC sometimes gives up on where it was going
          for (const n of [a, b]) if (!n.p && -rv > 40 && Math.random() < 0.3) { n.goal = spot(); n.wait = 0; }
          if (a.p && b.p && -rv > 60 && a.noiseCool <= 0) { noise((a.x + b.x) / 2, (a.y + b.y) / 2, 1, "#ff2a6d"); a.noiseCool = b.noiseCool = 0.6; }
          const hit = Math.min(0.3, -rv / 600);
          a.bump = Math.max(a.bump, hit); b.bump = Math.max(b.bump, hit);
        }
        const foot = R * 0.8;
        for (const b of live) for (const c of cover.crates) {
          const px = Math.max(c.x, Math.min(c.x + c.w, b.x)), py = Math.max(c.y, Math.min(c.y + c.h, b.y));
          const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy);
          if (d >= foot) continue;
          if (d < 0.01) { // centre inside the footprint: pop out the nearest side
            const out = [[b.x - c.x, -1, 0], [c.x + c.w - b.x, 1, 0], [b.y - c.y, 0, -1], [c.y + c.h - b.y, 0, 1]].sort((p, q) => p[0] - q[0])[0];
            b.x += out[1] * (out[0] + foot); b.y += out[2] * (out[0] + foot);
          } else { b.x += (dx / d) * (foot - d); b.y += (dy / d) * (foot - d); }
          b.kx *= 0.5; b.ky *= 0.5;
        }
      }

      function drawBlob(g, b) {
        const e = b.emote > 0 ? Math.sin((0.6 - b.emote) * 16) : 0, bob = Math.hypot(b.vx, b.vy) > 1 ? Math.abs(Math.sin(t * 12 + b.x)) * 5 : 0;
        const q = b.bump > 0 ? Math.sin(b.bump * 40) * b.bump : 0; // wobble after a collision
        blob(g, b.look, b.x, b.y - bob - Math.abs(e) * 14, R, { sx: 1 + e * 0.15 + q, sy: 1 - e * 0.15 - q });
      }
      function drawCrate(g, c) {
        const top = c.y + c.h - c.ht - c.h * 0.6;
        rrect(g, c.x, top, c.w, c.h * 0.6, 3, "#8a5a2b", INK, 4);          // lid
        rrect(g, c.x, top + c.h * 0.6, c.w, c.ht, 3, "#6b4020", INK, 4);   // front face
        g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3;
        g.beginPath(); g.moveTo(c.x + 6, top + c.h * 0.6 + 6); g.lineTo(c.x + c.w - 6, top + c.h * 0.6 + c.ht - 6); g.stroke();
        for (const [hx, hy] of c.holes) circle(g, c.x + hx, c.y + hy, 5, INK);
      }
      function drawBush(g, u) {
        const wob = u.shake > 0 ? Math.sin(t * 50) * 6 * u.shake : 0;
        for (let i = 0; i < 9; i++) {
          const a = u.seed + i * 2.1, rr = u.r * (0.35 + 0.35 * ((i * 37) % 10) / 10);
          const x = u.x + Math.cos(a) * u.r * 0.55 + wob * Math.sin(i), y = u.y + Math.sin(a) * u.r * 0.35 - 10;
          circle(g, x, y, rr * 0.8, i % 2 ? "#1f7a3a" : "#2a9d4a", INK, 3);
        }
      }

      function drawField(g) {
        g.fillStyle = V.blackout ? "#0e0a1a" : "#120726"; g.fillRect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
        g.strokeStyle = "rgba(5,217,232,.22)"; g.lineWidth = 2;
        for (let x = F.x0; x <= F.x1; x += 80) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
        for (let y = F.y0; y <= F.y1; y += 80) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        if (!V.cover) {
          circle(g, W / 2, (F.y0 + F.y1) / 2, 110, "#1f0b3d", "#ff2a6d", 6);
          circle(g, W / 2, (F.y0 + F.y1) / 2, 60, "rgba(5,217,232,.35)", "#05d9e8", 4);
        }
        for (const sp of splats) drawSplat(g, sp);
        for (const c of coins) {
          const w = Math.abs(Math.cos(c.t * 4)) * 18 + 3;
          g.beginPath(); g.ellipse(c.x, c.y, w, 18, 0, 0, Math.PI * 2);
          g.fillStyle = "#f9f002"; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
        }
        // painter's order by ground line: whatever stands further south is drawn
        // later, so crates hide blobs behind them and bushes hide blobs inside
        const items = [];
        for (const b of everyone) if (!b.dead) items.push([b.y + R * 0.3, () => drawBlob(g, b)]);
        for (const c of cover.crates) items.push([c.y + c.h, () => drawCrate(g, c)]);
        for (const u of cover.bushes) items.push([u.y + u.r * 0.35, () => drawBush(g, u)]);
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
      }

      const inst = {
        result: null,
        _test: { runners, cover, scope, ripples, shots, fire: () => fire(), flare: () => flare(), setClock: (v) => { t = v; lastTick = 0; } }, // test-only handles
        state: () => ({ sniper: sniper.pid, scope: { x: scope.x, y: scope.y, cool: scope.cool }, stolen, panic, runners: runners.map((r) => ({ pid: r.p.pid, x: r.x, y: r.y, dead: r.dead, loot: r.loot })),
          cover: { crates: cover.crates.length, bushes: cover.bushes.length }, blocked: cover.crates.reduce((n, c) => n + c.holes.length, 0),
          minGap: (() => { const l = everyone.filter((b) => !b.dead); let m = Infinity; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) m = Math.min(m, Math.hypot(l[i].x - l[j].x, l[i].y - l[j].y)); return m; })() }), // read-only, for tests
        describe: () => [`Sniper: ${sniper.name}`, `Runners: ${runnersP.map((p) => p.name).join(", ")} · steal ${target} coins`],
        start() {
          sendScope();
          inst.sentMap = mapVersion;
          for (const r of runners) ctx.layout(r.p.pid, { kind: "stick", role: "Runner", hint: V.hint, action: V.action, map: mapNow() });
        },
        input(pid, m) {
          if (pid === sniper.pid) {
            if (m.t === "aim") { scope.x = Math.max(F.x0, Math.min(F.x1, scope.x + (+m.dx || 0))); scope.y = Math.max(F.y0, Math.min(F.y1, scope.y + (+m.dy || 0))); }
            else if (m.t === "fire") fire();
            else if (m.t === "flare") flare();
            return;
          }
          const r = runners.find((r) => r.p.pid === pid);
          if (!r || r.dead) return;
          if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0); const k = l > 1 ? 1 / l : 1; r.mx = (+m.x || 0) * k; r.my = (+m.y || 0) * k; }
          else if (m.t === "action" && V.action === "BLEND" && r.emoteCool <= 0) { r.emote = 0.6; r.emoteCool = 1.5; }
          else if (m.t === "action" && V.action === "SPRINT" && r.sprintCool <= 0) { r.sprint = SPRINT; r.sprintCool = SPRINT_COOL; ctx.buzz(pid, 30); }
        },
        bot(pid, dt) {
          if (t < 0 || endAt != null) return;
          const sb = scope.bot;
          const aimAt = (x, y, k) => { scope.x += (x - scope.x) * Math.min(1, dt * k); scope.y += (y - scope.y) * Math.min(1, dt * k); };
          if (pid === sniper.pid && V.blackout) {
            // a blackout bot only knows what's in its scope (or lit by a flare):
            // a runner in view (not behind a crate; in a bush, only if it
            // rustles) gets shot at. It chases noise ripples and flares when stuck.
            if (!sb.target && scope.flares && t > 12 + (FLARES - scope.flares) * 28 && Math.random() < dt * 0.3) flare();
            if (!sb.target || sb.target.dead) {
              const seen = alive().find((r) => (scope.flare > 0 || Math.hypot(r.x - scope.x, r.y - scope.y) < VIEW * 0.9)
                && !cover.crates.some((c) => r.x > c.x && r.x < c.x + c.w && r.y < c.y + c.h && r.y > c.y - c.ht)
                && (!inBush(r) || (inBush(r).shake > 0 && Math.random() < dt * 3)));
              // spotted under a flare = far away: allow the scope time to get there
              if (seen) { sb.target = seen; sb.chase = scope.flare > 0; sb.aimT = sb.chase ? rnd(1.4, 2.2) : rnd(0.8, 1.5); }
            }
            if (sb.target && !sb.target.dead) {
              aimAt(sb.target.x, sb.target.y, 5);
              sb.aimT -= dt;
              if (!sb.chase && Math.hypot(sb.target.x - scope.x, sb.target.y - scope.y) > VIEW * 1.3) sb.target = null; // lost them
              else if (sb.aimT <= 0 && scope.cool <= 0) { fire(); sb.target = null; sb.chase = false; }
              return;
            }
            // sweep: toward fresh noise, a coin (runners go there) or a random spot
            const heard = ripples.filter((q) => q.t < 0.3).pop();
            if (heard && Math.random() < 0.5) sb.patrol = [heard.x, heard.y];
            if (!sb.patrol || Math.hypot(sb.patrol[0] - scope.x, sb.patrol[1] - scope.y) < 30) sb.patrol = coins.length && Math.random() < 0.5 ? [pick(coins).x, pick(coins).y] : spot();
            aimAt(sb.patrol[0], sb.patrol[1], 1.4);
            return;
          }
          if (pid === sniper.pid) {
            // crowd bot: suspect whoever is standing nearest a grab it noticed; otherwise anyone
            if (!sb.target || sb.target.dead) {
              const pool = everyone.filter((b) => !b.dead), clue = sb.seen.pop();
              const near = clue && pool.sort((a, c) => Math.hypot(a.x - clue[0], a.y - clue[1]) - Math.hypot(c.x - clue[0], c.y - clue[1]))[0];
              sb.target = near || pool[Math.floor(Math.random() * pool.length)];
              sb.aimT = rnd(1.2, 2.6);
            }
            const tg = sb.target;
            if (!tg) return;
            aimAt(tg.x, tg.y, 4);
            sb.aimT -= dt;
            if (sb.aimT <= 0 && scope.cool <= 0) { fire(); sb.target = null; }
            return;
          }
          const r = runners.find((r) => r.p.pid === pid);
          if (!r || r.dead) return;
          r.bot.think -= dt;
          // blackout: a scope closing in makes a bot runner think right now
          if (V.blackout && !r.bot.fleeing && Math.hypot(scope.x - r.x, scope.y - r.y) < VIEW + 120) { r.bot.think = 0; r.bot.fleeing = true; }
          if (Math.hypot(scope.x - r.x, scope.y - r.y) > VIEW + 200) r.bot.fleeing = false;
          if (r.bot.think <= 0) {
            r.bot.think = rnd(0.4, 1.2);
            const near = coins.filter((c) => Math.hypot(c.x - r.x, c.y - r.y) < 420).sort((a, c) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(c.x - r.x, c.y - r.y))[0];
            const threat = V.blackout && Math.hypot(scope.x - r.x, scope.y - r.y) < VIEW + 160;
            if (threat) {
              // blackout runner bot: get out of the scope's way, ideally behind a crate
              const hide = cover.crates.map((c) => [c.x + c.w / 2, c.y - 30]).sort((a, b) => Math.hypot(a[0] - r.x, a[1] - r.y) - Math.hypot(b[0] - r.x, b[1] - r.y))[0];
              const ax = r.x - scope.x, ay = r.y - scope.y, al = Math.hypot(ax, ay) || 1;
              r.bot.goal = hide && Math.random() < 0.6 ? hide : [clampX(r.x + (ax / al) * 300), clampY(r.y + (ay / al) * 300)];
            } else r.bot.goal = near && Math.random() < 0.6 ? [near.x, near.y] : Math.random() < 0.35 ? null : spot();
            if (V.action === "BLEND" && Math.random() < 0.15) inst.input(pid, { t: "action" });
            if (V.action === "SPRINT" && threat && Math.random() < 0.5) inst.input(pid, { t: "action" });
          }
          if (!r.bot.goal) { r.mx = r.my = 0; return; }
          const dx = r.bot.goal[0] - r.x, dy = r.bot.goal[1] - r.y, d = Math.hypot(dx, dy);
          if (d < 10) { r.bot.goal = null; r.mx = r.my = 0; } else { const k = 0.6 + 0.3 * Math.random(); r.mx = (dx / d) * k; r.my = (dy / d) * k; }
        },
        update(dt) {
          cues(t, TIME); // the music: build over the countdown, drop on GO, half time, the last 10 s
          t += dt;
          if (t < 0) { if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); } return; }
          if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
          if (inst.result) return;
          if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
          panic = Math.max(0, panic - dt);
          const wasCool = scope.cool > 0;
          scope.cool = Math.max(0, scope.cool - dt); scope.flash = Math.max(0, scope.flash - dt); scope.flare = Math.max(0, scope.flare - dt);
          for (const q of ripples) q.t += dt;
          while (ripples.length && ripples[0].t > 1.4) ripples.shift();
          if (wasCool && scope.cool === 0) sendScope();
          for (const n of npcs) if (!n.dead) wander(n, dt);
          const cap = panic > 0 ? PANIC_SPEED : SPEED;
          for (const r of runners) if (!r.dead) {
            r.emote = Math.max(0, r.emote - dt); r.emoteCool -= dt; r.sprintCool -= dt; r.noiseCool -= dt;
            const boost = r.sprint > 0 ? 2 : 1;
            r.vx = r.mx * cap * boost; r.vy = r.my * cap * boost;
            if (r.sprint > 0) { r.sprint -= dt; if (r.noiseCool <= 0 && Math.hypot(r.vx, r.vy) > 60) { noise(r.x, r.y, 1.4); r.noiseCool = 0.2; } }
          }
          const damp = Math.exp(-KNOCK_DAMP * dt);
          for (const b of everyone) if (!b.dead) {
            b.x = clampX(b.x + (b.vx + b.kx) * dt); b.y = clampY(b.y + (b.vy + b.ky) * dt);
            b.kx *= damp; b.ky *= damp; b.bump = Math.max(0, b.bump - dt);
          }
          collide();
          for (const u of cover.bushes) {
            u.shake = Math.max(0, u.shake - dt * 2); u.rip -= dt;
            // a bush rustles when something moves inside it: the tell (and a green ripple)
            if (everyone.some((b) => !b.dead && Math.hypot(b.vx + b.kx, b.vy + b.ky) > 30 && Math.hypot(u.x - b.x, u.y - b.y) < u.r)) {
              u.shake = 1;
              if (u.rip <= 0) { noise(u.x, u.y, 0.8, "#39ff14"); u.rip = 0.45; }
            }
          }
          coinClock -= dt;
          if (coinClock <= 0) { spawnCoin(); coinClock = rnd(1.5, 3.5); }
          for (const c of coins) c.t += dt;
          for (const r of runners) {
            if (r.dead) continue;
            const got = coins.find((c) => Math.hypot(c.x - r.x, c.y - r.y) < 34);
            if (got) {
              coins = coins.filter((c) => c !== got);
              // a bot sniper only "notices" a grab, and never knows who did it for sure
              if (Math.random() < (Math.hypot(got.x - scope.x, got.y - scope.y) < 500 ? 0.8 : 0.35)) scope.bot.seen.push([got.x, got.y]);
              noise(got.x, got.y, 1.2, "#f9f002");
              stolen++; r.loot++; ctx.stat(r.p.pid, "loot", 1); ctx.sfx.dot(); ctx.buzz(r.p.pid, 40);
              // in the dark, a grab only shows if it happens inside the scope
              if (!V.blackout || Math.hypot(got.x - scope.x, got.y - scope.y) < VIEW) pops.push({ x: got.x, y: got.y - 40, word: "+1", color: "#f9f002", t: 0 });
            }
          }
          radarClock -= dt;
          if (radarClock <= 0) {
            radarClock = 0.1;
            const cs = coins.map((c) => [nx(c.x), ny(c.y)]);
            const sc = V.blackout ? [nx(scope.x), ny(scope.y), VIEW / (F.x1 - F.x0)] : null;
            const sh = V.blackout ? shots.filter((q) => t - q.t < SHOT_MARK).map((q) => [nx(q.x), ny(q.y), +((t - q.t) / SHOT_MARK).toFixed(2)]) : null;
            const mp = V.cover && inst.sentMap !== mapVersion ? mapNow() : undefined; // the map only when a crate breaks
            inst.sentMap = mapVersion;
            for (const r of runners) if (!r.dead) ctx.send(r.p.pid, { t: "radar", x: nx(r.x), y: ny(r.y), coins: cs, scope: sc, shots: sh, map: mp });
          }
          const rPids = runnersP.map((p) => p.pid);
          const finish = (runnersWin, headline) => {
            endAt = t + 1.2;
            const top = [...runners].sort((a, b) => b.loot - a.loot)[0];
            const bonus = runnersWin && top && top.loot > 0 ? { [top.p.pid]: 3 } : null;
            inst.pending = runnersWin ? { winners: rPids, losers: [sniper.pid], headline, bonus } : { winners: [sniper.pid], losers: rPids, headline };
            (runnersWin ? ctx.sfx.win : ctx.sfx.lose)();
          };
          if (!alive().length) finish(false, V.sniperWins(sniper.name));
          else if (stolen >= target) finish(true, "The heist is done!");
          else if (t >= TIME) finish(true, "The runners slipped away!");
        },
        draw(g) {
          g.fillStyle = V.blackout ? "#000" : "#0d0221"; g.fillRect(0, 0, W, H);
          if (!V.blackout) drawField(g);
          else {
            // the dark: a faint outline of the cover, and ripples of noise
            g.save(); g.globalAlpha = 0.14; g.strokeStyle = "#05d9e8"; g.lineWidth = 3;
            for (const c of cover.crates) g.strokeRect(c.x, c.y + c.h - c.ht - c.h * 0.6, c.w, c.ht + c.h * 0.6);
            for (const u of cover.bushes) { g.beginPath(); g.arc(u.x, u.y - 10, u.r * 0.8, 0, Math.PI * 2); g.stroke(); }
            g.restore();
            for (const q of ripples) {
              const k = q.t / 1.4;
              g.save(); g.globalAlpha = (1 - k) * 0.55 * Math.min(1, q.loud); g.strokeStyle = q.color; g.lineWidth = 4 * q.loud;
              g.beginPath(); g.arc(q.x, q.y, 16 + k * 170 * q.loud, 0, Math.PI * 2); g.stroke(); g.restore();
            }
            if (scope.flare > 0) { // a flare: the whole plaza, fading back to black
              g.save(); g.globalAlpha = Math.min(1, scope.flare / 0.4); drawField(g); g.restore();
              if (scope.flare > FLARE - 0.15) { g.fillStyle = `rgba(255,255,230,${(scope.flare - (FLARE - 0.15)) * 4})`; g.fillRect(0, 0, W, H); }
            }
          }
          // the scope: magnified view inside; outside it's dimmed (plaza) or pitch black (blackout)
          g.save();
          if (!V.blackout) { g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.rect(0, 0, W, H); g.arc(scope.x, scope.y, SCOPE, 0, Math.PI * 2, true); g.fill("evenodd"); }
          g.beginPath(); g.arc(scope.x, scope.y, SCOPE, 0, Math.PI * 2); g.clip();
          g.translate(scope.x, scope.y); g.scale(ZOOM, ZOOM); g.translate(-scope.x, -scope.y);
          drawField(g);
          g.restore();
          if (V.blackout) { // vignette inside the lens
            const v = g.createRadialGradient(scope.x, scope.y, SCOPE * 0.55, scope.x, scope.y, SCOPE);
            v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.6)");
            g.fillStyle = v; g.beginPath(); g.arc(scope.x, scope.y, SCOPE, 0, Math.PI * 2); g.fill();
          }
          const ready = scope.cool <= 0;
          circle(g, scope.x, scope.y, SCOPE, null, INK, 14);
          circle(g, scope.x, scope.y, SCOPE, null, ready ? "#ff2a6d" : "#6d6682", 6);
          g.strokeStyle = ready ? "#ff2a6d" : "#6d6682"; g.lineWidth = 3;
          g.beginPath(); g.moveTo(scope.x - SCOPE, scope.y); g.lineTo(scope.x - 14, scope.y); g.moveTo(scope.x + 14, scope.y); g.lineTo(scope.x + SCOPE, scope.y);
          g.moveTo(scope.x, scope.y - SCOPE); g.lineTo(scope.x, scope.y - 14); g.moveTo(scope.x, scope.y + 14); g.lineTo(scope.x, scope.y + SCOPE); g.stroke();
          if (!ready) { g.beginPath(); g.arc(scope.x, scope.y, SCOPE + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - scope.cool / scope.coolMax)); g.lineWidth = 8; g.strokeStyle = "#f9f002"; g.stroke(); }
          if (scope.flash > 0) { g.fillStyle = `rgba(255,255,255,${scope.flash * 3})`; g.fillRect(0, 0, W, H); }
          for (const pp of fade(pops)) { pp.t += FX.dt; if (pp.t < 1.2) shout(g, pp.word, pp.x, pp.y, 50, pp.color, pp.t); }
          if (panic > 0) outlined(g, "PANIC!", W / 2, F.y0 + 60, 70 + Math.sin(t * 20) * 6, "#ff2a6d", "center", Math.sin(t * 9) * 0.06);
          // HUD
          rrect(g, 0, 0, W, 150, 0, "rgba(13,2,33,.85)");
          tag(g, `SNIPER · ${sniper.name}`, 250, 70, sniper.color, 30);
          text(g, `LOOT ${stolen}/${target}`, W / 2, 55, 44, "#f9f002", "center", 900);
          g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(W / 2 - 250, 95, 500, 16);
          g.fillStyle = "#f9f002"; g.fillRect(W / 2 - 250, 95, 500 * Math.min(1, stolen / target), 16);
          text(g, `⏱ ${Math.max(0, Math.ceil(TIME - Math.max(0, t)))}`, W - 380, 70, 44, "#fff", "center", 900);
          text(g, `RUNNERS LEFT ${alive().length}`, W - 170, 70, 30, "#05d9e8", "center", 900);
          if (V.blackout) text(g, "FLARES " + "✦".repeat(scope.flares) + "·".repeat(FLARES - scope.flares), 560, 70, 28, "#f9f002", "center", 900);
          countdown(g, -t);
          if (t >= 0 && t < 0.6) shout(g, "GO!", W / 2, H / 2, 260, "#f9f002", t);
        },
      };
      return inst;
    },
  };
}

export default makeSniper(VARIANTS.plaza);
export const blackout = makeSniper(VARIANTS.blackout);
