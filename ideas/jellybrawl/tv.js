// The TV: owns the room and all game state. Phones only send intents and
// render the layouts we send them (see index.html / controller.js).

import { hostRoom } from "./net.js";
import { W, H, INK, POP, T, fit, grid, neon, text, outlined, rrect, shout, sunburst, halftone, panel, bomb, circle, blob, tag, star, shade, CRISP, flushCrisp, FX, PREFS } from "./gfx.js";
import { qr } from "./qr.js";
import { sfx, unlock, music, setMix } from "./sfx.js";
import flap from "./games/flap.js";
import sling from "./games/sling.js";
import chomp from "./games/chomp.js";
import gauntlet from "./games/gauntlet.js";
import snipe, { blackout } from "./games/snipe.js";
import tagGame from "./games/tag.js";
import kaiju from "./games/kaiju.js";
import soccer from "./games/soccer.js";
import sumo from "./games/sumo.js";
import bumper from "./games/bumper.js";
import coinrush from "./games/coinrush.js";
import potato from "./games/potato.js";
import paint from "./games/paint.js";
import crown from "./games/crown.js";
import dodgeball from "./games/dodgeball.js";
import snake from "./games/snake.js";
import tug from "./games/tug.js";
import relay from "./games/relay.js";
import stack from "./games/stack.js";
import bombsquad from "./games/bombsquad.js";
import maze from "./games/maze.js";
import drawDuel from "./games/draw.js";
import haunted from "./games/haunted.js";
import whack from "./games/whack.js";
import kraken from "./games/kraken.js";
import tank from "./games/tank.js";
import hill from "./games/hill.js";
import pilot from "./games/pilot.js";
import greed from "./games/greed.js";
import { makeBoard } from "./board.js";
import { MAP_NAMES } from "./boards.js";

const GAMES = [flap, sling, chomp, snipe, blackout, tagGame, kaiju, soccer, sumo, bumper, coinrush, potato, paint, crown, dodgeball, snake, tug, relay, stack, bombsquad, maze, drawDuel, haunted, whack, kraken, tank, hill, pilot, greed];
// what you mostly *do* in each game; the picker offers three different ones
const CATEGORY = {
  brawl: ["sumo", "bumper", "potato", "tag", "hill", "crown", "coinrush", "paint", "soccer", "dodgeball", "snake"],
  hunt: ["chomp", "snipe", "blackout", "kaiju", "haunted", "tank", "kraken", "whack"],
  race: ["relay", "maze", "pilot"],
  timing: ["flap", "stack", "tug"],
  brains: ["bombsquad", "draw", "greed"],
  aim: ["sling"],
};
const catOf = (id) => Object.keys(CATEGORY).find((c) => CATEGORY[c].includes(id)) || "brawl";
// near-twins never appear side by side
const FAMILY = { sumo: "shove", bumper: "shove", snipe: "sniper", blackout: "sniper", crown: "hold", hill: "hold" };
const famOf = (d) => FAMILY[d.id] || d.id;
// canvas text only uses a web font once it's loaded; ask for both up front
for (const f of [T.display, T.label]) document.fonts?.load(`40px ${f}`).catch(() => {});
const COLORS = ["#ff2e63", "#00b7ff", "#ffd400", "#35e06b", "#b14dff", "#ff8a00", "#ff6ec7", "#00e0c6"];
const MARKS = ["●", "▲", "■", "◆", "★", "✚", "✖", "♥"]; // one per colour, for colour-blind mode

/* ---------------------------------------------------------------- settings
   Kept on the TV (localStorage). Reduced motion follows the system setting
   until someone picks. */
