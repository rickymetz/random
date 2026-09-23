// Bomb Squad — teams (2v2, 3v3, 4v4). Each team has a bomb on the TV with
// three modules: wires, a symbol keypad, and a big button. One teammate (it
// rotates each module) holds the controls on their phone; the rest hold the
// manual, split between them, and have to talk them through it. Three
// strikes and it blows. First team to defuse wins; at 0:00, most modules.

import { arena, clock, TEAM, rnd, shuffle, W, H, INK, text, outlined, shout, rrect, circle, blob, tag } from "./arena.js";
import { FX, fade } from "../gfx.js";

const TIME = 150, STRIKES = 3;
const WIRE = { red: "#ff2a3d", blue: "#2a6bff", yellow: "#f9f002", white: "#f4f4f4", black: "#1a1a1a" };
const COLUMNS = [
  ["★", "Ω", "♣", "λ", "¶", "◆"],
  ["♠", "★", "✚", "Ψ", "¶", "♪"],
  ["☾", "♥", "Ω", "Σ", "✖", "✚"],
  ["π", "♦", "◆", "☯", "♥", "¥"],
  ["§", "▲", "♪", "Ж", "☾", "♦"],
  ["✿", "λ", "▲", "π", "⌘", "Ψ"],
];
const BTN = { red: "#ff2a3d", blue: "#2a6bff", white: "#f4f4f4", yellow: "#f9f002" };
const STRIP_DIGIT = { blue: "4", yellow: "5", white: "1", red: "1" };

export const MANUAL = {
  wires: { title: "WIRES", lines: [
    "Count the wires, top to bottom. Cut exactly one.",
    "3 wires: no red → cut the 2nd. Else, last wire white → cut the last. Else, more than one blue → cut the last blue. Else cut the last.",
    "4 wires: more than one red and the serial ends odd → cut the last red. Else, last wire yellow and no red → cut the 1st. Else, exactly one blue → cut the 1st. Else, more than one yellow → cut the last. Else cut the 2nd.",
    "5 wires: last wire black and the serial ends odd → cut the 4th. Else, exactly one red and more than one yellow → cut the 1st. Else, no black → cut the 2nd. Else cut the 1st.",
  ] },
  keypad: { title: "KEYPAD", lines: [
    "Exactly one column below has all four symbols on the bomb. Press the four in that column's order.",
    ...COLUMNS.map((c, i) => `Column ${i + 1}:  ${c.join("  ")}`),
  ] },
  button: { title: "BUTTON", lines: [
    "Follow the first rule that fits:",
    "1. Blue button that says ABORT → HOLD.",
    "2. Says DETONATE → TAP (press and let go).",
    "3. White button → HOLD.",
    "4. Red button that says HOLD → TAP.",
    "5. Otherwise → HOLD.",
    "Holding: a strip lights up. Blue → let go when the timer shows a 4 anywhere. Yellow → a 5. Any other colour → a 1.",
  ] },
};

