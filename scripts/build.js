#!/usr/bin/env node
// Builds the static site into _site/:
//   - copies every ideas/<slug>/ folder that contains an index.html
//   - generates the homepage by scanning those folders (no manual index upkeep)
//   - generates the PWA files at the repo root: manifest.webmanifest,
//     ideas.json (the catalogue nav.js and the offline page read) and sw.js
//     (from scripts/sw.template.js, version-stamped so each deploy that
//     changes the shell or the idea list is offered as an update)
//   - mirrors each idea's icon-flat.svg / icon-3d.svg to icons/<slug>-<style>.svg
//     (generated and committed, like the files above; part of the shell)
//
// Per-idea metadata (all optional), resolved in this order:
//   1. ideas/<slug>/idea.json  -> { "title", "description", "emoji", "color", "hidden" }
//   2. <title> and <meta name="description"> parsed from the idea's index.html
//   3. the slug itself
// Ideas are dated by the first git commit that touched their folder.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const ideasDir = path.join(root, "ideas");
const outDir = path.join(root, "_site");

function firstCommitDate(relPath) {
  try {
    const out = execFileSync(
      "git",
      ["log", "--diff-filter=A", "--follow", "--format=%aI", "--reverse", "--", relPath],
      { cwd: root, encoding: "utf8" }
    ).trim();
    const first = out.split("\n").filter(Boolean)[0];
    if (first) return new Date(first);
  } catch {
    // not a git checkout, or no history — fall through
  }
  return new Date();
}

function extractTag(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

// --- colour ---
const INK = "#141414";
const ICON_STYLES = ["flat", "3d"];

// No "color" in idea.json: a hue from an FNV-1a hash of the slug (the same
// hash nav.js tileVars falls back to), darkened until white text on it
// reaches 4.5:1.
function slugColor(slug) {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let l = 42;
  while (l > 10 && contrast(hslHex(h % 360, 52, l), "#ffffff") < 4.5) l -= 2;
  return hslHex(h % 360, 52, l);
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Text on an idea's block: white or ink, whichever reads better.
function inkOn(color, slug) {
  const white = contrast(color, "#ffffff");
  const ink = contrast(color, INK);
  if (Math.max(white, ink) < 4.5) {
    console.warn(`warning: ideas/${slug} colour ${color} is under 4.5:1 with both white and ink text`);
  }
  return white >= ink ? "#ffffff" : INK;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Every file an idea deploys (dotfiles never deploy), with its size.
function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix + entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, rel + "/"));
    else out.push({ rel, bytes: fs.statSync(full).size });
  }
  return out;
}

