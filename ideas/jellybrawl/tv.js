// The TV: owns the room and all game state. Phones only send intents and
// render the layouts we send them (see index.html / controller.js).

import { hostRoom } from "./net.js";
import { W, H, text, outlined, rrect, circle, blob, tag, star } from "./gfx.js";
import { qr } from "./qr.js";
import { sfx, unlock } from "./sfx.js";
import flap from "./games/flap.js";
import sling from "./games/sling.js";
import chomp from "./games/chomp.js";

const GAMES = [flap, sling, chomp];
const COLORS = ["#ff5a5f", "#3fa7ff", "#ffd23f", "#3ddc84", "#b77dff", "#ff9f43", "#ff7eb6", "#3fe0d0"];
const BOT_NAMES = ["Wobbles", "Gloop", "Jiggly", "Squish", "Blorp", "Mochi", "Puddin", "Boing"];
const MAX = 8;
const POINTS = [10, 6, 4, 2, 1, 1, 1, 1];
const ROUND_CHOICES = [3, 5, 8];
const AWARDS = [
  ["wins", "Champion", "wins"], ["flaps", "Flappiest", "flaps"], ["airtime", "Frequent flyer", "s aloft"],
  ["kings", "Kingslayer", "kings popped"], ["blocks", "Demolition crew", "blocks smashed"],
  ["dots", "Hungriest", "dots eaten"], ["catches", "Best hunter", "catches"], ["gulps", "Tables turned", "hunters gulped"],
];

const canvas = document.getElementById("screen");
const g = canvas.getContext("2d");
const S = {
  scene: "gate", t: 0, players: [], rounds: 5, round: 0, net: null, qr: null, joinUrl: "",
  game: null, def: null, chooser: null, options: null, picked: null, lastGameId: null,
  result: null, deltas: [], roleCounts: {}, layouts: new Map(),
};
window.__jelly = S; // for tests and poking around in devtools

/* ---------------------------------------------------------------- players */

const humans = () => S.players.filter((p) => !p.bot);
const byPid = (pid) => S.players.find((p) => p.pid === pid);
const vip = () => humans().find((p) => p.connected);

function send(p, m) { if (p && !p.bot && p.connected) S.net.send(p.pid, m); }
function layout(pid, obj) {
  const p = byPid(pid);
  if (!p) return;
  const l = { t: "layout", ...obj, you: { name: p.name, color: p.color } };
  S.layouts.set(pid, l);
  send(p, l);
}
const layoutAll = (fn) => S.players.forEach((p) => layout(p.pid, fn(p)));

function addPlayer(pid, name, bot = false) {
  const used = new Set(S.players.map((p) => p.color));
  const p = { pid, name, bot, color: COLORS.find((c) => !used.has(c)), face: null, connected: true, score: 0, stats: {}, rtt: null, bob: Math.random() * 6 };
  S.players.push(p);
  return p;
}

function onJoin(pid, name) {
  let p = byPid(pid);
  if (p) {
    p.connected = true;
    p.name = name || p.name;
    const l = S.layouts.get(pid);
    if (S.scene === "lobby" || S.scene === "final") refreshMenus();
    else if (l) send(p, l);
    return;
  }
  if (S.players.length >= MAX) {
    // a human bumps a bot in the lobby; otherwise the game is full
    if (S.scene !== "lobby" || !S.players.some((q) => q.bot)) {
      S.net.send(pid, { t: "layout", kind: "wait", text: "This game is full", sub: "Audience mode is coming soon.", you: { name, color: "#888" } });
      return;
    }
    removeBot();
  }
  p = addPlayer(pid, (name || "Player").slice(0, 12));
  sfx.join();
  if (S.scene === "lobby" || S.scene === "final") refreshMenus();
  else layout(pid, { kind: "wait", text: "You're in!", sub: "You'll play from the next minigame." });
}

function onLeave(pid) {
  const p = byPid(pid);
  if (!p) return;
  p.connected = false;
  if (S.scene === "lobby") S.players.splice(S.players.indexOf(p), 1);
  if (S.scene === "lobby" || S.scene === "final") refreshMenus();
}

