// Draw Duel — free-for-all. Everyone gets the same silly prompt and draws it
// on their phone; the TV shows the drawings coming together live. Then all the
// drawings go up anonymously and everyone votes for their favourite (not their
// own). Most votes wins.

import { arena, clock, rnd, shuffle, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const DRAW_T = 45, VOTE_T = 20, REVEAL_T = 5, PX = 600;
const mkCanvas = () => (typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: PX, height: PX }) : null);
const strokeOn = (g, s, k) => {
  g.strokeStyle = s.c; g.lineWidth = s.w * (k / PX); g.beginPath();
  s.pts.forEach(([px, py], i) => (i ? g.lineTo(px * k, py * k) : g.moveTo(px * k, py * k)));
  if (s.pts.length === 1) g.lineTo(s.pts[0][0] * k + 0.1, s.pts[0][1] * k);
  g.stroke();
};
export const PROMPTS = [
  "a cat on a skateboard", "a haunted toaster", "the world's worst superhero", "a jellyfish at the dentist", "your boss as a vegetable",
  "a dragon who's scared of the dark", "a pizza with feelings", "a very tired cloud", "a fancy snail", "a shark doing yoga",
  "the last slice of cake", "a volcano on vacation", "a robot falling in love", "a sandwich with a secret", "the moon's bad hair day",
  "a dog who thinks it's a chef", "a ghost trying to be scary", "an alien at a bus stop", "a cactus giving hugs", "a penguin in a hurry",
  "a banana detective", "a monster under a very small bed", "a pigeon's worst day", "a wizard who lost his hat", "a frog in a tuxedo",
  "breakfast gone wrong", "a sock with ambition", "a knight afraid of horses", "a sleepy volcano", "a cloud raining cats",
];
const LETTERS = "ABCDEFGH";

