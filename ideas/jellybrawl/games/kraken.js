// Kraken — 1 vs rest. Everyone else shares one raft: its heading is the
// average of all their sticks, so they have to agree on where to row. They
// must pass three buoys, then reach the dock. One player is the kraken: move
// the target with the stick and SLAM a tentacle down on it (a shadow warns
// the raft first). Three slams sink the raft. The kraken also wins if the
// clock runs out.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 60, RAFT_ACC = 260, RAFT_MAX = 190, WINDUP = 1.1, SLAM_R = 115, TENTACLES = 2, T_COOL = 1.4, AIM_SPEED = 520;

export default {
  id: "kraken", title: "Kraken", command: "ROW!", kind: "1 vs rest", min: 2, max: 8,
  blurb: "One raft, many rowers who must agree. One kraken who wants it sunk.",
  controls: "Rowers: stick (the raft goes where you all point). Kraken: stick to aim, SLAM",

  create(ctx) {
    const kPid = ctx.pickOne();
    const A = arena(ctx, {});
    const ck = clock(ctx, TIME), pops = [], splashes = [];
    const kraken = A.of(kPid), rowers = A.bodies.filter((b) => b !== kraken);
    const F = { x0: 80, y0: 150, x1: W - 80, y1: H - 50 };
    const raft = { x: 220, y: 610, vx: 0, vy: 0, hp: 3 + Math.min(2, Math.floor(rowers.length / 2)), hit: 0, ang: 0, leg: 0 };
    const buoys = [[rnd(560, 760), rnd(250, 420)], [rnd(900, 1100), rnd(760, 950)], [rnd(1300, 1500), rnd(250, 420)]];
    const dock = [F.x1 - 90, 610];
    const aim = { x: W / 2, y: 610 };
    const tents = Array.from({ length: TENTACLES }, () => ({ state: "idle", t: 0, x: 0, y: 0, cool: 0 }));
    let endAt = null;
    const goal = () => (raft.leg < 3 ? buoys[raft.leg] : dock);

    function slam() {
      const t = tents.find((t) => t.state === "idle" && t.cool <= 0);
      if (!t || ck.t < 0 || endAt != null) return;
      Object.assign(t, { state: "wind", t: 0, x: aim.x, y: aim.y }); ctx.sfx.whoosh();
    }
    function finish(krakenWins, headline) {
      endAt = ck.t + 1.6; ctx.sfx.win();
      const rp = A.real(rowers);
      inst.pending = krakenWins ? { winners: [kPid], losers: rp, headline } : { winners: rp, losers: [kPid], headline };
    }

    const inst = {
      result: null,
      describe: () => [`${kraken.p.name} is the KRAKEN`, `${rowers.length} rower${rowers.length > 1 ? "s" : ""} on one raft: agree on a heading!`],
      start() {
        for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, b === kraken
          ? { kind: "stick", radar: false, action: "SLAM", role: "🐙 THE KRAKEN", hint: "Aim at the raft and SLAM. Three hits sinks it!" }
          : { kind: "stick", radar: false, role: "Rower", hint: "Point where the raft should go. It follows the whole crew's average!" });
      },
      input(pid, m) {
        const b = A.of(pid); if (!b) return;
        if (A.input(pid, m) === "action" && b === kraken) slam();
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || ck.t < 0) return;
        if (b === kraken) {
          // lead the raft by the windup, then slam when lined up
          b.bot.err ??= [rnd(-40, 40), rnd(-40, 40)]; // bots misjudge the lead a little
          const px = raft.x + raft.vx * WINDUP + b.bot.err[0], py = raft.y + raft.vy * WINDUP + b.bot.err[1];
          const dx = px - aim.x, dy = py - aim.y, d = Math.hypot(dx, dy);
          b.mx = d > 10 ? dx / d : 0; b.my = d > 10 ? dy / d : 0;
          b.bot.t = (b.bot.t ?? 0) - dt;
          if (d < 50 && b.bot.t <= 0) { slam(); b.bot.t = rnd(0.8, 2); b.bot.err = null; }
          return;
        }
        // rowers: head for the goal, swerve out of any shadow closing in
        const [gx, gy] = goal();
        let tx = gx - raft.x, ty = gy - raft.y;
        for (const t of tents) if (t.state === "wind") {
          const dx = raft.x - t.x, dy = raft.y - t.y, d = Math.hypot(dx, dy) || 1;
          if (d < SLAM_R + 90) { tx = (dx / d) * 400; ty = (dy / d) * 400; }
        }
        const l = Math.hypot(tx, ty) || 1, wob = b.bot.wob ??= rnd(-0.5, 0.5);
        b.mx = tx / l + wob * 0.3; b.my = ty / l - wob * 0.3;
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        // the crew's average stick steers the raft
        const live = rowers;
        let ax = 0, ay = 0;
        for (const b of live) { ax += b.mx; ay += b.my; }
        ax /= live.length || 1; ay /= live.length || 1;
        if (raft.hit > 0) { raft.hit -= dt; ax = ay = 0; }
        raft.vx += ax * RAFT_ACC * dt; raft.vy += ay * RAFT_ACC * dt;
        raft.vx *= Math.exp(-0.9 * dt); raft.vy *= Math.exp(-0.9 * dt);
        const v = Math.hypot(raft.vx, raft.vy); if (v > RAFT_MAX) { raft.vx *= RAFT_MAX / v; raft.vy *= RAFT_MAX / v; }
        raft.x = Math.max(F.x0 + 70, Math.min(F.x1 - 70, raft.x + raft.vx * dt)); raft.y = Math.max(F.y0 + 50, Math.min(F.y1 - 50, raft.y + raft.vy * dt));
        if (v > 20) raft.ang += (Math.atan2(raft.vy, raft.vx) * 0.25 - raft.ang) * Math.min(1, 3 * dt);
        // the kraken's aim
        aim.x = Math.max(F.x0, Math.min(F.x1, aim.x + kraken.mx * AIM_SPEED * dt)); aim.y = Math.max(F.y0, Math.min(F.y1, aim.y + kraken.my * AIM_SPEED * dt));
        // tentacles
        for (const t of tents) {
          t.cool -= dt;
          if (t.state === "wind") { t.t += dt; if (t.t >= WINDUP) {
            t.state = "slam"; t.t = 0; ctx.shake(14); ctx.sfx.crunch(); splashes.push({ x: t.x, y: t.y, t: 0 });
            if (Math.hypot(raft.x - t.x, raft.y - t.y) < SLAM_R) {
              raft.hp--; raft.hit = 0.7; const d = Math.hypot(raft.x - t.x, raft.y - t.y) || 1; raft.vx = ((raft.x - t.x) / d) * 320; raft.vy = ((raft.y - t.y) / d) * 320;
              ctx.sfx.hit(); ctx.shake(26); pops.push({ x: raft.x, y: raft.y - 90, t: 0, word: raft.hp > 0 ? "CRUNCH!" : "SUNK!" });
              for (const b of rowers) if (!b.ghost) ctx.buzz(b.pid, 350);
              if (!kraken.ghost) ctx.stat(kPid, "slams", 1);
              if (raft.hp <= 0) return finish(true, `${kraken.p.name} sinks the raft!`);
            }
          } }
          else if (t.state === "slam") { t.t += dt; if (t.t > 0.6) { t.state = "idle"; t.cool = T_COOL; } }
        }
        // buoys, then the dock
        const [gx, gy] = goal();
        if (Math.hypot(raft.x - gx, raft.y - gy) < 90) {
          raft.leg++; ctx.sfx.power(); pops.push({ x: gx, y: gy - 80, t: 0, word: raft.leg > 3 ? "LAND HO!" : `BUOY ${raft.leg}/3` });
          for (const b of rowers) if (!b.ghost) ctx.stat(b.pid, "buoys", 1);
          if (raft.leg > 3) return finish(false, "The crew makes it to shore!");
        }
        if (ck.t >= TIME) return finish(true, `${kraken.p.name} keeps them at sea!`);
      },
      draw(g) {
        g.fillStyle = "#07324a"; g.fillRect(0, 0, W, H);
        g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 4;
        for (let y = 170; y < H; y += 60) { g.beginPath(); for (let x = 0; x <= W; x += 40) g.lineTo(x, y + Math.sin(x / 90 + ck.t * 1.5 + y) * 8); g.stroke(); }
        // dock
        rrect(g, dock[0] - 50, dock[1] - 140, 150, 280, 8, "#8a5a2b", INK, 6);
        for (let k = 0; k < 6; k++) { g.fillStyle = "rgba(0,0,0,.2)"; g.fillRect(dock[0] - 50, dock[1] - 140 + k * 47, 150, 4); }
        text(g, "DOCK", dock[0] + 25, dock[1], 30, "#fff", "center", 900);
        // buoys
        buoys.forEach(([x, y], i) => {
          const done = i < raft.leg, next = i === raft.leg, bob = Math.sin(ck.t * 3 + i) * 4;
          if (next) { g.beginPath(); g.arc(x, y, 90, 0, Math.PI * 2); g.setLineDash([12, 10]); g.strokeStyle = "#f9f002"; g.lineWidth = 4; g.stroke(); g.setLineDash([]); }
          circle(g, x, y + bob, 26, done ? "#39ff14" : "#ff6b00", INK, 5); g.fillStyle = "#fff"; g.fillRect(x - 26, y + bob - 6, 52, 10);
          text(g, String(i + 1), x, y + bob - 46, 28, "#fff", "center", 900);
        });
        // shadows then tentacles
        for (const t of tents) if (t.state === "wind") {
          const k = t.t / WINDUP;
          g.beginPath(); g.ellipse(t.x, t.y, SLAM_R * (0.4 + 0.6 * k), SLAM_R * 0.55 * (0.4 + 0.6 * k), 0, 0, Math.PI * 2); g.fillStyle = `rgba(0,0,0,${0.25 + 0.3 * k})`; g.fill();
          g.strokeStyle = `rgba(255,42,109,${0.4 + 0.6 * k})`; g.lineWidth = 5; g.stroke();
        }
        for (const s of fade(splashes)) { s.t += FX.dt; if (s.t < 0.7) for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; circle(g, s.x + Math.cos(a) * (40 + s.t * 200), s.y + Math.sin(a) * (20 + s.t * 100) - s.t * 60, 10 * (1 - s.t), "rgba(200,240,255,.8)"); } }
        // raft with the crew aboard
        g.save(); g.translate(raft.x, raft.y); g.rotate(raft.ang);
        if (raft.hit > 0) g.translate(rnd(-5, 5), rnd(-5, 5));
        for (let k = 0; k < 5; k++) rrect(g, -110, -70 + k * 28, 220, 26, 6, k % 2 ? "#a06a36" : "#8a5a2b", INK, 3);
        g.restore();
        rowers.forEach((b, i) => { const c = i % 4, r = Math.floor(i / 4); blob(g, b.p, raft.x - 75 + c * 50, raft.y - 20 + r * 44, 22); });
        text(g, "♥".repeat(Math.max(0, raft.hp)), raft.x, raft.y + 100, 30, "#ff2a6d", "center", 900);
        for (const t of tents) if (t.state === "slam") {
          const k = Math.min(1, t.t / 0.15), lift = t.t > 0.35 ? (t.t - 0.35) / 0.25 : 0;
          const sx = t.x + 260, sy = t.y + 260;
          g.lineCap = "round";
          for (const [w, c] of [[70, INK], [56, "#8a2be2"], [22, "#c77dff"]]) {
            g.strokeStyle = c; g.lineWidth = w * (1 - lift * 0.5); g.beginPath(); g.moveTo(sx, sy);
            g.quadraticCurveTo(t.x + 260, t.y - 200 * (1 - k), t.x + (1 - k) * 200, t.y - (1 - k) * 260 - lift * 200); g.stroke();
          }
          for (let s = 0; s < 4; s++) circle(g, t.x + (1 - k) * 200 + 30 + s * 40, t.y - (1 - k) * 260 + 20 + s * 30 - lift * 200, 9, "#f0d6ff", INK, 2);
        }
        // the kraken's crosshair (everyone can see it coming)
        g.strokeStyle = "#ff2a6d"; g.lineWidth = 5; g.beginPath(); g.arc(aim.x, aim.y, 40, 0, Math.PI * 2); g.moveTo(aim.x - 60, aim.y); g.lineTo(aim.x + 60, aim.y); g.moveTo(aim.x, aim.y - 60); g.lineTo(aim.x, aim.y + 60); g.stroke();
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1) shout(g, p.word, p.x, p.y, 60, "#f9f002", p.t); }
        rrect(g, 0, 0, W, 130, 0, "rgba(3,20,32,.9)");
        text(g, raft.leg < 3 ? `NEXT: BUOY ${raft.leg + 1}` : "NEXT: THE DOCK", 300, 66, 38, "#f9f002", "center", 900);
        outlined(g, String(ck.left()), W / 2, 66, 70, "#fff");
        text(g, `🐙 ${kraken.ghost ? "BOT" : kraken.p.name} · TENTACLES ${tents.filter((t) => t.state === "idle" && t.cool <= 0).length}/${TENTACLES}`, W - 400, 66, 34, "#c77dff", "center", 900);
        ck.overlay(g, "ROW!");
      },
    };
    return inst;
  },
};
