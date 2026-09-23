#!/usr/bin/env node
// Screenshots for the Jellybrawl preview page (ideas/jellybrawl/preview/).
//
// Starts the relay (server.mjs), then drives a real TV and one phone in
// headless Chromium through every screen, every minigame (TV + phone), the
// three boards and the Gauntlet, and writes:
//   ideas/jellybrawl/preview/shots/*.jpg   the pictures
//   ideas/jellybrawl/preview/shots.json    what's what (the page reads this)
//
// Run it locally with Playwright installed, or point PLAYWRIGHT at a copy
// (CI installs one into a temp dir, like the hub's e2e):
//   node scripts/jellybrawl-preview.mjs
// Env: PORT (default 8790), ONLY=soccer,sumo (just those games, for a quick look).

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = path.join(root, "ideas/jellybrawl");
const outDir = path.join(game, "preview/shots");
const PORT = +(process.env.PORT || 8790), B = `http://localhost:${PORT}/`;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

// how long into each game to take the TV shots (seconds after GO); the
// default catches the opening scramble and the thick of it
const WHEN = { draw: [14, 30], greed: [7, 12.5], maze: [6, 16], pilot: [6, 16], relay: [5, 14], stack: [8, 18], tug: [5, 12], haunted: [2.5, 6], bombsquad: [6, 16], flap: [3, 9], chomp: [5, 13], sumo: [7, 11], bumper: [4, 10], potato: [5, 12] };
const DEFAULT_WHEN = [5, 13];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const manifest = { generated: new Date().toISOString(), commit: "", screens: [], games: [], modes: [] };
try { manifest.commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}

const server = spawn(process.execPath, ["server.mjs", String(PORT)], { cwd: game, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);

const browser = await chromium.launch();
const errors = [];
// a 1080p TV: the game renders at 1920×1080 natively, so this is 1:1
const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const tv = await tvCtx.newPage();
tv.on("pageerror", (e) => errors.push("tv: " + e.message));
tv.on("console", (m) => m.type() === "error" && errors.push("tv console: " + m.text()));
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
ph.on("pageerror", (e) => errors.push("phone: " + e.message));

const S = (fn, arg) => tv.evaluate(fn, arg);
const until = (fn, ms = 30000) => tv.waitForFunction(fn, null, { timeout: ms });
async function shot(page, file, caption, list) {
  await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: page === tv ? 60 : 65 });
  if (list) list.push({ file: `shots/${file}`, caption, kind: page === tv ? "tv" : "phone" });
  return `shots/${file}`;
}
// keep the phone busy during games: wiggle the stick, press whatever's there
async function wiggle(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const stick = await ph.$(".stick");
    if (stick) {
      const b = await stick.boundingBox();
      if (b) {
        const a = Math.random() * 6.28;
        await ph.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await ph.mouse.down();
        await ph.mouse.move(b.x + b.width / 2 + Math.cos(a) * 60, b.y + b.height / 2 + Math.sin(a) * 60, { steps: 2 });
        await sleep(220); await ph.mouse.up();
      }
      if (Math.random() < 0.3) await ph.locator(".act").dispatchEvent("pointerdown").catch(() => {});
    } else if (await ph.$(".hit")) {
      await ph.locator(".hit").first().dispatchEvent("pointerdown").catch(() => {});
      await ph.locator(".hit").first().dispatchEvent("pointerup").catch(() => {});
    }
    await sleep(160);
  }
}

// ---------------------------------------------------------------- screens
await tv.goto(B + "tv.html");
await sleep(900);
await shot(tv, "screen-title.jpg", "The title screen", manifest.screens);
await tv.keyboard.press("Space");
await until(() => window.__jelly.scene === "lobby");
const code = await S(() => window.__jelly.net.code);

await ph.goto(`${B}?room=${code}`);
await sleep(500);
await shot(ph, "phone-join.jpg", "Joining: scan the QR code, type a name", manifest.screens);
await ph.fill("#name", "Ana"); await ph.click("button[type=submit]");
await ph.waitForSelector("#face:not([hidden])");
await ph.click("#draw-btn");
const pad = await ph.locator("#doodle").boundingBox();
const dot = async (x, y) => { await ph.mouse.move(pad.x + x, pad.y + y); await ph.mouse.down(); await ph.mouse.move(pad.x + x + 2, pad.y + y + 2); await ph.mouse.up(); };
await dot(80, 90); await dot(140, 90);
await ph.mouse.move(pad.x + 70, pad.y + 150); await ph.mouse.down(); await ph.mouse.move(pad.x + 110, pad.y + 175, { steps: 6 }); await ph.mouse.move(pad.x + 150, pad.y + 150, { steps: 6 }); await ph.mouse.up();
await shot(ph, "phone-face.jpg", "Add your face: a selfie or a doodle", manifest.screens);
await ph.click("#face-done");
for (const k of "bbbb") await tv.keyboard.press(k);
await sleep(1600);
await shot(tv, "screen-lobby.jpg", "The lobby: a QR code to join, seats for up to 8, bots to fill in", manifest.screens);
await shot(ph, "phone-vip.jpg", "The VIP's phone runs the lobby", manifest.screens);
await ph.click("text=⚙ Settings"); await sleep(300);
await shot(ph, "phone-settings.jpg", "Accessibility settings: motion, CRT filter, text size, colour-blind shapes…", manifest.screens);
await ph.click("text=✓ Done");

