// The TV: owns the room and all game state. Phones only send intents and
// render the layouts we send them (see index.html / controller.js).

import { hostRoom } from "./net.js";
import { W, H, INK, POP, T, fit, grid, neon, text, outlined, rrect, shout, sunburst, halftone, panel, bomb, circle, blob, tag, star, shade } from "./gfx.js";
import { qr } from "./qr.js";
import { sfx, unlock } from "./sfx.js";
import flap from "./games/flap.js";
import sling from "./games/sling.js";
import chomp from "./games/chomp.js";
import gauntlet from "./games/gauntlet.js";
import snipe, { blackout } from "./games/snipe.js";

const GAMES = [flap, sling, chomp, snipe, blackout];
// canvas text only uses a web font once it's loaded; ask for both up front
for (const f of [T.display, T.label]) document.fonts?.load(`40px ${f}`).catch(() => {});
const COLORS = ["#ff2e63", "#00b7ff", "#ffd400", "#35e06b", "#b14dff", "#ff8a00", "#ff6ec7", "#00e0c6"];
const BOT_NAMES = ["Wobbles", "Gloop", "Jiggly", "Squish", "Blorp", "Mochi", "Puddin", "Boing"];
const MAX = 8;
const POINTS = [10, 6, 4, 2, 1, 1, 1, 1];
const ROUND_CHOICES = [3, 5, 8];
const AWARDS = [
  ["wins", "Champion", "wins"], ["flaps", "Flappiest", "flaps"], ["airtime", "Frequent flyer", "s aloft"],
  ["kings", "Kingslayer", "kings popped"], ["blocks", "Demolition crew", "blocks smashed"],
  ["dots", "Hungriest", "dots eaten"], ["cleared", "Microgame machine", "microgames cleared"],
  ["snipes", "Deadeye", "runners sniped"], ["loot", "Master thief", "coins stolen"], ["catches", "Best hunter", "catches"], ["gulps", "Tables turned", "hunters gulped"],
];

// Everything draws at 1920×1080 into an offscreen scene; post() then runs the
// grit pass onto the visible canvas: half-res pixels, chromatic aberration,
// camera sway and shake, scanlines, grain and a vignette.
const canvas = document.getElementById("screen");
const out = canvas.getContext("2d");
const mkCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
const sceneC = mkCanvas(W, H);
const g = sceneC.getContext("2d");
const S = {
  scene: "gate", t: 0, players: [], rounds: 5, round: 0, net: null, qr: null, joinUrl: "",
  mode: "playlist", game: null, def: null, chooser: null, options: null, picked: null, lastGameId: null,
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
  else if (id === "mode" && S.scene === "lobby") { S.mode = S.mode === "playlist" ? "gauntlet" : "playlist"; refreshMenus(); }
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
          { id: "mode", label: S.mode === "gauntlet" ? "Mode: Gauntlet" : "Mode: Playlist" },
          ...(S.mode === "playlist" ? [{ id: "rounds", label: `Rounds: ${S.rounds}` }] : []), { id: "addbot", label: "+ Add bot" }, { id: "rmbot", label: "− Remove bot" }] }
        : { kind: "menu", text: "You're in!", sub: `Waiting for ${v ? v.name : "the VIP"} to start…` });
    } else if (S.scene === "final") {
      layout(p.pid, { kind: "menu", text: finalLine(p), sub: p === v ? "Play again?" : `Waiting for ${v?.name}…`, actions: p === v ? [{ id: "rematch", label: "↻ Rematch", big: true }, { id: "lobby", label: "Back to lobby" }] : [] });
    }
  }
  const el = document.getElementById("tools");
  el.hidden = !(S.scene === "lobby" || S.scene === "final");
  document.getElementById("t-start").textContent = S.scene === "final" ? "Rematch (Enter)" : "Start (Enter)";
  document.getElementById("t-rounds").textContent = `Rounds: ${S.rounds} (R)`;
  document.getElementById("t-mode").textContent = `Mode: ${S.mode === "gauntlet" ? "Gauntlet" : "Playlist"} (G)`;
  for (const id of ["t-tab", "t-mode", "t-rounds", "t-bot", "t-rmbot"]) document.getElementById(id).hidden = S.scene !== "lobby";
  if (S.mode === "gauntlet") document.getElementById("t-rounds").hidden = true;
}

