// Sniper Plaza — asymmetric, 1 vs the rest. Everyone in the plaza is an
// identical grey blob: the runners hide in an AI crowd while one sniper hunts
// them through a scope. Runners steal coins (only runners can, so greed gives
// you away) and find themselves on a private radar on their phone. The sniper
// drags a trackpad and fires; hitting an innocent costs a long reload and sends
// the crowd into a panic. Runners win on the loot target or by surviving the
// clock; the sniper wins by hitting every runner. The sniper role rotates.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, tag, countdown, makeSplat, drawSplat } from "../gfx.js";

const TIME = 75, R = 26, SPEED = 150, PANIC_SPEED = 260, RELOAD = 1.5, MISFIRE = 4, PANIC = 3, SCOPE = 120, ZOOM = 1.6;
const F = { x0: 120, y0: 170, x1: W - 120, y1: H - 90 };               // the plaza
const CROWD = { color: "#aaa3bf", face: null, name: "" };              // what everyone looks like
const rnd = (a, b) => a + Math.random() * (b - a);
const clampX = (x) => Math.max(F.x0 + R, Math.min(F.x1 - R, x));
const clampY = (y) => Math.max(F.y0 + R, Math.min(F.y1 - R, y));
const spot = () => [rnd(F.x0 + 60, F.x1 - 60), rnd(F.y0 + 60, F.y1 - 60)];

