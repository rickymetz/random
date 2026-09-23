#!/usr/bin/env node
// Screenshots for the Jellybrawl preview page (ideas/jellybrawl/preview/).
//
// Starts the relay (server.mjs), then drives a real TV and one phone in
// headless Chromium through every screen, every minigame (TV + phone), the
// three boards and the Gauntlet, and writes:
//   ideas/jellybrawl/preview/shots/*.webp  the pictures
//   ideas/jellybrawl/preview/shots.json    what's what (the page reads this)
//   ideas/jellybrawl/preview/bumper.webm   a ~30 s sizzle cut, recorded in the page
//   ideas/jellybrawl/preview/shots/slide-*.webp  collages for the page's carousel
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
// the games that get a ~1.4 s cut in the sizzle (in the order they're played)
const SIZZLE = ["flap", "sling", "chomp", "snipe", "kaiju", "soccer", "sumo", "bumper", "paint", "dodgeball", "snake", "stack", "haunted", "whack", "kraken", "tank"];
const CUT = 1400; // one bar of the trailer music
// the TV + phone pairs on the carousel: games whose phone does something special
const PAIRS = ["snipe", "bombsquad", "draw", "pilot"];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const manifest = { generated: new Date().toISOString(), commit: "", video: null, slides: [], capsule: null, screens: [], games: [], modes: [] };
try { manifest.commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}

