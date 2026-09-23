// Flap Frenzy — free-for-all. Everyone flaps through the same pillars on one
// screen; placements are by elimination order, last blob flying wins.

import { W, H, INK, text, outlined, shout, rrect, panel, grid, makeSplat, drawSplat, blob, tag, countdown } from "../gfx.js";

const GROUND = H - 90, X = 560, R = 34, GRAV = 2300, FLAP = -760, PW = 130;

export default {
  id: "flap", title: "Flap Frenzy", command: "FLAP!", kind: "Free-for-all", min: 1, max: 8,
  blurb: "Flap through the pillars. Last blob flying wins.",
  controls: "Tap FLAP on your phone",

  create(ctx) {
    const birds = ctx.players.map((p, i) => ({ p, y: 300 + (i * 480) / Math.max(1, ctx.players.length - 1 || 1), vy: 0, alive: true, diedAt: null, x: X - i * 14, phase: i, botCool: 0, botErr: 0 }));
    let splats = [];
    let t = -3, dist = 0, nextPipe = 1100, pipes = [], endAt = null, lastTick = 3;
    const speed = () => 400 + Math.max(0, t) * 5;
    const gap = () => Math.max(250, 340 - Math.max(0, t) * 2.5);

    const inst = {
      result: null,
      describe: () => [`${birds.length} blob${birds.length > 1 ? "s" : ""} take flight`],
      start() {
        for (const b of birds) ctx.layout(b.p.pid, { kind: "button", label: "FLAP", hint: "Tap to flap!" });
      },
      input(pid, m) {
        if (m.t !== "btn" || !m.down || t < 0) return;
        const b = birds.find((b) => b.p.pid === pid);
        if (!b || !b.alive) return;
        b.vy = FLAP;
        ctx.stat(pid, "flaps", 1);
        ctx.sfx.flap();
      },
      bot(pid, dt) {
        const b = birds.find((b) => b.p.pid === pid);
        if (!b || !b.alive || t < 0) return;
        b.botCool -= dt;
        const next = pipes.find((q) => q.x - dist + PW > b.x - R);
        if (!b.botErr || Math.random() < dt * 0.6) b.botErr = (Math.random() - 0.5) * gap() * 0.45;
        const target = (next ? next.gapY : H / 2) + b.botErr + 40;
        if (b.botCool <= 0 && b.y > target && b.vy > -150) { inst.input(pid, { t: "btn", down: true }); b.botCool = 0.2 + Math.random() * 0.12; }
      },
      update(dt) {
        t += dt;
        if (t < 0) {
          if (Math.ceil(-t) < lastTick) { lastTick = Math.ceil(-t); ctx.sfx.tick(); }
          for (const b of birds) { b.phase += dt * 8; b.y += Math.sin(b.phase) * 0.8; }
          return;
        }
        if (lastTick > 0) { lastTick = 0; ctx.sfx.go(); }
        dist += speed() * dt;
        while (nextPipe - dist < W + 200) {
          pipes.push({ x: nextPipe, gapY: 260 + Math.random() * (GROUND - 520), gap: gap() });
          nextPipe += 540;
        }
        pipes = pipes.filter((q) => q.x - dist > -PW - 40);
        for (const b of birds) {
          b.vy = Math.min(1100, b.vy + GRAV * dt);
          b.y += b.vy * dt;
          b.phase += dt * (b.vy < 0 ? 30 : 10);
          if (!b.alive) { b.x -= speed() * dt; continue; }
          let dead = b.y > GROUND - R || b.y < -R * 2;
          for (const q of pipes) {
            const px = q.x - dist;
            if (b.x + R * 0.8 > px && b.x - R * 0.8 < px + PW && (b.y - R * 0.8 < q.gapY - q.gap / 2 || b.y + R * 0.8 > q.gapY + q.gap / 2)) dead = true;
          }
          if (dead) {
            b.alive = false; b.diedAt = t; b.vy = -500;
            splats.push(makeSplat(b.x + dist, Math.min(b.y, GROUND - 10), 46, b.p.color));
            ctx.shake(26);
            ctx.stat(b.p.pid, "airtime", Math.round(t));
            ctx.sfx.hit(); ctx.buzz(b.p.pid, 200);
            ctx.layout(b.p.pid, { kind: "wait", text: "Splat!", sub: `You lasted ${t.toFixed(1)}s` });
          }
        }
        const alive = birds.filter((b) => b.alive);
        if (endAt == null && (alive.length === 0 || (birds.length > 1 && alive.length === 1) || t > 90)) endAt = t + (alive.length ? 1.2 : 0.8);
        if (endAt != null && t >= endAt) {
          for (const b of alive) ctx.stat(b.p.pid, "airtime", Math.round(t));
          const order = [...birds].sort((a, b) => (b.diedAt ?? 1e9) - (a.diedAt ?? 1e9));
          const ranking = [];
          for (const b of order) {
            const grp = ranking[ranking.length - 1];
            if (grp && Math.abs((grp.at ?? 1e9) - (b.diedAt ?? 1e9)) < 0.05) grp.push(b.p.pid);
            else { const ng = [b.p.pid]; ng.at = b.diedAt ?? 1e9; ranking.push(ng); }
          }
          inst.result = { ranking, headline: alive.length === 1 ? `${alive[0].p.name} flies highest!` : alive.length ? "Survivors share the sky!" : `${order[0].p.name} flew furthest!` };
        }
      },
      draw(g) {
        const sky = g.createLinearGradient(0, 0, 0, GROUND);
        sky.addColorStop(0, "#0d0221"); sky.addColorStop(0.6, "#3a0a4a"); sky.addColorStop(1, "#b0105a");
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        // striped synthwave sun
        g.save(); g.beginPath(); g.arc(W / 2, GROUND - 120, 300, 0, Math.PI * 2); g.clip();
        const sun = g.createLinearGradient(0, GROUND - 420, 0, GROUND + 180);
        sun.addColorStop(0, "#f9f002"); sun.addColorStop(1, "#ff2a6d");
        g.fillStyle = sun; g.fillRect(W / 2 - 300, GROUND - 420, 600, 600);
        g.fillStyle = "#3a0a4a";
        for (let i = 0; i < 9; i++) g.fillRect(W / 2 - 300, GROUND - 200 + i * 26, 600, 4 + i * 2);
        g.restore();
        for (let i = 0; i < 9; i++) {
          const hx = ((i * 300 - dist * 0.3) % (W + 300) + W + 300) % (W + 300) - 150;
          g.beginPath(); g.moveTo(hx - 220, GROUND); g.lineTo(hx, GROUND - 180 - (i % 3) * 60); g.lineTo(hx + 220, GROUND); g.closePath();
          g.fillStyle = "#16042a"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#05d9e8"; g.stroke();
        }
        for (const q of pipes) {
          const px = q.x - dist, top = q.gapY - q.gap / 2, bot = q.gapY + q.gap / 2;
          for (const [y0, h] of [[-20, top + 20], [bot, GROUND - bot]]) {
            rrect(g, px, y0, PW, h, 0, "#1b0636", "#ff2a6d", 8);
            g.fillStyle = "rgba(5,217,232,.5)"; g.fillRect(px + 16, y0 + 10, 8, h - 20);
            g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(px + PW - 30, y0 + 4, 24, h - 8);
          }
          rrect(g, px - 14, top - 44, PW + 28, 44, 0, "#ff2a6d", INK, 6);
          rrect(g, px - 14, bot, PW + 28, 44, 0, "#ff2a6d", INK, 6);
        }
        g.fillStyle = "#0d0221"; g.fillRect(0, GROUND, W, H - GROUND);
        g.save(); g.beginPath(); g.rect(0, GROUND, W, H - GROUND); g.clip(); grid(g, dist / 300, "#ff2a6d", GROUND); g.restore();
        g.fillStyle = "#ff2a6d"; g.fillRect(0, GROUND, W, 6);
        for (const sp of splats) drawSplat(g, sp, dist);
        for (const b of [...birds].sort((a, c) => a.alive - c.alive)) {
          const s = Math.min(0.25, Math.abs(b.vy) / 3000);
          blob(g, b.p, b.x, b.y, R, { wings: b.phase, rot: b.alive ? Math.max(-0.5, Math.min(1.2, b.vy / 900)) : b.phase, sx: 1 - s, sy: 1 + s, alpha: b.alive ? 1 : 0.6 });
          if (b.alive) tag(g, b.p.name, b.x, b.y - R - 30, b.p.color, 22);
          else if (t - b.diedAt < 0.8) outlined(g, "SPLAT", b.x, b.y - 60, 50, "#f9f002", "center", -0.2);
        }
        const alive = birds.filter((b) => b.alive).length;
        panel(g, 30, 24, 400, 76, "#fff", 12, 6);
        text(g, `FLYING ${alive}/${birds.length} · ${Math.max(0, t).toFixed(1)}s`, 230, 63, 32, INK, "center", 900);
        countdown(g, -t);
        if (t < 0) outlined(g, "GET READY TO FLAP", W / 2, H / 2 - 240, 70, "#05d9e8", "center", -0.04);
        if (t >= 0 && t < 0.6) shout(g, "GO!", W / 2, H / 2, 260, "#f9f002", t);
      },
    };
    return inst;
  },
};