function onInput(pid, m) {
  const p = byPid(pid);
  if (!p || !m) return;
  if (m.t === "pong") { const r = performance.now() - m.ts; p.rtt = p.rtt == null ? r : p.rtt * 0.7 + r * 0.3; return; }
  if (m.t === "face" && typeof m.data === "string" && m.data.startsWith("data:image/") && m.data.length < 300000) {
    const img = new Image();
    img.src = m.data;
    p.face = img;
    return;
  }
  if (m.t === "act") return act(m.id, p);
  if (m.t === "pick" && S.scene === "choose" && pid === S.chooser && !S.picked) return pick(m.id);
  if (S.scene === "game" && S.game && !p.bot) S.game.input(pid, m);
}

function addBot() {
  if (S.players.length >= MAX) return;
  const name = BOT_NAMES.find((n) => !S.players.some((p) => p.name === n)) || "Bot";
  addPlayer("bot-" + Math.random().toString(36).slice(2, 8), name, true);
  sfx.join();
  refreshMenus();
}
function removeBot() {
  const i = S.players.map((p) => p.bot).lastIndexOf(true);
  if (i >= 0) S.players.splice(i, 1);
  refreshMenus();
}

/* ------------------------------------------------------------------ menus */

function act(id, p) {
  const isVip = !p || p === vip();
  if (!isVip) return;
  if (id === "start" && S.scene === "lobby" && S.players.length >= 2) startSession();
  else if (id === "rounds" && S.scene === "lobby") { S.rounds = ROUND_CHOICES[(ROUND_CHOICES.indexOf(S.rounds) + 1) % ROUND_CHOICES.length]; refreshMenus(); }
  else if (id === "addbot" && S.scene === "lobby") addBot();
  else if (id === "rmbot" && S.scene === "lobby") removeBot();
  else if (id === "rematch" && S.scene === "final") startSession();
  else if (id === "lobby" && S.scene === "final") { S.players = S.players.filter((q) => q.bot || q.connected); go("lobby"); refreshMenus(); }
}

function refreshMenus() {
  const v = vip();
  for (const p of humans()) {
    if (S.scene === "lobby") {
      layout(p.pid, p === v
        ? { kind: "menu", text: "You're the VIP", sub: S.players.length < 2 ? "Waiting for one more player…" : `${S.players.length} players ready`, actions: [
          ...(S.players.length >= 2 ? [{ id: "start", label: "▶ Start game", big: true }] : []),
          { id: "rounds", label: `Rounds: ${S.rounds}` }, { id: "addbot", label: "+ Add bot" }, { id: "rmbot", label: "− Remove bot" }] }
        : { kind: "menu", text: "You're in!", sub: `Waiting for ${v ? v.name : "the VIP"} to start…` });
    } else if (S.scene === "final") {
      layout(p.pid, { kind: "menu", text: finalLine(p), sub: p === v ? "Play again?" : `Waiting for ${v?.name}…`, actions: p === v ? [{ id: "rematch", label: "↻ Rematch", big: true }, { id: "lobby", label: "Back to lobby" }] : [] });
    }
  }
  const el = document.getElementById("tools");
  el.hidden = !(S.scene === "lobby" || S.scene === "final");
  document.getElementById("t-start").textContent = S.scene === "final" ? "Rematch (Enter)" : "Start (Enter)";
  document.getElementById("t-rounds").textContent = `Rounds: ${S.rounds} (R)`;
  for (const id of ["t-tab", "t-rounds", "t-bot", "t-rmbot"]) document.getElementById(id).hidden = S.scene !== "lobby";
}

function finalLine(p) {
  const place = standings().indexOf(p) + 1;
  return place === 1 ? "You won! 🏆" : `You finished #${place}`;
}

/* ----------------------------------------------------------------- scenes */

function go(scene) { S.scene = scene; S.t = 0; }

function startSession() {
  for (const p of S.players) { p.score = 0; p.stats = {}; }
  S.roleCounts = {}; S.round = 0; S.lastGameId = null;
  S.players = S.players.filter((p) => p.bot || p.connected);
  document.getElementById("tools").hidden = true;
  startChoose();
}

function standings() { return [...S.players].sort((a, b) => b.score - a.score); }