const server = spawn(process.execPath, ["server.mjs", String(PORT)], { cwd: game, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600);

// no click needed to start audio: the sizzle's soundtrack plays from the start
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
// a 1080p TV: the game renders at 1920×1080 natively, so this is 1:1
const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const tv = await tvCtx.newPage();
tv.on("pageerror", (e) => errors.push("tv: " + e.message));
tv.on("console", (m) => m.type() === "error" && errors.push("tv console: " + m.text()));
const ph = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
ph.on("pageerror", (e) => errors.push("phone: " + e.message));

// Pictures are saved as WebP: about half the size of the equivalent JPEG.
// Playwright only takes PNG or JPEG, so take a lossless PNG and have
// Chromium encode it.
const enc = await browser.newPage();
async function save(file, png, quality) {
  const webp = await enc.evaluate(async ({ b64, quality }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/webp", quality })).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { b64: png.toString("base64"), quality });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(webp, "base64"));
}

const S = (fn, arg) => tv.evaluate(fn, arg);
const until = (fn, ms = 30000) => tv.waitForFunction(fn, null, { timeout: ms });
async function shot(page, file, caption, list) {
  await save(file, await page.screenshot({ type: "png" }), page === tv ? 0.75 : 0.8);
  if (list) { // a retried game can take the same picture twice: keep one
    const item = { file: `shots/${file}`, caption, kind: page === tv ? "tv" : "phone" }, at = list.findIndex((x) => x.file === item.file);
    if (at >= 0) list[at] = item; else list.push(item);
  }
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
      if (Math.random() < 0.3) await ph.locator(".act").dispatchEvent("pointerdown", null, { timeout: 300 }).catch(() => {});
    } else if (await ph.$(".hit")) {
      await ph.locator(".hit").first().dispatchEvent("pointerdown", null, { timeout: 300 }).catch(() => {});
      await ph.locator(".hit").first().dispatchEvent("pointerup", null, { timeout: 300 }).catch(() => {});
    }
    await sleep(160);
  }
}

// ------------------------------------------------------------ the sizzle
// A second canvas copies the TV's frames into a MediaRecorder, adding a
// title tag to each cut and drawing the opening and closing cards itself.
// It's paused between cuts, so the video is just the cuts, back to back.
//
// The soundtrack is the game's own music engine playing the "trailer" song
// on a separate AudioContext that runs only while recording, so the music
// is continuous across the cuts; one bar is 1.4 s, the length of a cut, so
// every cut lands on a downbeat. The game's sound effects are mixed in
// underneath (its own music muted).
const REC = async () => {
  const src = document.getElementById("screen"), c = document.createElement("canvas");
  c.width = 1920; c.height = 1080;
  const g = c.getContext("2d");
  const game = await import(new URL("sfx.js", location.href).href);
  const { createMusic } = await import(new URL("music.js", location.href).href);
  game.setMix({ music: 0 }); game.unlock();
  const ax = new AudioContext(), mixOut = ax.createMediaStreamDestination();
  const tuneGain = ax.createGain(); tuneGain.gain.value = 0.9; tuneGain.connect(mixOut);
  const tune = createMusic(ax, tuneGain);
  const fx = game.tap();
  if (fx) { const fxGain = ax.createGain(); fxGain.gain.value = 0.5; ax.createMediaStreamSource(fx).connect(fxGain).connect(mixOut); }
  await ax.suspend();
  tune.play("trailer");
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...mixOut.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2.2e6, audioBitsPerSecond: 96e3 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const back = (k) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); // ease out, with a little overshoot
  function words(t, str, x, y, size, font, color, shadow = "#0b0710") {
    g.font = `${size}px ${font}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = shadow; g.fillText(str, x + size * 0.05, y + size * 0.06);
    g.fillStyle = color; g.fillText(str, x, y);
  }
  function card(t, o) {
    const bg = g.createRadialGradient(960, 480, 40, 960, 540, 1150);
    bg.addColorStop(0, "#4a0f5c"); bg.addColorStop(1, "#0b0710");
    g.fillStyle = bg; g.fillRect(0, 0, 1920, 1080);
    g.save(); g.globalAlpha = 0.07; g.translate(960, 540); g.rotate(-0.12 + t * 0.02);
    for (let i = -14; i < 14; i++) { g.fillStyle = i % 2 ? "#ff2a6d" : "#05d9e8"; g.fillRect(i * 150 - (t * 120) % 300, -1200, 70, 2400); }
    g.restore();
    const k = Math.min(1, t / 0.4), s = 2 - back(k);
    g.save(); g.translate(960, o.sub ? 450 : 520); g.rotate(-0.06); g.scale(s, s);
    g.shadowColor = "#ff2a6d"; g.shadowBlur = 40;
    words(t, "Jellybrawl", 0, 0, 250, "Knewave", "#ff2a6d");
    g.restore();
    const k2 = Math.max(0, Math.min(1, (t - 0.3) / 0.3));
    g.globalAlpha = k2; g.letterSpacing = "10px";
    if (o.sub) words(t, o.sub.toUpperCase(), 960, 690 + (1 - k2) * 30, 70, "'League Gothic'", "#05d9e8");
    if (o.sub2) words(t, o.sub2.toUpperCase(), 960, 780 + (1 - k2) * 30, 50, "'League Gothic'", "#f9f002");
    g.globalAlpha = 1; g.letterSpacing = "0px";
    for (let y = 0; y < 1080; y += 4) { g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, y, 1920, 2); }
  }
  function tag(t, o) {
    const x = 60 - Math.max(0, 1 - t / 0.18) * 700;
    g.font = "82px Knewave"; const w = Math.max(g.measureText(o.label).width, 200) + 90;
    g.save(); g.transform(1, 0, -0.18, 1, 0, 0);
    g.fillStyle = "#ff2a6d"; g.fillRect(x + 190 + 12, 872 + 12, w, 124);
    g.fillStyle = "#0b0710"; g.fillRect(x + 190, 872, w, 124);
    g.restore();
    g.textAlign = "left"; g.textBaseline = "middle";
    g.fillStyle = "#f9f002"; g.fillText(o.label, x + 60, 944);
    if (o.sub) { g.font = "36px 'League Gothic'"; g.letterSpacing = "5px"; g.fillStyle = "#0b0710"; g.fillRect(x + 36, 840, g.measureText(o.sub.toUpperCase()).width + 44, 46); g.fillStyle = "#05d9e8"; g.fillText(o.sub.toUpperCase(), x + 58, 864); g.letterSpacing = "0px"; }
  }
  let cut = null, crt = null, ms = 0;
  function paint() {
    if (!cut) return;
    const t = (performance.now() - cut.at) / 1000;
    if (cut.card) card(t, cut); else { g.drawImage(src, 0, 0, 1920, 1080); if (cut.label) tag(t, cut); }
  }
  (function loop() { paint(); requestAnimationFrame(loop); })();
  window.__rec = {
    async on(o) {
      cut = { ...o, at: performance.now() };
      crt = window.__jelly.opt.crt; window.__jelly.opt.crt = "light"; // scanlines compress better than the full filter's noise
      if (o.outro) tune.outro();
      paint(); // so the first frame after a resume is this cut, not the last one
      await ax.resume();
      if (rec.state === "inactive") rec.start(); else rec.resume();
    },
    off() { if (rec.state === "recording") rec.pause(); ax.suspend(); if (cut) ms += performance.now() - cut.at; cut = null; if (crt) window.__jelly.opt.crt = crt; },
    stop: () => new Promise((done) => {
      rec.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(parts, { type }).arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        done({ ms, b64: btoa(bin) });
      };
      if (rec.state === "paused") rec.resume();
      rec.stop();
    }),
  };
};
let sizzleMs = 0;
const cutDone = new Set(); // a retried game doesn't get a second cut
// A MediaRecorder WebM streamed in chunks has no duration (Chrome only
// finalises it when recorded in one piece), so players show a broken seek
// bar. If the Segment's size is unknown, add a duration to its Info element.
function withDuration(buf, ms) {
  const seg = buf.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67]));
  if (seg < 0 || buf[seg + 4] !== 0x01 || buf.readUIntBE(seg + 5, 6) !== 0xffffffffffff || buf[seg + 11] !== 0xff) return buf; // already finalised
  const vint = (at) => { const b = buf[at]; let len = 1; while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++; let v = b & (0xff >> len); for (let i = 1; i < len; i++) v = v * 256 + buf[at + i]; return { len, v }; };
  const info = buf.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]), seg + 12);
  const has = info < 0 ? -1 : buf.indexOf(Buffer.from([0x44, 0x89]), info);
  if (info < 0 || (has >= 0 && has - info < 64)) return buf; // no Info, or it already has a duration
  const size = vint(info + 4), body = buf.subarray(info + 4 + size.len, info + 4 + size.len + size.v);
  const dur = Buffer.alloc(11); dur.set([0x44, 0x89, 0x88]); dur.writeDoubleBE(ms, 3); // TimecodeScale is 1 ms
  const n = body.length + dur.length, head = Buffer.alloc(8); head[0] = 0x01; head.writeUIntBE(n, 2, 6);
  return Buffer.concat([buf.subarray(0, info + 4), head, body, dur, buf.subarray(info + 4 + size.len + size.v)]);
}
async function cut(o, ms, during = sleep) {
  await tv.evaluate((o) => window.__rec.on(o), o);
  const busy = during(ms); // the phone keeps playing, but the cut ends on time
  await sleep(ms);
  await tv.evaluate(() => window.__rec.off());
  await busy;
}

// ---------------------------------------------------------------- screens
await tv.goto(B + "tv.html");
await sleep(900);
await tv.evaluate(() => document.fonts.ready);
await tv.evaluate(REC);
await cut({ card: true, sub: "One TV · Everyone's phone · A pile of minigames" }, 2 * CUT);
await shot(tv, "screen-title.webp", "The title screen", manifest.screens);
await tv.keyboard.press("Space");
await until(() => window.__jelly.scene === "lobby");
const code = await S(() => window.__jelly.net.code);

await ph.goto(`${B}?room=${code}`);
await sleep(500);
await shot(ph, "phone-join.webp", "Joining: scan the QR code, type a name", manifest.screens);
await ph.fill("#name", "Ana"); await ph.click("button[type=submit]");
await ph.waitForSelector("#face:not([hidden])");
await ph.click("#draw-btn");
const pad = await ph.locator("#doodle").boundingBox();
const dot = async (x, y) => { await ph.mouse.move(pad.x + x, pad.y + y); await ph.mouse.down(); await ph.mouse.move(pad.x + x + 2, pad.y + y + 2); await ph.mouse.up(); };
await dot(80, 90); await dot(140, 90);
await ph.mouse.move(pad.x + 70, pad.y + 150); await ph.mouse.down(); await ph.mouse.move(pad.x + 110, pad.y + 175, { steps: 6 }); await ph.mouse.move(pad.x + 150, pad.y + 150, { steps: 6 }); await ph.mouse.up();
await shot(ph, "phone-face.webp", "Add your face: a selfie or a doodle", manifest.screens);
await ph.click("#face-done");
for (const k of "bbbb") await tv.keyboard.press(k);
await sleep(1600);
await shot(tv, "screen-lobby.webp", "The lobby: a QR code to join, seats for up to 8, bots to fill in", manifest.screens);
await shot(ph, "phone-vip.webp", "The VIP's phone runs the lobby", manifest.screens);
await ph.click("text=⚙ Settings"); await sleep(300);
await shot(ph, "phone-settings.webp", "Accessibility settings: motion, CRT filter, text size, colour-blind shapes…", manifest.screens);
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
      if (S.scene === "game" && S.game && !S.game.result) { const pids = S.players.map((p) => p.pid).sort(() => Math.random() - 0.5); S.game.result = { ranking: pids.map((p) => [p]), headline: `${S.players.find((p) => p.pid === pids[0]).name} wins the round!` }; window.__finish(); }
      if (S.scene === "results") S.t = Math.max(S.t, 7);
      return S.scene;
    });
    if (scene === "choose") return;
    if (scene === "intro") await ph.click("text=READY!").catch(() => {});
    await sleep(500);
  }
  throw new Error(`couldn't get back to the choose screen (stuck on ${await S(() => window.__jelly.scene)})`);
}

const queue = todo.map((d) => ({ def: d, tries: 0 }));
for (let i = 0; i < queue.length; i++) {
  const { def } = queue[i];
  await toChoose();
  // the first time round, show the loser-picks screen on the phone
  if (i === 1) {
    await S(() => { const S = window.__jelly; S.players.find((p) => p.name === "Ana").score = -1; S.round = Math.max(1, S.round); window.__choose(); });
    await sleep(900);
    await shot(tv, "screen-choose.webp", "Loser picks: last place chooses the next game from three", manifest.screens);
    await shot(ph, "phone-choose.webp", "…on their phone", manifest.screens);
  }
  // all three options are the game we want, so even an automatic pick lands on it
  await S((id) => { const S = window.__jelly, d = window.__games.find((g) => g.id === id); S.options = [d, d, d]; S.picked = null; }, def.id);
  await tv.keyboard.press("1");
  await until(() => window.__jelly.scene === "intro", 15000);
  await sleep(1500);
  if (i === 0) { // one example of the intro and the role card
    await shot(tv, "screen-intro.webp", "Every game opens with a slammed-in command and the rules", manifest.screens);
    await shot(ph, "phone-ready.webp", "…while each phone shows your role, and READY", manifest.screens);
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
    await shot(tv, "screen-heckle.webp", "Knocked out? Drop goo on the living and send emoji", manifest.screens);
    await shot(ph, "phone-heckle.webp", "…from the waiting screen", manifest.screens);
  }
  let phoneShot = null;
  for (const [k, at] of when.entries()) {
    if (k === 0 && SIZZLE.includes(def.id) && !cutDone.has(def.id)) { // this game's cut for the sizzle, just before the first picture
      await wiggle(Math.max(0, at * 1000 - CUT - 150 - (Date.now() - t0)));
      if (await S(() => window.__jelly.scene === "game")) cutDone.add(def.id), await cut({ label: def.title, sub: def.kind }, CUT, wiggle);
    }
    await wiggle(Math.max(0, at * 1000 - (Date.now() - t0)));
    if (await S(() => window.__jelly.scene !== "game")) { console.log(`\n${def.id}: left the game scene early (${await S(() => window.__jelly.scene)})`, await S(() => [window.__jelly.def?.id, window.__jelly.result?.headline, window.__jelly.round])); break; }
    tvShots.push(await shot(tv, `${def.id}-tv-${k + 1}.webp`));
    if (!phoneShot) phoneShot = await shot(ph, `${def.id}-phone.webp`);
  }
  // extras, once: a pause, and a knocked-out phone heckling
  if (def.id === "kraken") {
    await ph.click("#pause").catch(() => {}); await sleep(500);
    await shot(tv, "screen-pause.webp", "The VIP can pause, skip a game or end the night", manifest.screens);
    await ph.click("text=▶ Resume").catch(() => {});
  }
  if (!tvShots.length && queue[i].tries++ < 2) { queue.push(queue[i]); continue; } // ended before we got a picture: go again later
  manifest.games.push({ ...def, tv: tvShots, phone: phoneShot });
  if (i === 2) { // one results screen, from a (made-up) finishing order
    await S(() => { const S = window.__jelly; if (S.scene === "game" && S.game && !S.game.result) { S.game.result = { ranking: S.players.map((p) => [p.pid]).reverse(), headline: `${S.players[S.players.length - 1].name} wins the round!` }; window.__finish(); } });
    await until(() => window.__jelly.scene === "results", 10000).catch(() => {});
    await sleep(2800); await shot(tv, "screen-results.webp", "Results: rows slide into the standings; lead changes get called out", manifest.screens);
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
    if (S.scene === "game" && S.game && !S.game.result) { S.game.result = { ranking: S.players.map((p) => [p.pid]), headline: "Final round!" }; window.__finish(); }
    if (S.scene === "results") S.t = Math.max(S.t, 7);
  });
  await ph.click("text=READY!").catch(() => {});
  await sleep(400);
}
await sleep(1200);
await cut({ label: "The podium", sub: "Awards for everyone" }, CUT);
await sleep(300);
await shot(tv, "screen-final.webp", "The final: a podium and awards for everyone", manifest.screens);
await shot(ph, "phone-final.webp", "…and a rematch button for the VIP", manifest.screens);

