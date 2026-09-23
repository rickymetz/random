#!/usr/bin/env node
// Builds the static site into _site/:
//   - copies every ideas/<slug>/ folder that contains an index.html
//   - generates the homepage by scanning those folders (no manual index upkeep)
//   - generates the PWA files at the repo root: manifest.webmanifest,
//     ideas.json (the catalogue nav.js and the offline page read) and sw.js
//     (from scripts/sw.template.js, version-stamped so each deploy that
//     changes the shell or the idea list is offered as an update)
//
// Per-idea metadata (all optional), resolved in this order:
//   1. ideas/<slug>/idea.json  -> { "title", "description", "emoji", "hidden" }
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

    ideas.push({
      slug,
      title,
      description,
      emoji: meta.emoji || "",
      // Optional retro launcher tile colour (a hex colour); else it's
      // picked from the slug.
      icon: /^#[0-9a-f]{3,8}$/i.test(meta.icon || "") ? meta.icon : "",
      date: firstCommitDate(path.join("ideas", slug)),
      saveable,
      files: saveable ? listFiles(dir) : [],
    });
  }
  // newest first
  ideas.sort((a, b) => b.date - a.date);
  return ideas;
}

function renderCard(idea) {
  const date = idea.date.toISOString().slice(0, 10);
  const slug = escapeHtml(idea.slug);
  // The Save button is a sibling of the card link (a button can't live
  // inside a link); hub.js reveals it once the hub worker is in control.
  const save = idea.saveable
    ? `\n      <button type="button" class="save" data-slug="${slug}" hidden>Save offline</button>`
    : "";
  return `      <div class="card-wrap${idea.saveable ? " saveable" : ""}">
      <a class="card" href="ideas/${slug}/" data-slug="${slug}">
        <div class="card-top">
          <span class="card-emoji">${escapeHtml(idea.emoji || "✦")}</span>
          <time datetime="${date}">${date}</time>
        </div>
        <h2>${escapeHtml(idea.title)}</h2>
        ${idea.description ? `<p>${escapeHtml(idea.description)}</p>` : ""}
      </a>${save}
      </div>`;
}