function startChoose() {
  const n = S.players.length;
  let pool = GAMES.filter((d) => n >= d.min && n <= d.max);
  if (pool.length > 1) pool = pool.filter((d) => d.id !== S.lastGameId).concat(pool.filter((d) => d.id === S.lastGameId));
  S.options = pool.slice(0, 3);
  S.picked = null;
  // loser picks: the lowest score chooses (random among ties); round 1 is a roulette
  const low = Math.min(...S.players.map((p) => p.score));
  const lows = S.players.filter((p) => p.score === low);
  S.chooser = S.round === 0 ? null : lows[Math.floor(Math.random() * lows.length)].pid;
  go("choose");
  const c = byPid(S.chooser);
  layoutAll((p) => p.pid === S.chooser
    ? { kind: "choose", text: "You're in last — you pick!", options: S.options.map(({ id, title, kind, blurb }) => ({ id, title, kind, blurb })) }
    : { kind: "wait", text: c ? `${c.name} is picking…` : "Spinning the wheel…", sub: `Round ${S.round + 1} of ${S.rounds}` });
}

function pick(id) {
  S.picked = S.options.find((d) => d.id === id) || S.options[0];
  S.pickedAt = S.t;
  sfx.go();
}

function startIntro() {
  S.def = S.picked;
  S.lastGameId = S.def.id;
  const seats = S.players.slice();
  S.game = S.def.create({
    players: seats,
    layout,
    sfx,
    buzz: (pid, ms) => send(byPid(pid), { t: "buzz", ms }),
    stat: (pid, k, n) => { const p = byPid(pid); if (p) p.stats[k] = (p.stats[k] || 0) + n; },
    pickOne: () => {
      const min = Math.min(...seats.map((p) => S.roleCounts[p.pid] || 0));
      const c = seats.filter((p) => (S.roleCounts[p.pid] || 0) === min);
      const one = c[Math.floor(Math.random() * c.length)].pid;
      S.roleCounts[one] = (S.roleCounts[one] || 0) + 1;
      return one;
    },
  });
  go("intro");
  layoutAll(() => ({ kind: "wait", text: S.def.title, sub: S.def.controls }));
}

function finishGame() {
  const r = S.game.result;
  const deltas = new Map();
  if (r.tie) for (const pid of r.ranking.flat()) deltas.set(pid, 5);
  else if (r.winners) { r.winners.forEach((pid) => deltas.set(pid, 10)); r.losers.forEach((pid) => deltas.set(pid, 2)); }
  else { let place = 0; for (const grp of r.ranking) { for (const pid of grp) deltas.set(pid, POINTS[place]); place += grp.length; } }
  const winners = r.tie ? [] : r.winners || r.ranking[0];
  for (const pid of winners) { const p = byPid(pid); if (p) p.stats.wins = (p.stats.wins || 0) + 1; }
  S.deltas = [...deltas].map(([pid, d]) => ({ p: byPid(pid), d })).filter((x) => x.p).sort((a, b) => b.d - a.d);
  for (const { p, d } of S.deltas) p.score += d;
  S.result = r;
  S.game = null;
  go("results");
  for (const { p, d } of S.deltas) layout(p.pid, { kind: "wait", text: winners.includes(p.pid) ? "You won! 🎉" : `+${d} points`, sub: r.headline });
  for (const { p } of S.deltas) send(p, { t: "buzz", ms: winners.includes(p.pid) ? 300 : 80 });
}

function tick(dt) {
  S.t += dt;
  for (const p of S.players) p.bob += dt;
  if (S.scene === "choose") {
    const auto = !S.chooser || byPid(S.chooser)?.bot || !byPid(S.chooser)?.connected;
    if (!S.picked && ((auto && S.t > 2.5) || S.t > 15)) pick(S.options[Math.floor(Math.random() * S.options.length)].id);
    if (S.picked && S.t - S.pickedAt > 1.4) startIntro();
  } else if (S.scene === "intro") {
    if (S.t > 4.5) { go("game"); S.game.start(); }
  } else if (S.scene === "game") {
    for (const p of S.players) if (p.bot || !p.connected) S.game.bot(p.pid, dt);
    S.game.update(dt);
    if (S.game.result) finishGame();
  } else if (S.scene === "results") {
    if (S.t > 6.5) {
      S.round++;
      if (S.round >= S.rounds) { go("final"); sfx.win(); refreshMenus(); }
      else startChoose();
    }
  }
}

/* ---------------------------------------------------------------- drawing */

