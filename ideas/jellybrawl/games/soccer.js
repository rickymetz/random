// Blob Soccer — teams (2v2, 3v3, 4v4). Top-down arena soccer: push the ball
// with your body or KICK it. First to 3, or the most goals in 90 s; a draw
// goes to golden-goal overtime.

import { arena, clock, TEAM, rnd, W, H, INK, text, outlined, shout, rrect, circle } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 90, OT = 45, WIN = 3, GOAL_TOP = 395, GOAL_BOT = 795, BALL_R = 24, KICK = 1150;

export default {
  id: "soccer", title: "Blob Soccer", command: "KICK OFF!", kind: "Teams", min: 2, max: 8,
  blurb: "Two teams, one ball. First to 3 goals wins.",
  controls: "Stick to run, KICK near the ball",

  create(ctx) {
    const A = arena(ctx, { R: 30, speed: 270, teams: true, bounds: { x0: 190, y0: 170, x1: W - 190, y1: H - 60 }, bounce: 0.6, dash: { mul: 1.8, time: 0.2, cool: 1.8 } });
    const F = A.bounds, midY = (F.y0 + F.y1) / 2;
    const ball = { x: W / 2, y: midY, vx: 0, vy: 0, r: BALL_R, mass: 0.6, ball: true };
    const score = [0, 0], ck = clock(ctx, TIME);
    let pause = 0, flash = null, endAt = null, lastTouch = null, overtime = false;

    function kickoff() {
      ball.x = W / 2; ball.y = midY + rnd(-60, 60); ball.vx = ball.vy = 0;
      for (const t of [0, 1]) A.teams[t].forEach((b, i, arr) => {
        b.x = t === 0 ? W / 2 - 260 - (i % 2) * 220 : W / 2 + 260 + (i % 2) * 220;
        b.y = midY + (i - (arr.length - 1) / 2) * 150; b.vx = b.vy = 0;
      });
      pause = 1;
    }
    kickoff();

    function kick(b) {
      const dx = ball.x - b.x, dy = ball.y - b.y, d = Math.hypot(dx, dy);
      if (d > A.R + BALL_R + 26) { A.tryDash(b); return; }
      ball.vx = (dx / d) * KICK; ball.vy = (dy / d) * KICK; lastTouch = b;
      ctx.sfx.pop(); ctx.shake(6);
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { A.layoutAll("KICK", "Push the ball into their goal. KICK when you're touching it!"); },
      input(pid, m) { if (A.input(pid, m) === "action" && ck.t >= 0 && pause <= 0) kick(A.of(pid)); },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        if (pause > 0) { pause -= dt; return; }
        const { hits } = A.step(dt, [ball]);
        for (const h of hits) if (h.a === ball || h.b === ball) lastTouch = h.a === ball ? h.b : h.a;
        ball.vx *= Math.exp(-0.8 * dt); ball.vy *= Math.exp(-0.8 * dt);
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.y < F.y0 + BALL_R) { ball.y = F.y0 + BALL_R; ball.vy = Math.abs(ball.vy) * 0.8; }
        if (ball.y > F.y1 - BALL_R) { ball.y = F.y1 - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.8; }
        const inMouth = ball.y > GOAL_TOP && ball.y < GOAL_BOT;
        for (const [side, lim] of [[0, F.x0], [1, F.x1]]) {
          const past = side === 0 ? ball.x < lim : ball.x > lim;
          if (past && inMouth) {
            const scorer = 1 - side; score[scorer]++;
            if (lastTouch && !lastTouch.ghost && lastTouch.team === scorer) ctx.stat(lastTouch.pid, "goals", 1);
            flash = { team: scorer, t: 0 }; ctx.sfx.win(); ctx.shake(24);
            if (score[scorer] >= WIN || overtime) { finish(); return; }
            kickoff(); return;
          }
          if ((side === 0 ? ball.x < lim + BALL_R : ball.x > lim - BALL_R) && !inMouth) { ball.x = side === 0 ? lim + BALL_R : lim - BALL_R; ball.vx = -ball.vx * 0.8; }
        }
        if (ck.t >= TIME && !overtime && score[0] === score[1]) { overtime = true; flash = { team: -1, t: 0 }; ctx.sfx.slam(); ctx.shake(18); ctx.music?.countdown(1); kickoff(); return; }
        if (ck.t >= (overtime ? TIME + OT : TIME)) finish();
      },
      draw(g) {
        g.fillStyle = "#0b2a1a"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? "#12402a" : "#0f3a25"; g.fillRect(F.x0 + ((F.x1 - F.x0) / 12) * i, F.y0, (F.x1 - F.x0) / 12 + 1, F.y1 - F.y0); }
        g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 6;
        g.strokeRect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
        g.beginPath(); g.moveTo(W / 2, F.y0); g.lineTo(W / 2, F.y1); g.stroke();
        g.beginPath(); g.arc(W / 2, midY, 120, 0, Math.PI * 2); g.stroke();
        for (const [side, x] of [[0, F.x0], [1, F.x1]]) {
          const d = side === 0 ? -1 : 1;
          g.fillStyle = TEAM[side].color + "55"; g.fillRect(side === 0 ? x - 60 : x, GOAL_TOP, 60, GOAL_BOT - GOAL_TOP);
          g.strokeStyle = TEAM[side].color; g.lineWidth = 10; g.strokeRect(side === 0 ? x - 60 : x, GOAL_TOP, 60, GOAL_BOT - GOAL_TOP);
          g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 6; g.strokeRect(side === 0 ? x : x - 180, GOAL_TOP - 90, 180, GOAL_BOT - GOAL_TOP + 180);
          void d;
        }
        const items = [...A.live().map((b) => [b.y, () => A.drawBody(g, b)]), [ball.y, () => {
          g.beginPath(); g.ellipse(ball.x, ball.y + 20, 22, 8, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.4)"; g.fill();
          circle(g, ball.x, ball.y, BALL_R, "#fff", INK, 5);
          const a = (ball.x + ball.y) / 30;
          for (let k = 0; k < 3; k++) circle(g, ball.x + Math.cos(a + k * 2.1) * 11, ball.y + Math.sin(a + k * 2.1) * 11, 6, INK);
        }]];
        items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
        rrect(g, W / 2 - 330, 20, 660, 110, 12, "rgba(13,2,33,.85)", "#fff", 4);
        outlined(g, String(score[0]), W / 2 - 200, 76, 80, TEAM[0].color);
        outlined(g, String(score[1]), W / 2 + 200, 76, 80, TEAM[1].color);
        if (overtime) text(g, "GOLDEN GOAL", W / 2, 76, 40, "#f9f002", "center", 900);
        else text(g, `${Math.floor(ck.left() / 60)}:${String(ck.left() % 60).padStart(2, "0")}`, W / 2, 76, 44, "#fff", "center", 900);
        if (flash && (flash.t += FX.dt) < 1.2) shout(g, flash.team < 0 ? "GOLDEN GOAL!" : "GOOOAL!", W / 2, H / 2, flash.team < 0 ? 150 : 200, flash.team < 0 ? "#f9f002" : TEAM[flash.team].color, flash.t);
        ck.overlay(g, "KICK OFF!");
      },
    };

    function finish() {
      endAt = ck.t + 1.4;
      const w = score[0] === score[1] ? -1 : score[0] > score[1] ? 0 : 1;
      inst.pending = A.teamResult(w, w < 0 ? `A ${score[0]}–${score[1]} draw!` : `${TEAM[w].name} wins ${Math.max(...score)}–${Math.min(...score)}!`);
    }

    // bot: the team's nearest-to-ball player attacks (gets behind the ball and
    // drives it at the goal); the rest hold a defensive spot between ball and goal
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || pause > 0) { if (b) b.mx = b.my = 0; return; }
      const myGoalX = b.team === 0 ? F.x0 : F.x1, theirGoalX = b.team === 0 ? F.x1 : F.x0;
      const mates = A.teams[b.team], attacker = [...mates].sort((a, c) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(c.x - ball.x, c.y - ball.y))[0];
      if (attacker === b) {
        // aim line: from the ball to their goal; get behind it (circling round
        // if we're on the wrong side), then kick along the line
        // each bot picks a spot in the goal mouth and changes its mind now
        // and then, so head-on shoving matches don't deadlock
        if (!(b.aimT > 0)) { b.aimY = midY + rnd(-1, 1) * (GOAL_BOT - GOAL_TOP) * 0.4; b.aimT = rnd(1.5, 3); }
        b.aimT -= dt;
        const ux0 = theirGoalX - ball.x, uy0 = b.aimY - ball.y, ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul;
        const rx = b.x - ball.x, ry = b.y - ball.y, along = rx * ux + ry * uy;
        if (along > -20) {
          const side = rx * -uy + ry * ux >= 0 ? 1 : -1; // go round on whichever side we're on
          A.steer(b, ball.x - ux * 70 + -uy * side * 95, ball.y - uy * 70 + ux * side * 95);
        } else {
          const d = A.steer(b, ball.x - ux * 45, ball.y - uy * 45);
          if (d < 40) { b.mx = ux; b.my = uy; }
          if (Math.hypot(rx, ry) < A.R + BALL_R + 24 && Math.random() < 9 * dt) kick(b);
        }
      } else {
        // one keeper (the teammate nearest our goal); everyone else pushes up
        const rest = mates.filter((m) => m !== attacker).sort((a, c) => Math.abs(a.x - myGoalX) - Math.abs(c.x - myGoalX));
        const dir = b.team === 0 ? 1 : -1, k = rest.indexOf(b);
        if (k === 0) A.steer(b, myGoalX + dir * 110, midY + (ball.y - midY) * 0.4);
        else A.steer(b, Math.max(F.x0 + 80, Math.min(F.x1 - 80, ball.x + dir * 220)), k % 2 ? F.y0 + 170 : F.y1 - 170);
      }
    }
    return inst;
  },
};