function finalLine(p) {
  const place = standings().indexOf(p) + 1;
  return place === 1 ? "You won! 🏆" : `You finished #${place}`;
}

/* ----------------------------------------------------------------- scenes */

function go(scene) { S.scene = scene; S.t = 0; if (scene !== "lobby") { S.wipe = performance.now(); sfx.whoosh?.(); } }

function startSession() {
  for (const p of S.players) { p.score = 0; p.stats = {}; }
  S.roleCounts = {}; S.round = 0; S.lastGameId = null;
  S.players = S.players.filter((p) => p.bot || p.connected);
  document.getElementById("tools").hidden = true;
  if (S.mode === "gauntlet") { S.picked = gauntlet; startIntro(); }
  else startChoose();
}

const sessionRounds = () => (S.mode === "gauntlet" ? 1 : S.rounds);

function standings() { return [...S.players].sort((a, b) => b.score - a.score); }

function startChoose() {
  const n = S.players.length;
  let pool = GAMES.filter((d) => n >= d.min && n <= d.max);
  // three random picks, never the game just played unless there's no choice
  pool = pool.filter((d) => d.id !== S.lastGameId).sort(() => Math.random() - 0.5).concat(pool.filter((d) => d.id === S.lastGameId));
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
    send: (pid, m) => send(byPid(pid), m),
    shake: (n) => { S.shake = Math.max(S.shake || 0, n); if (n >= 25) S.hitstop = 0.09; }, // big hits freeze a beat
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
  layoutAll(() => ({ kind: "wait", text: S.def.command, sub: S.def.controls, shout: true }));
  setTimeout(() => sfx.slam(), 120);
}

function finishGame() {
  const r = S.game.result;
  const deltas = new Map();
  if (r.tie) for (const pid of r.ranking.flat()) deltas.set(pid, 5);
  else if (r.winners) { r.winners.forEach((pid) => deltas.set(pid, 10)); r.losers.forEach((pid) => deltas.set(pid, 2)); }
  else { let place = 0; for (const grp of r.ranking) { for (const pid of grp) deltas.set(pid, POINTS[place]); place += grp.length; } }
  for (const [pid, d] of Object.entries(r.bonus || {})) deltas.set(pid, (deltas.get(pid) || 0) + d); // e.g. top thief
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
    if (S.hitstop > 0) { S.hitstop -= dt; return; }
    for (const p of S.players) if (p.bot || !p.connected) S.game.bot(p.pid, dt);
    S.game.update(dt);
    if (S.game.result) finishGame();
  } else if (S.scene === "results") {
    if (S.t > 6.5) {
      S.round++;
      if (S.round >= sessionRounds()) { go("final"); sfx.win(); refreshMenus(); }
      else startChoose();
    }
  }
}

/* ---------------------------------------------------------------- drawing */

const QUIPS = [
  "No bones. No mercy.", "Your friends are the enemy tonight.", "Tap fast. Die faster.",
  "Somebody's getting splattered.", "Jelly on the walls. Jelly on the floor.", "Do you like hurting other blobs?",
];

function bg(hue, cx = W / 2, cy = H / 2, floor = true) {
  const h = hue + Math.sin(S.t * 0.7) * 18;
  sunburst(g, cx, cy, `hsl(${h} 75% 9%)`, `hsl(${h + 25} 85% 16%)`, S.t * 0.6, 22);
  if (floor) grid(g, S.t, `hsl(${h + 60} 100% 60%)`);
}

function title(y, size) {
  neon(g, "Jellybrawl", W / 2, y, size, "#ff2a6d", -0.08, S.t);
}

