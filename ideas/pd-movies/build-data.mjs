#!/usr/bin/env node
// Author-time scraper for the PD Movies browser. NOT part of CI — the hub
// workflow only runs scripts/build.js. Run this by hand to refresh data.json:
//
//   node ideas/pd-movies/build-data.mjs --cache <dir>
//
// Two sources, both polite (sequential, delayed, identifying UA, cached):
//   1. publicdomaintorrents.info — catalog + per-movie genres/rating/formats
//   2. wikidata.org MediaWiki API — year + poster art (the source site has
//      neither). Matching is title-only, so see mismatches.log.
import fs from "node:fs";
import path from "node:path";

const UA = "random-hub/1.0 (+https://github.com/rickymetz/random) static catalog browser, ~1 req/1.5s";
const PDT = "https://www.publicdomaintorrents.info";
const args = process.argv.slice(2);
const cacheDir = args[args.indexOf("--cache") + 1] || path.join(import.meta.dirname, ".cache");
const outFile = path.join(import.meta.dirname, "data.json");
const logFile = path.join(import.meta.dirname, "mismatches.log");
fs.mkdirSync(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache every fetch to disk so re-runs and crashes never re-hit the servers.
async function get(url, key, delayMs = 1500) {
  const f = path.join(cacheDir, key);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      fs.writeFileSync(f, body);
      await sleep(delayMs);
      return body;
    } catch (e) {
      if (attempt === 3) { console.warn(`  fetch failed ${url}: ${e.message}`); return null; }
      await sleep(delayMs * attempt * 4); // back off hard before retrying
    }
  }
}

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", ntilde: "ñ" };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// "A Bucket of Blood" sorts under B — matches Plex and the source's own order.
const sortTitle = (t) => t.replace(/^(a|an|the)\s+/i, "").toLowerCase();

const GENRES = ["action", "animation", "comedy", "drama", "exploitation", "family", "horror", "martialarts", "musicals", "mystery", "scifi", "serial", "war", "westerns"];

// ---------------------------------------------------------------- 1. catalog
async function scrapeCatalog() {
  const movies = new Map();
  for (const cat of ["ALL", ...GENRES]) {
    const html = await get(`${PDT}/nshowcat.html?category=${cat}`, `cat-${cat}.html`);
    if (!html) continue;
    // Rows look like: <td><a href=nshowmovie.html?movieid=939>Title</a> <img src=ipod.jpg>...
    const rowRe = /<a href=nshowmovie\.html\?movieid=(\d+)>([^<]*)<\/a>((?:\s*<img[^>]*>(?:<\/img>)?)*)/gi;
    let m, n = 0;
    while ((m = rowRe.exec(html))) {
      const [, id, rawTitle, imgs] = m;
      const title = decodeEntities(rawTitle);
      if (!title) continue;
      n++;
      if (!movies.has(id)) movies.set(id, { id, title, genres: [], formats: [] });
      const rec = movies.get(id);
      if (cat !== "ALL" && !rec.genres.includes(cat)) rec.genres.push(cat);
      for (const [needle, label] of [["ipod", "iPod"], ["psp", "PSP"], ["pda", "PDA"], ["googlevid", "Stream"]]) {
        if (imgs.toLowerCase().includes(needle) && !rec.formats.includes(label)) rec.formats.push(label);
      }
    }
    console.log(`  ${cat}: ${n} rows (${movies.size} unique so far)`);
  }
  return [...movies.values()];
}

// ------------------------------------------------- 2. per-movie detail pages
async function scrapeDetails(movies) {
  let i = 0;
  for (const mv of movies) {
    i++;
    const html = await get(`${PDT}/nshowmovie.html?movieid=${mv.id}`, `mv-${mv.id}.html`);
    if (i % 50 === 0) console.log(`  detail ${i}/${movies.length}`);
    if (!html) continue;
    // Rating = count of star gifs (occurrences, not lines).
    const stars = (html.match(/yellow-star\.gif/gi) || []).length;
    if (stars > 0 && stars <= 5) mv.rating = stars;
    // Genres from the detail page fill in any the category sweep missed.
    for (const g of html.matchAll(/nshowcat\.html\?category=([a-z]+)>([a-z]+)<\/a>/gi)) {
      const cat = g[1].toLowerCase();
      if (GENRES.includes(cat) && !mv.genres.includes(cat)) mv.genres.push(cat);
    }
    // Screenshot filename is arbitrary per movie, and extension case varies.
    const grab = html.match(/grabs\/((?!hdsale)[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|gif))/i);
    if (grab) mv.grab = grab[1];
  }
  return movies;
}