const SETTINGS = {
  motion: { label: "Motion", values: ["full", "reduced"], names: { full: "Full", reduced: "Reduced" } },
  crt: { label: "CRT filter", values: ["full", "light", "off"], names: { full: "Full", light: "Light", off: "Off" } },
  text: { label: "Text size", values: [1, 1.25, 1.5], names: { 1: "Normal", 1.25: "Large", 1.5: "Huge" } },
  marks: { label: "Colour-blind shapes", values: [false, true], names: { false: "Off", true: "On" } },
  bright: { label: "Brightness boost", values: [false, true], names: { false: "Off", true: "On" } },
  haptics: { label: "Phone buzz", values: [true, false], names: { true: "On", false: "Off" } },
  music: { label: "Music", values: [true, false], names: { true: "On", false: "Off" } },
  sounds: { label: "Sound effects", values: [true, false], names: { true: "On", false: "Off" } },
};
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("jb-settings") || "{}"); } catch {}
  const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return { motion: reduced ? "reduced" : "full", crt: "full", text: 1, marks: false, bright: false, haptics: true, music: true, sounds: true, ...saved };
}
function applySettings() {
  PREFS.motion = S.opt.motion === "reduced" ? 0.25 : 1;
  PREFS.marks = S.opt.marks; PREFS.text = S.opt.text;
  setMix({ music: S.opt.music ? 1 : 0, sfx: S.opt.sounds ? 1 : 0 });
  try { localStorage.setItem("jb-settings", JSON.stringify(S.opt)); } catch {}
}
const BOT_NAMES = ["Wobbles", "Gloop", "Jiggly", "Squish", "Blorp", "Mochi", "Puddin", "Boing"];
const MAX = 8;
const POINTS = [10, 6, 4, 2, 1, 1, 1, 1];
const ROUND_CHOICES = [3, 5, 8];
const MODES = ["playlist", "board", "gauntlet"];
const MODE_NAME = { playlist: "Playlist", board: "Board", gauntlet: "Gauntlet" };
const AWARDS = [
  ["wins", "Champion", "wins"], ["flaps", "Flappiest", "flaps"], ["airtime", "Frequent flyer", "s aloft"],
  ["kings", "Kingslayer", "kings popped"], ["blocks", "Demolition crew", "blocks smashed"],
  ["dots", "Hungriest", "dots eaten"], ["cleared", "Microgame machine", "microgames cleared"], ["bosses", "Boss slayer", "bosses beaten"],
  ["stars", "Star collector", "stars bought"], ["duels", "Duelist", "duels won"],
  ["snipes", "Deadeye", "runners sniped"], ["tags", "Patient zero", "blobs infected"],
  ["goals", "Striker", "goals"], ["shoves", "Sumo slammer", "big shoves"], ["coins", "Coin magnet", "coins grabbed"], ["passes", "Hot hands", "bomb passes"],
  ["painted", "Painter", "tiles painted"], ["splats", "Splatter", "rivals splatted"], ["crown", "Royalty", "s wearing the crown"], ["knocks", "Crown thief", "crowns knocked off"],
  ["hits", "Dodgeball ace", "hits"], ["snacks", "Big appetite", "snacks eaten"], ["cutoffs", "Cut-off artist", "snakes cut off"], ["heaves", "Heave-ho", "HEAVE! taps"],
  ["legs", "Anchor leg", "relay legs run"], ["perfects", "Steady hands", "perfect drops"], ["defused", "Bomb whisperer", "modules defused"], ["votes", "Crowd favourite", "votes"], ["plops", "Hole magnet", "falls down holes"],
  ["spooks", "Poltergeist", "hunters spooked"], ["zaps", "Ghostbuster", "beam hits"], ["gems", "Gem hoarder", "gems"], ["bonks", "Bonk master", "moles bonked"],
  ["slams", "Sea monster", "tentacle hits"], ["splatted", "Tank ace", "swarmers splatted"], ["gnaws", "Gnawer", "armour gnawed"], ["reign", "Giant", "s as king"], ["checkpoints", "Navigator", "checkpoints"], ["heckles", "Heckler", "goo bombs dropped"],
  ["squashes", "Stomper", "blobs squashed"], ["cannon", "Artillery", "cannon shots"], ["wrecked", "Wrecking ball", "buildings flattened"], ["loot", "Master thief", "coins stolen"], ["catches", "Best hunter", "catches"], ["gulps", "Tables turned", "hunters gulped"],
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
  mode: "playlist", boardMap: "random", game: null, def: null, chooser: null, options: null, picked: null, lastGameId: null,
  result: null, deltas: [], roleCounts: {}, layouts: new Map(), reacts: [], gctx: null, settingsOpen: false,
};
S.opt = loadSettings(); applySettings();
window.__jelly = S; // for tests and poking around in devtools
window.__finish = () => finishGame(); // tests: settle S.game.result now
window.__choose = () => startChoose(); // tests: deal a fresh set of options
window.__games = GAMES; // the preview page's screenshot script walks these

/* ---------------------------------------------------------------- players */

const humans = () => S.players.filter((p) => !p.bot);
const byPid = (pid) => S.players.find((p) => p.pid === pid);
const vip = () => humans().find((p) => p.connected);

function send(p, m) { if (p && !p.bot && p.connected && !(m.t === "buzz" && !S.opt.haptics)) S.net.send(p.pid, m); }
function layout(pid, obj) {
  const p = byPid(pid);
  if (!p) return;
  const l = { t: "layout", ...obj, you: { name: p.name, color: p.color } };
  if (S.capture) { S.capture.set(pid, l); return; } // the intro holds these back
  if (!S.opt.haptics) l.haptics = false;
  if (p === vip() && ["choose", "intro", "game", "results", "board", "duel"].includes(S.scene)) l.vip = true; // ⏸ on the VIP's phone
  // anyone waiting mid-game can react; knocked out of an arena game, they can heckle too
  if (l.kind === "wait" && ["game", "duel", "board", "intro", "results"].includes(S.scene)) { l.react = true; l.heckle = !!S.gctx?.arena?.stepping && S.scene === "game"; }
  S.layouts.set(pid, l);
  send(p, l);
}
const layoutAll = (fn) => S.players.forEach((p) => layout(p.pid, fn(p)));