export function wireAnswer(ws, odd) {
  const n = ws.length, cnt = (c) => ws.filter((w) => w === c).length, last = (c) => ws.lastIndexOf(c);
  if (n === 3) { if (!cnt("red")) return 1; if (ws[2] === "white") return 2; if (cnt("blue") > 1) return last("blue"); return 2; }
  if (n === 4) { if (cnt("red") > 1 && odd) return last("red"); if (ws[3] === "yellow" && !cnt("red")) return 0; if (cnt("blue") === 1) return 0; if (cnt("yellow") > 1) return 3; return 1; }
  if (ws[4] === "black" && odd) return 3; if (cnt("red") === 1 && cnt("yellow") > 1) return 0; if (!cnt("black")) return 1; return 0;
}
export function buttonAnswer(color, label) {
  if (color === "blue" && label === "ABORT") return "hold";
  if (label === "DETONATE") return "tap";
  if (color === "white") return "hold";
  if (color === "red" && label === "HOLD") return "tap";
  return "hold";
}
export function makeBomb() {
  const serial = Array.from({ length: 5 }, (_, i) => (i === 4 ? String(Math.floor(rnd(0, 10))) : "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[Math.floor(rnd(0, 34))])).join("");
  const odd = +serial[4] % 2 === 1;
  const wires = Array.from({ length: Math.floor(rnd(3, 6)) }, () => Object.keys(WIRE)[Math.floor(rnd(0, 5))]);
  let col, keys;
  do { col = Math.floor(rnd(0, COLUMNS.length)); keys = shuffle(COLUMNS[col]).slice(0, 4); } while (COLUMNS.some((c, i) => i !== col && keys.every((k) => c.includes(k))));
  const keyOrder = COLUMNS[col].filter((k) => keys.includes(k));
  const bcolor = Object.keys(BTN)[Math.floor(rnd(0, 4))], blabel = ["ABORT", "DETONATE", "HOLD", "PRESS"][Math.floor(rnd(0, 4))];
  return { serial, odd, wires, cuts: [], wireAns: wireAnswer(wires, odd), keys, keyOrder, pressed: [], bcolor, blabel, bAns: buttonAnswer(bcolor, blabel), strip: null, holdT: 0, stage: 0, strikes: 0, boom: false, done: false, flash: 0 };
}

export default {
  id: "bombsquad", title: "Bomb Squad", command: "DEFUSE!", kind: "Teams", min: 2, max: 8,
  blurb: "One of you holds the bomb, the rest hold the manual. Talk it through!",
  controls: "Defuser: wires, keypad, button on your phone · Everyone else: read your manual pages",

  create(ctx) {
    const A = arena(ctx, { teams: true });
    const ck = clock(ctx, TIME), pops = [];
    const bombs = [makeBomb(), makeBomb()];
    let endAt = null;
    const STAGES = ["wires", "keypad", "button"];
    const human = (b) => !b.ghost && !b.p.bot;
    const defuser = (t) => A.teams[t][bombs[t].stage % A.teams[t].length];
    const timerStr = () => { const s = Math.max(0, Math.ceil(TIME - Math.max(0, ck.t))); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

    function relayout(t) {
      const B = bombs[t], d = defuser(t), mod = STAGES[B.stage];
      if (B.done || B.boom) {
        for (const b of A.teams[t]) if (!b.ghost) ctx.layout(b.pid, { kind: "wait", text: B.done ? "DEFUSED!" : "KABOOM", sub: B.done ? "Nice work, squad." : "Well… that happened.", role: `${TEAM[t].name} team` });
        return;
      }
      // the manual goes to the readers (humans who aren't defusing), split
      // module by module; with nobody to read, the defuser gets it all
      const readers = A.teams[t].filter((b) => human(b) && b !== d);
      const pages = new Map(readers.map((r) => [r, []]));
      if (readers.length) STAGES.forEach((s, i) => pages.get(readers[i % readers.length]).push(MANUAL[s]));
      for (const b of A.teams[t]) {
        if (b.ghost) continue;
        const role = `${TEAM[t].name} · module ${B.stage + 1}/3`;
        if (b === d) {
          const l = { kind: "bomb", role, manual: readers.length ? [] : STAGES.map((s) => MANUAL[s]), hint: readers.length ? "Describe what's on the TV. Your team has the manual!" : "Nobody to read to: the manual's all yours." };
          if (mod === "wires") l.wires = B.wires.map((c, i) => ({ id: "w" + i, label: String(i + 1), color: WIRE[c], fg: c === "black" || c === "blue" || c === "red" ? "#fff" : undefined, off: B.cuts.includes(i) }));
          if (mod === "keypad") l.keys = B.keys.map((k, i) => ({ id: "k" + i, label: k, color: "#efe6d2", off: B.pressed.includes(k) }));
          if (mod === "button") l.hold = { label: B.blabel, color: BTN[B.bcolor] };
          ctx.layout(b.pid, l);
        } else {
          ctx.layout(b.pid, { kind: "bomb", role, manual: pages.get(b) ?? [], hint: `${d.ghost ? "The bot" : d.p.name} has the bomb. Talk them through it!` });
        }
      }
    }
    function strike(t) {
      const B = bombs[t]; B.strikes++; B.flash = 0.5;
      ctx.sfx.hit(); ctx.shake(16);
      pops.push({ x: t === 0 ? W / 4 : (W * 3) / 4, y: 520, t: 0, word: "STRIKE!", c: "#ff2a3d" });
      for (const b of A.teams[t]) if (!b.ghost) ctx.buzz(b.pid, 350);
      if (B.strikes >= STRIKES) { B.boom = true; ctx.sfx.lose(); ctx.shake(40); pops.push({ x: t === 0 ? W / 4 : (W * 3) / 4, y: 480, t: 0, word: "KABOOM!", c: "#ff6b00" }); relayout(t); check(); }
    }
    function advance(t) {
      const B = bombs[t], d = defuser(t);
      if (!d.ghost) ctx.stat(d.pid, "defused", 1);
      B.stage++; ctx.sfx.power(); ctx.shake(6);
      pops.push({ x: t === 0 ? W / 4 : (W * 3) / 4, y: 520, t: 0, word: B.stage >= 3 ? "DEFUSED!" : "CLEAR!", c: "#39ff14" });
      if (B.stage >= 3) { B.done = true; relayout(t); check(); return; }
      relayout(t);
    }
    function check() {
      if (endAt != null) return;
      const [a, b] = bombs;
      let w = null;
      if (a.done || b.done) w = a.done && b.done ? -1 : a.done ? 0 : 1;
      else if (a.boom && b.boom) w = -1;
      else if (a.boom) w = 1;
      else if (b.boom) w = 0;
      else if (ck.t >= TIME) w = a.stage === b.stage ? (a.strikes === b.strikes ? -1 : a.strikes < b.strikes ? 0 : 1) : a.stage > b.stage ? 0 : 1;
      if (w == null) return;
      endAt = ck.t + 2;
      ctx.sfx.win();
      inst.pending = A.teamResult(w, w < 0 ? "Nobody wins the bomb squad trophy!" : bombs[w].done ? `${TEAM[w].name} defused it first!` : bombs[1 - w].boom ? `${TEAM[1 - w].name} blew it!` : `${TEAM[w].name} got further!`);
    }
    // module actions, shared by phones and bots
    function cut(t, i) {
      const B = bombs[t]; if (STAGES[B.stage] !== "wires" || B.cuts.includes(i)) return;
      B.cuts.push(i); ctx.sfx.crunch();
      if (i === B.wireAns) advance(t); else { strike(t); relayout(t); }
    }
    function press(t, k) {
      const B = bombs[t]; if (STAGES[B.stage] !== "keypad" || B.pressed.includes(k)) return;
      if (B.keyOrder[B.pressed.length] === k) { B.pressed.push(k); ctx.sfx.dot(); if (B.pressed.length === 4) advance(t); }
      else { strike(t); relayout(t); }
    }
    function hold(t, down) {
      const B = bombs[t]; if (STAGES[B.stage] !== "button") return;
      if (down) { B.holdT = 0.0001; B.strip = null; ctx.sfx.tick(); return; }
      if (!B.holdT) return;
      const held = B.holdT; B.holdT = 0;
      const tapped = held < 0.6;
      if (B.bAns === "tap") { if (tapped) advance(t); else strike(t); }
      else if (tapped) strike(t);
      else if (timerStr().includes(STRIP_DIGIT[B.strip])) advance(t);
      else strike(t);
      B.strip = null;
    }

    const inst = {
      result: null,
      describe: () => A.teams.map((tm, i) => `${TEAM[i].name}: ${tm.map((b) => (b.ghost ? "Bot" : b.p.name)).join(", ")}`),
      start() { relayout(0); relayout(1); },
      input(pid, m) {
        const b = A.of(pid); if (!b || ck.t < 0 || endAt != null) return;
        const t = b.team, B = bombs[t]; if (defuser(t) !== b || B.done || B.boom) return;
        if (m.t === "pad" && /^w\d$/.test(m.id)) cut(t, +m.id[1]);
        if (m.t === "pad" && /^k\d$/.test(m.id)) press(t, B.keys[+m.id[1]]);
        if (m.t === "btn") hold(t, !!m.down);
      },
      bot(pid, dt) { botPlay(A.of(pid), dt); },
      update(dt) {
        if (!ck.tick(dt) || inst.result) return;
        if (endAt != null) { if (ck.t >= endAt) inst.result = inst.pending; return; }
        for (const g of A.ghosts()) botPlay(g, dt);
        for (const t of [0, 1]) {
          const B = bombs[t];
          B.flash = Math.max(0, B.flash - dt);
          if (B.holdT > 0) { B.holdT += dt; if (B.holdT > 0.6 && !B.strip) B.strip = ["blue", "yellow", "white", "red"][Math.floor(rnd(0, 4))]; }
        }
        if (ck.t >= TIME) check();
      },
      draw(g) {
        g.fillStyle = "#0d0a0a"; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) { g.fillStyle = i % 2 ? "#1a1410" : "#16110d"; g.fillRect(0, i * 42, W, 42); } // workbench planks
        g.fillStyle = "#f9f002"; for (let x = -40; x < W; x += 80) { g.beginPath(); g.moveTo(x, H - 30); g.lineTo(x + 40, H - 30); g.lineTo(x + 70, H); g.lineTo(x + 30, H); g.closePath(); g.fill(); }
        for (const t of [0, 1]) drawBomb(g, t, t === 0 ? W / 4 : (W * 3) / 4);
        for (const p of fade(pops)) { p.t += FX.dt; if (p.t < 1.1) shout(g, p.word, p.x, p.y, 90, p.c, p.t); }
        ck.overlay(g, "DEFUSE!");
      },
    };

    function drawBomb(g, t, x) {
      const B = bombs[t], y = 150, w = 820, h = 800, L = x - w / 2;
      rrect(g, L, y, w, h, 24, B.boom ? "#3a1a10" : "#4a4f5a", B.flash > 0 ? "#ff2a3d" : INK, 8);
      rrect(g, L + 20, y + 20, w - 40, 120, 10, "#2a2e36", INK, 4);
      text(g, TEAM[t].name.toUpperCase() + " BOMB", L + 40, y + 55, 34, TEAM[t].color, "left", 900);
      text(g, `SERIAL ${B.serial}`, L + 40, y + 105, 28, "#efe6d2", "left", 900);
      // timer
      rrect(g, x + 40, y + 36, 220, 88, 8, "#120505", INK, 4);
      text(g, timerStr(), x + 150, y + 82, 60, B.boom ? "#555" : "#ff2a3d", "center", 900);
      // strikes and module LEDs
      for (let i = 0; i < STRIKES; i++) text(g, "✖", x + 300 + i * 34, y + 60, 30, i < B.strikes ? "#ff2a3d" : "#555", "center", 900);
      for (let i = 0; i < 3; i++) circle(g, x + 300 + i * 34, y + 104, 11, i < B.stage ? "#39ff14" : "#333", INK, 3);
      const my = y + 170, mh = h - 200;
      rrect(g, L + 20, my, w - 40, mh, 12, "#3a3f4a", INK, 4);
      if (B.boom) { outlined(g, "KABOOM", x, my + mh / 2, 120, "#ff6b00"); return; }
      if (B.done) { outlined(g, "DEFUSED", x, my + mh / 2, 120, "#39ff14"); return; }
      const mod = STAGES[B.stage];
      text(g, mod.toUpperCase(), L + 44, my + 34, 30, "#efe6d2", "left", 900);
      if (mod === "wires") {
        const n = B.wires.length, gap = (mh - 120) / n;
        B.wires.forEach((c, i) => {
          const wy = my + 90 + i * gap + gap / 2;
          circle(g, L + 110, wy, 16, "#999", INK, 3); circle(g, L + w - 110, wy, 16, "#999", INK, 3);
          g.save();
          if (B.cuts.includes(i)) { g.beginPath(); g.rect(L, wy - 80, w / 2 - 30, 160); g.rect(x + 30, wy - 80, w / 2 - 30, 160); g.clip(); } // snipped in the middle
          g.strokeStyle = INK; g.lineWidth = 22; g.beginPath(); g.moveTo(L + 110, wy); g.bezierCurveTo(L + 300, wy + 50, L + w - 300, wy - 50, L + w - 110, wy); g.stroke();
          g.strokeStyle = WIRE[c]; g.lineWidth = 14; g.stroke();
          g.restore();
          text(g, String(i + 1), L + 60, wy, 34, "#efe6d2", "center", 900);
        });
      }
      if (mod === "keypad") {
        B.keys.forEach((k, i) => {
          const kx = x + (i % 2 ? 140 : -140), ky = my + 200 + Math.floor(i / 2) * 260;
          rrect(g, kx - 110, ky - 110, 220, 220, 14, "#efe6d2", INK, 6);
          text(g, k, kx, ky + 6, 130, INK, "center", 900);
          circle(g, kx + 80, ky - 80, 12, B.pressed.includes(k) ? "#39ff14" : "#555", INK, 3);
        });
      }
      if (mod === "button") {
        const bx = x - 120, by = my + mh / 2 + 20, pressed = B.holdT > 0;
        circle(g, bx, by + 14, 190, INK);
        circle(g, bx, by + (pressed ? 12 : 0), 180, BTN[B.bcolor], INK, 8);
        text(g, B.blabel, bx, by + (pressed ? 12 : 0), 58, B.bcolor === "white" || B.bcolor === "yellow" ? INK : "#fff", "center", 900);
        rrect(g, x + 180, my + 110, 90, mh - 180, 10, "#222", INK, 5);
        if (B.strip) rrect(g, x + 192, my + 122, 66, mh - 204, 6, BTN[B.strip]);
        text(g, "STRIP", x + 225, my + mh - 40, 26, "#efe6d2", "center", 900);
      }
      // who's holding it: top-right of the module panel
      const d = defuser(t);
      blob(g, d.p, L + w - 70, my + 44, 26);
      text(g, `${d.ghost ? "BOT" : d.p.name} HAS IT ▶`, L + w - 110, my + 44, 26, TEAM[t].color, "right", 900);
    }

    // bots: take a moment to "read", then act; usually right
    function botPlay(b, dt) {
      if (!b || ck.t < 0 || endAt != null) return;
      const t = b.team, B = bombs[t];
      if (defuser(t) !== b || B.done || B.boom) return;
      const bot = b.bot, mod = STAGES[B.stage];
      if (bot.stage !== B.stage) { bot.stage = B.stage; bot.wait = rnd(5, 10); bot.releaseAt = null; }
      bot.wait -= dt;
      if (bot.wait > 0) return;
      const right = Math.random() < 0.82;
      if (mod === "wires") { const wrong = B.wires.map((_, i) => i).filter((i) => i !== B.wireAns && !B.cuts.includes(i)); cut(t, right || !wrong.length ? B.wireAns : wrong[0]); bot.wait = rnd(3, 6); }
      if (mod === "keypad") { press(t, right ? B.keyOrder[B.pressed.length] : B.keys.find((k) => !B.pressed.includes(k) && k !== B.keyOrder[B.pressed.length]) ?? B.keyOrder[B.pressed.length]); bot.wait = rnd(1, 2.4); }
      if (mod === "button") {
        if (!B.holdT) { hold(t, true); bot.mode = right ? B.bAns : B.bAns === "tap" ? "hold" : "tap"; bot.wait = bot.mode === "tap" ? 0.2 : 0.8; return; }
        if (bot.mode === "tap") { hold(t, false); bot.wait = rnd(3, 5); return; }
        if (B.strip && (timerStr().includes(STRIP_DIGIT[B.strip]) || Math.random() < 0.004)) { hold(t, false); bot.wait = rnd(3, 5); }
      }
    }
    return inst;
  },
};
