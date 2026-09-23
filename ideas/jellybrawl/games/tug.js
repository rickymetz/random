// Tug of Jelly — teams (2v2, 3v3, 4v4). Mash PULL to drag the other team
// into the goo pit. Every few seconds the TV yells HEAVE!: taps inside that
// window count triple. Pull a rival into the pit, or be ahead after 40 s.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";

const TIME = 40, TAP = 13, HEAVE_MUL = 3, WIN = 175, ROPE_Y = 640, GAP = 130, BR = 54;

export default {
  id: "tug", title: "Tug of Jelly", command: "PULL!", kind: "Teams", min: 2, max: 8,
  blurb: "Mash to pull the other team into the goo. Tap hard on HEAVE!",
  controls: "Mash PULL. Taps during HEAVE! count triple",

  create(ctx) {
    const A = arena(ctx, { teams: true });
    const ck = clock(ctx, TIME), pops = [];
    let pos = 0, vel = 0, endAt = null, heave = 0, nextHeave = rnd(3, 5), heaves = 0, loser = -1;
    for (const b of A.bodies) { b.taps = 0; b.pulse = 0; b.rate = rnd(5.5, 8); b.clock = 0; b.heaveAim = rnd(0.55, 0.9); }

    function tap(b) {
      if (!b || ck.t < 0 || endAt != null) return;
      const k = heave > 0 ? HEAVE_MUL : 1;
      vel += (b.team === 0 ? -1 : 1) * TAP * k;
      b.taps++; b.pulse = 1;
      if (k > 1 && !b.ghost) ctx.stat(b.pid, "heaves", 1);
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "button", label: "PULL", hint: `Mash! Taps on HEAVE! count ×${HEAVE_MUL}`, role: `${TEAM[b.team].name} team` }); },
      input(pid, m) { if (m.t === "btn" && m.down) tap(A.of(pid)); },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        for (const b of A.bodies) b.pulse = Math.max(0, b.pulse - dt * 5);
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        heave -= dt; nextHeave -= dt;
        if (nextHeave <= 0) {
          heave = 0.8; nextHeave = rnd(3, 5.5); heaves++;
          ctx.sfx.slam(); ctx.shake(8);
          for (const b of A.bodies) if (!b.ghost) ctx.buzz(b.pid, 120);
        }
        vel *= Math.exp(-2.6 * dt);
        pos += vel * dt;
        if (Math.abs(pos) >= WIN || ck.t >= TIME) {
          // negative pos = pulled toward pink's side: cyan goes in the goo
          const w = Math.abs(pos) < 8 ? -1 : pos < 0 ? 0 : 1;
          loser = w < 0 ? -1 : 1 - w;
          endAt = ck.t + 2;
          if (w >= 0) { ctx.sfx.lose(); ctx.shake(26); pops.push({ t: 0, word: "SPLOOSH!", c: TEAM[w].color }); }
          inst.pending = A.teamResult(w, w < 0 ? "Dead even on the rope!" : Math.abs(pos) >= WIN ? `${TEAM[1 - w].name} takes a goo bath!` : `${TEAM[w].name} was ahead at the whistle!`);
          ctx.sfx.win();
        }
      },
      draw(g) {
        // dusk sky, two cliffs, the goo pit between them
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#1b0735"); sky.addColorStop(1, "#4a0f3a"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 30; i++) circle(g, (i * 331) % W, 40 + ((i * 97) % 300), 2, "rgba(255,255,255,.5)");
        const pitL = W / 2 - 140, pitR = W / 2 + 140, ground = ROPE_Y + BR - 2;
        g.fillStyle = "#2b1233"; g.fillRect(0, ground, pitL, H - ground); g.fillRect(pitR, ground, W - pitR, H - ground);
        g.fillStyle = "#3d1a47"; g.fillRect(0, ground, pitL, 18); g.fillRect(pitR, ground, W - pitR, 18);
        g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(-10, ground, pitL + 10, H); g.strokeRect(pitR, ground, W, H);
        const gy = ground + 120;
        g.fillStyle = "#39ff14"; g.beginPath(); g.moveTo(pitL, H);
        for (let x = pitL; x <= pitR; x += 10) g.lineTo(x, gy + Math.sin(x / 30 + ck.t * 3) * 8);
        g.lineTo(pitR, H); g.closePath(); g.fill();
        for (let i = 0; i < 6; i++) circle(g, pitL + 30 + ((i * 53 + ck.t * 40) % 220), gy + 30 + ((i * 37) % 60), 6 + (i % 3) * 3, "rgba(255,255,255,.35)");
        // the rope and the midpoint flag
        const mid = W / 2 + pos;
        g.strokeStyle = "#c8a064"; g.lineWidth = 10; g.beginPath(); g.moveTo(80, ROPE_Y); g.lineTo(W - 80, ROPE_Y); g.stroke();
        g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3; for (let x = 80; x < W - 80; x += 24) { g.beginPath(); g.moveTo(x, ROPE_Y - 5); g.lineTo(x + 10, ROPE_Y + 5); g.stroke(); }
        g.fillStyle = "#f9f002"; g.beginPath(); g.moveTo(mid, ROPE_Y); g.lineTo(mid - 16, ROPE_Y + 50); g.lineTo(mid + 16, ROPE_Y + 50); g.closePath(); g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
        // win lines
        for (const s of [-1, 1]) { const x = W / 2 + s * WIN; g.setLineDash([12, 10]); g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = 4; g.beginPath(); g.moveTo(x, ROPE_Y - 90); g.lineTo(x, ROPE_Y + 60); g.stroke(); g.setLineDash([]); }
        // teams, leaning back; the losers slide in
        for (const t of [0, 1]) A.teams[t].forEach((b, i) => {
          const s = t === 0 ? -1 : 1;
          let x = W / 2 + s * (190 + i * GAP) + pos, y = ROPE_Y - 4;
          const over = t === 0 ? x > pitL - 10 : x < pitR + 10;
          if (over && endAt != null && loser === t) y += Math.min(260, (ck.t - (endAt - 2)) * 400);
          const lean = 0.12 + b.pulse * 0.1;
          g.save(); g.translate(x, y); g.rotate(s * lean);
          blob(g, b.p, 0, 0, BR, { sx: 1 + b.pulse * 0.15, sy: 1 - b.pulse * 0.12 });
          g.restore();
          tag(g, b.ghost ? "BOT" : b.p.name, x, y - BR - 36, TEAM[t].color, 20);
        });
        if (heave > 0) shout(g, "HEAVE!", W / 2, 340, 170, "#f9f002", 0.8 - heave);
        for (const p of pops) { p.t += 1 / 60; if (p.t < 1.5) shout(g, p.word, W / 2, 420, 150, p.c, p.t); }
        // HUD: tug meter
        rrect(g, W / 2 - 400, 30, 800, 60, 12, "rgba(13,2,33,.9)", "#fff", 4);
        rrect(g, W / 2 - 390, 40, 390, 40, 6, TEAM[0].color + "55"); rrect(g, W / 2, 40, 390, 40, 6, TEAM[1].color + "55");
        circle(g, W / 2 + (pos / WIN) * 380, 60, 18, "#f9f002", INK, 4);
        text(g, String(ck.left()), W / 2, 130, 44, "#fff", "center", 900);
        text(g, TEAM[0].name.toUpperCase() + " PULLS ←", 300, 60, 32, TEAM[0].color, "center", 900);
        text(g, "→ " + TEAM[1].name.toUpperCase() + " PULLS", W - 300, 60, 32, TEAM[1].color, "center", 900);
        ck.overlay(g, "PULL!");
      },
    };

    // bots mash at their own rate and try to catch most HEAVE! windows
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || endAt != null) return;
      const rate = b.rate * (heave > 0 ? 1 + b.heaveAim * 0.5 : 1);
      b.clock += dt * rate;
      while (b.clock >= 1) { b.clock--; tap(b); }
    }
    return inst;
  },
};