function bg(c1 = "#2b1b5e", c2 = "#120c2e") {
  const gr = g.createRadialGradient(W / 2, H * 0.3, 100, W / 2, H / 2, W * 0.7);
  gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.04)";
  for (let i = 0; i < 14; i++) { const x = (i * 173 + S.t * 20) % (W + 200) - 100; circle(g, x, (i * 97) % H, 40 + (i % 4) * 30, "rgba(255,255,255,.035)"); }
}

function title(y = 130, size = 150) {
  const letters = "JELLYBRAWL".split("");
  g.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
  const total = g.measureText("JELLYBRAWL").width;
  let x = W / 2 - total / 2;
  letters.forEach((ch, i) => {
    const w = g.measureText(ch).width;
    const dy = Math.sin(S.t * 3 + i * 0.6) * 10;
    outlined(g, ch, x + w / 2, y + dy, size, COLORS[i % COLORS.length]);
    x += w;
  });
}

function drawSeat(p, x, y, r = 70) {
  const sq = Math.sin(p.bob * 4) * 0.06;
  g.beginPath(); g.ellipse(x, y + r * 0.98, r * 0.75, r * 0.16, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.3)"; g.fill();
  blob(g, p, x, y, r, { sx: 1 + sq, sy: 1 - sq, alpha: p.connected || p.bot ? 1 : 0.35 });
  text(g, p.name, x, y + r + 34, 34, p.color);
  const sub = p.bot ? "🤖 bot" : !p.connected ? "reconnecting…" : p.rtt != null ? `${Math.round(p.rtt)} ms` : "…";
  text(g, sub, x, y + r + 72, 24, p.rtt > 150 ? "#ff9f43" : "rgba(255,255,255,.6)", "center", 600);
  if (p === vip() && S.scene === "lobby") tag(g, "VIP", x, y - r - 22, "#ffd23f", 24);
}

function drawGate() {
  bg();
  title(380, 190);
  text(g, "A party game for the big screen. Phones are the controllers.", W / 2, 560, 44, "#fff", "center", 600);
  outlined(g, "Click or press any key to open a room", W / 2, 760 + Math.sin(S.t * 4) * 6, 60, "#ffd23f");
}

function drawLobby() {
  bg();
  title(110, 120);
  // join panel
  rrect(g, 60, 220, 620, 800, 40, "rgba(255,255,255,.08)", "rgba(255,255,255,.15)", 3);
  if (S.qr) {
    const n = S.qr.length, size = 420, cell = size / (n + 8), x0 = 370 - size / 2, y0 = 260;
    rrect(g, x0, y0, size, size, 20, "#fff");
    g.fillStyle = "#16182b";
    S.qr.forEach((row, y) => row.forEach((d, x) => d && g.fillRect(x0 + (x + 4) * cell, y0 + (y + 4) * cell, cell + 0.5, cell + 0.5)));
    text(g, "Scan to join, or go to", 370, 730, 32, "rgba(255,255,255,.75)", "center", 600);
    text(g, S.joinUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), 370, 780, 40);
  } else {
    text(g, "No relay server running", 370, 330, 38, "#ffd23f");
    ["Controllers can be other tabs of", "this browser (button below), or run", "node server.mjs for real phones."].forEach((l, i) => text(g, l, 370, 410 + i * 50, 32, "rgba(255,255,255,.8)", "center", 600));
  }
  text(g, "Room code", 370, 860, 34, "rgba(255,255,255,.75)", "center", 600);
  outlined(g, S.net?.code || "····", 370, 945, 120, "#fff");
  // seats
  const cols = 4;
  for (let i = 0; i < MAX; i++) {
    const x = 860 + (i % cols) * 270, y = 370 + Math.floor(i / cols) * 360;
    const p = S.players[i];
    if (p) drawSeat(p, x, y);
    else { g.setLineDash([12, 12]); circle(g, x, y, 66, null, "rgba(255,255,255,.2)", 4); g.setLineDash([]); text(g, "join!", x, y, 30, "rgba(255,255,255,.3)"); }
  }
  const v = vip();
  text(g, `${S.rounds} rounds · ${v ? `${v.name} (VIP) starts from their phone` : "first to join is the VIP"} · or press Enter`, 1300, 950, 30, "rgba(255,255,255,.65)", "center", 600);
}

