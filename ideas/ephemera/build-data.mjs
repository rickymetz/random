#!/usr/bin/env node
// Author-time scraper for Ephemera. NOT part of CI — the hub workflow only
// runs scripts/build.js. Run by hand to refresh data.json:
//
//   node ideas/ephemera/build-data.mjs
//
// One source: archive.org. Every item arrives with a stable identifier, so
// unlike the sibling public-screening app there is no title matching here
// and none of its matching failure modes apply.
import fs from "node:fs";
import path from "node:path";

const UA = "random-hub/1.0 (+https://github.com/rickymetz/random) static catalog browser";
const QUERY = "collection:prelinger AND NOT title:(Home Movie)";
const SOURCE = "https://archive.org/details/prelinger";
const outFile = path.join(import.meta.dirname, "data.json");

// Used only by the --runtimes pass below; the bulk scrape needs neither a
// cache nor arguments, so these did not exist until that pass was added.
const args = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheDir = args.includes("--cache")
  ? args[args.indexOf("--cache") + 1]
  : path.join(import.meta.dirname, ".cache");

// Archivist placeholders, not topics. "need keyword" is the second most
// common tag in the entire collection — 225 items — so this matters.
const JUNK = new Set(["need keyword", "need meta", "to come", "needs keyword", "tbd"]);
// Decade-shaped tags belong to the decade filter, not the topic chip rail.
const DECADE_TAG = /^(1[89]\d0s|20\d0s)$/i;
// Above this, a "year" is a digitization timestamp rather than a film date.
// 137 items claim the 2020s. public-screening shipped this bug once already.
const MAX_YEAR = 2015;
const MIN_YEAR = 1890;
const TAG_THRESHOLD = 40;
const DESC_CAP = 400;

const scrapeUrl = (cursor) => {
  const p = new URLSearchParams({
    q: QUERY,
    fields: "identifier,mediatype,title,year,date,subject,description,downloads,runtime",
    count: "10000",
  });
  if (cursor) p.set("cursor", cursor);
  return `https://archive.org/services/search/v1/scrape?${p}`;
};

async function scrapeAll() {
  const items = [];
  let cursor = null, page = 0;
  do {
    const res = await fetch(scrapeUrl(cursor), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`scrape HTTP ${res.status}`);
    const body = await res.json();
    items.push(...(body.items || []));
    cursor = body.cursor || null;
    console.log(`  page ${++page}: ${items.length}/${body.total}`);
  } while (cursor);
  return items;
}

const clean = (s) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function subjects(raw) {
  let s = raw.subject || [];
  if (typeof s === "string") s = [s];
  return s.map((t) => String(t).trim()).filter(Boolean);
}

function resolveYear(raw) {
  for (const field of [raw.year, raw.date]) {
    if (!field) continue;
    const m = String(field).match(/(1[89]\d\d|20\d\d)/);
    if (m) {
      const y = parseInt(m[1], 10);
      if (y >= MIN_YEAR && y <= MAX_YEAR) return y;
    }
  }
  return null;
}

// Archive's runtime is free text and only ~21% of items carry it. Most are
// mm:ss or hh:mm:ss, with a long tail of junk ("1 reel", "317 Feet",
// "PA8087 Bacteria: Fri"). Parse only the shapes we can trust and drop the
// rest -- a wrong length on a card is worse than no length.
function resolveRuntime(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  let secs = null;
  let m = v.match(/^(\d+):(\d{2}):(\d{2})$/);          // hh:mm:ss
  if (m) secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
  if (secs === null && (m = v.match(/^(\d+):(\d{2})$/))) // mm:ss
    secs = +m[1] * 60 + +m[2];
  if (secs === null && (m = v.match(/^:(\d{2})$/)))       // :ss
    secs = +m[1];
  if (secs === null && (m = v.match(/^(\d+)\s*min\.?$/i)))
    secs = +m[1] * 60;
  if (secs === null && (m = v.match(/^(\d+)\s*sec\.?$/i)))
    secs = +m[1];
  if (secs === null || secs <= 0) return null;
  // A day-long "runtime" is a data error, not a film.
  if (secs > 6 * 3600) return null;
  return Math.max(1, Math.round(secs / 60));
}

// "A Trip Down Market Street" sorts under T, matching the sibling app.
const sortTitle = (t) => t.replace(/^(a|an|the)\s+/i, "").toLowerCase();


