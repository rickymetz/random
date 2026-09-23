// Whack-a-Blob — 1 vs rest. Twelve holes. Everyone else is a mole: tap a
// hole on your phone to pop up there and rake in gems while you're up, then
// DUCK before the hammer comes down. One player swings the hammer by tapping
// holes on their phone; it lands a beat later. A bonk stuns you and knocks
// gems loose. Moles win together if they bank enough gems in 45 s.

import { arena, clock, rnd, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";

const TIME = 45, COLS = 4, ROWS = 3, SWING = 0.42, SWING_COOL = 0.35, STUN = 2.5, GEM_EVERY = 0.5, LOSE = 4;

export default {
  id: "whack", title: "Whack-a-Blob", command: "WHACK!", kind: "1 vs rest", min: 2, max: 8,
  blurb: "Moles pop up for gems. The hammer tries to bonk them.",
  controls: "Moles: tap a hole to pop up, DUCK to hide. Hammer: tap holes to whack",

  create(ctx) {
    const hPid = ctx.pickOne();
    const A = arena(ctx, {});
    const ck = clock(ctx, TIME), pops = [];
    const hammer = A.of(hPid), moles = A.bodies.filter((b) => b !== hammer);
    const goal = moles.length * [42, 42, 44, 48, 54, 60, 62, 64][Math.min(7, moles.length)]; // gems per mole, tuned by bot play: crowds are harder to bonk
    const holes = Array.from({ length: COLS * ROWS }, (_, i) => ({ x: W / 2 + ((i % COLS) - (COLS - 1) / 2) * 380, y: 360 + Math.floor(i / COLS) * 250, gold: 0 }));
    const swings = [];
    let bank = 0, endAt = null, goldT = rnd(4, 7), hcool = 0;
    for (const m of moles) Object.assign(m, { hole: -1, up: 0, gems: 0, stun: 0, tick: 0 });

    const padsFor = (b) => holes.map((h, i) => ({ id: "h" + i, label: String(i + 1), color: b === hammer ? "#c9ced8" : "#f9f002" }));
    function relayout(b) {
      if (b.ghost) return;
      if (b === hammer) return ctx.layout(b.pid, { kind: "pads", pads: padsFor(b), cols: 4, multi: true, role: "🔨 THE HAMMER", hint: "Tap a hole to whack it. Watch the TV!" });
      ctx.layout(b.pid, { kind: "pads", pads: [...padsFor(b), { id: "duck", label: "DUCK", color: "#ff2a6d" }], cols: 4, multi: true, role: "Mole", hint: b.stun > 0 ? "Seeing stars…" : "Tap a hole to pop up there. DUCK before the hammer lands!" });
    }
    function popUp(b, i) {
      if (b.stun > 0 || !holes[i]) return;
      if (moles.some((m) => m !== b && m.hole === i)) return; // occupied
      b.hole = i; b.up = 0; ctx.sfx.pop();
    }
    function duck(b) { if (b.hole >= 0) { b.hole = -1; ctx.sfx.dot(); } }
    function whack(i) {
      if (hcool > 0 || ck.t < 0 || endAt != null) return;
      hcool = SWING_COOL; swings.push({ i, t: 0 }); ctx.sfx.whoosh();
    }

    const inst = {
      result: null,
      describe: () => [`${hammer.p.name} has the HAMMER`, `Moles need ${goal} gems together`],
      start() { for (const b of A.bodies) relayout(b); },
      input(pid, m) {
        const b = A.of(pid); if (!b || m.t !== "pad" || ck.t < 0 || endAt != null) return;
        if (b === hammer) { if (/^h\d+$/.test(m.id)) { whack(+m.id.slice(1)); relayout(b); } return; }
        if (m.id === "duck") duck(b); else if (/^h\d+$/.test(m.id)) popUp(b, +m.id.slice(1));
        relayout(b);
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || ck.t < 0 || endAt != null) return;
        b.bot.t = (b.bot.t ?? rnd(0.3, 1)) - dt;
        if (b === hammer) {
          // whack a hole that's up (reaction time), sometimes guess
          if (b.bot.t > 0) return;
          const up = moles.filter((m) => m.hole >= 0 && m.up > rnd(0.1, 0.35)).map((m) => m.hole);
          if (up.length) { whack(up[Math.floor(Math.random() * up.length)]); b.bot.t = rnd(0.35, 0.8); }
          else { if (Math.random() < 0.25) whack(Math.floor(rnd(0, holes.length))); b.bot.t = rnd(0.25, 0.6); } // the odd guess
          return;
        }
        if (b.stun > 0) return;
        // duck when a swing is coming at my hole (usually); pop back up elsewhere
        if (b.hole >= 0 && swings.some((s) => s.i === b.hole) && Math.random() < 5 * dt) { duck(b); b.bot.t = rnd(0.3, 0.9); return; }
        if (b.hole >= 0 && b.up > (b.bot.stay ??= rnd(1.2, 3.2))) { duck(b); b.bot.stay = null; b.bot.t = rnd(0.3, 1); return; }
        if (b.hole < 0 && b.bot.t <= 0) {
          const free = holes.map((_, i) => i).filter((i) => !moles.some((m) => m.hole === i) && !swings.some((s) => s.i === i));
          const gold = free.filter((i) => holes[i].gold > 0);
          const pick = gold.length && Math.random() < 0.6 ? gold[0] : free[Math.floor(Math.random() * free.length)];
          if (pick != null) popUp(b, pick);
        }
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        hcool -= dt;
        goldT -= dt;
        if (goldT <= 0) { holes[Math.floor(rnd(0, holes.length))].gold = 3; goldT = rnd(4, 7); }
        for (const h of holes) h.gold = Math.max(0, h.gold - dt);
        for (const m of moles) {
          if (m.stun > 0) { m.stun -= dt; if (m.stun <= 0) relayout(m); continue; }
          if (m.hole < 0) continue;
          m.up += dt; m.tick += dt;
          const h = holes[m.hole];
          if (m.tick >= GEM_EVERY) { m.tick = 0; const v = h.gold > 0 ? 3 : 1; m.gems += v; bank += v; if (!m.ghost) ctx.stat(m.pid, "gems", v); if (v > 1) ctx.sfx.power(); }
        }
        for (const s of swings) {
          s.t += dt;
          if (s.t >= SWING && !s.hit) {
            s.hit = true; ctx.shake(10); ctx.sfx.crunch();
            const m = moles.find((m) => m.hole === s.i);
            if (m) {
              const lost = Math.min(LOSE, m.gems); m.gems -= lost; bank -= lost;
              m.hole = -1; m.stun = STUN; ctx.sfx.hit(); ctx.shake(20);
              pops.push({ x: holes[s.i].x, y: holes[s.i].y - 120, t: 0, word: "BONK!" });
              if (!hammer.ghost) ctx.stat(hPid, "bonks", 1);
              if (!m.ghost) { ctx.buzz(m.pid, 300); relayout(m); }
            }
          }
        }
        for (let i = swings.length - 1; i >= 0; i--) if (swings[i].t > SWING + 0.3) swings.splice(i, 1);
        if (bank >= goal) return finish(false);
        if (ck.t >= TIME) return finish(true);
      },
      draw(g) {
        g.fillStyle = "#2a7a3a"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 90; i++) { g.fillStyle = i % 2 ? "#2f8a42" : "#256e34"; g.fillRect((i * 173) % W, 140 + ((i * 97) % (H - 140)), 30, 6); }
        holes.forEach((h, i) => {
          g.beginPath(); g.ellipse(h.x, h.y + 60, 120, 42, 0, 0, Math.PI * 2); g.fillStyle = "#5a3a1a"; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
          g.beginPath(); g.ellipse(h.x, h.y + 60, 96, 30, 0, 0, Math.PI * 2); g.fillStyle = "#140a04"; g.fill();
          if (h.gold > 0) { circle(g, h.x + 110, h.y - 10, 18 + Math.sin(ck.t * 10) * 3, "#ffd400", INK, 4); text(g, "×3", h.x + 110, h.y - 44, 24, "#ffd400", "center", 900); }
          text(g, String(i + 1), h.x - 130, h.y + 60, 30, "rgba(255,255,255,.7)", "center", 900);
          const m = moles.find((m) => m.hole === i);
          if (m) {
            const rise = Math.min(1, m.up * 8);
            g.save(); g.beginPath(); g.rect(h.x - 140, h.y - 200, 280, 262); g.clip();
            blob(g, m.p, h.x, h.y + 60 - rise * 70, 58);
            g.restore();
            tag(g, m.ghost ? "BOT" : m.p.name, h.x, h.y - 60 - rise * 20, m.p.color, 18);
            text(g, `◆ ${m.gems}`, h.x, h.y + 120, 24, "#ffd400", "center", 900);
          }
          const s = swings.find((s) => s.i === i);
          if (s) {
            const k = Math.min(1, s.t / SWING), ang = -1.2 + k * 1.3;
            g.save(); g.translate(h.x + 150, h.y + 40); g.rotate(ang);
            rrect(g, -8, -260, 16, 240, 6, "#8a5a2b", INK, 4);
            rrect(g, -80, -300, 110, 70, 12, "#c9ced8", INK, 6);
            g.restore();
            if (!s.hit) { g.beginPath(); g.ellipse(h.x, h.y + 60, 100 * k, 34 * k, 0, 0, Math.PI * 2); g.strokeStyle = "rgba(255,42,109,.8)"; g.lineWidth = 6; g.stroke(); }
          }
        });
        // stunned moles sit at the side seeing stars
        moles.filter((m) => m.stun > 0).forEach((m, i) => { blob(g, m.p, 90 + i * 70, H - 70, 26); text(g, "✶", 90 + i * 70, H - 110, 24, "#f9f002", "center", 900); });
        for (const p of pops) { p.t += 1 / 60; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 70, "#ff2a6d", p.t); }
        rrect(g, 0, 0, W, 130, 0, "rgba(13,2,33,.88)");
        text(g, "MOLE GEMS", 250, 42, 28, "#ffd400", "center", 900);
        rrect(g, 90, 66, 340, 34, 6, "#222"); rrect(g, 90, 66, 340 * Math.min(1, Math.max(0, bank / goal)), 34, 6, "#ffd400");
        text(g, `${Math.max(0, bank)} / ${goal}`, 250, 83, 24, INK, "center", 900);
        outlined(g, String(ck.left()), W / 2, 66, 70, "#fff");
        text(g, `🔨 ${hammer.ghost ? "BOT" : hammer.p.name}`, W - 330, 66, 40, "#c9ced8", "center", 900);
        ck.overlay(g, "WHACK!");
      },
    };

    function finish(hammerWins) {
      endAt = ck.t + 1.4; ctx.sfx.win();
      const mp = A.real(moles), top = [...moles].sort((a, b) => b.gems - a.gems)[0];
      const bonus = top && top.gems > 0 && !top.ghost ? { [top.pid]: 3 } : undefined; // top earner gets a tip
      inst.pending = hammerWins
        ? { winners: [hPid], losers: mp, bonus, headline: `${hammer.p.name} guards the gems!` }
        : { winners: mp, losers: [hPid], bonus, headline: `The moles bank ${bank} gems!` };
    }
    return inst;
  },
};