function addPlayer(pid, name, bot = false) {
  const used = new Set(S.players.map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c));
  const p = { pid, name, bot, color, mark: MARKS[COLORS.indexOf(color)], face: null, connected: true, score: 0, stats: {}, rtt: null, bob: Math.random() * 6 };
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
  // rescanned the QR (a new tab, so a new pid)? Take back your old seat by name.
  const lost = S.players.find((q) => !q.bot && !q.connected && q.name.toLowerCase() === (name || "").slice(0, 12).toLowerCase());
  if (lost) {
    if (S.layouts.has(lost.pid)) { S.layouts.set(pid, S.layouts.get(lost.pid)); S.layouts.delete(lost.pid); }
    lost.pid = pid; // games read the pid through the player object, so they follow along
    return onJoin(pid, name);
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
    if (S.scene === "lobby") refreshMenus();
    return;
  }
  // every phone gets a message budget (60/s, bursts to 90), and a button
  // press only counts after a release, at most 14 a second: two thumbs or a
  // script can't out-mash a person
  const now = performance.now();
  p.budget = Math.min(90, (p.budget ?? 90) + ((now - (p.budgetAt ?? now)) / 1000) * 60); p.budgetAt = now;
  if (p.budget < 1) return;
  p.budget--;
  if (m.t === "btn") {
    if (m.down) {
      if (p.held) return;
      p.taps = (p.taps || []).filter((x) => now - x < 1000);
      if (p.taps.length >= 14) return;
      p.taps.push(now); p.held = true;
    } else p.held = false;
  }
  if (m.t === "react" && REACTS.includes(m.e) && now - (p.reactAt || 0) > 500) { p.reactAt = now; S.reacts.push({ e: m.e, p, t: 0, x: 120 + (S.players.indexOf(p) + 0.5) * ((W - 240) / S.players.length) + (Math.random() - 0.5) * 40 }); return; }
  if (m.t === "heckle" && S.scene === "game" && now - (p.heckleAt || 0) > 4000 && S.gctx?.arena?.heckle(p)) { p.heckleAt = now; p.stats.heckles = (p.stats.heckles || 0) + 1; return; }
  if (m.t === "noface") { p.noFace = true; if (S.scene === "lobby") refreshMenus(); return; }
  if (m.t === "act") return act(m.id, p);
  if (m.t === "pick" && S.scene === "choose" && pid === S.chooser && !S.picked) return pick(m.id);
  if ((S.scene === "game" || S.scene === "duel") && S.game && !p.bot) S.game.input(pid, m);
  if (S.scene === "board" && S.board && !p.bot) S.board.input(p, m);
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
  if (id === "ready" && S.scene === "intro" && p) { p.ready = true; return layout(p.pid, { kind: "wait", text: "READY!", sub: "Waiting for the others…" }); }
  const isVip = !p || p === vip();
  if (!isVip) return;
  if (id === "pause" && !S.paused && S.scene !== "lobby" && S.scene !== "final") return pause(true);
  if (id === "resume" && S.paused) return pause(false);
  if (id === "skip" && S.paused && (S.scene === "game" || S.scene === "intro") && S.game) {
    pause(false);
    if (S.scene === "intro") go("game");
    S.game.result = { skipped: true, tie: true, ranking: [(S.game.players ?? S.players).map((q) => q.pid)], headline: "Skipped! No points." };
    return;
  }
  if (id === "end" && S.paused) { pause(false); S.game = null; go("final"); sfx.win(); return refreshMenus(); }
  if (id === "settings" && S.scene === "lobby") { S.settingsOpen = !S.settingsOpen; return refreshMenus(); }
  if (id.startsWith("set-") && SETTINGS[id.slice(4)]) {
    const k = id.slice(4), vals = SETTINGS[k].values;
    S.opt[k] = vals[(vals.indexOf(S.opt[k]) + 1) % vals.length];
    applySettings(); return refreshMenus();
  }
  if (id === "start" && S.scene === "lobby" && S.players.length >= 2) startSession();
  else if (id === "rounds" && S.scene === "lobby") { S.rounds = ROUND_CHOICES[(ROUND_CHOICES.indexOf(S.rounds) + 1) % ROUND_CHOICES.length]; refreshMenus(); }
  else if (id === "map" && S.scene === "lobby") { const k = Object.keys(MAP_NAMES); S.boardMap = k[(k.indexOf(S.boardMap) + 1) % k.length]; refreshMenus(); }
  else if (id === "mode" && S.scene === "lobby") { S.mode = MODES[(MODES.indexOf(S.mode) + 1) % MODES.length]; refreshMenus(); }
  else if (id === "addbot" && S.scene === "lobby") addBot();
  else if (id === "rmbot" && S.scene === "lobby") removeBot();
  else if (id === "rematch" && S.scene === "final") startSession();
  else if (id === "lobby" && S.scene === "final") { S.players = S.players.filter((q) => q.bot || q.connected); go("lobby"); refreshMenus(); }
}

// "3 players ready · Ben is still picking a face"
function lobbyLine() {
  const picking = humans().filter((p) => p.connected && !p.face && !p.noFace);
  return `${S.players.length} players` + (picking.length ? ` · ${picking.map((p) => p.name).join(", ")} still picking a face` : " ready");
}