// ------------------------------------------------------------------ games
const games = await S(() => window.__games.map(({ id, title, command, kind, min, max, blurb, controls }) => ({ id, title, command, kind, min, max, blurb, controls })));
const todo = games.filter((d) => !ONLY || ONLY.includes(d.id));
await S(() => { window.__jelly.rounds = 99; }); // one long session
await tv.keyboard.press("Enter");

// whatever state a game ended in (some end on their own before we're done),
// get the TV back to the choose screen
async function toChoose() {
  for (let k = 0; k < 60; k++) {
    const scene = await S(() => {
      const S = window.__jelly;
      if (S.scene === "game" && S.game && !S.game.result) { const pids = S.players.map((p) => p.pid).sort(() => Math.random() - 0.5); S.game.result = { ranking: pids.map((p) => [p]), headline: `${S.players.find((p) => p.pid === pids[0]).name} wins the round!` }; }
      if (S.scene === "results") S.t = Math.max(S.t, 7);
      return S.scene;
    });
    if (scene === "choose") return;
    if (scene === "intro") await ph.click("text=READY!").catch(() => {});
    await sleep(500);
  }
  throw new Error("couldn't get back to the choose screen");
}

const queue = todo.map((d) => ({ def: d, tries: 0 }));
for (let i = 0; i < queue.length; i++) {
  const { def } = queue[i];
  await toChoose();
  // the first time round, show the loser-picks screen on the phone
  if (i === 1) {
    await S(() => { const S = window.__jelly; S.players.find((p) => p.name === "Ana").score = -1; S.round = Math.max(1, S.round); window.__choose(); });
    await sleep(900);
    await shot(tv, "screen-choose.jpg", "Loser picks: last place chooses the next game from three", manifest.screens);
    await shot(ph, "phone-choose.jpg", "…on their phone", manifest.screens);
  }
  // all three options are the game we want, so even an automatic pick lands on it
  await S((id) => { const S = window.__jelly, d = window.__games.find((g) => g.id === id); S.options = [d, d, d]; S.picked = null; }, def.id);
  await tv.keyboard.press("1");
  await until(() => window.__jelly.scene === "intro", 15000);
  await sleep(1500);
  if (i === 0) { // one example of the intro and the role card
    await shot(tv, "screen-intro.jpg", "Every game opens with a slammed-in command and the rules", manifest.screens);
    await shot(ph, "phone-ready.jpg", "…while each phone shows your role, and READY", manifest.screens);
  }
  await ph.waitForSelector("text=READY!", { timeout: 5000 }).catch(() => {});
  await ph.click("text=READY!").catch(() => {});
  await until(() => window.__jelly.scene === "game", 20000);
  const t0 = Date.now(), when = WHEN[def.id] || DEFAULT_WHEN, tvShots = [];
  if (def.id === "sumo") { // knock Ana out early to show heckling from the waiting screen
    await wiggle(2500);
    await S(() => { const a = window.__jelly.gctx.arena.bodies.find((b) => b.p.name === "Ana"); a.x = 200; a.y = 300; });
    await ph.waitForSelector("button.heckle", { timeout: 6000 }).catch(() => {});
    await ph.click("button.heckle").catch(() => {}); await ph.click(".reacts button >> nth=0").catch(() => {});
    await sleep(700);
    await shot(tv, "screen-heckle.jpg", "Knocked out? Drop goo on the living and send emoji", manifest.screens);
    await shot(ph, "phone-heckle.jpg", "…from the waiting screen", manifest.screens);
  }
  let phoneShot = null;
  for (const [k, at] of when.entries()) {
    await wiggle(Math.max(0, at * 1000 - (Date.now() - t0)));
    if (await S(() => window.__jelly.scene !== "game")) { console.log(`\n${def.id}: left the game scene early (${await S(() => window.__jelly.scene)})`, await S(() => [window.__jelly.def?.id, window.__jelly.result?.headline, window.__jelly.round])); break; }
    tvShots.push(await shot(tv, `${def.id}-tv-${k + 1}.jpg`));
    if (!phoneShot) phoneShot = await shot(ph, `${def.id}-phone.jpg`);
  }
  // extras, once: a pause, and a knocked-out phone heckling
  if (def.id === "kraken") {
    await ph.click("#pause").catch(() => {}); await sleep(500);
    await shot(tv, "screen-pause.jpg", "The VIP can pause, skip a game or end the night", manifest.screens);
    await ph.click("text=▶ Resume").catch(() => {});
  }
  if (!tvShots.length && queue[i].tries++ < 2) { queue.push(queue[i]); continue; } // ended before we got a picture: go again later
  manifest.games.push({ ...def, tv: tvShots, phone: phoneShot });
  if (i === 2) { // one results screen, from a (made-up) finishing order
    await S(() => { const S = window.__jelly; if (S.scene === "game" && S.game && !S.game.result) S.game.result = { ranking: S.players.map((p) => [p.pid]).reverse(), headline: `${S.players[S.players.length - 1].name} wins the round!` }; });
    await until(() => window.__jelly.scene === "results", 10000).catch(() => {});
    await sleep(2800); await shot(tv, "screen-results.jpg", "Results: rows slide into the standings; lead changes get called out", manifest.screens);
  }
  process.stdout.write(`${def.id} `);
}
manifest.games.sort((a, b) => todo.findIndex((d) => d.id === a.id) - todo.findIndex((d) => d.id === b.id));

