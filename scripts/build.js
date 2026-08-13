#!/usr/bin/env node
// Builds the static site into _site/:
//   - copies every ideas/<slug>/ folder that contains an index.html
//   - generates the homepage by scanning those folders (no manual index upkeep)
//
// Per-idea metadata (all optional), resolved in this order:
//   1. ideas/<slug>/idea.json  -> { "title", "description", "emoji", "hidden" }
//   2. <title> and <meta name="description"> parsed from the idea's index.html
//   3. the slug itself
// Ideas are dated by the first git commit that touched their folder.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

    ideas.push({
      slug,
      title,
      description,
      emoji: meta.emoji || "",
      date: firstCommitDate(path.join("ideas", slug)),
    });
  }
  // newest first
  ideas.sort((a, b) => b.date - a.date);
  return ideas;
}

function renderCard(idea) {
  const date = idea.date.toISOString().slice(0, 10);
  return `      <a class="card" href="ideas/${escapeHtml(idea.slug)}/">
        <div class="card-top">
          <span class="card-emoji">${escapeHtml(idea.emoji || "✦")}</span>
          <time datetime="${date}">${date}</time>
        </div>
        <h2>${escapeHtml(idea.title)}</h2>
        ${idea.description ? `<p>${escapeHtml(idea.description)}</p>` : ""}
      </a>`;
}

function renderHome(ideas) {
  const cards = ideas.map(renderCard).join("\n");
  const empty = `      <p class="empty">Nothing here yet. The first idea is on its way.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>random</title>
<meta name="description" content="A hub of small ideas, each one a tiny page.">
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
    padding: 3rem 1.25rem 5rem;
  }
  main { max-width: 52rem; margin: 0 auto; }
  header { margin-bottom: 2.5rem; }
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
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.6rem;
  }
  .card-emoji { font-size: 1.3rem; }
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
      <h1>random</h1>
      <p>Small ideas, each one a tiny page.</p>
    </header>
    <div class="grid">
${ideas.length ? cards : empty}
    </div>
    <footer>
      <a href="https://github.com/rickymetz/random">source</a>
    </footer>
  </main>
</body>
</html>
`;
}

// --- build ---
// GitHub Pages serves the main branch directly, so the homepage lives at the
// repo root (committed by CI when it changes). _site/ is kept as a local
// preview of exactly what Pages serves.
const ideas = collectIdeas();
const home = renderHome(ideas);
fs.writeFileSync(path.join(root, "index.html"), home);
fs.writeFileSync(path.join(root, ".nojekyll"), "");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const idea of ideas) {
  fs.cpSync(path.join(ideasDir, idea.slug), path.join(outDir, "ideas", idea.slug), {
    recursive: true,
  });
}
fs.writeFileSync(path.join(outDir, "index.html"), home);
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

console.log(`built ${ideas.length} idea(s) -> index.html + _site/`);
for (const i of ideas) console.log(`  - ideas/${i.slug}/  (${i.title})`);