function refreshMenus() {
  const v = vip();
  for (const p of humans()) {
    if (S.scene === "lobby" && p === v && S.settingsOpen) {
      layout(p.pid, { kind: "menu", text: "Settings", sub: "Saved on this TV.", actions: [
        ...Object.entries(SETTINGS).map(([k, s]) => ({ id: `set-${k}`, label: `${s.label}: ${s.names[S.opt[k]]}` })),
        { id: "settings", label: "✓ Done", big: true }] });
    } else if (S.scene === "lobby") {
      layout(p.pid, p === v
        ? { kind: "menu", text: "You're the VIP", sub: S.players.length < 2 ? "Waiting for one more player…" : lobbyLine(), actions: [
          ...(S.players.length >= 2 ? [{ id: "start", label: "▶ Start game", big: true }] : []),
          { id: "mode", label: `Mode: ${MODE_NAME[S.mode]}` },
          ...(S.mode === "board" ? [{ id: "map", label: `Board: ${MAP_NAMES[S.boardMap]}` }] : []),
          ...(S.mode !== "gauntlet" ? [{ id: "rounds", label: `${S.mode === "board" ? "Turns" : "Rounds"}: ${S.rounds}` }] : []), { id: "addbot", label: "+ Add bot" }, { id: "rmbot", label: "− Remove bot" }, { id: "settings", label: "⚙ Settings" }] }
        : { kind: "menu", text: "You're in!", sub: `Waiting for ${v ? v.name : "the VIP"} to start…` });
    } else if (S.scene === "final") {
      layout(p.pid, { kind: "menu", text: finalLine(p), sub: p === v ? "Play again?" : `Waiting for ${v?.name}…`, actions: p === v ? [{ id: "rematch", label: "↻ Rematch", big: true }, { id: "lobby", label: "Back to lobby" }] : [] });
    }
  }
  const el = document.getElementById("tools");
  el.hidden = !(S.scene === "lobby" || S.scene === "final");
  document.getElementById("t-start").textContent = S.scene === "final" ? "Rematch (Enter)" : "Start (Enter)";
  document.getElementById("t-rounds").textContent = `Rounds: ${S.rounds} (R)`;
  document.getElementById("t-mode").textContent = `Mode: ${MODE_NAME[S.mode]} (G)`;
  for (const id of ["t-tab", "t-mode", "t-rounds", "t-bot", "t-rmbot"]) document.getElementById(id).hidden = S.scene !== "lobby";
  // extra controllers in this browser only make sense without the relay
  if (S.net?.mode !== "local") document.getElementById("t-tab").hidden = true;
  else document.getElementById("t-tab").textContent = onePhone() ? "📱 Play on this phone" : "Open a controller tab";
  if (S.mode === "gauntlet") document.getElementById("t-rounds").hidden = true;
}

function finalLine(p) {
  const top = tiedTop();
  if (top.includes(p)) return top.length > 1 ? "Co-champions! 🏆" : "You won! 🏆";
  const s = standings(), place = s.findIndex((q) => rankKey(q) === rankKey(p) && tieKey(q) === tieKey(p)) + 1; // tied players share a place
  return `You finished #${place}`;
}

/* ----------------------------------------------------------------- scenes */

function go(scene) { S.scene = scene; S.t = 0; if (scene !== "lobby") { S.wipe = performance.now(); sfx.whoosh?.(); } }

function startSession() {
  for (const p of S.players) { p.score = 0; p.stats = {}; }
  S.roleCounts = {}; S.round = 0; S.lastGameId = null;
  S.players = S.players.filter((p) => p.bot || p.connected);
  document.getElementById("tools").hidden = true;
  if (S.mode === "gauntlet") { S.picked = gauntlet; startIntro(); }
  else if (S.mode === "board") { S.board = makeBoard(boardApi); S.board.newGame(); go("board"); S.board.startTurn(); }
  else startChoose();
}

const sessionRounds = () => (S.mode === "gauntlet" ? 1 : S.rounds);
// the last playlist round counts double, so nobody's out of it
const finalDouble = () => S.mode === "playlist" && S.rounds > 1 && S.round + 1 === S.rounds;

// board mode ranks by stars, then coins (p.score)
const rankKey = (p) => (S.mode === "board" ? (p.stars || 0) * 1e6 : 0) + p.score;
// ties: more minigame wins, then the better finish last game (never join order)
const tieKey = (p) => (p.stats.wins || 0) * 100 - (p.lastPlace ?? 99);
function standings() { return [...S.players].sort((a, b) => rankKey(b) - rankKey(a) || tieKey(b) - tieKey(a)); }
const tiedTop = () => { const s = standings(); return s.filter((p) => rankKey(p) === rankKey(s[0]) && tieKey(p) === tieKey(s[0])); };

const boardApi = {
  players: () => S.players,
  byPid, layout, sfx,
  send: (pid, m) => send(byPid(pid), m),
  shake: (n) => { S.shake = Math.max(S.shake || 0, n); },
  bg: (...a) => bg(...a),
  turns: () => S.rounds,
  get map() { return S.boardMap === "random" ? null : S.boardMap; },
  minigame: () => startChoose(),
  // a 1v1 duel: a single gauntlet microgame for the two of them
  duel: (a, b, done) => {
    S.duelDone = done;
    S.game = gauntlet.create({ ...gameCtx([a, b]), duel: true });
    go("duel");
    S.game.start();
  },
};

