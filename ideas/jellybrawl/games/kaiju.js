// KAIJU! — asymmetric, 1 vs the rest. One player is a giant blob loose in a
// neon city: it walks through buildings (flattening them) and STOMPs, with
// a telegraphed ring, squashing anyone inside. Everyone else stands on
// cannon pads to charge them (faster with more of you on a pad); a full
// cannon fires at the kaiju. Knock out its HP to win; the kaiju wins by
// squashing everyone or outlasting the clock.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, tag, countdown, makeSplat, drawSplat } from "../gfx.js";
import { musicCues } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 60, R = 24, KR = 105, SPEED = 250, K_SPEED = 135, WINDUP = 0.7, STOMP_R = 185, STOMP_COOL = 1.6;
const CHARGE = 3.2, DASH = 0.25, DASH_MUL = 2.2, DASH_COOL = 2.5;
const F = { x0: 80, y0: 150, x1: W - 80, y1: H - 50 };
const rnd = (a, b) => a + Math.random() * (b - a);

export default {
  id: "kaiju", title: "Kaiju", command: "KAIJU!", kind: "1 vs rest", min: 2, max: 8,
  blurb: "One giant blob wrecks the city. Everyone else charges the cannons.",
  controls: "Kaiju: stick + STOMP. City: stick + DASH, stand on cannon pads",

  create(ctx) {
    const cues = musicCues(ctx);
    const kPid = ctx.pickOne();
    const kp = ctx.players.find((p) => p.pid === kPid);
    const others = ctx.players.filter((p) => p !== kp);
    const hpMax = Math.round(1 + others.length * 1.5);
    const charge = CHARGE * (0.75 + 0.1 * others.length); // seconds for one blob to fill a pad
    const k = { p: kp, x: W / 2, y: (F.y0 + F.y1) / 2, mx: 0, my: 0, hp: hpMax, wind: 0, cool: 0, hit: 0, ring: 0, bot: { think: 0 } };
    const pads = [[F.x0 + 190, F.y0 + 160], [F.x1 - 190, F.y0 + 160], [F.x0 + 190, F.y1 - 160], [F.x1 - 190, F.y1 - 160]].map(([x, y]) => ({ x, y, r: 70, charge: 0, flash: 0 }));
    // city blocks: solid to the small blobs, flattened by the kaiju
    const blocks = [];
    for (let tries = 0; blocks.length < 14 && tries < 400; tries++) {
      const w = rnd(90, 170), h = rnd(70, 130), x = rnd(F.x0 + 20, F.x1 - 20 - w), y = rnd(F.y0 + 20, F.y1 - 20 - h), cx = x + w / 2, cy = y + h / 2;
      if (pads.every((p) => Math.hypot(p.x - cx, p.y - cy) > 190) && Math.hypot(cx - k.x, cy - k.y) > 260
        && blocks.every((b) => x > b.x + b.w + 70 || x + w < b.x - 70 || y > b.y + b.h + 70 || y + h < b.y - 70))
        blocks.push({ x, y, w, h, ht: rnd(60, 140), down: false, hue: [190, 300, 330][Math.floor(Math.random() * 3)] });
    }
    const n = others.length;
    const runners = others.map((p, i) => ({ p, x: pads[i % 4].x + rnd(-30, 30), y: pads[i % 4].y + rnd(-30, 30), mx: 0, my: 0, dash: 0, dashCool: 0, out: false, bot: { think: 0, goal: null } }));
    const splats = [], pops = [], shots = [];
    let t = -3, lastTick = 3, endAt = null;
    const alive = () => runners.filter((r) => !r.out);

    function stomp() {
      if (k.wind > 0 || k.cool > 0 || t < 0 || endAt != null) return;
      k.wind = WINDUP;
    }
    function land() {
      k.cool = STOMP_COOL; k.ring = 0.4;
      ctx.sfx.hit(); ctx.shake(30);
      for (const r of alive()) if (Math.hypot(r.x - k.x, r.y - k.y) < STOMP_R) {
        r.out = true;
        splats.push(makeSplat(r.x, r.y, 36, r.p.color));
        pops.push({ x: r.x, y: r.y - 60, word: "SQUASHED!", color: r.p.color, t: 0 });
        ctx.stat(k.p.pid, "squashes", 1); ctx.buzz(r.p.pid, 500);
        ctx.layout(r.p.pid, { kind: "wait", text: "SQUASHED", sub: "Flat as a pancake. Cheer them on." });
      }
      for (const b of blocks) if (!b.down && Math.hypot(b.x + b.w / 2 - k.x, b.y + b.h / 2 - k.y) < STOMP_R + 40) b.down = true;
    }

    const inst = {
      result: null,
      describe: () => [`Kaiju: ${kp.name} · ${hpMax} HP`, `City: ${others.map((p) => p.name).join(", ")}`],
      start() {
        ctx.layout(kp.pid, { kind: "stick", radar: false, role: "Kaiju", action: "STOMP", hint: "Crush the city! Stomp the little blobs." });
        for (const r of runners) ctx.layout(r.p.pid, { kind: "stick", radar: false, role: "City", action: "DASH", hint: "Stand on the cannon pads to charge them. Dodge the stomp!" });
      },
      input(pid, m) {
        if (pid === kp.pid) {
          if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0), s = l > 1 ? 1 / l : 1; k.mx = (+m.x || 0) * s; k.my = (+m.y || 0) * s; }
          else if (m.t === "action") stomp();
          return;
        }
        const r = runners.find((r) => r.p.pid === pid);
        if (!r || r.out) return;
        if (m.t === "move") { const l = Math.hypot(+m.x || 0, +m.y || 0), s = l > 1 ? 1 / l : 1; r.mx = (+m.x || 0) * s; r.my = (+m.y || 0) * s; }
        else if (m.t === "action" && r.dashCool <= 0) { r.dash = DASH; r.dashCool = DASH_COOL; }
      },
      bot(pid, dt) {
        if (t < 0 || endAt != null) return;
        if (pid === kp.pid) {
          // chase the busiest pad or the nearest blob; stomp when someone's close
          k.bot.think -= dt;
          const tgt = alive().sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
          if (tgt) { const dx = tgt.x - k.x, dy = tgt.y - k.y, d = Math.hypot(dx, dy) || 1; k.mx = dx / d; k.my = dy / d; if (d < STOMP_R * 0.75 && k.bot.think <= 0) { stomp(); k.bot.think = rnd(0.3, 0.9); } }
          return;
        }
        const r = runners.find((r) => r.p.pid === pid);
        if (!r || r.out) return;
        r.bot.think -= dt;
        const kd = Math.hypot(r.x - k.x, r.y - k.y);
        if (kd < STOMP_R + 80 && (k.wind > 0 || Math.random() < 0.4)) {
          // run from the kaiju (dash if the stomp is winding up)
          const dx = r.x - k.x, dy = r.y - k.y, d = kd || 1; r.mx = dx / d; r.my = dy / d;
          if (k.wind > 0 && Math.random() < 0.5) inst.input(pid, { t: "action" });
          r.bot.goal = null; return;
        }
        if (!r.bot.goal || r.bot.think <= 0) {
          r.bot.think = rnd(1, 2.5);
          const pad = [...pads].sort((a, b) => Math.hypot(b.x - k.x, b.y - k.y) - Math.hypot(a.x - k.x, a.y - k.y))[Math.random() < 0.7 ? 0 : 1];
          r.bot.goal = [pad.x + rnd(-35, 35), pad.y + rnd(-35, 35)];
        }
        const dx = r.bot.goal[0] - r.x, dy = r.bot.goal[1] - r.y, d = Math.hypot(dx, dy);
        if (d < 12) { r.mx = r.my = 0; } else { r.mx = dx / d; r.my = dy / d; }
      },
      update(dt) {
        cues(t, TIME); // the music: build over the countdown, drop on GO, half time, the last 10 s
        t += dt;
        if (t < 0) { if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); } return; }
        if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
        if (inst.result) return;
        if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        k.cool = Math.max(0, k.cool - dt); k.hit = Math.max(0, k.hit - dt); k.ring = Math.max(0, k.ring - dt);
        if (k.wind > 0) { k.wind -= dt; if (k.wind <= 0) land(); }
        const ks = k.wind > 0 ? 0.25 : 1; // rooted while winding up
        k.x = Math.max(F.x0 + KR * 0.6, Math.min(F.x1 - KR * 0.6, k.x + k.mx * K_SPEED * ks * dt));
        k.y = Math.max(F.y0 + KR * 0.6, Math.min(F.y1 - KR * 0.6, k.y + k.my * K_SPEED * ks * dt));
        for (const b of blocks) if (!b.down && k.x + KR * 0.6 > b.x && k.x - KR * 0.6 < b.x + b.w && k.y + KR * 0.5 > b.y && k.y - KR * 0.5 < b.y + b.h) { b.down = true; ctx.sfx.crunch(b); ctx.shake(8); ctx.stat(kp.pid, "wrecked", 1); }
        for (const r of runners) {
          if (r.out) continue;
          r.dash = Math.max(0, r.dash - dt); r.dashCool -= dt;
          const sp = SPEED * (r.dash > 0 ? DASH_MUL : 1);
          r.x = Math.max(F.x0 + R, Math.min(F.x1 - R, r.x + r.mx * sp * dt));
          r.y = Math.max(F.y0 + R, Math.min(F.y1 - R, r.y + r.my * sp * dt));
          for (const b of blocks) {
            if (b.down) continue;
            const px = Math.max(b.x, Math.min(b.x + b.w, r.x)), py = Math.max(b.y, Math.min(b.y + b.h, r.y)), dx = r.x - px, dy = r.y - py, d = Math.hypot(dx, dy);
            if (d < R && d > 0.01) { r.x += (dx / d) * (R - d); r.y += (dy / d) * (R - d); }
          }
        }
        // cannons: charge with the number of blobs on the pad; a full one fires
        for (const p of pads) {
          p.flash = Math.max(0, p.flash - dt);
          const on = alive().filter((r) => Math.hypot(r.x - p.x, r.y - p.y) < p.r);
          if (on.length) p.charge += (dt / charge) * (1 + 0.6 * (on.length - 1));
          if (p.charge >= 1) {
            p.charge = 0; p.flash = 0.3; k.hp--; k.hit = 0.35;
            if (k.hp === 1) ctx.music?.hot(); // one more hit brings it down
            shots.push({ x0: p.x, y0: p.y, t: 0 });
            ctx.sfx.launch(); ctx.shake(20);
            for (const r of on) ctx.stat(r.p.pid, "cannon", 1);
            pops.push({ x: k.x, y: k.y - KR - 40, word: "BOOM!", color: "#ff6b00", t: 0 });
          }
        }
        for (const s of shots) s.t += dt;
        const rp = others.map((p) => p.pid);
        if (k.hp <= 0 || !alive().length || t >= TIME) {
          const cityWins = k.hp <= 0;
          endAt = t + 1.4;
          inst.pending = cityWins
            ? { winners: rp, losers: [kp.pid], headline: `The city takes down ${kp.name}!` }
            : { winners: [kp.pid], losers: rp, headline: alive().length ? `${kp.name} rules the ruins!` : `${kp.name} flattened everyone!` };
          (cityWins ? ctx.sfx.win : ctx.sfx.lose)();
        }
      },
      draw(g) {
        g.fillStyle = "#0d0221"; g.fillRect(0, 0, W, H);
        rrect(g, F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0, 10, "#171027", "#05d9e8", 4);
        g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 26;
        for (let x = F.x0 + 150; x < F.x1; x += 300) { g.beginPath(); g.moveTo(x, F.y0); g.lineTo(x, F.y1); g.stroke(); }
        for (let y = F.y0 + 140; y < F.y1; y += 280) { g.beginPath(); g.moveTo(F.x0, y); g.lineTo(F.x1, y); g.stroke(); }
        for (const sp of splats) drawSplat(g, sp);
        for (const p of pads) {
          circle(g, p.x, p.y, p.r, "rgba(249,240,2,.12)", "#f9f002", 5);
          g.beginPath(); g.arc(p.x, p.y, p.r - 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.charge); g.lineWidth = 12; g.strokeStyle = "#ff6b00"; g.stroke();
          rrect(g, p.x - 16, p.y - 44, 32, 44, 4, p.flash > 0 ? "#fff" : "#6b6b80", INK, 4);
          circle(g, p.x, p.y + 4, 22, "#3a3a4d", INK, 4);
        }
        // buildings and blobs, back to front
        const items = [];
        for (const b of blocks) items.push([b.y + b.h, () => {
          if (b.down) { rrect(g, b.x, b.y + b.h - 22, b.w, 22, 3, "#3a3350", INK, 3); for (let i = 0; i < 5; i++) circle(g, b.x + (i + 0.5) * (b.w / 5), b.y + b.h - 22, 10, "#4a4262", INK, 2); return; }
          rrect(g, b.x, b.y + b.h - b.ht - 20, b.w, 20, 3, `hsl(${b.hue} 60% 35%)`, INK, 4);
          rrect(g, b.x, b.y + b.h - b.ht, b.w, b.ht, 3, `hsl(${b.hue} 55% 22%)`, INK, 4);
          g.fillStyle = `hsl(${b.hue} 100% 70% / .7)`;
          for (let wy = b.y + b.h - b.ht + 14; wy < b.y + b.h - 16; wy += 24) for (let wx = b.x + 12; wx < b.x + b.w - 14; wx += 24) g.fillRect(wx, wy, 10, 12);
        }]);
        for (const r of runners) if (!r.out) items.push([r.y, () => { blob(g, r.p, r.x, r.y - (Math.hypot(r.mx, r.my) > 0.1 ? Math.abs(Math.sin(t * 14 + r.x)) * 5 : 0), R, { sx: r.dash > 0 ? 1.25 : 1, sy: r.dash > 0 ? 0.8 : 1 }); tag(g, r.p.name, r.x, r.y - R - 24, r.p.color, 16); }]);
        items.push([k.y + KR * 0.5, () => {
          if (k.wind > 0) { const f = 1 - k.wind / WINDUP; circle(g, k.x, k.y + KR * 0.3, STOMP_R, `rgba(255,42,109,${0.1 + 0.25 * f})`, "#ff2a6d", 6); }
          const lift = k.wind > 0 ? (1 - k.wind / WINDUP) * 60 : 0, sq = k.ring > 0 ? 0.25 * (k.ring / 0.4) : 0;
          blob(g, kp, k.x, k.y - lift, KR, { tint: k.hit > 0 ? "#ffffff" : undefined, sx: 1 + sq, sy: 1 - sq });
          // spikes on its back
          for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(k.x + i * 34 - 16, k.y - lift - KR * 0.8); g.lineTo(k.x + i * 34, k.y - lift - KR * 1.2 - (2 - Math.abs(i)) * 12); g.lineTo(k.x + i * 34 + 16, k.y - lift - KR * 0.8); g.fillStyle = "#39ff14"; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke(); }
        }]);
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        if (k.ring > 0) circle(g, k.x, k.y + KR * 0.3, STOMP_R * (1.2 - k.ring), null, `rgba(255,255,255,${k.ring * 2})`, 10);
        for (const s of shots) if (s.t < 0.25) { g.strokeStyle = "#ff6b00"; g.lineWidth = 14 * (1 - s.t * 4); g.beginPath(); g.moveTo(s.x0, s.y0 - 40); g.lineTo(k.x, k.y); g.stroke(); }
        for (const pp of fade(pops)) { pp.t += FX.dt; if (pp.t < 1.1) shout(g, pp.word, pp.x, pp.y, 48, pp.color, pp.t); }
        // HUD: kaiju HP bar
        rrect(g, 0, 0, W, 130, 0, "rgba(13,2,33,.85)");
        tag(g, `KAIJU · ${kp.name}`, 230, 64, kp.color, 28);
        rrect(g, W / 2 - 360, 44, 720, 40, 6, "#2a1a3a", INK, 4);
        rrect(g, W / 2 - 356, 48, 712 * Math.max(0, k.hp / hpMax), 32, 4, "#ff2a6d");
        text(g, `HP ${Math.max(0, k.hp)}/${hpMax}`, W / 2, 64, 30, "#fff", "center", 900);
        text(g, `⏱ ${Math.max(0, Math.ceil(TIME - Math.max(0, t)))}`, W - 330, 64, 44, "#fff", "center", 900);
        text(g, `CITY ${alive().length}/${n}`, W - 150, 64, 30, "#05d9e8", "center", 900);
        countdown(g, -t);
        if (t >= 0 && t < 0.6) shout(g, "RAAAWR!", W / 2, H / 2, 220, "#39ff14", t);
      },
    };
    return inst;
  },
};