export default {
  id: "snipe", title: "Sniper Plaza", command: "BLEND IN!", kind: "1 vs rest", min: 2, max: 8,
  blurb: "Hide in the crowd and steal the loot. One sniper is watching.",
  controls: "Runners: stick + BLEND. Sniper: drag to aim, FIRE",

  create(ctx) {
    const sniperPid = ctx.pickOne();
    const sniper = ctx.players.find((p) => p.pid === sniperPid);
    const runnersP = ctx.players.filter((p) => p !== sniper);
    const target = 3 + 2 * runnersP.length;
    const mk = (p) => { const [x, y] = spot(); return { p, x, y, vx: 0, vy: 0, goal: spot(), wait: rnd(0, 2), emote: 0, emoteCool: 0, dead: false, mx: 0, my: 0, loot: 0, pace: rnd(0.55, 1), bot: { goal: null, think: 0 } }; };
    const runners = runnersP.map(mk);
    const npcs = Array.from({ length: Math.min(45 - runners.length, 12 * runners.length + 6) }, () => mk(null));
    const everyone = [...runners, ...npcs];
    const splats = [], pops = [];
    let coins = [], coinClock = 0, stolen = 0;
    let t = -3, lastTick = 3, endAt = null, panic = 0, radarClock = 0;
    const scope = { x: W / 2, y: H / 2, cool: 0, coolMax: RELOAD, flash: 0, bot: { target: null, aimT: 0, seen: [] } };

    const alive = () => runners.filter((r) => !r.dead);
    const sendScope = () => ctx.layout(sniper.pid, { kind: "scope", role: "Sniper", hint: "Drag to aim · FIRE to shoot", cool: scope.cool });

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
      if (!best) { scope.cool = RELOAD; }
      else if (best.p) {
        best.dead = true;
        splats.push(makeSplat(best.x, best.y, 40, best.p.color));
        pops.push({ x: best.x, y: best.y - 70, word: `GOT ${best.p.name.toUpperCase()}`, color: best.p.color, t: 0 });
        ctx.stat(sniper.pid, "snipes", 1);
        ctx.buzz(best.p.pid, 500);
        ctx.layout(best.p.pid, { kind: "wait", text: "SNIPED", sub: "Should have blended harder." });
        scope.cool = RELOAD;
        ctx.sfx.pop();
      } else {
        best.dead = true;
        splats.push(makeSplat(best.x, best.y, 34, "#6d6682"));
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

    function drawField(g) {
      g.fillStyle = "#120726"; g.fillRect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
      g.strokeStyle = "rgba(5,217,232,.22)"; g.lineWidth = 2;
      for (let x = F.x0; x <= F.x1; x += 80) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
      for (let y = F.y0; y <= F.y1; y += 80) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
      circle(g, W / 2, (F.y0 + F.y1) / 2, 110, "#1f0b3d", "#ff2a6d", 6);
      circle(g, W / 2, (F.y0 + F.y1) / 2, 60, "rgba(5,217,232,.35)", "#05d9e8", 4);
      for (const sp of splats) drawSplat(g, sp);
      for (const c of coins) {
        const w = Math.abs(Math.cos(c.t * 4)) * 18 + 3;
        g.beginPath(); g.ellipse(c.x, c.y, w, 18, 0, 0, Math.PI * 2);
        g.fillStyle = "#f9f002"; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
      }
      for (const b of [...everyone].filter((b) => !b.dead).sort((a, c) => a.y - c.y)) {
        const e = b.emote > 0 ? Math.sin((0.6 - b.emote) * 16) : 0, bob = Math.hypot(b.vx, b.vy) > 1 ? Math.abs(Math.sin(t * 12 + b.x)) * 5 : 0;
        blob(g, CROWD, b.x, b.y - bob - Math.abs(e) * 14, R, { sx: 1 + e * 0.15, sy: 1 - e * 0.15 });
      }
    }

    const inst = {
      result: null,
      state: () => ({ sniper: sniper.pid, scope: { x: scope.x, y: scope.y, cool: scope.cool }, stolen, panic, runners: runners.map((r) => ({ pid: r.p.pid, x: r.x, y: r.y, dead: r.dead, loot: r.loot })) }), // read-only, for tests
      describe: () => [`Sniper: ${sniper.name}`, `Runners: ${runnersP.map((p) => p.name).join(", ")} · steal ${target} coins`],
      start() {
        sendScope();
        for (const r of runners) ctx.layout(r.p.pid, { kind: "stick", role: "Runner", hint: "Find your dot on the radar. Act natural.", action: "BLEND" });
      },
      input(pid, m) {
        if (pid === sniper.pid) {
          if (m.t === "aim") { scope.x = Math.max(F.x0, Math.min(F.x1, scope.x + (+m.dx || 0))); scope.y = Math.max(F.y0, Math.min(F.y1, scope.y + (+m.dy || 0))); }
          else if (m.t === "fire") fire();
          return;
        }
        const r = runners.find((r) => r.p.pid === pid);
        if (!r || r.dead) return;
        if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0); const k = l > 1 ? 1 / l : 1; r.mx = (+m.x || 0) * k; r.my = (+m.y || 0) * k; }
        else if (m.t === "act" && r.emoteCool <= 0) { r.emote = 0.6; r.emoteCool = 1.5; }
      },
      bot(pid, dt) {
        if (t < 0 || endAt != null) return;
        if (pid === sniper.pid) {
          // watch for blobs that grab coins; otherwise pick someone at random
          const sb = scope.bot;
          if (!sb.target || sb.target.dead) {
            // suspect whoever is standing nearest a grab it noticed; otherwise anyone
            const pool = everyone.filter((b) => !b.dead), clue = sb.seen.pop();
            const near = clue && pool.sort((a, c) => Math.hypot(a.x - clue[0], a.y - clue[1]) - Math.hypot(c.x - clue[0], c.y - clue[1]))[0];
            sb.target = near || pool[Math.floor(Math.random() * pool.length)];
            sb.aimT = rnd(1.2, 2.6);
          }
          const tg = sb.target;
          if (!tg) return;
          const dx = tg.x - scope.x, dy = tg.y - scope.y;
          scope.x += dx * Math.min(1, dt * 4); scope.y += dy * Math.min(1, dt * 4);
          sb.aimT -= dt;
          if (sb.aimT <= 0 && scope.cool <= 0) { fire(); sb.target = null; }
          return;
        }
        const r = runners.find((r) => r.p.pid === pid);
        if (!r || r.dead) return;
        // runner bot: wander like the crowd, but sneak toward nearby coins
        r.bot.think -= dt;
        if (r.bot.think <= 0) {
          r.bot.think = rnd(0.4, 1.2);
          const near = coins.filter((c) => Math.hypot(c.x - r.x, c.y - r.y) < 420).sort((a, c) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(c.x - r.x, c.y - r.y))[0];
          r.bot.goal = near && Math.random() < 0.6 ? [near.x, near.y] : Math.random() < 0.35 ? null : spot();
          if (Math.random() < 0.15) inst.input(pid, { t: "act" });
        }
        if (!r.bot.goal) { r.mx = r.my = 0; return; }
        const dx = r.bot.goal[0] - r.x, dy = r.bot.goal[1] - r.y, d = Math.hypot(dx, dy);
        if (d < 10) { r.bot.goal = null; r.mx = r.my = 0; } else { const k = 0.6 + 0.3 * Math.random(); r.mx = (dx / d) * k; r.my = (dy / d) * k; }
      },
      update(dt) {
        t += dt;
        if (t < 0) { if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); } return; }
        if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
        if (inst.result) return;
        if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        panic = Math.max(0, panic - dt);
        const wasCool = scope.cool > 0;
        scope.cool = Math.max(0, scope.cool - dt); scope.flash = Math.max(0, scope.flash - dt);
        if (wasCool && scope.cool === 0) sendScope();
        for (const n of npcs) if (!n.dead) wander(n, dt);
        const cap = panic > 0 ? PANIC_SPEED : SPEED;
        for (const r of runners) if (!r.dead) { r.emote = Math.max(0, r.emote - dt); r.emoteCool -= dt; r.vx = r.mx * cap; r.vy = r.my * cap; }
        for (const b of everyone) if (!b.dead) { b.x = clampX(b.x + b.vx * dt); b.y = clampY(b.y + b.vy * dt); }
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
            stolen++; r.loot++; ctx.stat(r.p.pid, "loot", 1); ctx.sfx.dot(); ctx.buzz(r.p.pid, 40);
            pops.push({ x: got.x, y: got.y - 40, word: "+1", color: "#f9f002", t: 0 });
          }
        }
        radarClock -= dt;
        if (radarClock <= 0) {
          radarClock = 0.12;
          const cs = coins.map((c) => [(c.x - F.x0) / (F.x1 - F.x0), (c.y - F.y0) / (F.y1 - F.y0)]);
          for (const r of runners) if (!r.dead) ctx.send(r.p.pid, { t: "radar", x: (r.x - F.x0) / (F.x1 - F.x0), y: (r.y - F.y0) / (F.y1 - F.y0), coins: cs });
        }
        const rPids = runnersP.map((p) => p.pid);
        const finish = (runnersWin, headline) => {
          endAt = t + 1.2;
          const top = [...runners].sort((a, b) => b.loot - a.loot)[0];
          const bonus = runnersWin && top && top.loot > 0 ? { [top.p.pid]: 3 } : null;
          inst.pending = runnersWin ? { winners: rPids, losers: [sniper.pid], headline, bonus } : { winners: [sniper.pid], losers: rPids, headline };
          (runnersWin ? ctx.sfx.win : ctx.sfx.lose)();
        };
        if (!alive().length) finish(false, `${sniper.name} cleaned the plaza!`);
        else if (stolen >= target) finish(true, "The heist is done!");
        else if (t >= TIME) finish(true, "The runners slipped away!");
      },
      draw(g) {
        g.fillStyle = "#0d0221"; g.fillRect(0, 0, W, H);
        drawField(g);
        // the scope: magnified view inside, darkness around it
        g.save();
        g.fillStyle = "rgba(0,0,0,.28)";
        g.beginPath(); g.rect(0, 0, W, H); g.arc(scope.x, scope.y, SCOPE, 0, Math.PI * 2, true); g.fill("evenodd");
        g.beginPath(); g.arc(scope.x, scope.y, SCOPE, 0, Math.PI * 2); g.clip();
        g.translate(scope.x, scope.y); g.scale(ZOOM, ZOOM); g.translate(-scope.x, -scope.y);
        drawField(g);
        g.restore();
        const ready = scope.cool <= 0;
        circle(g, scope.x, scope.y, SCOPE, null, INK, 14);
        circle(g, scope.x, scope.y, SCOPE, null, ready ? "#ff2a6d" : "#6d6682", 6);
        g.strokeStyle = ready ? "#ff2a6d" : "#6d6682"; g.lineWidth = 3;
        g.beginPath(); g.moveTo(scope.x - SCOPE, scope.y); g.lineTo(scope.x - 14, scope.y); g.moveTo(scope.x + 14, scope.y); g.lineTo(scope.x + SCOPE, scope.y);
        g.moveTo(scope.x, scope.y - SCOPE); g.lineTo(scope.x, scope.y - 14); g.moveTo(scope.x, scope.y + 14); g.lineTo(scope.x, scope.y + SCOPE); g.stroke();
        if (!ready) { g.beginPath(); g.arc(scope.x, scope.y, SCOPE + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - scope.cool / scope.coolMax)); g.lineWidth = 8; g.strokeStyle = "#f9f002"; g.stroke(); }
        if (scope.flash > 0) { g.fillStyle = `rgba(255,255,255,${scope.flash * 3})`; g.fillRect(0, 0, W, H); }
        for (const pp of pops) { pp.t += 1 / 60; if (pp.t < 1.2) shout(g, pp.word, pp.x, pp.y, 50, pp.color, pp.t); }
        if (panic > 0) outlined(g, "PANIC!", W / 2, F.y0 + 60, 70 + Math.sin(t * 20) * 6, "#ff2a6d", "center", Math.sin(t * 9) * 0.06);
        // HUD
        rrect(g, 0, 0, W, 150, 0, "rgba(13,2,33,.85)");
        tag(g, `SNIPER · ${sniper.name}`, 250, 70, sniper.color, 30);
        text(g, `LOOT ${stolen}/${target}`, W / 2, 55, 44, "#f9f002", "center", 900);
        g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(W / 2 - 250, 95, 500, 16);
        g.fillStyle = "#f9f002"; g.fillRect(W / 2 - 250, 95, 500 * Math.min(1, stolen / target), 16);
        text(g, `⏱ ${Math.max(0, Math.ceil(TIME - Math.max(0, t)))}`, W - 380, 70, 44, "#fff", "center", 900);
        text(g, `RUNNERS LEFT ${alive().length}`, W - 170, 70, 30, "#05d9e8", "center", 900);
        countdown(g, -t);
        if (t >= 0 && t < 0.6) shout(g, "GO!", W / 2, H / 2, 260, "#f9f002", t);
      },
    };
    return inst;
  },
};
