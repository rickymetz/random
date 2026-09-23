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

const server = { offline: false, bump: 0, capBytes: null };
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".wasm": "application/wasm", ".woff2": "font/woff2",
};
const httpServer = http.createServer((req, res) => {
  if (server.offline) return req.socket.destroy();
  const url = new URL(req.url, "http://x");
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
await new Promise((r) => httpServer.listen(PORT, r));

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