// ------------------------------------------- 3. Wikidata: year + poster art
async function enrich(movies) {
  const WD = "https://www.wikidata.org/w/api.php";
  const misses = [];
  const candidates = new Map(); // qid -> [movie, ...]

  let i = 0;
  for (const mv of movies) {
    i++;
    if (i % 50 === 0) console.log(`  wikidata search ${i}/${movies.length}`);
    const url = `${WD}?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(mv.title)}`;
    const body = await get(url, `wd-s-${mv.id}.json`, 500);
    if (!body) { misses.push(`${mv.id}\t${mv.title}\tsearch failed`); continue; }
    let ids = [];
    try { ids = (JSON.parse(body).search || []).map((x) => x.id); } catch {}
    if (!ids.length) { misses.push(`${mv.id}\t${mv.title}\tno entity`); continue; }
    mv._cands = ids;
    for (const q of ids) {
      if (!candidates.has(q)) candidates.set(q, []);
      candidates.get(q).push(mv);
    }
  }

  // wbgetentities takes 50 ids per call — batch the claim lookups.
  const qids = [...candidates.keys()];
  const ents = {};
  for (let s = 0; s < qids.length; s += 50) {
    const batch = qids.slice(s, s + 50);
    console.log(`  wikidata entities ${s}/${qids.length}`);
    const url = `${WD}?action=wbgetentities&format=json&props=claims&ids=${batch.join("|")}`;
    const body = await get(url, `wd-e-${s}.json`, 500);
    if (!body) continue;
    try { Object.assign(ents, JSON.parse(body).entities || {}); } catch {}
  }

  const claimVal = (c, p) => c[p]?.[0]?.mainsnak?.datavalue?.value;

  for (const mv of movies) {
    if (!mv._cands) continue;
    const films = [];
    for (const q of mv._cands) {
      const c = ents[q]?.claims;
      if (!c) continue;
      const isFilm = (c.P31 || []).some((x) => {
        const id = x.mainsnak?.datavalue?.value?.id;
        return id === "Q11424" || id === "Q24856" || id === "Q202866"; // film, film series, animated film
      });
      if (!isFilm) continue;
      let year = null;
      for (const x of c.P577 || []) {
        const t = x.mainsnak?.datavalue?.value?.time;
        if (t) { year = parseInt(t.slice(1, 5), 10); break; }
      }
      const art = claimVal(c, "P3383") || claimVal(c, "P18") || null;
      films.push({ q, year, art, imdb: claimVal(c, "P345") || null, tmdb: claimVal(c, "P4947") || null });
    }
    if (!films.length) { misses.push(`${mv.id}\t${mv.title}\tno film among candidates`); continue; }
    // This catalog is old public domain film. Prefer a plausibly-old match,
    // then the earliest, then one that actually has art.
    films.sort((a, b) => {
      const old = (f) => (f.year && f.year <= 1985 ? 0 : 1);
      return old(a) - old(b) || (a.year ?? 9999) - (b.year ?? 9999) || (b.art ? 1 : 0) - (a.art ? 1 : 0);
    });
    const best = films[0];
    mv.year = best.year ?? undefined;
    mv.wd = best.q;
    if (best.imdb) mv.imdb = best.imdb;
    if (best.tmdb) mv.tmdb = best.tmdb;
    if (best.art) mv.wdArt = best.art;
    if (films.length > 1) misses.push(`${mv.id}\t${mv.title}\tambiguous -> ${best.q} (${best.year}) of ${films.length}`);
    if (best.year && best.year > 1985) misses.push(`${mv.id}\t${mv.title}\tsuspicious year ${best.year} (${best.q})`);
  }

  fs.writeFileSync(logFile, misses.join("\n") + "\n");
  console.log(`  ${misses.length} misses/ambiguities -> ${path.basename(logFile)}`);
  return movies;
}


