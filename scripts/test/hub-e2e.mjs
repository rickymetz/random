#!/usr/bin/env node
// End-to-end checks for the hub PWA in a real Chromium: the service worker,
// the bottom navbar, offline, updates, eviction, save-for-offline, sharing.
//
//   node scripts/build.js && node scripts/test/hub-e2e.mjs
//
// The hub ships no dependencies, so Playwright isn't in a package.json here:
// point PLAYWRIGHT at an installed copy (CI installs one into a temp dir),
// and CHROMIUM_PATH at a browser if Playwright's own isn't downloaded.
//
// It serves the repo root under /random/ the way GitHub Pages does
// (directory redirects, real 404s), and can take that server "offline",
// ship an update, or shrink the worker's cache cap, without restarting.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT || 8123);
const B = `http://localhost:${PORT}/random/`;

/* ------------------------------------------------------------- server */

const server = { offline: false, bump: 0, capBytes: null, slow: null };
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".wasm": "application/wasm", ".woff2": "font/woff2",
};
const httpServer = http.createServer(async (req, res) => {
  if (server.offline) return req.socket.destroy();
  const url = new URL(req.url, "http://x");
  if (server.slow && url.pathname === server.slow) await new Promise((r) => setTimeout(r, 2500));
  if (!url.pathname.startsWith("/random/")) { res.writeHead(404); return res.end(); }
  let file = path.join(root, decodeURIComponent(url.pathname.slice("/random/".length)));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) { res.writeHead(301, { location: url.pathname + "/" }); return res.end(); }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<h1>404</h1>"); }
  const headers = { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "max-age=600" };
  if (file === path.join(root, "sw.js")) {
    // The worker script itself: variants for the update and eviction tests.
    let body = fs.readFileSync(file, "utf8");
    if (server.capBytes) body = body.replace(/var CAP_BYTES = [^;]+;/, `var CAP_BYTES = ${server.capBytes};`);
    if (server.bump) body += `\n// bump ${server.bump}\n`;
    res.writeHead(200, { ...headers, "cache-control": "no-cache" });
    return res.end(body);
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => {
  httpServer.once("error", (e) => {
    console.error(`can't serve on port ${PORT} (${e.code}); set PORT to a free one`);
    process.exit(1);
  });
  httpServer.listen(PORT, resolve);
});

/* -------------------------------------------------------------- harness */

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`);
  if (!ok) failures++;
};
const section = (name) => console.log(`\n${name}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pageErrors = [];
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  return { ctx, page };
}
// Loads the hub and waits until its worker controls the page.
async function installHub(page) {
  await page.goto(B);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
}
const bar = (page, sel) => page.locator(`random-nav ${sel}`);
const navH = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--random-nav-h"));
const hasBar = (page) => page.evaluate(() => !!document.querySelector("random-nav"));

