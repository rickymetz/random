// Sling Siege — teams. Each team has a block fort guarding crowned kings
// (the other team's blobs). Teammates take turns: drag back on the phone,
// release to launch yourself over the hill. Pop every enemy king to win;
// after the shot limit, the team with more kings standing wins.

import { W, H, text, outlined, rrect, circle, blob, tag, shade, shuffle } from "../gfx.js";

const GROUND = 930, B = 48, COLS = 5, GRAV = 1000, BALL = 28, SHOTS = 5, TURN = 15;
const FORT = [ // columns, bottom-up: S stone (2 hits), W wood, K king
  "SWK", "SWSWW", "SKWWSK", "SWSWW", "SWW",
];
const HILL = { x: W / 2, w: 230, h: 230 };
const hillY = (x) => { const d = (x - HILL.x) / HILL.w; return Math.abs(d) < 1 ? GROUND - HILL.h * Math.sqrt(1 - d * d) : GROUND; };

function makeFort(mirror) {
  const cols = FORT.map((c) => c.split("").map((ch) => ({ type: ch, hp: ch === "S" ? 2 : 1, fall: 0, off: 0 })));
  return mirror ? cols.reverse() : cols;
}

export default {
  id: "sling", title: "Sling Siege", kind: "Teams", min: 2, max: 8,
  blurb: "Launch yourself at the enemy fort. Pop their kings!",
  controls: "Drag back on your phone, release to launch",

  create(ctx) {
    const shuffled = shuffle([...ctx.players]);
    const teams = [
      { name: "Left", color: "#ff5a5f", side: -1, x0: 110, sling: 470, players: [], fort: makeFort(false), shots: 0, turn: 0 },
      { name: "Right", color: "#3fa7ff", side: 1, x0: W - 110 - COLS * B, sling: W - 470, players: [], fort: makeFort(true), shots: 0, turn: 0 },
    ];
    shuffled.forEach((p, i) => teams[i % 2].players.push(p));
    const shotsPer = Math.max(SHOTS, Math.max(teams[0].players.length, teams[1].players.length) * 2);
    const kings = (tm) => tm.fort.flat().filter((c) => c.type === "K").length;
    const cellPos = (tm, ci, ri) => [tm.x0 + ci * B, GROUND - (ri + 1) * B];

    let t = -2, cur = 0, phase = "aim", aim = { x: 0.7, y: -0.7, p: 0 }, turnT = TURN, ball = null, settle = 0, endAt = null, debris = [];
    let botPlan = null;
    const shooter = () => { const tm = teams[cur]; return tm.players[tm.turn % tm.players.length]; };
    const launchPt = (tm) => [tm.sling, GROUND - 170];

    function announce() {
      const s = shooter();
      for (const tm of teams) for (const p of tm.players)
        ctx.layout(p.pid, p === s
          ? { kind: "sling", active: true, hint: "Your shot! Drag back, then let go.", role: tm.name + " team" }
          : { kind: "sling", active: false, hint: `${s.name} is aiming…`, role: tm.name + " team" });
      aim = { x: -teams[cur].side * 0.7, y: -0.7, p: 0 };
      turnT = TURN; phase = "aim"; botPlan = null;
      ctx.buzz(s.pid, 150);
    }

    function fire(v) {
      const tm = teams[cur], [x, y] = launchPt(tm), sp = 450 + 1150 * Math.min(1, Math.max(0.05, v.p));
      const len = Math.hypot(v.x, v.y) || 1;
      ball = { x, y, vx: (v.x / len) * sp, vy: (v.y / len) * sp, energy: 2 + Math.round(v.p * 2), p: shooter(), life: 0, bounced: false, trail: [] };
      tm.shots++; phase = "fly";
      ctx.sfx.launch();
      for (const t2 of teams) for (const p of t2.players) ctx.layout(p.pid, { kind: "sling", active: false, hint: "Wheee!", role: t2.name + " team" });
    }

    function hitCell(tm, ci, ri) {
      const col = tm.fort[ci], c = col[ri];
      if (c.type === "K") {
        col.splice(ri, 1); ctx.sfx.pop(); ctx.stat(ball.p.pid, "kings", 1);
        burst(...cellPos(tm, ci, ri), "#ffd23f");
        return true;
      }
      c.hp--;
      if (c.hp <= 0) { col.splice(ri, 1); ctx.stat(ball.p.pid, "blocks", 1); ctx.sfx.crunch(); burst(...cellPos(tm, ci, ri), c.type === "S" ? "#9aa3b5" : "#c98b4a"); return true; }
      ctx.sfx.crunch();
      return false;
    }

    function burst(x, y, color) {
      for (let i = 0; i < 10; i++) debris.push({ x: x + B / 2, y: y + B / 2, vx: (Math.random() - 0.5) * 600, vy: -Math.random() * 500, life: 1, color });
    }

    function simulate(v, tm) { // bot aiming: where does this shot land (ignoring blocks)?
      let [x, y] = launchPt(tm);
      const sp = 450 + 1150 * v.p, len = Math.hypot(v.x, v.y);
      let vx = (v.x / len) * sp, vy = (v.y / len) * sp;
      const pts = [];
      for (let i = 0; i < 400; i++) { vy += GRAV / 60; x += vx / 60; y += vy / 60; pts.push([x, y]); if (y > hillY(x)) break; }
      return pts;
    }
    function planBot() {
      const tm = teams[cur], enemy = teams[1 - cur], targets = [];
      enemy.fort.forEach((col, ci) => col.forEach((c, ri) => { if (c.type === "K") targets.push(cellPos(enemy, ci, ri).map((v) => v + B / 2)); }));
      if (!targets.length) enemy.fort.forEach((col, ci) => col.length && targets.push(cellPos(enemy, ci, col.length - 1).map((v) => v + B / 2)));
      const tgt = targets[Math.floor(Math.random() * targets.length)];
      let best = null, bestD = Infinity;
      for (let a = 0.15; a < 1.45; a += 0.05) for (let p = 0.3; p <= 1; p += 0.05) {
        const v = { x: -tm.side * Math.cos(a), y: -Math.sin(a), p };
        const d = Math.min(...simulate(v, tm).map(([x, y]) => Math.hypot(x - tgt[0], y - tgt[1])));
        if (d < bestD) { bestD = d; best = v; }
      }
      const err = 0.06;
      return { x: best.x + (Math.random() - 0.5) * err, y: best.y + (Math.random() - 0.5) * err, p: Math.min(1, best.p + (Math.random() - 0.5) * err), at: TURN - 1.6 - Math.random() };
    }

    const inst = {
      result: null,
      describe: () => teams.map((tm) => `${tm.name}: ${tm.players.map((p) => p.name).join(", ")}`),
      start() { announce(); },
      input(pid, m) {
        if (phase !== "aim" || t < 0 || shooter().pid !== pid) return;
        if (m.t === "aim" || m.t === "fire") aim = { x: +m.x || 0, y: +m.y || 0, p: Math.min(1, Math.max(0, +m.p || 0)) };
        if (m.t === "fire" && aim.p > 0.08) fire(aim);
      },
      bot(pid) {
        if (phase !== "aim" || t < 0 || shooter().pid !== pid) return;
        botPlan = botPlan || planBot();
        const k = Math.min(1, (TURN - turnT) / 1.4);
        aim = { x: botPlan.x, y: botPlan.y, p: botPlan.p * k };
        if (turnT <= botPlan.at) fire(botPlan);
      },
      update(dt) {
        t += dt;
        for (const d of debris) { d.vy += GRAV * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
        debris = debris.filter((d) => d.life > 0);
        for (const tm of teams) for (const col of tm.fort) for (const c of col) if (c.off > 0) c.off = Math.max(0, c.off - dt * 8);
        if (t < 0 || inst.result) return;
        if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        if (phase === "aim") {
          turnT -= dt;
          if (turnT <= 0) fire(aim.p > 0.08 ? aim : { x: -teams[cur].side, y: -1, p: 0.6 });
        } else if (phase === "fly") {
          const b = ball;
          b.life += dt;
          const sub = 4;
          for (let s = 0; s < sub && ball; s++) {
            b.vy += (GRAV * dt) / sub; b.x += (b.vx * dt) / sub; b.y += (b.vy * dt) / sub;
            for (const tm of teams) tm.fort.forEach((col, ci) => {
              for (let ri = col.length - 1; ri >= 0; ri--) {
                const [cx, cy] = cellPos(tm, ci, ri);
                if (b.x + BALL > cx && b.x - BALL < cx + B && b.y + BALL > cy && b.y - BALL < cy + B) {
                  const broke = hitCell(tm, ci, ri);
                  // everything above a broken cell drops a row; kings that fall 2+ rows pop
                  for (let k = ri; k < col.length && broke; k++) { col[k].off += 1; if (col[k].type === "K") col[k].fall = (col[k].fall || 0) + 1; }
                  b.energy--; b.vx *= 0.55; b.vy *= 0.55;
                  if (!broke || b.energy <= 0) { b.vx *= -0.3; b.energy = Math.min(b.energy, 0); }
                  return;
                }
              }
            });
            if (b.y + BALL > hillY(b.x)) {
              if (b.bounced || Math.abs(b.vy) < 200) { ball = null; break; }
              b.bounced = true; b.y = hillY(b.x) - BALL; b.vy *= -0.35; b.vx *= 0.6; ctx.sfx.crunch();
            }
            if (b.x < -200 || b.x > W + 200 || b.life > 7 || (b.energy <= 0 && Math.hypot(b.vx, b.vy) < 120)) { ball = null; break; }
          }
          if (b && ball) { b.trail.push([b.x, b.y]); if (b.trail.length > 30) b.trail.shift(); }
          if (!ball) {
            for (const tm of teams) for (const col of tm.fort) for (let ri = col.length - 1; ri >= 0; ri--) if (col[ri].type === "K" && col[ri].fall >= 2) {
              col.splice(ri, 1); ctx.sfx.pop(); burst(...cellPos(tm, tm.fort.indexOf(col), ri), "#ffd23f");
            }
            for (const tm of teams) for (const col of tm.fort) for (const c of col) c.fall = 0;
            phase = "settle"; settle = 0.9;
          }
        } else if (phase === "settle") {
          settle -= dt;
          if (settle > 0) return;
          const k = teams.map(kings);
          const out = k.findIndex((n) => n === 0);
          if (out >= 0 || teams.every((tm) => tm.shots >= shotsPer)) {
            const w = out >= 0 ? 1 - out : k[0] === k[1] ? -1 : k[0] > k[1] ? 0 : 1;
            endAt = t + 1;
            if (w < 0) inst.pending = { tie: true, ranking: [ctx.players.map((p) => p.pid)], headline: "A royal stalemate!" };
            else inst.pending = { winners: teams[w].players.map((p) => p.pid), losers: teams[1 - w].players.map((p) => p.pid), headline: `${teams[w].name} team storms the castle!` };
            ctx.sfx.win();
            return;
          }
          teams[cur].turn++;
          cur = 1 - cur;
          if (teams[cur].shots >= shotsPer) cur = 1 - cur;
          announce();
        }
      },
      draw(g) {
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, "#ffb07a"); sky.addColorStop(1, "#ffe7c2");
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        circle(g, W / 2, 240, 110, "rgba(255,255,255,.55)");
        g.beginPath(); g.moveTo(0, GROUND);
        for (let x = 0; x <= W; x += 10) g.lineTo(x, hillY(x));
        g.lineTo(W, H); g.lineTo(0, H); g.closePath();
        g.fillStyle = "#6cc26a"; g.fill(); g.lineWidth = 8; g.strokeStyle = "#3f8f47"; g.stroke();
        for (const [ti, tm] of teams.entries()) {
          const enemy = teams[1 - ti];
          let kingIdx = 0;
          tm.fort.forEach((col, ci) => col.forEach((c, ri) => {
            const [x, y0] = cellPos(tm, ci, ri), y = y0 - c.off * B;
            if (c.type === "K") {
              const who = enemy.players[kingIdx++ % enemy.players.length] || tm.players[0];
              blob(g, who, x + B / 2, y + B / 2 + 2, B * 0.48, { crown: true });
            } else {
              const col2 = c.type === "S" ? (c.hp > 1 ? "#9aa3b5" : "#747c8e") : "#c98b4a";
              rrect(g, x + 2, y + 2, B - 4, B - 4, 8, col2, shade(c.type === "S" ? "#9aa3b5" : "#c98b4a", -0.45), 4);
            }
          }));
          const [sx, sy] = launchPt(tm);
          g.lineWidth = 16; g.strokeStyle = "#7a4a22"; g.lineCap = "round";
          g.beginPath(); g.moveTo(sx, GROUND); g.lineTo(sx, sy + 60); g.lineTo(sx - 36, sy); g.moveTo(sx, sy + 60); g.lineTo(sx + 36, sy); g.stroke();
          rrect(g, tm.side < 0 ? 40 : W - 520, 20, 480, 100, 24, "rgba(10,12,30,.6)", tm.color, 5);
          const hx = tm.side < 0 ? 280 : W - 280;
          text(g, `${tm.name} team`, hx, 50, 30, tm.color);
          text(g, `Kings ${kings(tm)}   Shots ${shotsPer - tm.shots}`, hx, 92, 30);
        }
        if (phase === "aim" && t >= 0) {
          const tm = teams[cur], [sx, sy] = launchPt(tm), s = shooter();
          const pull = 110 * aim.p, len = Math.hypot(aim.x, aim.y) || 1;
          const bx = sx - (aim.x / len) * pull, by = sy - (aim.y / len) * pull;
          g.lineWidth = 8; g.strokeStyle = "#5a2d0c";
          g.beginPath(); g.moveTo(sx - 36, sy); g.lineTo(bx, by); g.lineTo(sx + 36, sy); g.stroke();
          blob(g, s, bx, by, BALL, { sx: 1 + aim.p * 0.2, sy: 1 - aim.p * 0.15 });
          if (aim.p > 0.05) {
            const pts = simulate(aim, tm).slice(0, 22);
            pts.forEach(([x, y], i) => i % 3 === 0 && circle(g, x, y, 7 - i / 5, "rgba(255,255,255,.85)"));
          }
          tag(g, `${s.name}'s shot  ·  ${Math.ceil(turnT)}s`, sx, sy - 110, tm.color, 28);
        }
        if (ball) {
          ball.trail.forEach(([x, y], i) => circle(g, x, y, 4 + i / 6, "rgba(255,255,255,.4)"));
          const sp = Math.hypot(ball.vx, ball.vy), s = Math.min(0.3, sp / 4000);
          blob(g, ball.p, ball.x, Math.max(ball.y, 40), BALL, { rot: Math.atan2(ball.vy, ball.vx), sx: 1 + s, sy: 1 - s });
          if (ball.y < 0) outlined(g, "▲", ball.x, 30, 40, ball.p.color);
        }
        for (const d of debris) { g.globalAlpha = Math.max(0, d.life); g.fillStyle = d.color; g.fillRect(d.x - 7, d.y - 7, 14, 14); }
        g.globalAlpha = 1;
        if (t < 0) outlined(g, "Siege!", W / 2, H / 2 - 120, 130, "#ffd23f");
      },
    };
    return inst;
  },
};