function startChoose() {
  const n = S.players.length;
  const all = GAMES.filter((d) => n >= d.min && n <= d.max);
  // three picks from three different categories (so the choice is a real
  // choice), no near-twins, and not the game (or family) just played
  const lastFam = S.lastGameId && famOf(GAMES.find((d) => d.id === S.lastGameId));
  const fresh = all.filter((d) => famOf(d) !== lastFam).sort(() => Math.random() - 0.5);
  // bigger categories come up more (weight √size), so lone Sling isn't in every set
  const size = (c) => fresh.filter((d) => catOf(d.id) === c).length;
  const cats = [...new Set(fresh.map((d) => catOf(d.id)))].map((c) => [c, Math.random() ** (1 / Math.sqrt(size(c)))]).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  S.options = [];
  for (const c of cats) { const d = fresh.find((x) => catOf(x.id) === c); if (d && S.options.length < 3) S.options.push(d); }
  for (const d of [...fresh, ...all]) if (S.options.length < 3 && !S.options.includes(d) && !S.options.some((o) => famOf(o) === famOf(d))) S.options.push(d);
  S.picked = null;
  // loser picks: last place chooses (random among ties); round 1 is a roulette
  const low = Math.min(...S.players.map(rankKey));
  const lows = S.players.filter((p) => rankKey(p) === low);
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
  S.gctx = gameCtx(S.players.slice());
  S.game = S.def.create(S.gctx);
  go("intro");
  // the game hands out its layouts now (so we know everyone's role); hold
  // them back and show a role card with READY until play starts
  S.capture = new Map();
  S.game.start();
  S.held = S.capture; S.capture = null;
  for (const p of S.players) {
    p.ready = false;
    const l = S.held.get(p.pid) || {};
    layout(p.pid, { kind: "menu", text: S.def.command, sub: `${l.role ? `${l.role} · ` : ""}${l.hint || S.def.controls}`, actions: [{ id: "ready", label: "READY!", big: true }], role: l.role });
  }
  setTimeout(() => sfx.slam(), 120);
}

// what a game gets to talk to the TV with
function gameCtx(seats) {
  return {
    players: seats,
    layout,
    sfx,
    send: (pid, m) => send(byPid(pid), m),
    shake: (n) => { S.shake = Math.max(S.shake || 0, n); if (n >= 25 && PREFS.motion === 1) S.hitstop = 0.09; }, // big hits freeze a beat
    buzz: (pid, ms) => send(byPid(pid), { t: "buzz", ms }),
    stat: (pid, k, n) => { const p = byPid(pid); if (p) p.stats[k] = (p.stats[k] || 0) + n; },
    lag: (pid) => Math.min(0.15, (byPid(pid)?.rtt || 0) / 2000), // one-way delay, for timing games
    pickOne: () => {
      const min = Math.min(...seats.map((p) => S.roleCounts[p.pid] || 0));
      // a clear leader often gets the lone role when they're due one: the room gangs up on them
      const top = tiedTop();
      if (S.mode === "playlist" && S.round > 0 && top.length === 1 && seats.includes(top[0]) && (S.roleCounts[top[0].pid] || 0) <= min + 1 && Math.random() < 0.6) {
        S.roleCounts[top[0].pid] = (S.roleCounts[top[0].pid] || 0) + 1;
        return top[0].pid;
      }
      const c = seats.filter((p) => (S.roleCounts[p.pid] || 0) === min);
      const one = c[Math.floor(Math.random() * c.length)].pid;
      S.roleCounts[one] = (S.roleCounts[one] || 0) + 1;
      return one;
    },
  };
}

function finishGame() {
  const r = S.game.result;
  const deltas = new Map();
  const before = standings();
  if (r.skipped) for (const pid of r.ranking.flat()) deltas.set(pid, 0);
  else if (r.tie) for (const pid of r.ranking.flat()) deltas.set(pid, 5);
  else if (r.winners) {
    // the lone role (1 vs rest) is worth more to win and costs less to lose
    const lone = r.winners.length === 1 && r.losers.length > 1 ? "won" : r.losers.length === 1 && r.winners.length > 1 ? "lost" : null;
    r.winners.forEach((pid) => deltas.set(pid, lone === "won" ? 15 : 10));
    r.losers.forEach((pid) => deltas.set(pid, lone === "lost" ? 5 : 2));
  }
  else { let place = 0; for (const grp of r.ranking) { for (const pid of grp) deltas.set(pid, POINTS[place]); place += grp.length; } }
  for (const [pid, d] of Object.entries(r.bonus || {})) deltas.set(pid, (deltas.get(pid) || 0) + d); // e.g. top thief
  S.double = finalDouble() && !r.skipped;
  if (S.double) for (const [pid, d] of deltas) deltas.set(pid, d * 2);
  const winners = r.tie ? [] : r.winners || r.ranking[0];
  for (const pid of winners) { const p = byPid(pid); if (p) p.stats.wins = (p.stats.wins || 0) + 1; }
  S.deltas = [...deltas].map(([pid, d]) => ({ p: byPid(pid), d })).filter((x) => x.p).sort((a, b) => b.d - a.d);
  for (const { p, d } of S.deltas) { p.score += d; p.lastPlace = S.deltas.findIndex((x) => x.d === d); } // a tie-breaker for the final
  // results list the whole race: rows slide from the old order to the new
  const after = standings();
  S.rows = after.map((p) => ({ p, d: deltas.get(p.pid) || 0, from: before.indexOf(p) }));
  const lead = tiedTop();
  S.leadChange = lead.length === 1 && lead[0] !== before[0] && lead[0].score > 0 ? lead[0] : null;
  S.result = r;
  S.game = null;
  go("results");
  for (const { p, d } of S.deltas) layout(p.pid, { kind: "wait", text: winners.includes(p.pid) ? "You won! 🎉" : `+${d} ${S.mode === "board" ? "coins" : "points"}`, sub: r.headline });
  for (const { p } of S.deltas) send(p, { t: "buzz", ms: winners.includes(p.pid) ? 300 : 80 });
}