try {
  const { page } = await freshPage();

  section("hub");
  await installHub(page);
  check(await hasBar(page), "bar on the homepage");
  check(await bar(page, 'button[aria-label^="Home"]').isDisabled(), "Home disabled on the hub");
  check(await bar(page, 'button[aria-label="Back"]').isHidden(), "Back hidden with no history");
  const manifest = await (await page.request.get(B + "manifest.webmanifest")).json();
  check(manifest.display === "standalone" && manifest.shortcuts.length === 4 && !!manifest.share_target,
    "manifest: standalone, 4 shortcuts, share target");

  section("idea pages get the bar injected");
  await page.goto(B + "ideas/breathe/");
  await page.waitForSelector("random-nav", { state: "attached" });
  check((await navH(page)).includes("48px"), "--random-nav-h set");
  check(await page.$eval("a.back", (a) => getComputedStyle(a).display === "none"), 'the idea\'s own "← random" link is hidden');

  section("immersive moments");
  await bar(page, 'button[aria-label="Recent ideas"]').click();
  await page.keyboard.press("Escape");
  check((await navH(page)).includes("48px"), "a tap on the bar doesn't reach the page (Breathe stays put)");
  await page.locator("body").click({ position: { x: 195, y: 300 } }); // starts Breathe
  await page.waitForTimeout(400);
  check((await navH(page)).startsWith("env("), "Breathe tucks the bar away");
  await bar(page, ".handle").click();
  check((await navH(page)).includes("48px"), "the handle brings it back");

  section("back, recents");
  await bar(page, 'button[aria-label="Back"]').click();
  await page.waitForURL(B);
  const recents = await page.evaluate(() => JSON.parse(localStorage.getItem("random-hub:recents")));
  check(recents?.[0]?.slug === "breathe", "recents recorded the visit");
  await bar(page, 'button[aria-label="Recent ideas"]').click();
  check(await bar(page, '.card[href$="ideas/breathe/"]').isVisible(), "tray lists it");
  await page.keyboard.press("Escape");

  section("new labels");
  await page.evaluate(() => localStorage.setItem("random-hub:since", JSON.stringify("2000-01-01T00:00:00Z")));
  await page.reload();
  await page.waitForSelector(".card-new");
  const pills = await page.$$eval(".card-new", (els) => els.map((e) => e.closest(".card").dataset.slug));
  check(pills.length > 0 && !pills.includes("breathe"), `New on unopened ideas only (${pills.join(", ")})`);

  section("share");
  await page.goto(B + "ideas/breathe/");
  await page.waitForSelector("random-nav", { state: "attached" });
  if (await page.evaluate(() => !navigator.share)) {
    await page.evaluate(() => window.randomNav.share());
    await page.waitForTimeout(300);
    check((await page.evaluate(() => navigator.clipboard.readText())) === B + "ideas/breathe/", "no share sheet: the link is copied");
  }
  await page.goto(B + "?url=" + encodeURIComponent(B + "ideas/breathe/"));
  await page.waitForURL(B + "ideas/breathe/");
  check(true, "a link shared to the app opens that idea");

  section("save for offline");
  await page.goto(B);
  const save = page.locator('.save[data-slug="public-screening"]');
  await save.waitFor();
  check((await save.getAttribute("aria-pressed")) === "false", "Save offline offered");
  await save.click();
  await page.waitForFunction(() => document.querySelector('.save[data-slug="public-screening"]').getAttribute("aria-pressed") === "true", null, { timeout: 30000 });
  check(true, "saved");
  check((await page.locator('.save[data-slug="breathe"]').getAttribute("aria-pressed")) === "true", "tiny ideas are saved at install (Breathe)");
  check(!(await page.evaluate(() => JSON.parse(localStorage.getItem("random-hub:opened") || "[]"))).includes("public-screening"),
    "saving doesn't count as opening");

  section("offline");
  await page.goto(B + "ideas/container-compound/");
  await page.waitForTimeout(1500);
  server.offline = true;
  await page.goto(B);
  check((await page.title()) === "random", "hub loads");
  await page.goto(B + "ideas/public-screening/");
  check((await page.title()) !== "Offline · random" && (await hasBar(page)), "a saved idea loads, with the bar");
  await page.goto(B + "ideas/ephemera/");
  await page.waitForSelector("#cached .card", { timeout: 5000 }).catch(() => {});
  const listed = await page.$$eval("#cached .card h3", (els) => els.map((e) => e.textContent));
  check(listed.includes("Breathe") && listed.includes("Public Screening") && !listed.includes("Ephemera"),
    `unvisited idea → offline page listing cached ones (${listed.join(", ")})`);
  server.offline = false;

  section("an idea that brings its own worker");
  await page.goto(B + "ideas/cadence/");
  await page.waitForSelector("random-nav", { state: "attached" });
  await page.evaluate(() => { window.__firstLoad = true; });
  await page.waitForFunction(() => /ideas\/cadence\/sw\.js$/.test(navigator.serviceWorker.controller?.scriptURL || ""), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  check(await page.evaluate(() => window.__firstLoad === true), "Cadence's first install takes over without reloading the page");
  check(!(await page.$("[data-random-nav-spacer]")), "Cadence has the bar, overlay mode");
  const keys = await page.evaluate(() => caches.keys());
  check(keys.filter((k) => k.startsWith("random-hub-shell-")).length === 1 && keys.some((k) => k.startsWith("cadence-")),
    `each app keeps its own caches (${keys.join(", ")})`);

  section("updates");
  await page.goto(B + "ideas/breathe/");
  await page.waitForSelector("random-nav", { state: "attached" });
  const shellBefore = (await page.evaluate(() => caches.keys())).find((k) => k.startsWith("random-hub-shell-"));
  server.bump++;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  const refresh = bar(page, ".toast button");
  await refresh.waitFor({ timeout: 15000 });
  check((await bar(page, ".toast span").textContent()) === "New ideas available", "update offered as a toast");
  await Promise.all([page.waitForEvent("load"), refresh.click()]);
  await page.waitForTimeout(1000);
  check(!(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r.waiting))), "Refresh activates the waiting worker");
  const shellsAfter = (await page.evaluate(() => caches.keys())).filter((k) => k.startsWith("random-hub-shell-"));
  check(shellsAfter.length === 1 && shellsAfter[0] === shellBefore, "and reloads onto it, with a single shell cache");

  section("eviction");
  {
    const { ctx, page } = await freshPage();
    server.capBytes = 300 * 1024;
    server.bump++;
    await installHub(page);
    for (const slug of ["container-compound", "public-screening", "ephemera"]) {
      await page.goto(B + "ideas/" + slug + "/");
      await page.waitForTimeout(2500);
    }
    const cached = await page.evaluate(async () => {
      const c = await caches.open("random-hub-ideas");
      const index = await (await c.match(new URL("__random-hub-index__", location.origin + "/random/"))).json();
      return [...new Set(Object.values(index.entries).map((e) => e.slug))].sort();
    });
    check(cached.join() === "breathe,ephemera", `least recently used ideas evicted, saved ones kept (${cached.join(", ")})`);
    server.capBytes = null;
    await ctx.close();
  }

  /* ------------------------------------------------ retro look (stage 1) */

  section("retro look: switching");
  {
    const { ctx, page } = await freshPage();
    await installHub(page);
    const lookOf = () => page.evaluate(() => document.documentElement.dataset.look);
    const themeColor = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]').content);
    check((await lookOf()) === "modern" && (await page.locator("#retro").isHidden()), "a browser tab opens modern");
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.click("#look-retro");
    await page.waitForSelector("#retro[data-ready]");
    check((await page.evaluate(() => window.__sameDocument)) && (await page.locator("body > main").isHidden()),
      "Retro look switches at once, without a reload");
    check((await themeColor()) === "#000000", "the device's bar is painted black");
    check(await page.evaluate(() => document.fonts.load('12px "Droid Sans"').then((f) => f.length > 0)), "Droid Sans loads");
    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    check((await lookOf()) === "retro", "the choice survives a reload");
    await page.evaluate(() => window.randomNav.setLook("modern"));
    check((await lookOf()) === "modern" && (await page.locator("body > main").isVisible()) && (await page.locator("#retro").isHidden()),
      "and switching back to modern is instant too");
    check((await themeColor()) === "#faf9f7", "the theme colour is restored");
    await ctx.close();
  }

  section("retro look: installed default");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    check((await page.evaluate(() => document.documentElement.dataset.look)) === "retro", "the installed app opens retro");
    await ctx.close();
  }

  section("retro launcher: home screens, dock, drawer");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => localStorage.setItem("random-hub:look", '"retro"'));
    await installHub(page);
    await page.waitForSelector("#retro[data-ready]");
    const catalogue = await (await page.request.get(B + "ideas.json")).json();
    const homeSlugs = await page.$$eval(".rt-pages .rt-icon", (els) => els.map((e) => e.dataset.slug));
    check(homeSlugs.length === catalogue.length && catalogue.every((i) => homeSlugs.includes(i.slug)), "every idea is on the home screens");
    check((await page.$eval('.rt-page[data-page="1"] .rt-icon', (e) => e.dataset.slug)) === catalogue[0].slug, "newest first, on the centre screen");
    const current = () => page.$$eval(".rt-dots button", (bs) => bs.findIndex((b) => b.getAttribute("aria-current") === "true"));
    const shownPage = () => page.$eval(".rt-pages", (p) => Math.round(p.scrollLeft / p.clientWidth));
    check((await current()) === 1 && (await shownPage()) === 1, "opens on the centre of 3 screens");
    await page.click(".rt-dots button:nth-child(3)");
    await page.waitForFunction(() => { const p = document.querySelector(".rt-pages"); return Math.round(p.scrollLeft / p.clientWidth) === 2; });
    check((await current()) === 2, "a page dot swipes to its screen");
    await page.focus(".rt-pages");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => { const p = document.querySelector(".rt-pages"); return Math.round(p.scrollLeft / p.clientWidth) === 1; });
    check(true, "and the arrow keys do too");
    const hues = await page.$$eval(".rt-pages .rt-tile", (ts) => ts.map((t) => t.style.getPropertyValue("--h") + "/" + t.style.getPropertyValue("--dl")));
    check(new Set(hues).size === hues.length, "every idea's tile has its own colour");

    const dock = () => page.$$eval(".rt-dock-slot .rt-icon", (els) => els.map((e) => e.dataset.slug));
    check((await dock()).join() === catalogue.slice(0, 2).map((i) => i.slug).join(), "the dock starts with the two newest ideas");

    await page.click(".rt-launcher");
    await page.waitForSelector(".rt-drawer.rt-open");
    const drawerSlugs = () => page.$$eval(".rt-drawer .rt-icon", (els) => els.map((e) => e.dataset.slug));
    const az = [...catalogue].sort((a, b) => a.title.localeCompare(b.title)).map((i) => i.slug);
    check((await drawerSlugs()).join() === az.join(), "the drawer lists every idea, A–Z by default");
    await page.click('.rt-sort [data-sort="new"]');
    check((await drawerSlugs()).join() === catalogue.map((i) => i.slug).join(), "Newest sorts by date");
    await bar(page, 'button[aria-label="Back"]').click();
    await page.waitForSelector(".rt-drawer:not(.rt-open)");
    check(page.url() === B, "the bar's Back closes the drawer, staying on the hub");
    await page.click(".rt-launcher");
    await page.waitForSelector(".rt-drawer.rt-open");
    check((await drawerSlugs())[0] === catalogue[0].slug, "the sort order is remembered");
    await bar(page, 'button[aria-label^="Home"]').click();
    await page.waitForSelector(".rt-drawer:not(.rt-open)");
    check(!(await bar(page, 'button[aria-label^="Home"]').isDisabled()) && (await current()) === 1, "● closes it and returns to the centre screen");
    await page.click(".rt-launcher");
    await page.waitForSelector(".rt-drawer.rt-open");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".rt-drawer:not(.rt-open)");
    check(true, "Escape closes it");

    await page.click('.rt-pages .rt-icon[data-slug="breathe"]');
    await page.waitForURL(B + "ideas/breathe/");
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    check((await dock())[0] === "breathe", "then it follows what you open");
    await page.evaluate(() => localStorage.setItem("random-hub:since", JSON.stringify("2000-01-01T00:00:00Z")));
    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    const dotted = await page.$$eval(".rt-pages .rt-new", (els) => els.map((e) => e.closest(".rt-icon").dataset.slug));
    check(dotted.length === catalogue.length - 1 && !dotted.includes("breathe"), "unopened new ideas carry a green dot");

    server.offline = true;
    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    check(await page.evaluate(() => document.fonts.load('12px "Droid Sans"').then((f) => f.length > 0)),
      "offline, the launcher and its font come from the precache");
    server.offline = false;
    await ctx.close();
  }

  /* ------------------------------------------ retro launcher (stage 2) */

  section("retro widgets");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("random-hub:look", '"retro"');
        localStorage.setItem("random-hub:since", JSON.stringify("2000-01-01T00:00:00Z"));
      }
    });
    await installHub(page);
    await page.waitForSelector("#retro[data-ready]");
    const catalogue = await (await page.request.get(B + "ideas.json")).json();
    check(await page.locator('.rt-page[data-page="1"] .rt-search').isVisible() && await page.locator('.rt-page[data-page="1"] .rt-clock').count() === 1
      && await page.locator('.rt-page[data-page="0"] .rt-news').count() === 1 && await page.locator('.rt-page[data-page="2"] .rt-power').count() === 1,
      "search and clock on the centre screen, new ideas on the left, power control on the right");

    await page.fill(".rt-search input", "film");
    const found = await page.$$eval(".rt-result", (els) => els.map((e) => e.dataset.slug));
    const expected = catalogue.filter((i) => (i.title + " " + i.description).toLowerCase().includes("film")).map((i) => i.slug);
    check(found.length > 0 && found.join() === expected.join(), `search filters title and description (${found.join(", ")})`);
    await page.fill(".rt-search input", "zzzz");
    check(await page.locator(".rt-results-none").isVisible(), "and says when nothing matches");
    await page.press(".rt-search input", "Escape");
    check(await page.locator(".rt-results").isHidden(), "Escape clears it");

    const clockText = await page.textContent(".rt-clock-time");
    check(/\d{1,2}:\d{2}/.test(clockText), `the clock tells the time (${clockText})`);
    await page.click(".rt-clock");
    check((await page.getAttribute(".rt-clock", "data-style")) === "analog" && (await page.locator(".rt-analog").count()) === 1, "a tap flips it to analog");

    const news = await page.$$eval(".rt-news-item", (els) => els.map((e) => e.dataset.slug));
    check(news.length === Math.min(3, catalogue.length) && news[0] === catalogue[0].slug, "New ideas lists up to three, newest first");

    const key = (id) => page.locator(`.rt-power-key[data-power="${id}"]`);
    check((await key("look").getAttribute("aria-pressed")) === "true" && (await key("haptics").getAttribute("aria-pressed")) === "true"
      && (await key("sounds").getAttribute("aria-pressed")) === "false", "power control shows retro on, haptics on, sounds off");
    await page.click(".rt-dots button:nth-child(3)");
    await page.waitForTimeout(500);
    await key("sounds").click();
    check((await key("sounds").getAttribute("aria-pressed")) === "true", "a power key toggles");
    check((await page.getAttribute(".rt-wallpaper", "data-moving")) === "true", "the live wallpaper moves");
    await key("motion").click();
    check((await page.getAttribute(".rt-wallpaper", "data-moving")) === "false", "Wallpaper motion off stills it");

    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    check((await page.getAttribute(".rt-clock", "data-style")) === "analog" && (await key("sounds").getAttribute("aria-pressed")) === "true",
      "clock style and toggles are remembered");
    await key("motion").click();
    await page.click(".rt-launcher");
    await page.waitForSelector(".rt-drawer.rt-open");
    check((await page.getAttribute(".rt-wallpaper", "data-moving")) === "false", "the wallpaper pauses under the drawer");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".rt-drawer:not(.rt-open)");
    check((await page.getAttribute(".rt-wallpaper", "data-moving")) === "true", "and resumes");
    await key("look").click();
    check((await page.evaluate(() => document.documentElement.dataset.look)) === "modern", "the look key leaves for modern");
    await ctx.close();
  }

  section("retro status bar and shade");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("random-hub:look", '"retro"');
        localStorage.setItem("random-hub:since", JSON.stringify("2000-01-01T00:00:00Z"));
      }
    });
    await installHub(page);
    await page.waitForSelector("#retro[data-ready]");
    const catalogue = await (await page.request.get(B + "ideas.json")).json();
    // (Waits rather than compares once, so a minute ticking over can't flake it.)
    const inStep = await page.waitForFunction(() => document.querySelector(".rt-status-clock").textContent ===
      new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), null, { timeout: 20000 }).then(() => true, () => false);
    check(inStep, `the status bar shows the real time (${await page.textContent(".rt-status-clock")})`);
    check((await page.getAttribute(".rt-status-net", "data-online")) === "true", "and that you're online");
    const hasBattery = await page.evaluate(() => !!navigator.getBattery);
    check((await page.locator(".rt-status-battery").isVisible()) === hasBattery, "battery shows only where the browser reports it");
    check(Number(await page.getAttribute(".rt-status", "data-unread")) === catalogue.length, "one notification per new idea");

    await page.click(".rt-status");
    await page.waitForSelector(".rt-shade.rt-open");
    const notes = await page.$$eval(".rt-note", (els) => els.map((e) => e.dataset.note));
    check(catalogue.every((i) => notes.includes("new:" + i.slug)), "the shade lists them");
    await page.click(".rt-shade-clear");
    check((await page.locator(".rt-note").count()) === 0 && (await page.locator(".rt-shade-none").isVisible()), "Clear empties it");
    await bar(page, 'button[aria-label="Back"]').click();
    await page.waitForSelector(".rt-shade:not(.rt-open)");
    check(page.url() === B, "Back closes the shade");
    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    check(Number(await page.getAttribute(".rt-status", "data-unread")) === 0, "cleared stays cleared");

    await page.evaluate(() => window.randomRetro.notify({ id: "saved:breathe", type: "saved", slug: "breathe" }));
    check(Number(await page.getAttribute(".rt-status", "data-unread")) === 1, "a saved-for-offline event arrives");
    await ctx.setOffline(true);
    await page.waitForFunction(() => document.querySelector(".rt-status-net").dataset.online === "false");
    await page.click(".rt-status");
    await page.waitForSelector(".rt-shade.rt-open");
    const now = await page.$$eval(".rt-note", (els) => els.map((e) => e.dataset.note));
    check(now.includes("offline") && now.includes("saved:breathe"), "offline shows as ongoing, beside the event");
    await ctx.setOffline(false);
    await page.click(".rt-shade-handle");
    await page.waitForSelector(".rt-shade:not(.rt-open)");

    await page.click(".rt-launcher");
    await page.waitForSelector(".rt-drawer.rt-open");
    await page.click(".rt-status");
    await page.waitForSelector(".rt-shade.rt-open");
    check(await page.locator(".rt-drawer.rt-open").count() === 1, "the shade pulls down over the drawer");
    await bar(page, 'button[aria-label^="Home"]').click();
    await page.waitForSelector(".rt-shade:not(.rt-open)");
    await page.waitForSelector(".rt-drawer:not(.rt-open)");
    check(true, "● unwinds both at once");

    server.bump++;
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page.waitForFunction(() => window.randomNav.updateReady(), null, { timeout: 15000 });
    await page.click(".rt-status");
    await page.waitForSelector('.rt-note[data-note="update"]');
    await Promise.all([page.waitForEvent("load"), page.click('.rt-note[data-note="update"]')]);
    check(!(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r.waiting))), "an update in the shade refreshes onto it");
    await ctx.close();
  }

  section("retro: no battery API, reduced motion");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => {
      localStorage.setItem("random-hub:look", '"retro"');
      Object.defineProperty(Navigator.prototype, "getBattery", { value: undefined, configurable: true });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    await page.waitForTimeout(300);
    check(await page.locator(".rt-status-battery").isHidden(), "no battery API, no battery (never a fake one)");
    check((await page.getAttribute(".rt-wallpaper", "data-moving")) === "false", "reduced motion keeps the wallpaper still");
    await ctx.close();
  }

  /* ------------------------------------------ retro chrome (stage 3) */

  section("retro chrome: ≡ menu, dialogs");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => { if (!localStorage.getItem("random-hub:look")) localStorage.setItem("random-hub:look", '"retro"'); });
    await installHub(page);
    await page.waitForSelector("#retro[data-ready]");
    const menuKey = bar(page, "button.menu");
    const layerKind = () => page.evaluate(() => {
      const r = document.querySelector("random-nav").shadowRoot;
      const n = r.querySelector(".opts, .dlg");
      return n ? (n.classList.contains("opts") ? "options" : n.dataset.kind || "menu") : null;
    });
    check(await menuKey.isVisible(), "retro adds a ≡ key");
    await menuKey.click();
    const opts = await page.$$eval("random-nav >> .opt", (els) => els.map((e) => e.dataset.opt));
    check(opts.join() === "wallpaper,search,settings,look,share,about", `≡ on the hub: ${opts.join(", ")}`);
    await bar(page, 'button[aria-label="Back"]').click();
    check((await layerKind()) === null && page.url() === B, "◀ closes the panel without leaving");
    await menuKey.click();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    check((await page.evaluate(() => document.querySelector("random-nav").shadowRoot.activeElement?.dataset.opt)) === "settings", "Tab moves within the panel");
    await page.keyboard.press("Escape");
    check((await layerKind()) === null, "Escape closes it");
    await menuKey.click();
    await bar(page, '.opt[data-opt="search"]').click();
    check(await page.evaluate(() => document.activeElement === document.querySelector(".rt-search input")), "≡ → Search focuses the search box");
    await menuKey.click();
    await bar(page, '.opt[data-opt="about"]').click();
    await page.waitForFunction(() => /version [0-9a-f]{12}/.test(document.querySelector("random-nav").shadowRoot.querySelector(".dlg-meta")?.textContent || ""));
    check(true, "About shows the idea count and version");
    await page.keyboard.press("Escape");

    // The icon context menu: right-click (desktop) and long-press (touch).
    await page.click('.rt-pages .rt-icon[data-slug="container-compound"]', { button: "right" });
    await bar(page, ".dlg-item").first().waitFor(); // opens once the offline status is in
    const items = await page.$$eval("random-nav >> .dlg-item", (els) => els.map((e) => e.dataset.act));
    check(items.join() === "open,dock,save,share,about", `right-click an icon: ${items.join(", ")}`);
    await bar(page, '.dlg-item[data-act="dock"]').click();
    const dock = await page.$$eval(".rt-dock-slot .rt-icon", (els) => els.map((e) => e.dataset.slug));
    check(dock.includes("container-compound") && dock.length === 2, `Add to dock replaces the older slot (${dock.join(", ")})`);
    const icon = page.locator('.rt-pages .rt-icon[data-slug="public-screening"]');
    const box = await icon.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await bar(page, ".dlg-item").first().waitFor();
    await page.waitForTimeout(300);
    check((await layerKind()) === "menu" && page.url() === B, "a long hold opens the menu, not the idea");
    await bar(page, '.dlg-item[data-act="save"]').click();
    await page.waitForFunction(() => window.randomNav.offlineStatus().then((s) => s.saved.includes("public-screening")), null, { timeout: 30000, polling: 1000 });
    check(true, "Save offline from the menu pins it");
    const landed = await page.waitForFunction(() => (JSON.parse(localStorage.getItem("random-hub:events") || "[]")[0] || {}).id === "saved:public-screening"
      && Number(document.querySelector(".rt-status").dataset.unread) >= 1, null, { timeout: 5000 }).then(() => true, () => false);
    check(landed, "and it lands in the shade");
    await page.click('.rt-pages .rt-icon[data-slug="public-screening"]', { button: "right" });
    await bar(page, '.dlg-item[data-act="about"]').click(); // (the locator waits for the menu)
    await page.waitForFunction(() => document.querySelector("random-nav").shadowRoot.querySelector(".dlg-meta")?.dataset.offline);
    check((await page.evaluate(() => document.querySelector("random-nav").shadowRoot.querySelector(".dlg-meta").dataset.offline)) === "Saved for offline",
      "About this idea shows its offline status");
    await page.keyboard.press("Escape");

    // Long-press ●: the recents dialog (retro).
    await page.goto(B + "ideas/breathe/");
    await page.waitForSelector("random-nav", { state: "attached" });
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    const home = await bar(page, 'button[aria-label^="Home"]').boundingBox();
    await page.mouse.move(home.x + home.width / 2, home.y + home.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    check((await layerKind()) === "recents" && (await page.$$eval("random-nav >> .gtile", (els) => els.map((e) => e.dataset.slug)))[0] === "breathe",
      "long-press ● opens the recents dialog");
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  section("retro chrome on idea pages");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => { if (!localStorage.getItem("random-hub:look")) localStorage.setItem("random-hub:look", '"retro"'); });
    await installHub(page);
    await page.goto(B + "ideas/public-screening/");
    await page.waitForSelector("random-nav", { state: "attached" });
    check(await page.evaluate(() => document.querySelector("random-nav").shadowRoot.querySelector(".wrap").classList.contains("retro")), "ideas get the retro bar too");
    await bar(page, "button.menu").click();
    const opts = await page.$$eval("random-nav >> .opt", (els) => els.map((e) => e.dataset.opt));
    check(opts.join() === "share,save,about,settings,home,look", `≡ on an idea: ${opts.join(", ")}`);
    await bar(page, '.opt[data-opt="save"]').click();
    await page.waitForFunction(() => window.randomNav.offlineStatus().then((s) => s.saved.includes("public-screening")), null, { timeout: 15000, polling: 500 });
    await bar(page, "button.menu").click();
    await page.waitForFunction(() => document.querySelector("random-nav").shadowRoot.querySelector('.opt[data-opt="save"]').getAttribute("aria-pressed") === "true");
    check(true, "Save offline pins this idea, and ≡ then shows it saved");
    await page.keyboard.press("Escape");
    await page.goto(B + "ideas/cadence/");
    await page.waitForSelector("random-nav", { state: "attached" });
    await bar(page, "button.menu").click();
    check(await bar(page, '.opt[data-opt="save"]').isDisabled(), "an idea that keeps itself offline can't be saved again");
    await bar(page, '.opt[data-opt="look"]').click();
    check(!(await page.evaluate(() => document.querySelector("random-nav").shadowRoot.querySelector(".wrap").classList.contains("retro")))
      && (await bar(page, "button.menu").isHidden()), "Modern look from an idea page switches the bar back");
    await page.evaluate(() => window.randomNav.setLook("retro"));

    // Retro offline page: truly offline, an idea not yet cached.
    server.offline = true;
    await page.goto(B + "ideas/ephemera/");
    await page.waitForSelector("#cached .card");
    check((await page.locator(".signal").isVisible()) && (await page.locator("#cached .card .rt-tile").first().isVisible()),
      "offline, the retro 'no connection' screen lists cached ideas as tiles");
    server.offline = false;
    await ctx.close();
  }

  /* ------------------------- retro feel: boot, launch, feedback (stage 4) */

  const installedRetro = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...opts });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
      window.__vibes = [];
      navigator.vibrate = (ms) => { window.__vibes.push(ms); return true; };
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    return { ctx, page };
  };

  section("retro boot animation");
  {
    const { ctx, page } = await installedRetro();
    await page.goto(B);
    check(await page.locator(".rt-boot").isVisible(), "a cold start of the installed app boots");
    const t0 = Date.now();
    await page.waitForSelector(".rt-boot", { state: "detached", timeout: 5000 });
    const took = Date.now() - t0;
    check(took > 900 && took < 2600, `for about a second and a half (${took} ms)`);
    await page.reload();
    await page.waitForSelector("#retro[data-ready]");
    check((await page.locator(".rt-boot").count()) === 0, "not again in the same session");
    await ctx.close();
  }
  {
    const { ctx, page } = await installedRetro();
    await page.goto(B);
    await page.waitForSelector(".rt-boot");
    await page.waitForTimeout(200);
    await page.click(".rt-boot");
    await page.waitForSelector(".rt-boot", { state: "detached", timeout: 800 });
    check(true, "a tap skips it");
    await ctx.close();
  }
  {
    const { ctx, page } = await installedRetro({ reducedMotion: "reduce" });
    await page.goto(B);
    check((await page.getAttribute(".rt-boot", "class")).includes("rt-boot-still"), "reduced motion: a still logo");
    await page.waitForSelector(".rt-boot", { state: "detached", timeout: 1500 });
    check(true, "and a short fade");
    await ctx.close();
  }
  {
    const { ctx, page } = await installedRetro();
    await ctx.addInitScript(() => localStorage.setItem("random-hub:look", '"modern"'));
    await page.goto(B);
    await page.waitForTimeout(300);
    check((await page.locator(".rt-boot").count()) === 0, "never in the modern look");
    await ctx.close();
  }

  section("retro launch, haptics and sounds");
  {
    const { ctx, page } = await installedRetro();
    await ctx.addInitScript(() => sessionStorage.setItem("random-hub:booted", "1"));
    await page.goto(B);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForSelector("#retro[data-ready]");
    const vibes = () => page.evaluate(() => window.__vibes.slice());

    await bar(page, "button.menu").click();
    await page.keyboard.press("Escape");
    check((await vibes()).includes(10), "a key press ticks (10 ms)");
    await page.click('.rt-pages .rt-icon[data-slug="breathe"]', { button: "right" });
    await bar(page, ".dlg-item").first().waitFor();
    check((await vibes()).includes(25), "a long-press menu buzzes (25 ms)");
    await page.keyboard.press("Escape");
    check((await page.evaluate(() => window.randomNav.lastSound())) === null, "sounds are off by default");

    await page.evaluate(() => window.randomRetro.setSetting("sounds", true));
    await bar(page, "button.menu").click();
    await page.keyboard.press("Escape");
    check((await page.evaluate(() => window.randomNav.lastSound())) === "key", "with sounds on, keys click");
    await page.click(".rt-dots button:nth-child(3)");
    await page.waitForFunction(() => window.randomNav.lastSound() === "swipe", null, { timeout: 3000 }).catch(() => {});
    check((await page.evaluate(() => window.randomNav.lastSound())) === "swipe", "and a swipe ticks");
    await page.click(".rt-dots button:nth-child(2)");
    await page.waitForTimeout(400);

    await page.evaluate(() => { window.randomRetro.setSetting("haptics", false); window.__vibes.length = 0; });
    await bar(page, "button.menu").click();
    await page.keyboard.press("Escape");
    check((await vibes()).length === 0, "haptics off: no vibration");

    // Launch: the tile zooms up, then the idea opens.
    await Promise.all([page.waitForURL(B + "ideas/breathe/"), page.click('.rt-pages .rt-icon[data-slug="breathe"]').then(async () => {
      check((await page.locator(".rt-zoom").count()) === 1, "tapping an icon zooms its tile up");
    })]);
    check(true, "and opens the idea");
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    server.slow = "/random/ideas/container-compound/";
    // The page is mid-navigation while the card shows, so it notes the card
    // in sessionStorage for the next page to report.
    await page.evaluate(() => new MutationObserver(() => {
      const card = document.querySelector(".rt-loading");
      if (card) sessionStorage.setItem("sawLoading", card.textContent);
    }).observe(document.getElementById("retro"), { childList: true }));
    await page.click('.rt-pages .rt-icon[data-slug="container-compound"]');
    await page.waitForURL(B + "ideas/container-compound/", { timeout: 10000 });
    server.slow = null;
    check(((await page.evaluate(() => sessionStorage.getItem("sawLoading"))) || "").includes("Loading Container Compound"),
      "a slow idea shows the loading card");

    // Modern: no feedback at all.
    await page.evaluate(() => { window.randomRetro && window.randomRetro.setSetting("haptics", true); window.randomNav.setLook("modern"); window.__vibes.length = 0; });
    await bar(page, 'button[aria-label="Recent ideas"]').click();
    await page.keyboard.press("Escape");
    check((await vibes()).length === 0, "the modern look stays silent and still");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => localStorage.setItem("random-hub:look", '"retro"'));
    const page = await ctx.newPage();
    await page.goto(B);
    await page.waitForSelector("#retro[data-ready]");
    await Promise.all([page.waitForURL(B + "ideas/breathe/"), page.click('.rt-pages .rt-icon[data-slug="breathe"]')]);
    check(true, "reduced motion: a plain switch");
    await ctx.close();
  }

  section("retro Settings");
  {
    const { ctx, page } = await freshPage();
    await ctx.addInitScript(() => { if (!localStorage.getItem("random-hub:look")) localStorage.setItem("random-hub:look", '"retro"'); });
    await installHub(page);
    await page.waitForSelector("#retro[data-ready]");
    const settingsOpen = () => page.locator(".rt-settings.rt-open").count().then((n) => n === 1);
    const rowSel = (id) => `.rt-set-row[data-row="${id}"]`;

    await bar(page, "button.menu").click();
    await bar(page, '.opt[data-opt="settings"]').click();
    check(await settingsOpen(), "≡ → Settings opens the Settings app");
    const sections = await page.$$eval(".rt-set-section", (els) => els.map((e) => e.dataset.section));
    check(sections.join() === "display,feedback,home,storage,about", `sections: ${sections.join(", ")}`);

    await page.click(rowSel("motion"));
    check((await page.getAttribute(rowSel("motion"), "aria-checked")) === "false"
      && (await page.getAttribute('.rt-power-key[data-power="motion"]', "aria-pressed")) === "false", "a switch here updates the power widget too");
    await page.click(rowSel("clock"));
    check((await page.getAttribute(".rt-clock", "data-style")) === "analog", "Clock style flips the clock");
    await page.click(rowSel("sounds"));
    check(await page.evaluate(() => window.randomRetro.setting("sounds")), "UI sounds switches on");
    await page.waitForFunction(() => /[0-9a-f]{12}/.test(document.querySelector('.rt-set-row[data-row="version"] .rt-set-summary').textContent));
    check(true, "About shows the version");

    await page.waitForSelector(rowSel("saved:breathe"));
    check((await page.getAttribute(rowSel("saved:breathe"), "aria-checked")) === "true", "Storage lists saved ideas");
    await page.click(rowSel("saved:breathe"));
    await page.waitForFunction(() => window.randomNav.offlineStatus().then((s) => !s.saved.includes("breathe")), null, { polling: 300, timeout: 5000 });
    check(true, "and unchecking one unsaves it");

    await bar(page, 'button[aria-label="Back"]').click();
    await page.waitForSelector(".rt-settings:not(.rt-open)");
    check(page.url() === B, "Back closes Settings");

    await page.goto(B + "ideas/container-compound/");
    await page.waitForTimeout(1500);
    await bar(page, "button.menu").click();
    await bar(page, '.opt[data-opt="settings"]').click();
    await page.waitForURL(B);
    await page.waitForSelector(".rt-settings.rt-open");
    check(true, "≡ → Settings on an idea page opens the hub's Settings");
    check((await page.evaluate(() => window.randomNav.offlineStatus().then((s) => s.cached.includes("container-compound")))), "(that idea is cached)");
    await page.click(rowSel("clear-cache"));
    await page.waitForFunction(() => window.randomNav.offlineStatus().then((s) => !s.cached.includes("container-compound")), null, { polling: 300, timeout: 5000 });
    check(true, "Clear cached ideas drops what isn't saved");

    await bar(page, 'button[aria-label^="Home"]').click();
    await page.waitForSelector(".rt-settings:not(.rt-open)");
    check(true, "● closes Settings");
    await page.click(".rt-dots button:nth-child(3)");
    await page.waitForTimeout(500);
    await page.click('.rt-power-key[data-power="storage"]');
    await page.waitForSelector(".rt-settings.rt-open");
    check(true, "the power widget's storage key opens Settings");

    await page.evaluate(() => localStorage.setItem("random-hub:dock", JSON.stringify(["ephemera"])));
    await page.click(rowSel("reset-dock"));
    check(await page.evaluate(() => localStorage.getItem("random-hub:dock") === null), "Reset dock forgets the chosen favourites");
    await page.click(rowSel("look"));
    check((await page.evaluate(() => document.documentElement.dataset.look)) === "modern", "and Retro look off returns to modern");
    await ctx.close();
  }

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await browser.close();
  httpServer.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
