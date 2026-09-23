// Blind Pilot — teams (2v2, 3v3, 4v4). Two jelly-mobiles race one lap of a
// track the TV doesn't show: it's pitch black except the cars' headlights.
// Each team's pilot drives (stick); the navigators' phones show the whole
// track, both cars and the next checkpoint, and they shout directions. Off
// the road is mud. A pilot with no navigator gets the map themselves.
// First car round the lap wins; at the whistle, most checkpoints.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 80, WP = 10, ROAD = 95, CP_R = 115, TOP = 330, ACCEL = 420, TURN = 3.4, MUD = 0.38, LIGHT = 150;

export default {
  id: "pilot", title: "Blind Pilot", command: "DRIVE!", kind: "Teams", min: 2, max: 8,
  blurb: "The TV is dark. Your pilot drives; the navigators see the track on their phones.",
  controls: "Pilot: stick to steer. Navigators: read the map, shout directions!",

  create(ctx) {
    const A = arena(ctx, { teams: true });
    const F = { x0: 80, y0: 160, x1: W - 80, y1: H - 50 }, cx = W / 2, cy = (F.y0 + F.y1) / 2, ck = clock(ctx, TIME), pops = [];
    // a wobbly loop of waypoints
    const wps = Array.from({ length: WP }, (_, i) => { const a = (i / WP) * Math.PI * 2 + Math.PI, k = rnd(0.55, 1); return [cx + Math.cos(a) * 760 * k, cy + Math.sin(a) * 350 * (i % 2 ? rnd(0.6, 1) : k)]; });
    const segs = wps.map((p, i) => [p, wps[(i + 1) % WP]]);
    const segDist = (x, y) => Math.min(...segs.map(([[x1, y1], [x2, y2]]) => { const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - x1 - dx * t, y - y1 - dy * t); }));
    // one pilot per team (the rest navigate); the first seat of each team
    const cars = [0, 1].map((t) => {
      const [sx, sy] = wps[0], [nx0, ny0] = wps[1], ang = Math.atan2(ny0 - sy, nx0 - sx);
      const off = t === 0 ? -40 : 40;
      return { t, pilot: A.teams[t][0], x: sx - Math.sin(ang) * off, y: sy + Math.cos(ang) * off, ang, v: 0, mx: 0, my: 0, cp: 1, done: false, mud: false };
    });
    const totalCp = WP; // waypoints 1..WP-1, then back to 0
    let endAt = null;
    const nxm = (x) => (x - F.x0) / (F.x1 - F.x0), nym = (y) => (y - F.y0) / (F.y1 - F.y0);
    const map = { lines: segs.map(([[x1, y1], [x2, y2]]) => [nxm(x1), nym(y1), nxm(x2), nym(y2)]), lw: (ROAD * 2) / (F.x1 - F.x0) };
    const carOf = (b) => cars.find((c) => c.pilot === b);
    const human = (b) => !b.ghost && !b.p.bot;

    const inst = {
      result: null,
      describe: () => cars.map((c) => `${TEAM[c.t].name}: ${c.pilot.ghost ? "Bot" : c.pilot.p.name} pilots · ${A.teams[c.t].filter((b) => b !== c.pilot).map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ") || "nobody"} navigate${A.teams[c.t].length > 2 ? "" : "s"}`),
      start() {
        for (const c of cars) {
          const navs = A.teams[c.t].filter((b) => b !== c.pilot && human(b));
          for (const b of A.teams[c.t]) if (!b.ghost) ctx.layout(b.pid, b === c.pilot
            ? { kind: "stick", radar: !navs.length, map: navs.length ? undefined : map, role: `🚗 ${TEAM[c.t].name} PILOT`, hint: navs.length ? "You're driving blind! Listen to your navigators." : "No navigator: the map's on your phone." }
            : { kind: "nav", map, role: `🧭 ${TEAM[c.t].name} NAVIGATOR`, hint: `Your car is the big dot. Talk ${c.pilot.ghost ? "the bot" : c.pilot.p.name} to the green ring!` });
        }
      },
      input(pid, m) { const b = A.of(pid), c = b && carOf(b); if (c && m.t === "move") { c.mx = Math.max(-1, Math.min(1, +m.x || 0)); c.my = Math.max(-1, Math.min(1, +m.y || 0)); } },
      bot(pid, dt) {
        const b = A.of(pid), c = b && carOf(b); if (!c || ck.t < 0 || c.done) return;
        botDrive(c);
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const c of cars) if (c.pilot.ghost) botDrive(c);
        for (const c of cars) {
          if (c.done) continue;
          const want = Math.hypot(c.mx, c.my);
          if (want > 0.2) { const a = Math.atan2(c.my, c.mx), d = ((a - c.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI; c.ang += Math.max(-TURN * dt, Math.min(TURN * dt, d)); }
          c.mud = segDist(c.x, c.y) > ROAD;
          const top = TOP * (c.mud ? MUD : 1) * Math.min(1, want);
          c.v += Math.sign(top - c.v) * Math.min(Math.abs(top - c.v), ACCEL * dt * (c.v > top ? 1.6 : 1));
          c.x = Math.max(F.x0 + 20, Math.min(F.x1 - 20, c.x + Math.cos(c.ang) * c.v * dt)); c.y = Math.max(F.y0 + 20, Math.min(F.y1 - 20, c.y + Math.sin(c.ang) * c.v * dt));
          const [wx, wy] = wps[c.cp % WP];
          if (Math.hypot(c.x - wx, c.y - wy) < CP_R) {
            c.cp++; ctx.sfx.dot();
            for (const b of A.teams[c.t]) if (!b.ghost) ctx.stat(b.pid, "checkpoints", 1);
            if (c.cp > totalCp) { c.done = true; ctx.sfx.power(); pops.push({ x: c.x, y: c.y - 70, t: 0, word: "FINISH!" }); return finish(c.t); }
          }
        }
        // bump
        const [a, b] = cars, d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 64 && d > 0) { const p = (64 - d) / 2, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d; a.x -= ux * p; a.y -= uy * p; b.x += ux * p; b.y += uy * p; a.v *= 0.7; b.v *= 0.7; if (d < 60) ctx.sfx.crunch(); }
        // the private maps, ~10 times a second
        if (Math.floor(ck.t * 10) !== Math.floor((ck.t - dt) * 10)) for (const c of cars) {
          const dots = cars.map((o) => [nxm(o.x), nym(o.y), TEAM[o.t].color, o === c ? 10 : 6]);
          const [wx, wy] = wps[c.cp % WP];
          for (const b of A.teams[c.t]) if (!b.ghost) ctx.send(b.pid, { t: "radar", dots, ring: [nxm(wx), nym(wy), CP_R / (F.x1 - F.x0)] });
        }
        if (ck.t >= TIME) {
          const p = cars.map((c) => c.cp - Math.hypot(c.x - wps[c.cp % WP][0], c.y - wps[c.cp % WP][1]) / 5000);
          finish(p[0] === p[1] ? -1 : p[0] > p[1] ? 0 : 1);
        }
      },
      draw(g) {
        g.fillStyle = "#0b0912"; g.fillRect(0, 0, W, H);
        // only the headlights light the road
        g.save(); g.beginPath();
        for (const c of cars) { g.moveTo(c.x + LIGHT * 0.6, c.y); g.arc(c.x, c.y, LIGHT * 0.6, 0, Math.PI * 2); g.moveTo(c.x, c.y); g.arc(c.x, c.y, LIGHT * 1.9, c.ang - 0.45, c.ang + 0.45); g.closePath(); }
        g.clip();
        g.fillStyle = "#3a2a1a"; g.fillRect(0, 0, W, H); // mud
        g.lineCap = g.lineJoin = "round";
        g.strokeStyle = "#4a4a52"; g.lineWidth = ROAD * 2; g.beginPath(); wps.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
        g.strokeStyle = "#f9f002"; g.lineWidth = 5; g.setLineDash([30, 26]); g.stroke(); g.setLineDash([]);
        wps.forEach(([x, y], i) => { if (i === 0) for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? "#fff" : INK; g.fillRect(x - 60 + k * 15, y - 10, 15, 20); } });
        g.restore();
        for (const c of cars) {
          g.beginPath(); g.moveTo(c.x, c.y); g.arc(c.x, c.y, LIGHT * 1.9, c.ang - 0.45, c.ang + 0.45); g.closePath(); g.fillStyle = "rgba(255,245,190,.07)"; g.fill();
          g.save(); g.translate(c.x, c.y); g.rotate(c.ang);
          rrect(g, -38, -24, 76, 48, 14, TEAM[c.t].color, INK, 5);
          rrect(g, 6, -18, 22, 36, 6, "rgba(180,240,255,.8)", INK, 3);
          circle(g, 36, -14, 6, "#fff6b0"); circle(g, 36, 14, 6, "#fff6b0");
          g.restore();
          blob(g, c.pilot.p, c.x - 8, c.y, 16);
          if (c.mud) text(g, "MUD!", c.x, c.y + 50, 22, "#c8a064", "center", 900);
        }
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1) shout(g, p.word, p.x, p.y, 60, "#f9f002", p.t); }
        rrect(g, 0, 0, W, 140, 0, "rgba(2,1,4,.95)");
        for (const c of cars) {
          const x = c.t === 0 ? 380 : W - 380;
          text(g, `${TEAM[c.t].name.toUpperCase()} · ${c.pilot.ghost ? "BOT" : c.pilot.p.name}`, x, 46, 32, TEAM[c.t].color, "center", 900);
          for (let k = 0; k < totalCp; k++) circle(g, x - (totalCp - 1) * 14 + k * 28, 96, 10, k < c.cp - 1 ? TEAM[c.t].color : "rgba(255,255,255,.12)", INK, 2);
        }
        outlined(g, String(ck.left()), W / 2, 70, 70, "#fff");
        text(g, "NAVIGATORS: CHECK YOUR PHONES", W / 2, 124, 24, "#c8c8d0", "center", 900);
        ck.overlay(g, "DRIVE!");
      },
    };

    function finish(w) {
      endAt = ck.t + 1.6; ctx.sfx.win();
      inst.pending = A.teamResult(w, w < 0 ? "Neck and neck in the dark!" : cars[w].done ? `${TEAM[w].name} finds the finish line!` : `${TEAM[w].name} got further!`);
    }
    // bot pilots have the map in their head, but drive a little sloppily
    function botDrive(c) {
      const [wx, wy] = wps[c.cp % WP], [nx, ny] = wps[(c.cp + 1) % WP];
      const d = Math.hypot(wx - c.x, wy - c.y), k = Math.max(0, Math.min(1, 1 - d / 400)) * 0.5;
      const tx = wx + (nx - wx) * k, ty = wy + (ny - wy) * k;
      c.bot = c.bot || { wob: rnd(0, 6), skill: rnd(0.8, 0.95) };
      const a = Math.atan2(ty - c.y, tx - c.x) + Math.sin(ck.t * 1.7 + c.bot.wob) * 0.25;
      c.mx = Math.cos(a) * c.bot.skill; c.my = Math.sin(a) * c.bot.skill;
    }
    return inst;
  },
};