// ------------------------------------------------------------------ modes
for (const [map, title] of [["city", "Neon City"], ["sewers", "Slime Sewers"], ["volcano", "Volcano Island"]]) {
  await ph.click("text=Back to lobby").catch(() => {});
  await until(() => window.__jelly.scene === "lobby");
  await S((m) => { const S = window.__jelly; S.mode = "board"; S.boardMap = m; S.rounds = 5; }, map);
  await tv.keyboard.press("Enter");
  await until(() => window.__jelly.scene === "board", 20000);
  const shots = [];
  if (map === "city") { await sleep(2600); await cut({ label: title, sub: "Board mode" }, CUT); await sleep(100); } else await sleep(4000);
  shots.push(await shot(tv, `board-${map}-tv-1.webp`)); shots.push(await shot(ph, `board-${map}-phone.webp`));
  await sleep(7000); shots.push(await shot(tv, `board-${map}-tv-2.webp`));
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
  for (const [k, at] of [6, 13, 21].entries()) {
    if (k === 1) { await wiggle(Math.max(0, at * 1000 - CUT - 150 - (Date.now() - t0))); await cut({ label: "Microgame Gauntlet", sub: "20 microgames · 3 lives" }, CUT, wiggle); }
    await wiggle(Math.max(0, at * 1000 - (Date.now() - t0))); shots.push(await shot(tv, `gauntlet-tv-${k + 1}.webp`)); if (k === 0) shots.push(await shot(ph, "gauntlet-phone.webp")); }
  manifest.modes.push({ id: "gauntlet", title: "Microgame Gauntlet", blurb: "WarioWare-style: 20 microgames of a few seconds each, three lives, speeding up, with boss stages.", shots });
}