function drawSeat(p, x, y, r = 70) {
  const sq = Math.sin(p.bob * 6) * 0.08;
  g.beginPath(); g.ellipse(x, y + r * 0.98, r * 0.8, r * 0.17, 0, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.35)"; g.fill();
  blob(g, p, x, y - Math.abs(Math.sin(p.bob * 3)) * 14, r, { sx: 1 + sq, sy: 1 - sq, alpha: p.connected || p.bot ? 1 : 0.35 });
  tag(g, p.name, x, y + r + 34, p.color, 30);
  const sub = p.bot ? "🤖 BOT" : !p.connected ? "reconnecting…" : p.rtt != null ? `${Math.round(p.rtt)} ms` : "…";
  text(g, sub, x, y + r + 78, 24, p.rtt > 150 ? "#ff2a6d" : "#fff", "center", 900);
  if (p === vip() && S.scene === "lobby") { outlined(g, "VIP", x + r * 0.9, y - r * 0.9, 34, "#ffd400", "center", 0.3); }
}

function drawGate() {
  bg(280);
  title(300, 250);
  panel(g, W / 2 - 560, 540, 1120, 90, "#fff", 20);
  text(g, "Party games on the TV. Phones are the controllers.", W / 2, 586, 42, INK, "center", 900);
  shout(g, "PRESS ANY KEY", W / 2, 780, 90, "#fff", (S.t % 1.2));
}

function drawLobby() {
  bg(270, 1300, 520);
  title(118, 138);
  text(g, QUIPS[Math.floor(S.t / 4) % QUIPS.length], W / 2 + 260, 196, 30, "#05d9e8", "center", 900);
  // join panel
  g.save(); g.translate(370, 620); g.rotate(-0.025); g.translate(-370, -620);
  panel(g, 70, 240, 600, 780, "#fff", 30);
  if (S.qr) {
    const n = S.qr.length, size = 400, cell = size / (n + 8), x0 = 370 - size / 2, y0 = 270;
    g.fillStyle = INK;
    S.qr.forEach((row, y) => row.forEach((d, x) => d && g.fillRect(x0 + (x + 4) * cell, y0 + (y + 4) * cell, cell + 0.5, cell + 0.5)));
    text(g, "SCAN IT or go to", 370, 710, 30, INK, "center", 900);
    text(g, S.joinUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), 370, 758, 40, "#ff2e63", "center", 900);
  } else {
    outlined(g, "NO RELAY!", 370, 340, 70, "#ff2e63", "center", -0.05);
    ["Controllers = other tabs of this", "browser (button below). Real", "phones: node server.mjs"].forEach((l, i) => text(g, l, 370, 440 + i * 50, 32, INK, "center", 900));
  }
  text(g, "ROOM CODE", 370, 835, 30, INK, "center", 900);
  outlined(g, S.net?.code || "····", 370, 935, 120, "#05d9e8", "center", 0.03);
  g.restore();
  for (let i = 0; i < MAX; i++) {
    const x = 860 + (i % 4) * 270, y = 380 + Math.floor(i / 4) * 330;
    const p = S.players[i];
    if (p) drawSeat(p, x, y);
    else {
      g.setLineDash([14, 12]); circle(g, x, y, 62, "rgba(255,255,255,.35)", INK, 5); g.setLineDash([]);
      outlined(g, "?", x, y, 70, "#fff", "center", Math.sin(S.t * 4 + i) * 0.2);
    }
  }
  const v = vip();
  panel(g, 820, 905, 960, 70, INK, 35, 0);
  text(g, `${S.mode === "gauntlet" ? "MICROGAME GAUNTLET · 3 LIVES" : `${S.rounds} ROUNDS`} · ${v ? `${v.name.toUpperCase()} (VIP) STARTS FROM THEIR PHONE` : "FIRST ONE IN IS THE VIP"}`, 1300, 940, 30, "#ffd400", "center", 900);
}