// the VIP can pause any time from their phone (or P on the TV keyboard)
function pause(on) {
  S.paused = on;
  const v = vip();
  if (on) {
    for (const p of humans()) send(p, { t: "layout", kind: "menu", text: "PAUSED", sub: p === v ? "Take five." : `${v?.name ?? "The VIP"} paused the game.`, you: { name: p.name, color: p.color },
      actions: p === v ? [{ id: "resume", label: "▶ Resume", big: true }, ...(S.scene === "game" || S.scene === "intro" ? [{ id: "skip", label: "⏭ Skip this game" }] : []), { id: "end", label: "🏁 End the night" }] : [] });
  } else for (const p of humans()) { const l = S.layouts.get(p.pid); if (l) send(p, l); }
}

function tick(dt) {
  if (S.paused) return;
  S.t += dt;
  for (const p of S.players) p.bob += dt;
  if (S.scene === "choose") {
    const auto = !S.chooser || byPid(S.chooser)?.bot || !byPid(S.chooser)?.connected;
    if (!S.picked && ((auto && S.t > 2.5) || S.t > 15)) pick(S.options[Math.floor(Math.random() * S.options.length)].id);
    if (S.picked && S.t - S.pickedAt > 1.4) startIntro();
  } else if (S.scene === "intro") {
    // at least 4.5 s; then as soon as everyone's tapped READY (12 s at most)
    const waiting = humans().filter((p) => p.connected && !p.ready);
    if (S.t > 4.5 && (!waiting.length || S.t > 12)) {
      go("game");
      for (const [pid, l] of S.held) { const { t, you, ...rest } = l; layout(pid, rest); }
      S.held = new Map();
    }
  } else if (S.scene === "game") {
    if (S.hitstop > 0) { S.hitstop -= dt; return; }
    for (const p of S.players) if (p.bot || !p.connected) S.game.bot(p.pid, dt);
    S.game.update(dt);
    if (S.game.result) finishGame();
  } else if (S.scene === "board") {
    S.board.tick(dt);
  } else if (S.scene === "duel") {
    if (S.hitstop > 0) { S.hitstop -= dt; return; }
    for (const p of S.game.players || []) if (p.bot || !p.connected) S.game.bot(p.pid, dt);
    S.game.update(dt);
    if (S.game.result) { const r = S.game.result; S.game = null; go("board"); S.duelDone(r); }
  } else if (S.scene === "results") {
    if (S.t > 6.5) {
      S.round++;
      if (S.round >= sessionRounds()) { go("final"); sfx.win(); refreshMenus(); }
      else if (S.mode === "board") { go("board"); S.board.startTurn(); }
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
  text(g, `${S.mode === "gauntlet" ? "MICROGAME GAUNTLET · 3 LIVES" : S.mode === "board" ? `${MAP_NAMES[S.boardMap].toUpperCase()} BOARD · ${S.rounds} TURNS` : `${S.rounds} ROUNDS`} · ${v ? `${v.name.toUpperCase()} (VIP) STARTS FROM THEIR PHONE` : "FIRST ONE IN IS THE VIP"}`, 1300, 940, 30, "#ffd400", "center", 900);
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
  bomb(g, 160, 960, 60, 1 - S.t / 12);
  if (finalDouble()) outlined(g, "FINAL ROUND · DOUBLE POINTS!", W / 2, 440, 50, "#f9f002", "center", -0.03);
  // who's tapped READY
  const hs = humans().filter((p) => p.connected);
  hs.forEach((p, i) => { const x = W / 2 + (i - (hs.length - 1) / 2) * 110; blob(g, p, x, 1000, 34); if (p.ready) text(g, "✓", x + 34, 970, 40, "#39ff14", "center", 900); });
  if (S.t > 4.5 && hs.some((p) => !p.ready)) text(g, "TAP READY ON YOUR PHONE", W / 2, 1060, 28, "#fff", "center", 900);
}

function drawResults() {
  bg(195);
  shout(g, S.result.headline || "RESULTS!", W / 2, 105, fit(g, S.result.headline || "RESULTS!", 80, W - 200), "#fff", S.t);
  const rows = S.rows, rh = Math.min(104, 700 / rows.length);
  const winners = S.result.tie ? [] : S.result.winners || S.result.ranking[0];
  // rows arrive in the old order, then slide into the new standings
  const slide = Math.min(1, Math.max(0, (S.t - 1.6) / 0.6)), ease = slide * slide * (3 - 2 * slide);
  rows.forEach(({ p, d, from }, i) => {
    const y = 220 + (from + (i - from) * ease) * rh, k = Math.min(1, Math.max(0, S.t * 3 - from * 0.3)), x = 420 - (1 - k) * 1600;
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
  if (S.double) outlined(g, "DOUBLE POINTS!", 1640, 150, 44, "#f9f002", "center", 0.12);
  if (S.leadChange && S.t > 2.2) shout(g, `${S.leadChange.name} takes the lead!`, W / 2, 950, 60, "#f9f002", S.t - 2.2);
  outlined(g, S.round + 1 >= sessionRounds() ? "FINAL RESULTS NEXT…" : `NEXT: ROUND ${S.round + 2} OF ${S.rounds}`, W / 2, 1030, 36, "#fff", "center", -0.02);
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
    text(g, S.mode === "board" ? `★ ${p.stars || 0} · ${p.score} coins` : `${p.score} pts`, x, top + 200, 30, INK, "center", 800);
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
  // a light vignette that only reaches into the corners: HUDs live near the
  // edges, so the middle and the top/bottom bars stay clear
  const v = o.createRadialGradient(W / 2, H / 2, H * 0.65, W / 2, H / 2, Math.hypot(W, H) / 2);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.6, "rgba(0,0,0,.1)"); v.addColorStop(1, "rgba(0,0,0,.28)");
  o.fillStyle = v; o.fillRect(0, 0, W, H);
  return c;
})();
const grain = [0, 1, 2].map(() => {
  const c = mkCanvas(480, 270), o = c.getContext("2d"), img = o.createImageData(480, 270);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  o.putImageData(img, 0, 0);
  return c;
});

// CRT tiers: full (half-res, colour split, grain), light (half-res and
// scanlines only; also used automatically when frames run slow), off (clean)
function post() {
  const mode = S.opt.crt === "full" && S.slow ? "light" : S.opt.crt;
  if (mode !== "off") {
    lg.imageSmoothingEnabled = true;
    lg.drawImage(sceneC, 0, 0, LW, LH);
  }
  if (mode === "full") for (const ch of chans) {
    ch.g.globalCompositeOperation = "copy"; ch.g.drawImage(low, 0, 0);
    ch.g.globalCompositeOperation = "multiply"; ch.g.fillStyle = ch.color; ch.g.fillRect(0, 0, LW, LH);
  }
  S.shake = Math.min(30, Math.max(0, (S.shake || 0) - 0.9));
  const sh = S.shake * PREFS.motion, now = performance.now() / 1000;
  // a smooth wobble that dies away, not a new random jolt every frame
  out.save();
  out.imageSmoothingEnabled = mode === "off";
  out.fillStyle = INK; out.fillRect(0, 0, W, H);
  out.translate(W / 2 + Math.sin(now * 41) * sh * 0.45, H / 2 + Math.cos(now * 37) * sh * 0.45);
  out.rotate((Math.sin(now * 0.5) * 0.006 + Math.sin(now * 29) * sh * 0.0006) * PREFS.motion);
  if (mode !== "off") out.scale(1.02, 1.02);
  out.translate(-W / 2, -H / 2);
  const base = out.getTransform(); // the crisp labels follow the same sway and shake
  out.drawImage(mode === "off" ? sceneC : low, 0, 0, W, H);
  if (mode === "full") {
    out.globalCompositeOperation = "screen";
    out.globalAlpha = 0.28;
    const ab = 4 + Math.min(sh, 20) * 0.25;
    out.drawImage(chans[0].c, ab, 0, W, H);
    out.drawImage(chans[1].c, -ab, 0, W, H);
  }
  out.restore();
  if (mode !== "off") out.drawImage(overlay, 0, 0);
  if (mode === "full") {
    out.save();
    out.globalCompositeOperation = "overlay"; out.globalAlpha = 0.18;
    out.drawImage(grain[Math.floor(Math.random() * 3)], 0, 0, W, H);
    out.restore();
  }
  if (S.opt.bright) { out.save(); out.globalCompositeOperation = "screen"; out.fillStyle = "rgb(46,40,56)"; out.fillRect(0, 0, W, H); out.restore(); } // lifts the blacks
  flushCrisp(out, base);
}

// emoji from the phones float up from the bottom edge, each above its sender's slot
const REACTS = ["😂", "😱", "🔥", "👏", "💀", "🍿"];
function drawReacts() {
  const dt = FX.dt;
  S.reacts = S.reacts.filter((r) => (r.t += dt) < 2.2);
  for (const r of S.reacts) {
    g.save(); g.globalAlpha = Math.min(1, (2.2 - r.t) * 1.5);
    g.font = `${54 + r.t * 10}px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(r.e, r.x + Math.sin(r.t * 5 + r.x) * 18, H - 40 - r.t * 260);
    g.restore();
  }
}

function draw() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  CRISP.ctx = g; CRISP.q.length = 0;
  if (S.scene === "gate") drawGate();
  else if (S.scene === "lobby") drawLobby();
  else if (S.scene === "choose") drawChoose();
  else if (S.scene === "intro") drawIntro();
  else if (S.scene === "game") { S.game.draw(g); S.gctx?.arena?.drawHazards(g); }
  else if (S.scene === "board") S.board.draw(g, S.t);
  else if (S.scene === "duel") { S.game.draw(g); outlined(g, "DUEL · WINNER TAKES 10", W / 2, 1050, 30, "#b026ff"); }
  else if (S.scene === "results") drawResults();
  else if (S.scene === "final") drawFinal();
  drawReacts();
  if (S.paused) { g.fillStyle = "rgba(8,4,16,.72)"; g.fillRect(0, 0, W, H); shout(g, "PAUSED", W / 2, H / 2 - 40, 200, "#fff", 1); text(g, "VIP: RESUME FROM YOUR PHONE · P TO RESUME", W / 2, H / 2 + 110, 34, "#f9f002", "center", 900); }
  if (S.wipe != null) flushCrisp(g, new DOMMatrix()); // the wipe covers everything, labels too
  drawWipe();
  post();
}

let last = performance.now();
let crashes = 0;
function frame(now) {
  requestAnimationFrame(frame); // first, so one bad frame can't freeze the TV
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  FX.dt = S.paused || S.hitstop > 0 ? 0 : dt;
  // slow for ~3 s straight? drop the full CRT pass to the light one
  S.frameMs = (S.frameMs ?? 16) * 0.97 + dt * 1000 * 0.03;
  if (S.frameMs > 24) S.slowFor = (S.slowFor || 0) + dt; else S.slowFor = 0;
  if (S.slowFor > 3) S.slow = true;
  try { tick(dt); draw(); syncNav(); syncMusic(); }
  catch (err) {
    console.error(err);
    // a minigame that throws is abandoned as a tie rather than taking the night down with it
    if (++crashes < 50 && (S.scene === "game" || S.scene === "duel") && S.game && !S.game.result) {
      const g = S.game;
      g.update = g.bot = () => {}; g.draw = () => {};
      g.result = { tie: true, ranking: [(g.players ?? S.players).map((p) => p.pid)], headline: "Glitch in the jelly! Nobody scores." };
    }
  }
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
  else if (k === "m") act("map");
  else if (k === "p") act(S.paused ? "resume" : "pause");
  else if (k === "o") act("settings");
  else if (k === "s" && S.paused) act("skip");
  else if (S.scene === "choose" && ["1", "2", "3"].includes(k) && !S.picked && S.options[+k - 1]) pick(S.options[+k - 1].id);
});

const tool = (id, fn) => document.getElementById(id).addEventListener("click", (e) => { e.stopPropagation(); fn(); });
tool("t-start", () => act(S.scene === "final" ? "rematch" : "start"));
tool("t-rounds", () => act("rounds"));
tool("t-mode", () => act("mode"));
tool("t-bot", () => act("addbot"));
tool("t-rmbot", () => act("rmbot"));
tool("t-tab", () => (onePhone() ? playHere() : window.open(`index.html?room=${S.net.code}`, "_blank")));

// On a phone, or in the installed app (no tabs), a controller in another tab
// can't work: you can't get back to this one, and a hidden tab stops
// drawing, so the game would freeze. Instead the controller goes right
// here, under the TV picture, in a frame: both stay on screen and talk over
// the same BroadcastChannel.
function onePhone() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return standalone || matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
}
function playHere() {
  const f = document.getElementById("solo");
  if (!document.body.classList.contains("solo")) { f.src = `index.html?room=${S.net.code}`; f.hidden = false; document.body.classList.add("solo"); }
  f.focus();
}

// The music follows the scene: a laid-back groove in the lobby and between
// games, a driving track for each game (its tempo and key from the game),
// a bouncy one on the board and a victory lap at the end. Paused, it ducks.
let ducked = false;
function syncMusic() {
  const sc = S.scene;
  if (sc === "gate") return;
  if (sc === "intro" || sc === "game") music.play("game", S.def?.id || "game", S.def?.kind); // the mood from the kind of game
  else if (sc === "duel") music.play("game", "duel");
  else if (sc === "board" || (S.mode === "board" && sc === "results")) music.play("board");
  else if (sc === "final") music.play("final");
  else music.play("lobby");
  if (!!S.paused !== ducked) { ducked = !!S.paused; music.duck(ducked); }
}

// The hub's bottom bar shows on the title, lobby and final screens and tucks
// away during play (its handle at the bottom edge brings it back).
let navShown = null;
function syncNav() {
  const want = S.scene === "gate" || S.scene === "lobby" || S.scene === "final";
  if (want === navShown) return;
  navShown = want;
  if (want) window.randomNav?.show(); else window.randomNav?.hide();
}