// ---------------------------------------------------------------------------
// Second pass: runtimes the bulk search field does not carry.
//
//   node ideas/ephemera/build-data.mjs --runtimes --cache <dir>
//
// The scrape endpoint reports a runtime for only about a fifth of the
// collection, but each item's own metadata usually names a video file with a
// length in seconds. Sampling found one for 12 of 14 items the bulk field had
// missed. This walks the gaps, caches every response so a re-run costs
// nothing, and never touches items that already have a runtime.
//
// NOT part of CI. Author-time only, like every other phase here.
async function runtimesPass() {
  const doc = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const todo = doc.items.filter((m) => !m.r);
  console.log(`${todo.length} items without a runtime`);

  const rtDir = path.join(cacheDir, "meta");
  fs.mkdirSync(rtDir, { recursive: true });

  let done = 0, found = 0;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const mv = queue.shift();
      const f = path.join(rtDir, `${mv.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
      let body = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
      if (body === null) {
        try {
          const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(mv.id)}`,
                                  { headers: { "User-Agent": UA } });
          body = res.ok ? await res.text() : "";
          fs.writeFileSync(f, body);
          await sleep(120);
        } catch { body = ""; }
      }
      if (++done % 250 === 0) console.log(`  ${done}/${todo.length} (${found} found)`);
      if (!body) continue;
      try {
        const j = JSON.parse(body);
        const secs = (j.files || [])
          .filter((x) => /mp4|mpeg|ogv|mkv|avi|m4v/i.test(String(x.format || "")))
          .map((x) => parseFloat(x.length))
          .filter((n) => Number.isFinite(n) && n > 0);
        // Several lengths means several reels or outtakes, not one film in
        // different bitrates -- take the longest as the item's own length.
        const best = secs.length ? Math.max(...secs) : null;
        if (best && best <= 6 * 3600) { mv.r = Math.max(1, Math.round(best / 60)); found++; }
      } catch {}
    }
  }
  // Four at a time with a short delay: enough to finish in minutes, gentle
  // enough to stay a good guest on an endpoint built for programmatic use.
  await Promise.all(Array.from({ length: 4 }, worker));

  const withR = doc.items.filter((m) => m.r).length;
  console.log(`recovered ${found}; ${withR}/${doc.items.length} now have a runtime (${Math.round(withR / doc.items.length * 100)}%)`);
  if (withR < doc.items.filter((m) => m.r).length) { console.error("refusing to lose runtimes"); process.exit(1); }
  doc.count = doc.items.length;
  fs.writeFileSync(outFile, JSON.stringify(doc));
  console.log("wrote data.json");
}

if (args.includes("--runtimes")) { await runtimesPass(); process.exit(0); }

const raw = await scrapeAll();
const movies = raw.filter((r) => r.mediatype === "movies");
console.log(`${movies.length} movies (dropped ${raw.length - movies.length} non-film collection entries)`);

// Build the chip vocabulary first: count case-folded, display the most
// common original casing ("FOOD" and "Food" are the same tag).
const freq = new Map(), casing = new Map();
for (const r of movies) {
  for (const t of subjects(r)) {
    const k = t.toLowerCase();
    if (JUNK.has(k) || DECADE_TAG.test(k)) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
    if (!casing.has(k)) casing.set(k, new Map());
    const c = casing.get(k);
    c.set(t, (c.get(t) || 0) + 1);
  }
}
const tags = [...freq.entries()]
  .filter(([, n]) => n >= TAG_THRESHOLD)
  .sort((a, b) => b[1] - a[1])
  .map(([slug, n]) => {
    const best = [...casing.get(slug).entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { slug, label: best, n };
  });
const keep = new Set(tags.map((t) => t.slug));
console.log(`${tags.length} tag chips at >=${TAG_THRESHOLD} items`);

const items = movies.map((r) => {
  const rec = { id: r.identifier, t: clean(r.title) || r.identifier };
  rec.sort = sortTitle(rec.t);
  const y = resolveYear(r);
  if (y) rec.y = y;
  let d = clean(r.description);
  if (d.length > DESC_CAP) d = d.slice(0, DESC_CAP).replace(/\s+\S*$/, "") + "…";
  if (d) rec.d = d;
  const g = [...new Set(subjects(r).map((t) => t.toLowerCase()).filter((t) => keep.has(t)))].sort();
  if (g.length) rec.g = g;
  if (r.downloads != null) rec.n = r.downloads;
  const rt = resolveRuntime(r.runtime);
  if (rt) rec.r = rt;
  return rec;
}).sort((a, b) => a.sort.localeCompare(b.sort));

// Refuse to replace a good dataset with a bad run. The sibling app learned
// this the hard way: a partial scrape silently gutted data.json.
if (fs.existsSync(outFile)) {
  const prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
  if (items.length < prev.count * 0.8 && !process.argv.includes("--force")) {
    console.error(`refusing to write: ${items.length} items vs ${prev.count} previously (>20% loss)`);
    console.error("re-run with --force if this is intentional");
    process.exit(1);
  }
}

fs.writeFileSync(outFile, JSON.stringify({
  source: SOURCE,
  query: QUERY,
  scraped: new Date().toISOString().slice(0, 10),
  count: items.length,
  tags,
  items,
}));
const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`wrote data.json: ${items.length} items, ${tags.length} tags, ${kb} KB`);
console.log(`  with year: ${items.filter((i) => i.y).length}`);
console.log(`  with description: ${items.filter((i) => i.d).length}`);
console.log(`  with >=1 chip tag: ${items.filter((i) => i.g).length}`);