function collectIdeas() {
  if (!fs.existsSync(ideasDir)) return [];
  const ideas = [];
  for (const entry of fs.readdirSync(ideasDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = path.join(ideasDir, slug);
    if (!fs.existsSync(path.join(dir, "index.html"))) continue;

    let meta = {};
    const metaPath = path.join(dir, "idea.json");
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      } catch (e) {
        console.warn(`warning: ideas/${slug}/idea.json is invalid JSON, ignoring (${e.message})`);
      }
    }
    if (meta.hidden) continue;

    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const title =
      meta.title ||
      extractTag(html, /<title[^>]*>([^<]*)<\/title>/i) ||
      slug.replace(/[-_]/g, " ");
    const description =
      meta.description ||
      extractTag(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
      "";

    // An idea that ships its own service worker (Cadence), or only
    // redirects to an app that does (the Ledger stub), keeps itself offline;
    // the hub doesn't offer to save it.
    const saveable =
      !fs.existsSync(path.join(dir, "sw.js")) && !/http-equiv=["']refresh/i.test(html);

    // The idea's colour (its block on the homepage, its launcher tile)
    // and the hand-drawn icons that sit on it, when it ships them.
    if (meta.color && !/^#[0-9a-f]{6}$/i.test(meta.color)) {
      console.warn(`warning: ideas/${slug}/idea.json "color" must be #rrggbb, ignoring ${JSON.stringify(meta.color)}`);
    }
    const color = /^#[0-9a-f]{6}$/i.test(meta.color || "") ? meta.color.toLowerCase() : slugColor(slug);
    const art = {};
    for (const style of ICON_STYLES) {
      if (fs.existsSync(path.join(dir, `icon-${style}.svg`))) art[style] = `icons/${slug}-${style}.svg`;
    }
    if (Object.keys(art).length === 1) {
      console.warn(`warning: ideas/${slug} ships only ${Object.values(art)[0].split("-").pop()}; icons need both icon-flat.svg and icon-3d.svg, using the emoji`);
    }

    // Where the hub's links land: the idea's folder, or a page inside it
    // ("entry" in idea.json, e.g. a preview page in front of the app).
    let url = `ideas/${slug}/`;
    if (meta.entry != null) {
      const entry = String(meta.entry);
      if (/^(?!\/)(?!.*\.\.)[\w./-]+$/.test(entry) && fs.existsSync(path.join(dir, entry.endsWith("/") ? entry + "index.html" : entry))) url += entry;
      else console.warn(`warning: ideas/${slug}/idea.json "entry" must be a page inside the idea, ignoring ${JSON.stringify(meta.entry)}`);
    }

    ideas.push({
      slug,
      url,
      title,
      description,
      emoji: meta.emoji || "",
      color,
      ink: inkOn(color, slug),
      art: Object.keys(art).length === ICON_STYLES.length ? art : null,
      // Optional retro launcher tile colour (a hex colour); else it's
      // picked from the slug.
      icon: /^#[0-9a-f]{3,8}$/i.test(meta.icon || "") ? meta.icon : "",
      // A private idea (Ledger) is never recorded in recents, so it can't
      // surface in the tray, the recents dialog or the retro dock.
      private: meta.private === true,
      date: firstCommitDate(path.join("ideas", slug)),
      saveable,
      files: saveable ? listFiles(dir) : [],
    });
  }
  // newest first
  ideas.sort((a, b) => b.date - a.date);
  return ideas;
}

// The hand-drawn icon in both styles, or the emoji. CSS shows the chosen
// style; the other is lazy (display: none), so the page itself doesn't
// fetch it, though the worker precaches both for a switch offline. The
// lead's icon is the likely LCP element, so it isn't lazy.
function renderArt(idea, eager) {
  if (!idea.art) {
    return `<span class="art art-emoji" aria-hidden="true">${escapeHtml(idea.emoji || "✦")}</span>`;
  }
  const img = (style) =>
    `<img class="art-${style}" src="${escapeHtml(idea.art[style])}" alt="" width="128" height="128" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
  return `<span class="art" aria-hidden="true">${ICON_STYLES.map(img).join("")}</span>`;
}

function prettyDate(date) {
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

// One idea: the lead, a secondary, or a row further down. Every kind keeps
// the hooks nav.js and hub.js use: .card[data-slug] with a .card-top that
// holds the <time> (the New pill goes before it), and the Save button as a
// sibling of the link (a button can't live inside a link), revealed by
// hub.js once the hub worker is in control.
function renderCard(idea, kind, i) {
  const date = idea.date.toISOString().slice(0, 10);
  const slug = escapeHtml(idea.slug);
  const tag = kind === "row" ? "li" : "div";
  const heading = kind === "row" ? "h3" : "h2";
  const save = idea.saveable
    ? `\n        <button type="button" class="save" data-slug="${slug}" hidden>Save offline</button>`
    : "";
  const kicker = kind === "lead" ? `<span class="kicker">Latest</span>` : "";
  // A screen reader hears the title (and "New", which nav.js adds with the
  // id new-<slug>), then the blurb as the description, not the whole card.
  const describe = idea.description ? ` aria-describedby="about-${slug}"` : "";
  return `      <${tag} class="card-wrap ${kind}${idea.saveable ? " saveable" : ""}" style="--c: ${idea.color}; --on: ${idea.ink}; --i: ${Math.min(i, 9)}">
        <a class="card" href="${idea.url}" data-slug="${slug}" aria-labelledby="title-${slug} new-${slug}"${describe}>
          ${renderArt(idea, kind === "lead")}
          <span class="card-body">
            <span class="card-top">${kicker}<time datetime="${date}">${prettyDate(idea.date)}</time></span>
            <${heading} id="title-${slug}">${escapeHtml(idea.title)}</${heading}>
            ${idea.description ? `<p id="about-${slug}">${escapeHtml(idea.description)}</p>` : ""}
          </span>
        </a>${save}
      </${tag}>`;
}

function renderHome(ideas) {
  const front = ideas.slice(0, 3).map((idea, i) => renderCard(idea, i === 0 ? "lead" : "second", i)).join("\n");
  const rows = ideas.slice(3).map((idea, i) => renderCard(idea, "row", i + 3)).join("\n");
  const count = `${ideas.length} idea${ideas.length === 1 ? "" : "s"}`;
  const body = !ideas.length
    ? `    <p class="empty">Nothing here yet. The first idea is on its way.</p>`
    : `    <section class="front" aria-label="Latest ideas">
${front}
    </section>${rows ? `
    <section class="more" aria-labelledby="more-title">
      <h2 class="section-title" id="more-title">More ideas</h2>
      <ol class="rows">
${rows}
      </ol>
    </section>` : ""}`;
  return `<!doctype html>
<html lang="en" data-random-page="hub">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>random</title>
<meta name="description" content="A hub of small ideas, each one a tiny page.">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="${THEME.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${THEME.dark}" media="(prefers-color-scheme: dark)">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="random">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<script>
  // The look (modern front page / retro launcher) and the icon style (flat /
  // 3D) are decided before first paint, so there's no flash of the wrong
  // one. nav.js makes the same calls later.
  (function () {
    var look, icons;
    try { look = JSON.parse(localStorage.getItem("random-hub:look")); } catch (e) {}
    try { icons = JSON.parse(localStorage.getItem("random-hub:icons")); } catch (e) {}
    // Modern unless someone has chosen retro.
    document.documentElement.setAttribute("data-look", look === "retro" ? "retro" : "modern");
    // Flat unless someone has chosen 3D.
    document.documentElement.setAttribute("data-icons", icons === "3d" ? "3d" : "flat");
    // The launcher's styles only for people who use it (nav.js loads its
    // script, and both on the switch to retro).
    if (look === "retro") document.write('<link rel="stylesheet" href="retro.css" data-retro-css>');
    // The display face only for the modern look, which uses it.
    else document.write('<link rel="preload" href="fonts/Archivo-Heavy.woff2" as="font" type="font/woff2" crossorigin>');
  })();
</script>
<style>
  @font-face {
    font-family: "Archivo Heavy";
    src: url("fonts/Archivo-Heavy.woff2") format("woff2");
    font-weight: 700 900;
    font-display: swap;
  }
  :root {
    --bg: ${THEME.light};
    --ink: #141414;
    --muted: #5e5a53;
    --line: #dcd7cc;
    --hover: #ece8df;
    --accent: #6a3fd0;
    --on-accent: #ffffff;
    --display: "Archivo Heavy", "Arial Black", ui-sans-serif, system-ui, sans-serif;
    --radius: 1.25rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: ${THEME.dark};
      --ink: #eeebe4;
      --muted: #a39f97;
      --line: #3a3733;
      --hover: #1c1b19;
      --accent: #a98cf5;
      --on-accent: #111111;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  [hidden] { display: none !important; }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) 1.5rem max(1rem, env(safe-area-inset-left));
  }
  main { max-width: 64rem; margin: 0 auto; }

  /* Masthead: a compact bar; the lead story carries the drama. */
  header { margin-bottom: 1.75rem; }
  .mast {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 0.9rem;
    border-bottom: 3px solid var(--ink);
  }
  header h1 {
    font-family: var(--display);
    font-weight: 900;
    font-size: 2rem;
    line-height: 1;
    letter-spacing: -0.03em;
  }
  header h1::after { content: "."; color: var(--accent); }
  .dek {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding-top: 0.6rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .dek b { color: var(--ink); font-weight: 600; }
  .hub-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .hub-actions > button, .seg button {
    min-height: 2.75rem;
    white-space: nowrap;
    border: 1.5px solid var(--ink);
    border-radius: 999px;
    padding: 0.35rem 1rem;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
  }
  @media (hover: hover) { .hub-actions > button:hover { background: var(--hover); } }
  .hub-actions #install { background: var(--ink); color: var(--bg); }
  .seg { display: inline-flex; }
  .seg button { border-radius: 0; }
  .seg button:first-child { border-radius: 999px 0 0 999px; }
  .seg button + button { border-left: 0; border-radius: 0 999px 999px 0; }
  @media (hover: hover) { .seg button:hover { background: var(--hover); } }
  /* The chosen style reads from <html data-icons>, so it's right before
     hub.js runs; hub.js keeps aria-pressed in step. */
  html[data-icons="flat"] .seg [data-icons="flat"],
  html[data-icons="3d"] .seg [data-icons="3d"] { background: var(--ink); color: var(--bg); }
  @media (max-width: 30rem) {
    header h1 { font-size: 1.6rem; }
    .hub-actions { gap: 0.35rem; }
    .hub-actions > button, .seg button { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.6rem 0.6rem 0.6rem 1rem;
    border: 1.5px solid var(--ink);
    border-radius: 0.75rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .hint b { color: var(--ink); font-weight: 600; }
  .hint span { flex: 1; }
  .hint button {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 1.2rem;
    line-height: 1;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 1.4rem;
    cursor: pointer;
  }

  /* Every idea */
  .card-wrap { position: relative; display: flex; }
  .card {
    flex: 1;
    position: relative;
    color: inherit;
    text-decoration: none;
    transition: transform 180ms cubic-bezier(.2, .7, .2, 1), box-shadow 180ms ease, background-color 180ms ease;
  }
  .card:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
  .card-body { display: flex; flex-direction: column; min-width: 0; }
  .card-top { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8rem; }
  .card-top time { margin-left: auto; }
  .card-top .kicker + time, .card-top .card-new + time { margin-left: 0; }
  .kicker {
    margin-right: auto;
    font-family: var(--display);
    font-weight: 800;
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .card-new {
    margin-left: auto;
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .card-top .kicker ~ .card-new { margin-left: 0; }
  .card h2, .card h3 {
    font-family: var(--display);
    font-weight: 900;
    letter-spacing: -0.025em;
    line-height: 0.98;
    text-wrap: balance;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  .art { display: grid; place-items: center; flex: none; }
  .art img { display: block; width: 100%; height: auto; transition: transform 220ms cubic-bezier(.2, .7, .2, 1); }
  .art .art-3d { display: none; }
  html[data-icons="3d"] .art .art-3d { display: block; }
  html[data-icons="3d"] .art .art-flat { display: none; }
  .art-emoji { line-height: 1; }
  .card:focus-visible .art img { transform: rotate(-5deg) scale(1.05); }
  @media (hover: hover) { .card:hover .art img { transform: rotate(-5deg) scale(1.05); } }

  /* The front: the lead and two secondaries as full-colour blocks */
  .front { display: grid; gap: 1rem; }
  @media (min-width: 44rem) {
    .front { grid-template-columns: 1fr 1fr; }
    .front .lead { grid-column: 1 / -1; }
  }
  .front .card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow: hidden;
    border-radius: var(--radius);
    padding: 1.4rem 1.4rem 1.6rem;
    background: var(--c);
    color: var(--on);
  }
  .front .card:focus-visible { transform: translateY(-4px); box-shadow: 0 18px 32px -18px var(--c); }
  @media (hover: hover) {
    .front .card:hover { transform: translateY(-4px); box-shadow: 0 18px 32px -18px var(--c); }
  }
  .front .card p { margin-top: 0.6rem; font-size: 0.95rem; max-width: 34rem; }
  .front .card-new { background: var(--on); color: var(--c); }
  .front time { font-weight: 600; }
  .lead .card { min-height: 22rem; }
  .lead h2 { margin-top: 0.8rem; font-size: clamp(2.1rem, 10vw, 5.25rem); line-height: 0.9; letter-spacing: -0.035em; }
  .lead .card-top .kicker { margin-right: 0; }
  .lead .card-top .kicker::after { content: "·"; margin-left: 0.6rem; }
  .lead .card-top time { margin-left: 0; }
  .lead .art { width: clamp(8rem, 38vw, 20rem); align-self: flex-end; order: -1; margin: -0.4rem -0.4rem -1.2rem 0; }
  .lead .card-body { flex: 1; justify-content: flex-end; max-width: 40rem; }
  @media (min-width: 44rem) {
    .lead .card { flex-direction: row; align-items: stretch; padding: 2rem 2rem 2.2rem; }
    .lead .art { order: 1; align-self: center; margin: 0; }
    .lead .card p { font-size: 1.05rem; }
  }
  .second .card { min-height: 13rem; }
  .second .card-body { flex: 1; justify-content: flex-end; }
  .second .card-top time { margin-left: 0; }
  .second h2 { margin-top: 0.5rem; font-size: clamp(1.7rem, 6vw, 2.5rem); }
  .second .art { width: 6rem; order: -1; align-self: flex-end; margin: -0.6rem -0.6rem 0 0; }
  /* Side by side, the secondaries set text left and the icon top right. */
  @media (min-width: 44rem) {
    .second .card { flex-direction: row; align-items: flex-end; }
    .second .card-body { align-self: stretch; }
    .second .art { order: 1; width: clamp(5.5rem, 12vw, 8rem); align-self: flex-start; }
  }
  .front .art-emoji { font-size: 4.5rem; }
  .lead .art-emoji { font-size: 7rem; }

  /* The rest: compact rows */
  .more { margin-top: 2.75rem; }
  .section-title {
    padding-bottom: 0.6rem;
    border-bottom: 3px solid var(--ink);
    font-family: var(--display);
    font-weight: 800;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .rows { list-style: none; padding: 0; }
  .row { border-bottom: 1px solid var(--line); }
  .row .card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 0.5rem;
    border-radius: 0.75rem;
  }
  .row .card:focus-visible { background: var(--hover); transform: translateX(4px); }
  @media (hover: hover) { .row .card:hover { background: var(--hover); transform: translateX(4px); } }
  .row .art {
    width: 3.75rem;
    height: 3.75rem;
    border-radius: 0.9rem;
    background: var(--c);
    padding: 0.3rem;
  }
  .row .art-emoji { font-size: 1.9rem; }
  .row .card-body { flex: 1; }
  .row .card-top { order: -1; color: var(--muted); }
  .row .card-top time { margin-left: 0; order: -1; }
  .row .card-new { margin-left: 0; }
  .row h3 { font-size: 1.3rem; margin-top: 0.15rem; letter-spacing: -0.005em; }
  @media (max-width: 24rem) { .row h3 { font-size: 1.1rem; } }
  .row p { margin-top: 0.2rem; color: var(--muted); font-size: 0.88rem; }

  /* Save offline: a sibling of the link, at the foot of its block or row */
  .card-wrap.has-save > .card { padding-bottom: 4rem; }
  .row.has-save > .card { padding-bottom: 3.9rem; }
  .save {
    position: absolute;
    left: 1.4rem;
    bottom: 1.1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.75rem;
    border: 1.5px solid currentColor;
    border-radius: 999px;
    padding: 0.2rem 0.8rem;
    background: transparent;
    color: var(--on);
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .lead .save { left: 2rem; }
  @media (max-width: 43.99rem) { .lead .save { left: 1.4rem; } }
  .row .save { left: calc(0.5rem + 3.75rem + 1rem); bottom: 0.8rem; color: var(--muted); }
  .save::before { content: "⤓"; }
  @media (hover: hover) {
    .save:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
    .row .save:hover { color: var(--ink); }
  }
  .save[aria-pressed="true"]::before { content: "✓"; }
  .row .save[aria-pressed="true"] { color: var(--accent); }
  .save[aria-busy="true"] { opacity: 0.6; cursor: progress; }
  .save[aria-busy="true"]::before { content: "…"; }
  .save:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }

  .empty { color: var(--muted); padding: 2rem 0; }
  footer {
    margin-top: 3.5rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.85rem;
  }
  footer a { display: inline-block; padding: 0.7rem 0; color: var(--ink); font-weight: 600; }

  /* Motion: a staggered entrance, the lead's icon floating. Nothing waits
     on an animation to be visible. */
  @media (prefers-reduced-motion: no-preference) {
    .front > .card-wrap, .rows > .card-wrap {
      animation: rise 520ms cubic-bezier(.2, .7, .2, 1) both;
      animation-delay: calc(var(--i, 0) * 60ms);
    }
    /* The lead holds the LCP: it moves in but never paints transparent. */
    .front > .lead { animation-name: lift; }
    /* A few slow breaths, then still (WCAG 2.2.2, and the battery). */
    .lead .art { animation: float 6s ease-in-out 3; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
  @keyframes lift { from { transform: translateY(14px); } }
  @keyframes float {
    0%, 100% { transform: translateY(0) rotate(0); }
    50% { transform: translateY(-8px) rotate(2deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .card, .art img { transition: none; }
    .front .card:hover, .front .card:focus-visible, .row .card:hover, .row .card:focus-visible { transform: none !important; }
    .card:hover .art img, .card:focus-visible .art img { transform: none !important; }
  }
</style>
</head>
<body>
  <main>
    <header>
      <div class="mast">
        <h1>random</h1>
        <div class="hub-actions">
          <button type="button" id="install" hidden>Install</button>
          <div class="seg" role="group" aria-label="Icon style">
            <button type="button" data-icons="flat" aria-pressed="false">Flat</button>
            <button type="button" data-icons="3d" aria-pressed="false">3D</button>
          </div>
          <button type="button" id="look-retro">Retro look</button>
          <button type="button" id="badge-toggle" hidden>Badge new ideas</button>
        </div>
      </div>
      <p class="dek"><span>Small ideas, each one a tiny page.</span><b>${count}</b></p>
      <p class="hint" id="ios-hint" hidden>
        <span>Install: tap <b>Share</b> → <b>Add to Home Screen</b>.</span>
        <button type="button" aria-label="Dismiss">×</button>
      </p>
    </header>
${body}
    <footer>
      <a href="https://github.com/rickymetz/random">source</a>
    </footer>
  </main>
  <div id="retro" hidden></div>
  <script src="nav.js" defer></script>
  <script src="hub.js" defer></script>
</body>
</html>
`;
}

// --- PWA ---
const THEME = { light: "#f5f3ee", dark: "#111111" };

// Static files at the repo root that make up the hub shell. Precached by the
// service worker and copied into _site/. ("./" is the homepage itself.)
const STATIC_SHELL = [
  "nav.js",
  "hub.js",
  "retro.js",
  "retro.css",
  "fonts/DroidSans.woff2",
  "fonts/DroidSans-Bold.woff2",
  "fonts/Archivo-Heavy.woff2",
  "offline.html",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
];
const GENERATED = ["index.html", "manifest.webmanifest", "ideas.json"];

function renderManifest(ideas) {
  return JSON.stringify({
    id: "./",
    name: "random",
    short_name: "random",
    description: "A hub of small ideas, each one a tiny page.",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: THEME.light,
    theme_color: THEME.light,
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    // Share a link to the installed app (Android): hub.js opens it when it
    // points at an idea.
    share_target: {
      action: "./",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    // Long-press the app icon: the four newest ideas, with their clay
    // icon where the platform takes SVG and the app icon where it doesn't.
    shortcuts: ideas.slice(0, 4).map((idea) => ({
      name: idea.title,
      url: idea.url,
      icons: [
        ...(idea.art ? [{ src: idea.art["3d"], sizes: "any", type: "image/svg+xml" }] : []),
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      ],
    })),
  }, null, 2) + "\n";
}

function renderIdeasJson(ideas) {
  return JSON.stringify(ideas.map((idea) => ({
    slug: idea.slug,
    title: idea.title,
    description: idea.description,
    emoji: idea.emoji,
    color: idea.color,
    ...(idea.art ? { art: idea.art } : {}),
    date: idea.date.toISOString(),
    url: idea.url,
    saveable: idea.saveable,
    ...(idea.icon ? { icon: idea.icon } : {}),
    ...(idea.private ? { private: true } : {}),
  })), null, 2) + "\n";
}

// Ideas this small are saved whole when the app installs, so they work
// offline before anyone has opened them. (Not their icons: the shell
// already precaches those, as icons/.)
const AUTO_SAVE_BYTES = 150 * 1024;
const NOT_SAVED = /^(idea\.json|README\.md|icon-(flat|3d)\.svg)$/;
function autoSaveList(ideas) {
  return ideas
    .filter((idea) => idea.saveable)
    .map((idea) => ({ ...idea, files: idea.files.filter((f) => !NOT_SAVED.test(f.rel)) }))
    .filter((idea) => idea.files.reduce((n, f) => n + f.bytes, 0) <= AUTO_SAVE_BYTES)
    .map((idea) => ({
      slug: idea.slug,
      paths: idea.files
        .map((f) => `ideas/${idea.slug}/${f.rel === "index.html" ? "" : f.rel}`),
    }));
}

// Each idea's icons, mirrored from ideas/<slug>/icon-<style>.svg to
// icons/<slug>-<style>.svg: part of the hub shell, so they show offline on
// every surface (the hub, the tray, the launcher), even for ideas the hub
// worker keeps its hands off (Cadence).
function artCopies(ideas) {
  return ideas.flatMap((idea) => (idea.art
    ? ICON_STYLES.map((style) => ({ dest: idea.art[style], src: path.join(ideasDir, idea.slug, `icon-${style}.svg`) }))
    : []));
}
function artFiles(ideas) {
  return artCopies(ideas).map((c) => c.dest);
}

function renderServiceWorker(files, ideas) {
  const template = fs.readFileSync(path.join(__dirname, "sw.template.js"), "utf8");
  const staticShell = [...STATIC_SHELL, ...artFiles(ideas)];
  const shell = ["./", ...GENERATED.filter((f) => f !== "index.html"), ...staticShell];
  // The version changes whenever anything the shell serves changes, so the
  // browser sees a byte-different worker and the page offers the update.
  const hash = crypto.createHash("sha256");
  hash.update(template);
  hash.update(JSON.stringify(autoSaveList(ideas)));
  for (const [name, content] of Object.entries(files)) hash.update(name).update(content);
  for (const name of staticShell) hash.update(name).update(fs.readFileSync(path.join(root, name)));
  const version = hash.digest("hex").slice(0, 12);
  // Per-file hashes, so an update reuses the files that didn't change.
  const fileHash = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const shellHash = {};
  for (const p of shell) {
    const name = p === "./" ? "index.html" : p;
    shellHash[p] = fileHash(files[name] != null ? files[name] : fs.readFileSync(path.join(root, name)));
  }
  return template
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace("__SHELL_HASH__", JSON.stringify(shellHash))
    .replace("__SHELL__", JSON.stringify(shell))
    .replace("__AUTO_SAVE__", JSON.stringify(autoSaveList(ideas)));
}

// --- build ---
// GitHub Pages serves the main branch directly, so the homepage lives at the
// repo root (committed by CI when it changes). _site/ is kept as a local
// preview of exactly what Pages serves.
const ideas = collectIdeas();
fs.rmSync(path.join(root, "icons"), { recursive: true, force: true });
for (const { dest, src } of artCopies(ideas)) {
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  fs.copyFileSync(src, path.join(root, dest));
}
const generated = {
  "index.html": renderHome(ideas),
  "manifest.webmanifest": renderManifest(ideas),
  "ideas.json": renderIdeasJson(ideas),
};
generated["sw.js"] = renderServiceWorker(generated, ideas);
for (const [name, content] of Object.entries(generated)) {
  fs.writeFileSync(path.join(root, name), content);
}
fs.writeFileSync(path.join(root, ".nojekyll"), "");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const idea of ideas) {
  // Never copy dotfiles: an idea folder may hold a .env of API keys, and _site
  // is what a deploy step would upload.
  fs.cpSync(path.join(ideasDir, idea.slug), path.join(outDir, "ideas", idea.slug), {
    filter: (src) => !path.basename(src).startsWith("."),
    recursive: true,
  });
}
for (const [name, content] of Object.entries(generated)) {
  fs.writeFileSync(path.join(outDir, name), content);
}
for (const name of [...STATIC_SHELL, ...artFiles(ideas)]) {
  fs.mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
  fs.copyFileSync(path.join(root, name), path.join(outDir, name));
}
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

console.log(`built ${ideas.length} idea(s) -> ${Object.keys(generated).join(", ")} + _site/`);
for (const i of ideas) console.log(`  - ideas/${i.slug}/  (${i.title})`);