// ------------------------------------------- 4. poster art (TVDB / fanart.tv)
// Resolution chain, best first:
//   fanart.tv (dedicated movie posters, keyed by IMDb/TMDB id from Wikidata)
//   -> TVDB v4 search art
//   -> Wikimedia Commons image from Wikidata
//   -> nothing (the page draws a generated poster instead)
function loadEnv() {
  const f = path.join(import.meta.dirname, ".env");
  const env = {};
  if (!fs.existsSync(f)) return env;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

async function tvdbToken(env) {
  if (!env.TVDB_API_KEY) return null;
  try {
    const body = { apikey: env.TVDB_API_KEY };
    if (env.TVDB_PIN) body.pin = env.TVDB_PIN;
    const res = await fetch("https://api4.thetvdb.com/v4/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn(`  tvdb login failed: HTTP ${res.status}`); return null; }
    return (await res.json())?.data?.token ?? null;
  } catch (e) {
    console.warn(`  tvdb login failed: ${e.message}`);
    return null;
  }
}

async function posters(movies) {
  const env = loadEnv();
  const haveFanart = Boolean(env.FANART_API_KEY);
  const token = await tvdbToken(env);
  if (!haveFanart) console.log("  no FANART_API_KEY — skipping fanart.tv");
  if (!token) console.log("  no TVDB token — skipping tvdb");

  // fanart.tv: keyed by the IMDb/TMDB ids Wikidata gave us.
  if (haveFanart) {
    let i = 0, got = 0;
    for (const mv of movies) {
      const id = mv.tmdb || mv.imdb;
      if (!id) continue;
      i++;
      if (i % 100 === 0) console.log(`  fanart ${i} (${got} hits)`);
      const body = await get(
        `https://webservice.fanart.tv/v3/movies/${encodeURIComponent(id)}?api_key=${env.FANART_API_KEY}`,
        `fa-${mv.id}.json`, 300
      );
      if (!body) continue;
      try {
        const d = JSON.parse(body);
        const pool = d.movieposter || d.moviethumb || [];
        if (!pool.length) continue;
        // Prefer English, then the most-liked.
        pool.sort((a, b) => (a.lang === "en" ? 0 : 1) - (b.lang === "en" ? 0 : 1) || (+b.likes || 0) - (+a.likes || 0));
        mv.art = pool[0].url;
        mv.artSrc = "fanart";
        got++;
      } catch {}
    }
    console.log(`  fanart.tv: ${got} posters`);
  }

  // TVDB for whatever fanart missed.
  if (token) {
    let i = 0, got = 0;
    for (const mv of movies) {
      if (mv.art) continue;
      i++;
      if (i % 100 === 0) console.log(`  tvdb ${i} (${got} hits)`);
      const q = new URLSearchParams({ query: mv.title, type: "movie", limit: "5" });
      const key = `tv-${mv.id}.json`;
      let body = fs.existsSync(path.join(cacheDir, key)) ? fs.readFileSync(path.join(cacheDir, key), "utf8") : null;
      if (body === null) {
        try {
          const res = await fetch(`https://api4.thetvdb.com/v4/search?${q}`, {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
          });
          body = res.ok ? await res.text() : "";
          fs.writeFileSync(path.join(cacheDir, key), body);
          await sleep(300);
        } catch { continue; }
      }
      if (!body) continue;
      try {
        const results = JSON.parse(body).data || [];
        // Same old-film bias as the Wikidata matcher.
        const scored = results
          .filter((r) => r.image_url)
          .map((r) => ({ r, year: parseInt(r.year, 10) || null }))
          .sort((a, b) => {
            const old = (x) => (x.year && x.year <= 1985 ? 0 : 1);
            return old(a) - old(b) || (a.year ?? 9999) - (b.year ?? 9999);
          });
        if (!scored.length) continue;
        mv.art = scored[0].r.image_url;
        mv.artSrc = "tvdb";
        if (!mv.year && scored[0].year) mv.year = scored[0].year;
        got++;
      } catch {}
    }
    console.log(`  tvdb: ${got} posters`);
  }

  // Commons fallback for anything still bare.
  let wd = 0;
  for (const mv of movies) {
    if (mv.art || !mv.wdArt) continue;
    mv.art = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(mv.wdArt)}?width=400`;
    mv.artSrc = "commons";
    wd++;
  }
  console.log(`  commons fallback: ${wd} posters`);
  for (const mv of movies) delete mv.wdArt;
  console.log(`  total with art: ${movies.filter((m) => m.art).length}/${movies.length}`);
  return movies;
}

// ------------------------------------------------------------------- driver
// Phases are separable: the PDT scrape is slow and key-free, the art pass
// needs API keys. `--only pdt` / `--only art` run one at a time.
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
const stageFile = path.join(cacheDir, "stage-pdt.json");

let movies;
if (only === "art") {
  movies = JSON.parse(fs.readFileSync(stageFile, "utf8"));
  console.log(`loaded ${movies.length} movies from ${stageFile}`);
} else {
  console.log("1. catalog + genres");
  movies = await scrapeCatalog();
  console.log(`   ${movies.length} unique titles`);
  console.log("2. detail pages (ratings, formats, screenshots)");
  movies = await scrapeDetails(movies);
  fs.writeFileSync(stageFile, JSON.stringify(movies));
  console.log(`   staged -> ${stageFile}`);
}

if (only !== "pdt") {
  console.log("3. wikidata (year, ids, fallback art)");
  movies = await enrich(movies);
  console.log("4. poster art (tvdb / fanart.tv, if keys present)");
  movies = await posters(movies);
}

for (const mv of movies) { delete mv._cands; mv.sort = sortTitle(mv.title); }
movies.sort((a, b) => a.sort.localeCompare(b.sort));

if (only === "pdt") {
  fs.writeFileSync(stageFile, JSON.stringify(movies));
  console.log(`PDT phase done: ${movies.length} movies, ${movies.filter((m) => m.rating).length} rated. Run again with --only art.`);
} else {
  const out = {
    source: "https://www.publicdomaintorrents.info/nshowcat.html?category=ALL",
    scraped: new Date().toISOString().slice(0, 10),
    count: movies.length,
    movies,
  };
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`wrote ${outFile}: ${movies.length} movies, ${movies.filter((m) => m.art).length} with art, ${movies.filter((m) => m.year).length} with year`);
}