export default {
  id: "draw", title: "Draw Duel", command: "DRAW!", kind: "Free-for-all", min: 3, max: 8,
  blurb: "Everyone draws the same prompt. Vote for the best one (not your own).",
  controls: "Draw on your phone, then vote",

  create(ctx) {
    const A = arena(ctx, {});
    const ck = clock(ctx, DRAW_T + VOTE_T + REVEAL_T + 3), pops = [];
    const prompt = PROMPTS[Math.floor(rnd(0, PROMPTS.length))];
    const n = A.bodies.length, order = shuffle(A.bodies.slice()); // gallery order (anonymous)
    let phase = "draw", phaseT = 0, endAt = null, started = false;
    for (const b of A.bodies) { b.strokes = []; b.drawn = 0; b.done = false; b.vote = null; b.votes = 0; b.doodle = null; }
    const letter = (b) => LETTERS[order.indexOf(b)];

    function toVote() {
      phase = "vote"; phaseT = 0; ctx.sfx.slam(); ctx.shake(8);
      for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "pads", text: "VOTE!", hint: "Your favourite drawing (not your own)", pads: order.map((o, i) => ({ id: LETTERS[i], label: LETTERS[i], color: ["#ff2a6d", "#05d9e8", "#f9f002", "#39ff14", "#ff6b00", "#8a5cff", "#efe6d2", "#ff8ad8"][i], off: o === b })) });
    }
    function vote(b, id) {
      if (phase !== "vote" || b.vote) return;
      const target = order[LETTERS.indexOf(id)];
      if (!target || target === b) return;
      b.vote = target; target.votes++; ctx.sfx.dot();
      if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: "VOTED!", sub: "Waiting for everyone…" });
      if (A.bodies.every((o) => o.vote)) reveal();
    }
    function reveal() {
      phase = "reveal"; phaseT = 0; ctx.sfx.win(); ctx.shake(10);
      for (const b of A.bodies) if (b.votes && !b.ghost) ctx.stat(b.pid, "votes", b.votes);
      const by = {};
      for (const b of A.bodies) (by[b.votes] ||= []).push(b);
      const groups = Object.keys(by).sort((a, b) => b - a).map((k) => by[k]);
      const top = groups[0];
      inst.pending = A.ffaResult(groups, top.length === 1 ? `${top[0].p.name}'s masterpiece wins!` : "A tie for best artist!");
      for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: `${b.votes} VOTE${b.votes === 1 ? "" : "S"}`, sub: b.votes ? "The crowd has spoken." : "Art is subjective." });
    }

    const inst = {
      result: null,
      describe: () => [`The prompt is secret until GO!`, `${DRAW_T} s to draw, then everyone votes`],
      start() { for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: "GET READY", sub: "Pencils out…" }); },
      input(pid, m) {
        const b = A.of(pid); if (!b) return;
        if (phase === "draw" && ck.t >= 0) {
          if (m.t === "stroke" && Array.isArray(m.pts) && b.strokes.length < 400) b.strokes.push({ c: String(m.c).slice(0, 9), w: Math.max(2, Math.min(30, +m.w || 8)), pts: m.pts.slice(0, 200).map(([x, y]) => [+x || 0, +y || 0]) });
          if (m.t === "undo") { b.strokes.pop(); b.drawn = Infinity; } // redraw from scratch next frame
          if (m.t === "done") b.done = true;
          if (A.bodies.every((o) => o.done)) toVote();
        }
        if (m.t === "pad") vote(b, m.id);
      },
      bot(pid, dt) {
        const b = A.of(pid); if (!b || ck.t < 0) return;
        if (phase === "draw" && !b.done) {
          b.doodle ??= doodle();
          b.bot.t = (b.bot.t ?? rnd(0.5, 1.5)) - dt;
          if (b.bot.t <= 0) { b.bot.t = rnd(0.6, 1.8); const s = b.doodle.shift(); if (s) b.strokes.push(s); else { b.done = true; if (A.bodies.every((o) => o.done)) toVote(); } }
        }
        if (phase === "vote" && !b.vote) {
          b.bot.v = (b.bot.v ?? rnd(2, 8)) - dt;
          if (b.bot.v <= 0) { const opts = order.filter((o) => o !== b); vote(b, letter(opts[Math.floor(Math.random() * opts.length)])); } // bots can't judge art: uniform, so scribbling more can't farm them
        }
      },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (!started) { started = true; for (const b of A.bodies) if (!b.ghost) ctx.layout(b.pid, { kind: "draw", prompt }); }
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        phaseT += dt;
        if (phase === "draw" && phaseT >= DRAW_T) toVote();
        else if (phase === "vote" && phaseT >= VOTE_T) reveal();
        else if (phase === "reveal" && endAt == null && phaseT >= 0.01) endAt = ck.t + REVEAL_T;
      },
      draw(g) {
        g.fillStyle = "#1a0f24"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 40; i++) circle(g, (i * 263) % W, (i * 151) % H, 3, "rgba(255,255,255,.05)");
        // the prompt banner
        rrect(g, 120, 24, W - 240, 110, 12, "#efe6d2", INK, 6);
        text(g, ck.t < 0 ? "THE PROMPT IS…" : `DRAW: ${prompt.toUpperCase()}`, W / 2, 66, ck.t < 0 ? 44 : prompt.length > 26 ? 40 : 48, INK, "center", 900);
        const left = phase === "draw" ? DRAW_T - phaseT : phase === "vote" ? VOTE_T - phaseT : 0;
        text(g, phase === "draw" ? `DRAWING · ${Math.ceil(Math.max(0, left))}s · ${A.bodies.filter((b) => b.done).length}/${n} done` : phase === "vote" ? `VOTE ON YOUR PHONE · ${Math.ceil(Math.max(0, left))}s · ${A.bodies.filter((b) => b.vote).length}/${n} voted` : "THE RESULTS", W / 2, 110, 28, "#ff2a6d", "center", 900);
        // gallery: up to 4 across, 2 rows
        const cols = Math.min(4, n), rows = Math.ceil(n / cols), size = Math.min(400, (H - 230) / rows - 70, (W - 160) / cols - 40);
        order.forEach((b, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const x = W / 2 + (c - (cols - 1) / 2) * (size + 40), y = 200 + size / 2 + r * (size + 80) + (rows === 1 ? 120 : 0);
          const tilt = ((i * 37) % 7 - 3) * 0.012;
          g.save(); g.translate(x, y); g.rotate(tilt);
          rrect(g, -size / 2 - 12, -size / 2 - 12, size + 24, size + 52, 6, "#fff", INK, 5);
          g.save(); g.beginPath(); g.rect(-size / 2, -size / 2, size, size); g.clip();
          // strokes are drawn once into the player's own canvas, which is then
          // scaled into the frame (up to 400 × 200-point strokes each would be
          // far too much to redraw every frame)
          b.cache ??= mkCanvas();
          if (b.cache) {
            const c = b.cache.getContext("2d");
            if (b.drawn > b.strokes.length) { c.clearRect(0, 0, PX, PX); b.drawn = 0; }
            c.lineCap = c.lineJoin = "round";
            for (; b.drawn < b.strokes.length; b.drawn++) strokeOn(c, b.strokes[b.drawn], PX);
            g.drawImage(b.cache, -size / 2, -size / 2, size, size);
          } else { g.translate(-size / 2, -size / 2); g.lineCap = g.lineJoin = "round"; for (const s of b.strokes) strokeOn(g, s, size); }
          g.restore();
          const label = phase === "reveal" ? (b.ghost ? "BOT" : b.p.name) : phase === "vote" ? LETTERS[i] : b.done ? "DONE ✓" : "…";
          text(g, label, 0, size / 2 + 20, 30, phase === "reveal" ? b.p.color : INK, "center", 900);
          g.restore();
          if (phase === "reveal") {
            for (let k = 0; k < b.votes; k++) circle(g, x - (b.votes - 1) * 18 + k * 36, y - size / 2 - 30, 14, "#f9f002", INK, 3);
          }
          if (phase === "draw") { blob(g, b.p, x + size / 2 - 6, y + size / 2 + 6, 22); }
        });
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 0.9) shout(g, p.word, p.x, p.y, 60, "#f9f002", p.t); }
        if (phase === "vote" && phaseT < 0.8) shout(g, "VOTE!", W / 2, H / 2, 200, "#f9f002", phaseT);
        ck.overlay(g, "DRAW!");
      },
    };

    // bot "drawings": a wobbly blob of a thing with eyes and some scribbles
    function doodle() {
      const out = [], cx = rnd(0.35, 0.65), cy = rnd(0.4, 0.6), r = rnd(0.18, 0.3), col = ["#0b0710", "#ff2a6d", "#05d9e8", "#39ff14", "#ff6b00", "#8a5cff"][Math.floor(rnd(0, 6))];
      const ring = (x, y, rr, c, w, wob = 0.15) => ({ c, w, pts: Array.from({ length: 24 }, (_, k) => { const a = (k / 23) * Math.PI * 2, q = rr * (1 + rnd(-wob, wob)); return [+(x + Math.cos(a) * q).toFixed(3), +(y + Math.sin(a) * q).toFixed(3)]; }) });
      out.push(ring(cx, cy, r, col, 10));
      out.push(ring(cx - r * 0.35, cy - r * 0.2, 0.03, "#0b0710", 14, 0));
      out.push(ring(cx + r * 0.35, cy - r * 0.2, 0.03, "#0b0710", 14, 0));
      out.push({ c: "#0b0710", w: 8, pts: Array.from({ length: 8 }, (_, k) => [+(cx - r * 0.4 + (k / 7) * r * 0.8).toFixed(3), +(cy + r * 0.3 + Math.sin((k / 7) * Math.PI) * r * 0.2).toFixed(3)]) });
      for (let k = 0; k < Math.floor(rnd(2, 6)); k++) {
        const x0 = rnd(0.1, 0.9), y0 = rnd(0.1, 0.9), c = ["#f9f002", "#ff6b00", "#05d9e8", "#39ff14", "#ff2a6d"][Math.floor(rnd(0, 5))];
        out.push({ c, w: Math.round(rnd(4, 16)), pts: Array.from({ length: 10 }, (_, j) => [+Math.min(1, Math.max(0, x0 + Math.sin(j * 0.9 + k) * 0.08 + j * 0.01)).toFixed(3), +Math.min(1, Math.max(0, y0 + j * 0.015)).toFixed(3)]) });
      }
      return out;
    }
    return inst;
  },
};