function scoreStrip(y = 1010) {
  const list = standings(), w = Math.min(230, 1800 / list.length);
  list.forEach((p, i) => {
    const x = W / 2 - (list.length * w) / 2 + i * w + w / 2;
    blob(g, p, x - 50, y, 26);
    text(g, String(p.score), x + 10, y, 34, p.color, "left");
  });
}

function drawChoose() {
  bg("#1b3a5e", "#0c1a2e");
  outlined(g, `Round ${S.round + 1} of ${S.rounds}`, W / 2, 110, 80, "#fff");
  const c = byPid(S.chooser);
  text(g, c ? `${c.name} is in last place — they pick the next game!` : "Spinning the wheel…", W / 2, 200, 44, "#ffd23f");
  const n = S.options.length, cw = 520, gap = 50;
  const spin = !S.picked && !S.chooser ? Math.floor(S.t * 8) % n : -1;
  S.options.forEach((d, i) => {
    const x = W / 2 - (n * cw + (n - 1) * gap) / 2 + i * (cw + gap), y = 300;
    const chosen = S.picked === d, lit = chosen || spin === i;
    const s = chosen ? 1 + 0.05 * Math.sin(S.t * 10) : 1;
    g.save(); g.translate(x + cw / 2, y + 280); g.scale(s, s); g.translate(-(x + cw / 2), -(y + 280));
    rrect(g, x, y, cw, 560, 36, lit ? "rgba(255,210,63,.25)" : "rgba(255,255,255,.08)", lit ? "#ffd23f" : "rgba(255,255,255,.2)", lit ? 8 : 3);
    outlined(g, d.title, x + cw / 2, y + 90, 54, "#fff");
    tag(g, d.kind, x + cw / 2, y + 170, "#ffd23f", 30);
    wrap(d.blurb, x + cw / 2, y + 260, cw - 80, 34);
    wrap(d.controls, x + cw / 2, y + 470, cw - 80, 26, "rgba(255,255,255,.6)");
    g.restore();
  });
  scoreStrip();
}

function wrap(str, x, y, maxW, size, color = "#fff") {
  g.font = `700 ${size}px ui-rounded, system-ui, sans-serif`;
  const words = str.split(" "), lines = [];
  let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  lines.forEach((l, i) => text(g, l, x, y + i * size * 1.3, size, color, "center", 700));
}

function drawIntro() {
  S.game.draw(g);
  g.fillStyle = "rgba(10,12,30,.75)"; g.fillRect(0, 0, W, H);
  const k = Math.min(1, S.t * 3), y = 200 - (1 - k) * 200;
  outlined(g, S.def.title, W / 2, y + 80, 140, "#ffd23f");
  tag(g, S.def.kind, W / 2, y + 210, "#fff", 40);
  wrap(S.def.blurb, W / 2, y + 330, 1200, 48);
  S.game.describe().forEach((l, i) => text(g, l, W / 2, y + 480 + i * 60, 40, "#9fe3ff"));
  text(g, "🎮 " + S.def.controls, W / 2, 900, 44);
  g.fillStyle = "#ffd23f"; g.fillRect(W / 2 - 300, 980, 600 * Math.min(1, S.t / 4.5), 14);
}

function drawResults() {
  bg("#3b1b5e", "#140c2e");
  outlined(g, S.result.headline || "Results", W / 2, 110, 76, "#ffd23f");
  const rows = S.deltas, rh = Math.min(100, 760 / rows.length);
  const winners = S.result.tie ? [] : S.result.winners || S.result.ranking[0];
  rows.forEach(({ p, d }, i) => {
    const y = 230 + i * rh, k = Math.min(1, Math.max(0, S.t * 2.5 - i * 0.25)), x = 420 - (1 - k) * 800;
    rrect(g, x, y, 1080, rh - 16, (rh - 16) / 2, winners.includes(p.pid) ? "rgba(255,210,63,.25)" : "rgba(255,255,255,.08)");
    blob(g, p, x + 60, y + (rh - 16) / 2, (rh - 16) * 0.42);
    text(g, p.name, x + 130, y + (rh - 16) / 2, 40, p.color, "left");
    text(g, `+${d}`, x + 820, y + (rh - 16) / 2, 44, "#ffd23f", "right");
    text(g, `${p.score}`, x + 1030, y + (rh - 16) / 2, 44, "#fff", "right");
  });
  text(g, "this game", 420 + 740, 200, 24, "rgba(255,255,255,.5)", "center", 600);
  text(g, "total", 420 + 990, 200, 24, "rgba(255,255,255,.5)", "center", 600);
  text(g, S.round + 1 >= S.rounds ? "Final results next…" : `Next: round ${S.round + 2} of ${S.rounds}`, W / 2, 1030, 32, "rgba(255,255,255,.6)", "center", 600);
}