function scoreStrip(y = 1000) {
  const list = standings(), w = Math.min(230, 1800 / list.length);
  panel(g, W / 2 - (list.length * w) / 2 - 20, y - 50, list.length * w + 40, 100, "#fff", 50);
  list.forEach((p, i) => {
    const x = W / 2 - (list.length * w) / 2 + i * w + w / 2;
    blob(g, p, x - 45, y, 30);
    text(g, String(p.score), x + 10, y + 2, 40, INK, "left", 900);
  });
}

function drawChoose() {
  bg(330);
  const c = byPid(S.chooser);
  shout(g, c ? `${c.name.toUpperCase()} PICKS!` : "SPIN IT!", W / 2, 110, 100, "#fff", S.t);
  outlined(g, c ? `Dead last gets to choose. Pity rules. · Round ${S.round + 1}/${S.rounds}` : `Round ${S.round + 1} of ${S.rounds}`, W / 2, 205, 36, "#fff", "center", -0.02);
  const n = S.options.length, cw = 500, gap = 60;
  const spin = !S.picked && !S.chooser ? Math.floor(S.t * 10) % n : -1;
  S.options.forEach((d, i) => {
    const x = W / 2 - (n * cw + (n - 1) * gap) / 2 + i * (cw + gap), y = 290;
    const chosen = S.picked === d, lit = chosen || spin === i, dim = S.picked && !chosen;
    const s = chosen ? 1.08 + 0.04 * Math.sin(S.t * 20) : lit ? 1.04 : 1;
    g.save(); g.translate(x + cw / 2, y + 270); g.rotate((i - 1) * 0.05 + (chosen ? Math.sin(S.t * 30) * 0.03 : 0)); g.scale(s, s); g.translate(-(x + cw / 2), -(y + 270));
    g.globalAlpha = dim ? 0.4 : 1;
    panel(g, x, y, cw, 540, lit ? "#ffd400" : "#fff", 30, 8);
    outlined(g, d.command, x + cw / 2, y + 110, fit(g, d.command, 120, cw - 60), INK, "center", -0.03);
    text(g, d.title.toUpperCase(), x + cw / 2, y + 215, 40, INK, "center", 900);
    tag(g, d.kind, x + cw / 2, y + 272, "#00d1ff", 28);
    wrap(d.blurb, x + cw / 2, y + 340, cw - 70, 27, INK);
    rrect(g, x + 30, y + 440, cw - 60, 70, 12, "#eee");
    wrap(d.controls, x + cw / 2, y + (d.controls.length > 30 ? 460 : 475), cw - 90, 24, "#444");
    g.restore();
  });
  if (S.chooser && !S.picked) bomb(g, 150, 950, 55, 1 - S.t / 15);
  scoreStrip();
}

function wrap(str, x, y, maxW, size, color = "#fff") {
  g.font = `800 ${size}px ui-rounded, system-ui, sans-serif`;
  const words = str.split(" "), lines = [];
  let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  lines.forEach((l, i) => text(g, l, x, y + i * size * 1.3, size, color, "center", 800));
}

function drawIntro() {
  bg([330, 190, 280, 20, 150][S.round % 5], W / 2, 330, false);
  outlined(g, `ROUND ${S.round + 1}`, 170, 70, 44, "#fff", "center", -0.08);
  shout(g, S.def.command, W / 2, 310, fit(g, S.def.command, 320, W - 200), "#fff", S.t);
  if (S.t > 0.35) {
    const lines = S.game.describe();
    panel(g, W / 2 - 600, 500, 1200, 200 + lines.length * 44, "#fff", 30);
    text(g, S.def.title.toUpperCase() + " · " + S.def.kind.toUpperCase(), W / 2, 550, 36, "#ff2e63", "center", 900);
    text(g, S.def.blurb, W / 2, 610, fit(g, S.def.blurb, 40, 1120), INK, "center", 900);
    lines.forEach((l, i) => text(g, l, W / 2, 670 + i * 44, 32, "#555", "center", 900));
    tag(g, "🎮 " + S.def.controls, W / 2, 790 + lines.length * 44, "#ffd400", 36);
  }
  bomb(g, 160, 960, 60, 1 - S.t / 4.5);
}

