// Relay Race — teams (2v2, 3v3, 4v4). Two lanes, one runner per team at a
// time. JUMP the hurdles (clipping one trips you), skirt the goo (it slows
// you), dodge the sweeping bumpers. Reach the flag and the baton passes to
// the next teammate. First team through four legs wins.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob } from "./arena.js";

const LEGS = 4, X0 = 170, X1 = W - 150, LANE_H = 370, JUMP_T = 0.55, TRIP = 0.8, TIME = 90;

export default {
  id: "relay", title: "Relay Race", command: "RUN!", kind: "Teams", min: 2, max: 8,
  blurb: "Take turns running the obstacle lane. Pass the baton, beat the other team.",
  controls: "Stick to run, JUMP over hurdles",

  create(ctx) {
    const A = arena(ctx, { R: 28, speed: 330, accel: 7, teams: true });
    const ck = clock(ctx, TIME), pops = [], laneY = [170, 170 + LANE_H + 60];
    const legs = [0, 0], order = A.teams.map((tm) => tm.slice());
    let endAt = null;
    // one course, mirrored in both lanes so it's fair: hurdles across the
    // lane, goo puddles, and bumpers that sweep up and down
    const course = [];
    for (let x = X0 + 260; x < X1 - 160; x += rnd(230, 330)) {
      const k = Math.random();
      if (k < 0.5) course.push({ kind: "hurdle", x });
      else if (k < 0.75) course.push({ kind: "goo", x, y: rnd(0.25, 0.75), r: rnd(70, 95) });
      else course.push({ kind: "bumper", x, ph: rnd(0, 6.28), sp: rnd(1.4, 2.2) });
    }
    const runner = (t) => order[t][legs[t] % order[t].length];
    function place(t) {
      const b = runner(t);
      b.x = X0; b.y = laneY[t] + LANE_H / 2; b.vx = b.vy = 0; b.z = 0; b.jump = 0; b.trip = 0; b.passed = new Set();
      for (const o of A.teams[t]) if (!o.ghost) ctx.layout(o.pid, o === b
        ? { kind: "stick", radar: false, action: "JUMP", role: `${TEAM[t].name} · leg ${legs[t] + 1}/${LEGS}`, hint: "RUN! Jump the hurdles, avoid the goo." }
        : { kind: "wait", text: legs[t] >= LEGS ? "DONE!" : "CHEER!", sub: legs[t] >= LEGS ? "Your team finished." : `${b.ghost ? "The bot" : b.p.name} has the baton.`, role: `${TEAM[t].name} team` });
    }
    const active = () => [0, 1].filter((t) => legs[t] < LEGS).map(runner);

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { place(0); place(1); },
      input(pid, m) {
        const b = A.of(pid); if (!b || !active().includes(b)) return;
        if (A.input(pid, m) === "action" && ck.t >= 0 && b.jump <= 0 && b.trip <= 0) { b.jump = JUMP_T; ctx.sfx.flap(); }
      },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        for (const t of [0, 1]) {
          if (legs[t] >= LEGS) continue;
          const b = runner(t), y0 = laneY[t] + A.R, y1 = laneY[t] + LANE_H - A.R;
          b.jump = Math.max(0, b.jump - dt); b.trip = Math.max(0, b.trip - dt);
          b.z = b.jump > 0 ? Math.sin((1 - b.jump / JUMP_T) * Math.PI) * 60 : 0;
          let slow = 1;
          for (const o of course) if (o.kind === "goo" && b.z < 5 && Math.hypot(b.x - o.x, b.y - (laneY[t] + o.y * LANE_H)) < o.r) slow = 0.4;
          const sp = 330 * slow * (b.trip > 0 ? 0 : 1);
          const k = Math.min(1, 7 * dt);
          b.vx += (b.mx * sp - b.vx) * k; b.vy += (b.my * sp - b.vy) * k;
          b.x = Math.max(X0 - 40, b.x + b.vx * dt); b.y = Math.max(y0, Math.min(y1, b.y + b.vy * dt));
          for (const o of course) {
            if (o.kind === "hurdle" && !b.passed.has(o) && b.x > o.x - 8 && b.x < o.x + 8) {
              b.passed.add(o);
              if (b.z < 22) { b.trip = TRIP; b.vx = -120; ctx.sfx.crunch(); ctx.shake(8); pops.push({ x: b.x, y: b.y - 60, t: 0, word: "TRIP!" }); if (!b.ghost) ctx.buzz(b.pid, 200); }
            }
            if (o.kind === "hurdle" && b.x < o.x - 8) b.passed.delete(o); // went back: jump it again
            if (o.kind === "bumper") {
              const by = laneY[t] + LANE_H / 2 + Math.sin(ck.t * o.sp + o.ph) * (LANE_H / 2 - 50), d = Math.hypot(b.x - o.x, b.y - by);
              if (d < A.R + 34 && b.z < 30) { b.vx = ((b.x - o.x) / d) * 700 - 200; b.vy = ((b.y - by) / d) * 700; ctx.sfx.hit(); ctx.shake(6); }
            }
          }
          if (b.x >= X1) {
            legs[t]++; ctx.sfx.power(); ctx.shake(6);
            if (!b.ghost) ctx.stat(b.pid, "legs", 1);
            pops.push({ x: X1 - 60, y: laneY[t] + 60, t: 0, word: legs[t] >= LEGS ? "FINISH!" : "TAG!" });
            if (legs[t] >= LEGS) { finish(t); return; }
            place(t);
          }
        }
        if (ck.t >= TIME) {
          const prog = [0, 1].map((t) => legs[t] + (legs[t] < LEGS ? (runner(t).x - X0) / (X1 - X0) : 0));
          finish(prog[0] === prog[1] ? -1 : prog[0] > prog[1] ? 0 : 1);
        }
      },
      draw(g) {
        g.fillStyle = "#101826"; g.fillRect(0, 0, W, H);
        for (const t of [0, 1]) {
          const y = laneY[t];
          rrect(g, 60, y, W - 120, LANE_H, 16, "#b0452a", INK, 6); // running track
          g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 3;
          for (const k of [1, 2]) { g.beginPath(); g.moveTo(80, y + (LANE_H / 3) * k); g.lineTo(W - 80, y + (LANE_H / 3) * k); g.stroke(); }
          g.fillStyle = TEAM[t].color; g.fillRect(X0 - 6, y + 10, 12, LANE_H - 20);
          // chequered finish
          for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? "#fff" : INK; g.fillRect(X1 + j * 16, y + 8 + i * ((LANE_H - 16) / 12), 16, (LANE_H - 16) / 12); }
          text(g, `${TEAM[t].name.toUpperCase()} · LEG ${Math.min(LEGS, legs[t] + 1)}/${LEGS}`, 80, y - 22, 30, TEAM[t].color, "left", 900);
          // baton-pass progress pips
          for (let k = 0; k < LEGS; k++) circle(g, W - 300 + k * 44, y - 22, 14, k < legs[t] ? TEAM[t].color : "rgba(255,255,255,.15)", INK, 3);
          for (const o of course) {
            if (o.kind === "goo") { g.beginPath(); g.ellipse(o.x, y + o.y * LANE_H, o.r, o.r * 0.7, 0, 0, Math.PI * 2); g.fillStyle = "#39ff14aa"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#1a6a0a"; g.stroke(); }
            if (o.kind === "hurdle") { g.fillStyle = "#fff"; g.fillRect(o.x - 6, y + 14, 12, LANE_H - 28); for (let s = 0; s < 6; s++) { g.fillStyle = s % 2 ? "#ff2a6d" : "#fff"; g.fillRect(o.x - 6, y + 14 + s * ((LANE_H - 28) / 6), 12, (LANE_H - 28) / 6); } g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(o.x - 6, y + 14, 12, LANE_H - 28); }
            if (o.kind === "bumper") { const by = y + LANE_H / 2 + Math.sin(ck.t * o.sp + o.ph) * (LANE_H / 2 - 50); g.strokeStyle = "rgba(255,255,255,.2)"; g.lineWidth = 4; g.beginPath(); g.moveTo(o.x, y + 30); g.lineTo(o.x, y + LANE_H - 30); g.stroke(); circle(g, o.x, by, 34, "#8a5cff", INK, 5); circle(g, o.x, by, 16, "#f9f002"); }
          }
          // waiting teammates in the pen at the start
          A.teams[t].forEach((b, i) => { if (legs[t] < LEGS && b === runner(t)) return; blob(g, b.p, 105, y + 50 + i * 64, 20); });
          if (legs[t] < LEGS) {
            const b = runner(t);
            g.beginPath(); g.ellipse(b.x, b.y + A.R * 0.85, A.R * (1 - b.z / 150), A.R * 0.3, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.35)"; g.fill();
            A.drawBody(g, Object.assign({}, b, { y: b.y - b.z }), { alpha: b.trip > 0 && Math.floor(ck.t * 12) % 2 ? 0.5 : 1 });
            rrect(g, b.x + 16, b.y - b.z - 10, 26, 10, 3, "#f9f002", INK, 2); // the baton
          }
        }
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 48, "#f9f002", p.t); }
        outlined(g, String(ck.left()), W / 2, 90, 60, "#fff");
        ck.overlay(g, "RUN!");
      },
    };

    function finish(w) {
      endAt = ck.t + 1.4; ctx.sfx.win();
      inst.pending = A.teamResult(w, w < 0 ? "A photo finish! Dead heat." : legs[w] >= LEGS ? `${TEAM[w].name} crosses the line first!` : `${TEAM[w].name} was further along!`);
    }

    // bots run right, jump a little before each hurdle (usually), drift
    // round goo and away from the bumpers
    function botPlay(b, dt) {
      if (!b || ck.t < 0) return;
      const t = b.team;
      if (legs[t] >= LEGS || runner(t) !== b) { b.mx = b.my = 0; return; }
      const y0 = laneY[t], ahead = course.filter((o) => o.x > b.x - 10 && o.x < b.x + 260);
      let ty = y0 + LANE_H / 2;
      for (const o of ahead) {
        if (o.kind === "goo") { const gy = y0 + o.y * LANE_H; ty = gy > y0 + LANE_H / 2 ? gy - o.r - 50 : gy + o.r + 50; }
        if (o.kind === "bumper" && o.x - b.x < 160) { const by = y0 + LANE_H / 2 + Math.sin(ck.t * o.sp + o.ph) * (LANE_H / 2 - 50); ty = by > y0 + LANE_H / 2 ? y0 + 50 : y0 + LANE_H - 50; }
        if (o.kind === "hurdle" && b.jump <= 0 && b.trip <= 0) {
          const d = o.x - b.x;
          b.bot.jumpAt ??= rnd(50, 110);
          if (d > 0 && d < b.bot.jumpAt && b.bot.decided !== o) { // one go per hurdle; now and then a bot fluffs it
            b.bot.decided = o; b.bot.jumpAt = null;
            if (Math.random() < 0.88) { b.jump = JUMP_T; ctx.sfx.flap(); }
          }
        }
      }
      const dy = ty - b.y;
      b.mx = 1; b.my = Math.max(-1, Math.min(1, dy / 80));
      const l = Math.hypot(b.mx, b.my); b.mx /= l; b.my /= l;
    }
    return inst;
  },
};
