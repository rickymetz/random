// Greed Doors — free-for-all, secret choices. Three doors, each showing a
// prize; one of them secretly hides a bomb. Everyone picks a door on their
// phone at the same time. A safe door's prize is split between everyone who
// picked it (alone = all of it), and the bomb door costs you half your gems.
// The big prize is tempting... which is why everyone goes for it. Five rounds.

import { arena, clock, rnd, shuffle, W, H, INK, text, outlined, shout, rrect, circle, blob, tag, musicCues } from "./arena.js";
import { FX, fade } from "../gfx.js";

const ROUNDS = 5, PICK_T = 9, SHOW_T = 3.4, DOOR_COLORS = ["#ff2a6d", "#05d9e8", "#f9f002"];

export default {
  id: "greed", title: "Greed Doors", command: "PICK A DOOR!", kind: "Free-for-all", min: 2, max: 8,
  blurb: "Pick a door in secret. Share the prize with whoever else picked it. One door is a bomb.",
  controls: "Tap a door on your phone",

  create(ctx) {
    const cues = musicCues(ctx);
    const A = arena(ctx, {});
    const n = A.bodies.length, pops = [];
    let round = 0, phase = "pick", t = -2, doors = [], endAt = null, bombAt = -1;
    for (const b of A.bodies) { b.gems = 0; b.door = null; b.gain = 0; }

    function deal() {
      if (round === ROUNDS - 1) ctx.music?.hot(); // the last round
      const prizes = shuffle([rnd(4, 7), rnd(8, 12), rnd(14, 20)].map(Math.round));
      bombAt = Math.floor(rnd(0, 3));
      doors = prizes.map((prize, i) => ({ prize, i }));
      phase = "pick"; t = round === 0 ? -2 : 0; // a beat to read the title first
      for (const b of A.bodies) { b.door = null; b.gain = 0; }
      for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "pads", text: `ROUND ${round + 1}/${ROUNDS}`, cols: 3, hint: "Pick a door. The prize is split between everyone who picks it. One is a bomb!",
        pads: doors.map((d) => ({ id: String(d.i), label: `${d.i + 1}·${d.prize}`, color: DOOR_COLORS[d.i] })) });
    }
    function reveal() {
      phase = "show"; t = 0;
      for (const b of A.bodies) if (b.door == null) b.door = Math.floor(rnd(0, 3)); // too slow: a door is picked for you
      doors.forEach((d) => {
        const on = A.bodies.filter((b) => b.door === d.i);
        if (d.i === bombAt) { for (const b of on) { b.gain = -Math.ceil(b.gems / 2); b.gems += b.gain; if (!b.ghost) ctx.buzz(b.pid, 400); } }
        else if (on.length) { const each = Math.floor(d.prize / on.length); for (const b of on) { b.gain = each; b.gems += each; if (!b.ghost) ctx.stat(b.pid, "gems", each); } }
      });
      ctx.sfx.slam(); ctx.shake(10);
      if (A.bodies.some((b) => b.door === bombAt)) { ctx.sfx.hit(); ctx.shake(22); pops.push({ x: doorX(bombAt), y: 330, t: 0, word: "KABOOM!" }); }
      for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: b.gain > 0 ? `+${b.gain}` : b.gain < 0 ? `BOOM ${b.gain}` : "+0", sub: `${b.gems} gems banked` });
    }
    const doorX = (i) => W / 2 + (i - 1) * 520;

    const inst = {
      result: null,
      describe: () => [`${ROUNDS} rounds · three doors`, "Alone on a door = the whole prize. One door is a bomb."],
      start() { deal(); },
      input(pid, m) {
        const b = A.of(pid);
        if (!b || m.t !== "pad" || phase !== "pick" || t < 0 || b.door != null) return;
        const i = +m.id; if (!(i >= 0 && i < 3)) return;
        b.door = i; ctx.sfx.dot(b);
        ctx.layout(pid, { kind: "wait", text: `DOOR ${i + 1}`, sub: "Locked in. No take-backs!" });
        if (A.bodies.every((o) => o.door != null)) t = Math.max(t, PICK_T - 1); // everyone's in: reveal a beat later
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || phase !== "pick" || t < 0 || b.door != null) return;
        b.bot.at ??= rnd(1.5, 6);
        if (t < b.bot.at) return;
        b.bot.at = null;
        // expect the big prize to be crowded; a bit greedy, a bit contrarian
        const w = doors.map((d) => d.prize / (1 + (n - 1) * (d.prize / 40)) * rnd(0.6, 1.4));
        b.door = w.indexOf(Math.max(...w));
      },
      update(dt) {
        if (inst.result) return;
        cues(t, 0); // the music: build over the countdown, drop on GO
        t += dt;
        if (endAt != null) { if (t >= endAt) inst.result = inst.pending; return; }
        if (phase === "pick" && t >= PICK_T) reveal();
        else if (phase === "show" && t >= SHOW_T) {
          round++;
          if (round >= ROUNDS) {
            const by = {};
            for (const b of A.bodies) (by[b.gems] ||= []).push(b);
            const groups = Object.keys(by).sort((a, c) => c - a).map((k) => by[k]);
            inst.pending = A.ffaResult(groups, groups[0].length === 1 ? `${groups[0][0].p.name} walks away with ${groups[0][0].gems} gems!` : "A greedy tie!");
            endAt = t + 0.3; ctx.sfx.win();
          } else deal();
        }
      },
      draw(g) {
        g.fillStyle = "#170a1f"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? "#1f0f29" : "#1a0c24"; g.fillRect(0, 140 + i * 80, W, 80); }
        text(g, `ROUND ${Math.min(round + 1, ROUNDS)} / ${ROUNDS}`, W / 2, 70, 44, "#fff", "center", 900);
        if (phase === "pick" && t >= 0) text(g, `PICK ON YOUR PHONE · ${Math.max(0, Math.ceil(PICK_T - t))}`, W / 2, 125, 30, "#f9f002", "center", 900);
        doors.forEach((d) => {
          const x = doorX(d.i), open = phase === "show", boom = open && d.i === bombAt, k = open ? Math.min(1, t / 0.4) : 0;
          rrect(g, x - 170, 200, 340, 480, 18, "#2b1a33", INK, 8);
          g.save(); g.translate(x - 150, 220); g.scale(1 - k * 0.85, 1); // the door swings open
          rrect(g, 0, 0, 300, 440, 12, DOOR_COLORS[d.i], INK, 7);
          circle(g, 260, 230, 14, "#ffd400", INK, 4);
          g.restore();
          if (open) {
            if (boom) { circle(g, x, 440, 90 + Math.sin(t * 20) * 6, "#26263a", INK, 8); outlined(g, "💣", x, 440, 110, "#fff"); }
            else outlined(g, `◆ ${d.prize}`, x, 440, 80, "#ffd400");
          }
          outlined(g, `${d.i + 1}`, x, 170, 60, "#fff");
          text(g, `PRIZE ${d.prize}`, x, 720, 40, "#ffd400", "center", 900);
          // who picked it: shown only on the reveal
          const on = A.bodies.filter((b) => b.door === d.i);
          if (open) on.forEach((b, j) => {
            const bx = x + (j - (on.length - 1) / 2) * Math.min(80, 300 / on.length), by = 820;
            blob(g, b.p, bx, by, 32, { sy: boom ? 0.6 : 1, sx: boom ? 1.3 : 1 });
            text(g, b.gain > 0 ? `+${b.gain}` : `${b.gain}`, bx, by - 58, 26, b.gain > 0 ? "#39ff14" : "#ff2a6d", "center", 900);
          });
        });
        // the bank, and who's locked in
        A.bodies.forEach((b, i) => {
          const x = W / 2 + (i - (n - 1) / 2) * Math.min(220, (W - 200) / n), y = 985;
          blob(g, b.p, x, y, 26);
          tag(g, b.ghost ? "BOT" : b.p.name, x, y - 46, b.p.color, 18);
          text(g, `◆ ${b.gems}${phase === "pick" && b.door != null ? " ✓" : ""}`, x, y + 44, 24, "#ffd400", "center", 900);
        });
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1.1) shout(g, p.word, p.x, p.y, 110, "#ff6b00", p.t); }
        if (t < 0) outlined(g, "PICK A DOOR!", W / 2, H / 2, 140, "#f9f002");
      },
    };
    return inst;
  },
};