function drawResults() {
  bg(195);
  shout(g, S.result.headline || "RESULTS!", W / 2, 105, fit(g, S.result.headline || "RESULTS!", 80, W - 200), "#fff", S.t);
  const rows = S.deltas, rh = Math.min(104, 760 / rows.length);
  const winners = S.result.tie ? [] : S.result.winners || S.result.ranking[0];
  rows.forEach(({ p, d }, i) => {
    const y = 220 + i * rh, k = Math.min(1, Math.max(0, S.t * 3 - i * 0.3)), x = 420 - (1 - k) * 1600;
    const h = rh - 18, won = winners.includes(p.pid);
    g.save(); g.translate(x + 540, y + h / 2); g.rotate((i % 2 ? 1 : -1) * 0.012); g.translate(-(x + 540), -(y + h / 2));
    panel(g, x, y, 1080, h, won ? "#ffd400" : "#fff", 16, 6);
    blob(g, p, x + 60, y + h / 2, h * 0.4);
    text(g, p.name, x + 125, y + h / 2, 42, INK, "left", 900);
    text(g, `${p.score}`, x + 1040, y + h / 2, 44, INK, "right", 900);
    g.restore();
    if (k >= 1) {
      const sk = S.t * 3 - i * 0.3 - 1;
      if (sk > 0) shout(g, `+${d}`, x + 800, y + h / 2, 64, won ? "#f9f002" : "#fff", sk);
    }
    if (won && k >= 1) outlined(g, "WIN!", x - 60, y + h / 2, 44, "#ff2e63", "center", -0.3);
  });
  outlined(g, S.round + 1 >= sessionRounds() ? "FINAL RESULTS NEXT…" : `NEXT: ROUND ${S.round + 2} OF ${S.rounds}`, W / 2, 1020, 36, "#fff", "center", -0.02);
}

function drawFinal() {
  bg(15, 820, 700);
  shout(g, "AND THE WINNER IS…", W / 2, 90, 80, "#fff", Math.min(S.t, 1));
  const list = standings();
  for (const [rank, x, h] of [[1, 520, 300], [0, 820, 400], [2, 1120, 220]]) {
    const p = list[rank];
    if (!p) continue;
    const top = 900 - h;
    panel(g, x - 130, top, 260, h, ["#ffd400", "#dfe6f0", "#ff8a00"][rank], 12, 7);
    outlined(g, String(rank + 1), x, top + 75, 100, "#fff", "center", -0.08);
    const jump = rank === 0 ? Math.abs(Math.sin(S.t * 5)) * 50 : 0;
    blob(g, p, x, top - 90 - jump, rank === 0 ? 95 : 72, { crown: rank === 0 });
    text(g, p.name, x, top + 160, 38, INK, "center", 900);
    text(g, `${p.score} pts`, x, top + 200, 30, INK, "center", 800);
  }
  list.slice(3).forEach((p, i) => outlined(g, `${i + 4}. ${p.name} · ${p.score}`, 820, 950 + i * 40, 30, "#fff"));
  g.save(); g.translate(1600, 560); g.rotate(0.025); g.translate(-1600, -560);
  panel(g, 1330, 170, 540, 760, "#fff", 26);
  outlined(g, "AWARDS!", 1600, 225, 56, "#ff2e63", "center", -0.05);
  let y = 305;
  for (const [key, name, unit] of AWARDS) {
    const best = [...S.players].sort((a, b) => (b.stats[key] || 0) - (a.stats[key] || 0))[0];
    if (!best || !best.stats[key]) continue;
    star(g, 1380, y, 22, "#ffd400", INK);
    text(g, name.toUpperCase(), 1415, y - 16, 28, INK, "left", 900);
    text(g, `${best.name} — ${best.stats[key]} ${unit}`, 1415, y + 20, 26, "#555", "left", 800);
    y += 80;
    if (y > 880) break;
  }
  g.restore();
  outlined(g, "VIP: REMATCH FROM YOUR PHONE · ENTER TO REMATCH", 700, 1030, 30, "#fff");
}

