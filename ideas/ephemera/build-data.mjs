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
    fields: "identifier,mediatype,title,year,date,subject,description,downloads",
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

// "A Trip Down Market Street" sorts under T, matching the sibling app.
const sortTitle = (t) => t.replace(/^(a|an|the)\s+/i, "").toLowerCase();

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
  if (r.downloads) rec.n = r.downloads;
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