function drawFinal() {
  bg("#5e3b1b", "#2e140c");
  outlined(g, "And the winner is…", W / 2, 90, 70, "#fff");
  const list = standings();
  const pods = [[1, 520, 300], [0, 820, 400], [2, 1120, 220]];
  for (const [rank, x, h] of pods) {
    const p = list[rank];
    if (!p) continue;
    const top = 900 - h;
    rrect(g, x - 130, top, 260, h, 20, ["#ffd23f", "#c9d2e3", "#e0a370"][rank], "rgba(0,0,0,.3)", 5);
    outlined(g, String(rank + 1), x, top + 70, 90, "#fff");
    const jump = rank === 0 ? Math.abs(Math.sin(S.t * 4)) * 40 : 0;
    blob(g, p, x, top - 90 - jump, rank === 0 ? 90 : 72, { crown: rank === 0 });
    text(g, `${p.name} · ${p.score}`, x, top + 150, 36, "#16182b");
  }
  list.slice(3).forEach((p, i) => text(g, `${i + 4}. ${p.name} · ${p.score}`, 820, 950 + i * 36, 28, "rgba(255,255,255,.7)", "center", 600));
  // awards
  rrect(g, 1330, 170, 540, 760, 30, "rgba(255,255,255,.08)");
  text(g, "Awards", 1600, 225, 44, "#ffd23f");
  let y = 300;
  for (const [key, name, unit] of AWARDS) {
    const best = [...S.players].sort((a, b) => (b.stats[key] || 0) - (a.stats[key] || 0))[0];
    if (!best || !best.stats[key]) continue;
    star(g, 1375, y, 20);
    text(g, name, 1410, y - 16, 30, "#fff", "left");
    text(g, `${best.name} — ${best.stats[key]} ${unit}`, 1410, y + 20, 26, best.color, "left", 700);
    y += 80;
    if (y > 880) break;
  }
  text(g, "VIP: rematch or back to lobby from your phone · Enter to rematch", W / 2, 1000, 28, "rgba(255,255,255,.6)", "center", 600);
}

function draw() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (S.scene === "gate") drawGate();
  else if (S.scene === "lobby") drawLobby();
  else if (S.scene === "choose") drawChoose();
  else if (S.scene === "intro") drawIntro();
  else if (S.scene === "game") S.game.draw(g);
  else if (S.scene === "results") drawResults();
  else if (S.scene === "final") drawFinal();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ setup */

async function open() {
  if (S.scene !== "gate" || S.opening) return;
  S.opening = true;
  unlock();
  S.net = await hostRoom({ onJoin, onLeave, onInput });
  const base = S.net.joinUrl;
  S.joinUrl = S.net.mode === "relay" ? base : base + "index.html";
  if (S.net.mode === "relay") S.qr = qr(`${base}?room=${S.net.code}`);
  go("lobby");
  refreshMenus();
  setInterval(() => { for (const p of humans()) send(p, { t: "ping", ts: performance.now() }); }, 2000);
}

addEventListener("pointerdown", () => { unlock(); open(); });
addEventListener("keydown", (e) => {
  unlock();
  if (S.scene === "gate") return open();
  const k = e.key.toLowerCase();
  if (k === "enter") act(S.scene === "final" ? "rematch" : "start");
  else if (k === "b") act("addbot");
  else if (k === "n") act("rmbot");
  else if (k === "r") act("rounds");
  else if (S.scene === "choose" && ["1", "2", "3"].includes(k) && !S.picked && S.options[+k - 1]) pick(S.options[+k - 1].id);
});

const tool = (id, fn) => document.getElementById(id).addEventListener("click", (e) => { e.stopPropagation(); fn(); });
tool("t-start", () => act(S.scene === "final" ? "rematch" : "start"));
tool("t-rounds", () => act("rounds"));
tool("t-bot", () => act("addbot"));
tool("t-rmbot", () => act("rmbot"));
tool("t-tab", () => window.open(`index.html?room=${S.net.code}`, "_blank"));