// scene change: a diagonal striped wipe slams across
function drawWipe() {
  if (S.wipe == null) return;
  const k = (performance.now() - S.wipe) / 450;
  if (k >= 1) { S.wipe = null; return; }
  const x = -W * 0.6 + k * W * 2.2;
  g.save(); g.translate(x, 0); g.rotate(0.25);
  POP.forEach((c, i) => { g.fillStyle = i % 2 ? INK : c; g.fillRect(-900 + i * 110, -800, 110, H * 3); });
  g.restore();
}

const LW = W / 2, LH = H / 2;
const low = mkCanvas(LW, LH), lg = low.getContext("2d");
const chans = ["#ff0000", "#00ffff"].map((color) => { const c = mkCanvas(LW, LH); return { c, g: c.getContext("2d"), color }; });
const overlay = (() => {
  const c = mkCanvas(W, H), o = c.getContext("2d");
  o.fillStyle = "rgba(0,0,0,.22)";
  for (let y = 0; y < H; y += 4) o.fillRect(0, y, W, 2);
  const v = o.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.65)");
  o.fillStyle = v; o.fillRect(0, 0, W, H);
  return c;
})();
const grain = [0, 1, 2].map(() => {
  const c = mkCanvas(480, 270), o = c.getContext("2d"), img = o.createImageData(480, 270);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  o.putImageData(img, 0, 0);
  return c;
});

function post() {
  lg.imageSmoothingEnabled = true;
  lg.drawImage(sceneC, 0, 0, LW, LH);
  for (const ch of chans) {
    ch.g.globalCompositeOperation = "copy"; ch.g.drawImage(low, 0, 0);
    ch.g.globalCompositeOperation = "multiply"; ch.g.fillStyle = ch.color; ch.g.fillRect(0, 0, LW, LH);
  }
  S.shake = Math.max(0, (S.shake || 0) - 0.9);
  const sh = S.shake, now = performance.now() / 1000;
  out.save();
  out.imageSmoothingEnabled = false;
  out.fillStyle = INK; out.fillRect(0, 0, W, H);
  out.translate(W / 2 + (Math.random() - 0.5) * sh, H / 2 + (Math.random() - 0.5) * sh);
  out.rotate(Math.sin(now * 0.5) * 0.006 + (Math.random() - 0.5) * sh * 0.0015);
  out.scale(1.02, 1.02);
  out.translate(-W / 2, -H / 2);
  out.drawImage(low, 0, 0, W, H);
  out.globalCompositeOperation = "screen";
  out.globalAlpha = 0.28;
  const ab = 4 + sh * 0.4;
  out.drawImage(chans[0].c, ab, 0, W, H);
  out.drawImage(chans[1].c, -ab, 0, W, H);
  out.restore();
  out.drawImage(overlay, 0, 0);
  out.save();
  out.globalCompositeOperation = "overlay"; out.globalAlpha = 0.18;
  out.drawImage(grain[Math.floor(Math.random() * 3)], 0, 0, W, H);
  out.restore();
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
  drawWipe();
  post();
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
  else if (k === "g") act("mode");
  else if (S.scene === "choose" && ["1", "2", "3"].includes(k) && !S.picked && S.options[+k - 1]) pick(S.options[+k - 1].id);
});

const tool = (id, fn) => document.getElementById(id).addEventListener("click", (e) => { e.stopPropagation(); fn(); });
tool("t-start", () => act(S.scene === "final" ? "rematch" : "start"));
tool("t-rounds", () => act("rounds"));
tool("t-mode", () => act("mode"));
tool("t-bot", () => act("addbot"));
tool("t-rmbot", () => act("rmbot"));
tool("t-tab", () => window.open(`index.html?room=${S.net.code}`, "_blank"));