function renderHome(ideas) {
  const cards = ideas.map(renderCard).join("\n");
  const empty = `      <p class="empty">Nothing here yet. The first idea is on its way.</p>`;
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
  // The look (modern cards / retro launcher) is decided before first paint,
  // so there's no flash of the wrong one. nav.js makes the same call later.
  (function () {
    var look;
    try { look = JSON.parse(localStorage.getItem("random-hub:look")); } catch (e) {}
    // Modern unless someone has chosen retro.
    document.documentElement.setAttribute("data-look", look === "retro" ? "retro" : "modern");
  })();
</script>
<link rel="stylesheet" href="retro.css">
<style>
  :root {
    --bg: #faf9f7;
    --card: #ffffff;
    --ink: #1a1a1a;
    --muted: #6b6b6b;
    --line: #e5e2dc;
    --accent: #b3542e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141414;
      --card: #1e1e1e;
      --ink: #eceae6;
      --muted: #9a9a9a;
      --line: #2c2c2c;
      --accent: #e08554;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: max(3rem, env(safe-area-inset-top)) 1.25rem 5rem;
  }
  main { max-width: 52rem; margin: 0 auto; }
  header { margin-bottom: 2.5rem; }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }
  .hub-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
  .hub-actions button {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.4rem 0.95rem;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .hub-actions button:hover { border-color: var(--accent); }
  .hub-actions #install { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.1rem;
    padding: 0.6rem 0.6rem 0.6rem 1rem;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--card);
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
    width: 2rem;
    height: 2rem;
    border-radius: 1rem;
    cursor: pointer;
  }
  [hidden] { display: none !important; }
  header h1 {
    font-size: 1.6rem;
    letter-spacing: -0.01em;
  }
  header p { color: var(--muted); margin-top: 0.35rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 1rem;
  }
  .card {
    display: block;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    padding: 1.1rem 1.2rem 1.25rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 120ms ease, transform 120ms ease;
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .card-wrap { position: relative; display: flex; }
  .card-wrap > .card { flex: 1; }
  .card-wrap.has-save > .card { padding-bottom: 3.3rem; }
  .save {
    position: absolute;
    left: 1.2rem;
    bottom: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    background: var(--bg);
    color: var(--muted);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .save::before { content: "⤓"; }
  .save:hover { border-color: var(--accent); color: var(--ink); }
  .save[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
  .save[aria-pressed="true"]::before { content: "✓"; }
  .save[aria-busy="true"] { opacity: 0.6; cursor: progress; }
  .save[aria-busy="true"]::before { content: "…"; }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.6rem;
  }
  .card-emoji { font-size: 1.3rem; }
  .card-new {
    margin-left: auto;
    margin-right: 0.6rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .card time { color: var(--muted); font-size: 0.78rem; }
  .card h2 { font-size: 1.05rem; letter-spacing: -0.01em; }
  .card p { color: var(--muted); font-size: 0.88rem; margin-top: 0.4rem; }
  .empty { color: var(--muted); }
  footer {
    margin-top: 3.5rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  footer a { color: var(--accent); }
</style>
</head>
<body>
  <main>
    <header>
      <div class="header-row">
        <div>
          <h1>random</h1>
          <p>Small ideas, each one a tiny page.</p>
        </div>
        <div class="hub-actions">
          <button type="button" id="install" hidden>Install</button>
          <button type="button" id="look-retro">Retro look</button>
          <button type="button" id="badge-toggle" hidden>Badge new ideas</button>
        </div>
      </div>
      <p class="hint" id="ios-hint" hidden>
        <span>Install: tap <b>Share</b> → <b>Add to Home Screen</b>.</span>
        <button type="button" aria-label="Dismiss">×</button>
      </p>
    </header>
    <div class="grid">
${ideas.length ? cards : empty}
    </div>
    <footer>
      <a href="https://github.com/rickymetz/random">source</a>
    </footer>
  </main>
  <div id="retro" hidden></div>
  <script src="nav.js" defer></script>
  <script src="retro.js" defer></script>
  <script src="hub.js" defer></script>
</body>
</html>
`;
}

// --- PWA ---
const THEME = { light: "#faf9f7", dark: "#141414" };

// Static files at the repo root that make up the hub shell. Precached by the
// service worker and copied into _site/. ("./" is the homepage itself.)
const STATIC_SHELL = [
  "nav.js",
  "hub.js",
  "retro.js",
  "retro.css",
  "fonts/DroidSans.woff2",
  "fonts/DroidSans-Bold.woff2",
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
    // Long-press the app icon: the four newest ideas.
    shortcuts: ideas.slice(0, 4).map((idea) => ({
      name: idea.title,
      url: `ideas/${idea.slug}/`,
      icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }],
    })),
  }, null, 2) + "\n";
}

function renderIdeasJson(ideas) {
  return JSON.stringify(ideas.map((idea) => ({
    slug: idea.slug,
    title: idea.title,
    description: idea.description,
    emoji: idea.emoji,
    date: idea.date.toISOString(),
    url: `ideas/${idea.slug}/`,
    saveable: idea.saveable,
    ...(idea.icon ? { icon: idea.icon } : {}),
  })), null, 2) + "\n";
}

// Ideas this small are saved whole when the app installs, so they work
// offline before anyone has opened them.
const AUTO_SAVE_BYTES = 150 * 1024;
function autoSaveList(ideas) {
  return ideas
    .filter((idea) => idea.saveable)
    .filter((idea) => idea.files.reduce((n, f) => n + f.bytes, 0) <= AUTO_SAVE_BYTES)
    .map((idea) => ({
      slug: idea.slug,
      paths: idea.files
        .filter((f) => !/^(idea\.json|README\.md)$/.test(f.rel))
        .map((f) => `ideas/${idea.slug}/${f.rel === "index.html" ? "" : f.rel}`),
    }));
}

function renderServiceWorker(files, ideas) {
  const template = fs.readFileSync(path.join(__dirname, "sw.template.js"), "utf8");
  const shell = ["./", ...GENERATED.filter((f) => f !== "index.html"), ...STATIC_SHELL];
  // The version changes whenever anything the shell serves changes, so the
  // browser sees a byte-different worker and the page offers the update.
  const hash = crypto.createHash("sha256");
  hash.update(template);
  hash.update(JSON.stringify(autoSaveList(ideas)));
  for (const [name, content] of Object.entries(files)) hash.update(name).update(content);
  for (const name of STATIC_SHELL) hash.update(name).update(fs.readFileSync(path.join(root, name)));
  const version = hash.digest("hex").slice(0, 12);
  return template
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace("__SHELL__", JSON.stringify(shell))
    .replace("__AUTO_SAVE__", JSON.stringify(autoSaveList(ideas)));
}

// --- build ---
// GitHub Pages serves the main branch directly, so the homepage lives at the
// repo root (committed by CI when it changes). _site/ is kept as a local
// preview of exactly what Pages serves.
const ideas = collectIdeas();
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
for (const name of STATIC_SHELL) {
  fs.mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
  fs.copyFileSync(path.join(root, name), path.join(outDir, name));
}
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

console.log(`built ${ideas.length} idea(s) -> ${Object.keys(generated).join(", ")} + _site/`);
for (const i of ideas) console.log(`  - ideas/${i.slug}/  (${i.title})`);