// ------------------------------------------------------------------ final
await toChoose();
await S(() => { const S = window.__jelly; S.rounds = S.round + 1; S.picked = null; });
await tv.keyboard.press("1");
for (let k = 0; k < 80 && (await S(() => window.__jelly.scene)) !== "final"; k++) {
  await S(() => {
    const S = window.__jelly;
    if (S.scene === "game" && S.game && !S.game.result) S.game.result = { ranking: S.players.map((p) => [p.pid]), headline: "Final round!" };
    if (S.scene === "results") S.t = Math.max(S.t, 7);
  });
  await ph.click("text=READY!").catch(() => {});
  await sleep(400);
}
await sleep(2500);
await shot(tv, "screen-final.jpg", "The final: a podium and awards for everyone", manifest.screens);
await shot(ph, "phone-final.jpg", "…and a rematch button for the VIP", manifest.screens);

// ------------------------------------------------------------------ modes
for (const [map, title] of [["city", "Neon City"], ["sewers", "Slime Sewers"], ["volcano", "Volcano Island"]]) {
  await ph.click("text=Back to lobby").catch(() => {});
  await until(() => window.__jelly.scene === "lobby");
  await S((m) => { const S = window.__jelly; S.mode = "board"; S.boardMap = m; S.rounds = 5; }, map);
  await tv.keyboard.press("Enter");
  await until(() => window.__jelly.scene === "board", 20000);
  const shots = [];
  await sleep(4000); shots.push(await shot(tv, `board-${map}-tv-1.jpg`)); shots.push(await shot(ph, `board-${map}-phone.jpg`));
  await sleep(7000); shots.push(await shot(tv, `board-${map}-tv-2.jpg`));
  manifest.modes.push({ id: `board-${map}`, title: `Board: ${title}`, blurb: "Mario Party-style: roll, take forks, buy stars and items, duel, and play a minigame after every turn.", shots });
  await ph.click("#pause").catch(() => {}); await sleep(300); await ph.click("text=🏁 End the night").catch(() => {});
  await until(() => window.__jelly.scene === "final", 15000).catch(() => {});
}
{
  await ph.click("text=Back to lobby").catch(() => {});
  await until(() => window.__jelly.scene === "lobby");
  await S(() => { window.__jelly.mode = "gauntlet"; });
  await tv.keyboard.press("Enter");
  await until(() => window.__jelly.scene === "intro" || window.__jelly.scene === "game", 20000);
  await ph.click("text=READY!").catch(() => {});
  await until(() => window.__jelly.scene === "game", 20000);
  const shots = [], t0 = Date.now();
  for (const [k, at] of [6, 13, 21].entries()) { await wiggle(Math.max(0, at * 1000 - (Date.now() - t0))); shots.push(await shot(tv, `gauntlet-tv-${k + 1}.jpg`)); if (k === 0) shots.push(await shot(ph, "gauntlet-phone.jpg")); }
  manifest.modes.push({ id: "gauntlet", title: "Microgame Gauntlet", blurb: "WarioWare-style: 20 microgames of a few seconds each, three lives, speeding up, with boss stages.", shots });
}

fs.writeFileSync(path.join(game, "preview/shots.json"), JSON.stringify(manifest, null, 1) + "\n");
await browser.close();
server.kill();
console.log(`\n${manifest.games.length} games, ${manifest.screens.length} screens, ${manifest.modes.length} modes, ${fs.readdirSync(outDir).length} images`);
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