// ------------------------------------------------------------ sizzle, done
await cut({ card: true, outro: true, sub: `${manifest.games.length} minigames · 3 boards · 1 gauntlet`, sub2: "1–8 players · play in your browser" }, 2 * CUT);
const got = await tv.evaluate(() => window.__rec.stop());
const webm = withDuration(Buffer.from(got.b64, "base64"), got.ms);
sizzleMs = got.ms;
fs.writeFileSync(path.join(game, "preview/bumper.webm"), webm);
console.log(`\nsizzle: ${(sizzleMs / 1000).toFixed(1)} s, ${(webm.length / 1e6).toFixed(1)} MB`);

// ----------------------------------------------------------------- slides
// Collages for the carousel, laid out as a web page (served next to the
// shots, so they load like any picture) and screenshotted at 1080p.
const KIND = (k) => (/^\d+ vs/i.test(k) ? "asym" : /team/i.test(k) ? "teams" : "ffa");
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; overflow: hidden; color: #fff; font-family: "League Gothic", Impact, sans-serif;
    background: repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 2px, transparent 2px 4px), radial-gradient(1400px 800px at 30% 0%, #4a0f5c, #0b0710 70%); }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .k { font-family: Knewave, Impact, sans-serif; }
  .tilt { transform: rotate(-3deg); }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; padding: 44px 50px; height: 1080px; }
  .grid figure { margin: 0; position: relative; border: 5px solid #0b0710; box-shadow: 9px 9px 0 var(--c); overflow: hidden; background: #000; }
  .grid figure:nth-child(3n) { transform: rotate(.7deg); } .grid figure:nth-child(3n+1) { transform: rotate(-.6deg); }
  .grid figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 16px 8px; font: 44px/1 Knewave, Impact, sans-serif; background: linear-gradient(transparent, rgba(11,7,16,.92)); text-shadow: 3px 3px 0 #0b0710; }
  .head { display: flex; flex-direction: column; justify-content: center; padding: 0 20px; }
  .head small { font-size: 40px; letter-spacing: 8px; color: #05d9e8; text-transform: uppercase; }
  .head h1 { margin: 0; font: 118px/1 Knewave, Impact, sans-serif; color: var(--c); text-shadow: 7px 8px 0 #0b0710; transform: rotate(-3deg); transform-origin: left; }
  .head p { margin: 14px 0 0; font-size: 44px; letter-spacing: 3px; text-transform: uppercase; color: #ece6f5; }
  .chip { display: inline-block; font-size: 36px; letter-spacing: 4px; text-transform: uppercase; background: var(--c); color: #0b0710; padding: 2px 16px; }
`;
const COLOR = { ffa: "#f9f002", teams: "#05d9e8", asym: "#b14dff" };
const cmp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
cmp.on("pageerror", (e) => errors.push("slides: " + e.message));
let slideHtml = "";
await cmp.route("**/preview/__slide.html", (r) => r.fulfill({ contentType: "text/html", body: slideHtml }));
async function slide(file, body, caption, size = [1920, 1080]) {
  slideHtml = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../fonts/fonts.css"><style>${CSS} body { width: ${size[0]}px; height: ${size[1]}px; }</style>${body}`;
  await cmp.setViewportSize({ width: size[0], height: size[1] });
  await cmp.goto(B + "preview/__slide.html");
  await cmp.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  await save(file, await cmp.screenshot({ type: "png" }), 0.8);
  if (caption) manifest.slides.push({ file: `shots/${file}`, caption });
  return `shots/${file}`;
}
const tile = (g) => `<figure><img src="${g.tv[g.tv.length - 1]}"><figcaption>${esc(g.title)}</figcaption></figure>`;
const sample = (list, n) => list.filter((g, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);

// a hero collage: the video's poster, and the Steam-style capsule
const hero = sample(manifest.games, 12);
manifest.video = { file: "bumper.webm", seconds: +(sizzleMs / 1000).toFixed(1), poster: await slide("slide-poster.webp", `
  <div style="position:absolute;inset:-60px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;transform:rotate(-4deg);opacity:.42">${hero.map((g) => `<img src="${g.tv[0]}" style="height:300px">`).join("")}</div>
  <div style="position:absolute;inset:0;background:radial-gradient(900px 500px at 50% 50%,rgba(11,7,16,.85),rgba(11,7,16,.3))"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div class="k tilt" style="font-size:230px;color:#ff2a6d;text-shadow:0 0 40px rgba(255,42,109,.7),12px 14px 0 #0b0710">Jellybrawl</div>
    <div style="font-size:66px;letter-spacing:10px;color:#05d9e8;text-transform:uppercase;text-shadow:4px 4px 0 #0b0710">One TV · Everyone's phone · ${manifest.games.length} minigames</div>
  </div>`) };
manifest.capsule = await slide("capsule.webp", `
  <div style="position:absolute;inset:-30px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;transform:rotate(-4deg);opacity:.5">${hero.slice(0, 9).map((g) => `<img src="${g.tv[0]}" style="height:170px">`).join("")}</div>
  <div style="position:absolute;inset:0;background:linear-gradient(transparent,rgba(11,7,16,.75))"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div class="k tilt" style="font-size:132px;color:#ff2a6d;text-shadow:0 0 26px rgba(255,42,109,.7),7px 8px 0 #0b0710">Jellybrawl</div>
    <div style="font-size:38px;letter-spacing:6px;color:#f9f002;text-transform:uppercase;text-shadow:3px 3px 0 #0b0710">Party game · 1–8 players</div>
  </div>`, null, [920, 430]);

// the games, by type
for (const [k, name, line] of [["ffa", "Free-for-all", "Every blob for themselves"], ["teams", "Teams", "Pink vs cyan, 2v2 to 4v4"], ["asym", "1 vs the rest", "One monster, everyone else"]]) {
  const list = manifest.games.filter((g) => KIND(g.kind) === k);
  if (!list.length) continue;
  const shown = list.slice(0, 11), span = Math.min(3, Math.ceil((shown.length + 2) / 4) * 4 - shown.length);
  await slide(`slide-${k}.webp`, `<div class="grid" style="--c:${COLOR[k]};grid-template-rows:repeat(${Math.ceil((shown.length + span) / 4)},1fr)">
    <div class="head" style="grid-column:span ${span}"><small>${manifest.games.length} minigames</small><h1>${esc(name)}</h1><p>${esc(line)} · <span class="chip">${list.length} games</span></p></div>
    ${shown.map(tile).join("")}</div>`, `${name}: ${list.map((g) => g.title).join(", ")}`);
}

// TV + phone pairs
for (const id of PAIRS) {
  const g = manifest.games.find((x) => x.id === id);
  if (!g || !g.phone) continue;
  const c = COLOR[KIND(g.kind)];
  await slide(`slide-pair-${id}.webp`, `<div style="--c:${c}">
    <div style="position:absolute;left:50px;top:36px;display:flex;align-items:center;gap:30px">
      <div class="k" style="font-size:100px;line-height:1.1;color:${c};text-shadow:6px 7px 0 #0b0710;transform:rotate(-2deg)">${esc(g.title)}</div>
      <span class="chip">${esc(g.kind)}</span>
    </div>
    <div style="position:absolute;left:50px;top:190px;width:1320px;aspect-ratio:16/9;border:6px solid #0b0710;box-shadow:12px 12px 0 ${c};background:#000"><img src="${g.tv[g.tv.length - 1]}"></div>
    <div style="position:absolute;right:70px;top:150px;width:392px;height:846px;border:14px solid #0b0710;border-radius:46px;overflow:hidden;box-shadow:12px 12px 0 #ff2a6d,0 0 0 3px #3a2656;background:#000;transform:rotate(2deg)"><img src="${g.phone}" style="object-fit:cover;object-position:top"></div>
    <div style="position:absolute;left:50px;top:955px;width:1320px;font-size:42px;line-height:1.1;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.blurb)}</div>
    <div style="position:absolute;left:50px;top:1010px;width:1320px;font-size:32px;letter-spacing:2px;text-transform:uppercase;color:#a99bc0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📱 ${esc(g.controls)}</div>
  </div>`, `${g.title}: the TV and a phone`);
}

// boards and the gauntlet
{
  const m = (id) => manifest.modes.find((x) => x.id === id);
  const four = ["board-city", "board-sewers", "board-volcano", "gauntlet"].map(m).filter(Boolean);
  if (four.length) await slide("slide-modes.webp", `<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(2,1fr);gap:18px;padding:18px">
      ${four.map((x, i) => `<figure style="margin:0;position:relative;border:5px solid #0b0710;overflow:hidden;box-shadow:8px 8px 0 ${["#ff2a6d", "#05d9e8", "#f9f002", "#b14dff"][i]}"><img src="${x.shots.filter((s) => !/phone/.test(s)).pop()}"><figcaption style="position:absolute;left:0;bottom:0;padding:8px 18px;font:50px Knewave,Impact,sans-serif;background:#0b0710">${esc(x.title.replace(/^Board: /, ""))}</figcaption></figure>`).join("")}</div>
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-3deg);background:#0b0710;border:5px solid #ff2a6d;box-shadow:12px 12px 0 #05d9e8;padding:18px 50px;text-align:center">
      <div class="k" style="font-size:84px;line-height:1.05;color:#ff2a6d">Three boards</div>
      <div style="font-size:48px;letter-spacing:6px;text-transform:uppercase;color:#f9f002">+ a WarioWare-style gauntlet</div>
    </div>`, "Modes: three Mario Party-style boards and a microgame gauntlet");
}

fs.writeFileSync(path.join(game, "preview/shots.json"), JSON.stringify(manifest, null, 1) + "\n");
await browser.close();
server.kill();
console.log(`\n${manifest.games.length} games, ${manifest.screens.length} screens, ${manifest.modes.length} modes, ${fs.readdirSync(outDir).length} images`);
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
