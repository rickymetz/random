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
import zlib from "node:zlib";
import readline from "node:readline";

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

// Compare titles on their letters alone: case, spacing, punctuation and a
// trailing parenthetical all vary between the catalogue and the databases.
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Short stable id for a set of qids, so cache files key by content.
function batchKey(ids) {
  let h = 2166136261;
  for (const c of ids.join("|")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

// "A Bucket of Blood" sorts under B — matches Plex and the source's own order.
const sortTitle = (t) => t.replace(/^(a|an|the)\s+/i, "").toLowerCase();

// The catalogue is public domain film; its newest genuine entries are cheap
// late-80s pictures. A title matching something newer means the real film
// simply isn't in the database and we've landed on a modern namesake — drop
// it rather than show a confidently wrong year and poster.
const MAX_YEAR = 1990;

// Accepting only "film" threw away shorts, which is most of what a public
// domain catalogue holds: of 38 films rejected as not-a-film, 10 were shorts,
// 8 television films and 4 animated shorts. The rest were genuinely albums,
// video games and taxons, and stay rejected.
const FILM_TYPES = new Set([
  "Q11424",     // film
  "Q24862",     // short film
  "Q506240",    // television film
  "Q202866",    // animated film
  "Q17517379",  // animated short film
  "Q93204",     // documentary film
  "Q226730",    // silent film
  "Q24856",     // film series
]);

// "Betty Boop - Pudgy Takes a Bow-Wow" is catalogued under the series, but
// Wikidata knows it by the short's own name. Try both.
function titleVariants(t) {
  const out = [t];
  const dash = t.split(/\s+-\s+/);
  if (dash.length === 2 && dash[1].length > 3) out.push(dash[1].trim());
  return out;
}

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
    const url = `${WD}?action=wbsearchentities&format=json&language=en&type=item&limit=20&search=${encodeURIComponent(mv.title)}`;
    const body = await get(url, `wd-s-${mv.id}.json`, 500);
    if (!body) { misses.push(`${mv.id}\t${mv.title}\tsearch failed`); continue; }
    let hits = [];
    try { hits = JSON.parse(body).search || []; } catch {}

    // wbsearchentities matches labels from the start of the string, so an
    // obscure short often returns nothing at all — 391 films failed here.
    // CirrusSearch reads the whole text and is far more forgiving, so it runs
    // as a fallback, restricted to things that are instances of a film.
    if (!hits.length) {
      for (const variant of titleVariants(mv.title)) {
        const q = `haswbstatement:${[...FILM_TYPES].map((t) => "P31=" + t).join("|")} "${variant}"`;
        const alt = await get(
          `${WD}?action=query&format=json&list=search&srlimit=6&srsearch=${encodeURIComponent(q)}`,
          `wd-c-${mv.id}-${variant === mv.title ? "a" : "b"}.json`, 400);
        if (!alt) continue;
        try {
          const found = (JSON.parse(alt).query?.search || []).map((x) => ({ id: x.title, label: variant }));
          if (found.length) { hits = found; break; }
        } catch {}
      }
    }
    if (!hits.length) { misses.push(`${mv.id}\t${mv.title}\tno entity`); continue; }
    // wbsearchentities is fuzzy/prefix: without an exact-title gate a film
    // with no Wikidata entry silently matches some *other* old film, and the
    // old-bias sort then promotes it. Demand the name actually match.
    const wants = titleVariants(mv.title).map(norm);
    const exact = hits.filter((h) => {
      const names = [h.label, h.match?.text, ...(h.aliases || [])].filter(Boolean);
      return names.some((n) => wants.includes(norm(n)));
    });
    if (!exact.length) {
      misses.push(`${mv.id}\t${mv.title}\tno exact-title entity (best: ${hits[0].label || "?"})`);
      continue;
    }
    const ids = exact.map((x) => x.id);
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
    const url = `${WD}?action=wbgetentities&format=json&props=claims|labels|aliases&languages=en&ids=${batch.join("|")}`;
    // Keyed by batch contents — an offset key would go stale and map to the
    // wrong ids as soon as a re-run shifted the candidate set.
    const body = await get(url, `wd-e-${batchKey(batch)}.json`, 500);
    if (!body) continue;
    try { Object.assign(ents, JSON.parse(body).entities || {}); } catch {}
  }

  const claimVal = (c, p) => c[p]?.[0]?.mainsnak?.datavalue?.value;

  for (const mv of movies) {
    if (!mv._cands) continue;
    const wants = titleVariants(mv.title).map(norm);
    const films = [], tooNew = [];
    for (const q of mv._cands) {
      const c = ents[q]?.claims;
      if (!c) continue;
      const isFilm = (c.P31 || []).some((x) =>
        FILM_TYPES.has(x.mainsnak?.datavalue?.value?.id));
      if (!isFilm) continue;

      // CirrusSearch reads whole articles, so a hit is only a suggestion. The
      // entity itself has to carry the title, or we are back to silently
      // attaching the wrong film.
      const ent = ents[q];
      const names = [ent?.labels?.en?.value, ...(ent?.aliases?.en || []).map((a) => a.value)].filter(Boolean);
      if (!names.some((n) => wants.includes(norm(n)))) continue;
      let year = null;
      for (const x of c.P577 || []) {
        const t = x.mainsnak?.datavalue?.value?.time;
        if (t) { year = parseInt(t.slice(1, 5), 10); break; }
      }
      const art = claimVal(c, "P3383") || claimVal(c, "P18") || null;
      if (year && year > MAX_YEAR) { tooNew.push(`${year}`); continue; }
      films.push({ q, year, art, imdb: claimVal(c, "P345") || null, tmdb: claimVal(c, "P4947") || null });
    }
    if (!films.length) {
      misses.push(`${mv.id}\t${mv.title}\t${tooNew.length ? `only modern namesakes (${tooNew.join(", ")})` : "no film among candidates"}`);
      continue;
    }
    // This catalog is old public domain film. Prefer a plausibly-old match,
    // then the earliest, then one that actually has art.
    films.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (b.art ? 1 : 0) - (a.art ? 1 : 0));
    const best = films[0];
    mv.year = best.year ?? undefined;
    mv.wd = best.q;
    if (best.imdb) mv.imdb = best.imdb;
    if (best.tmdb) mv.tmdb = best.tmdb;
    if (best.art) mv.wdArt = best.art;
    if (films.length > 1) misses.push(`${mv.id}\t${mv.title}\tambiguous -> ${best.q} (${best.year}) of ${films.length}`);

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
        const want = norm(mv.title);
        const scored = results
          .filter((r) => {
            const names = [r.name, r.title, ...Object.values(r.translations || {})].filter(Boolean);
            return names.some((n) => norm(n) === want);
          })
          .map((r) => ({ r, year: parseInt(r.year, 10) || null }))
          .filter((x) => !(x.year && x.year > MAX_YEAR))
          .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
        if (!scored.length) continue;

        // The match is good even when the artwork is not, so take the year
        // from it regardless.
        if (!mv.year && scored[0].year) mv.year = scored[0].year;

        // TheTVDB returns a shared "no poster" placeholder rather than
        // omitting the field, and says so in the path. 42 films were carrying
        // it, which made the Has poster filter overcount.
        const real = scored.find((x) =>
          x.r.image_url && !/\/images\/missing\//i.test(x.r.image_url));
        if (!real) continue;
        mv.art = real.r.image_url;
        mv.artSrc = "tvdb";
        got++;
      } catch {}
    }
    console.log(`  tvdb: ${got} posters`);
  }

  // Some art URLs 404 — TheTVDB drops artwork it once served. Check them, but
  // carefully: a whole host can be unreachable from wherever this runs, and
  // treating that as "every poster is dead" would strip hundreds of working
  // images. A URL is only dropped when its host answered some other request
  // successfully, which proves the host itself is up.
  async function verifyArt() {
    const targets = movies.filter((m) => m.art);
    const host = (u) => { try { return new URL(u).hostname; } catch { return "?"; } };
    const live = new Map(), dead = [];
    const queue = [...targets];
    async function worker() {
      while (queue.length) {
        const mv = queue.shift();
        const h = host(mv.art);
        const key = path.join(cacheDir, `alive-${mv.id}.txt`);
        let verdict = fs.existsSync(key) ? fs.readFileSync(key, "utf8").trim() : null;
        if (verdict === null) {
          try {
            const r = await fetch(mv.art, { method: "GET", headers: { "User-Agent": UA } });
            verdict = r.ok ? "ok" : "gone";
          } catch { verdict = "unreachable"; }
          fs.writeFileSync(key, verdict);
        }
        if (verdict === "ok") live.set(h, (live.get(h) || 0) + 1);
        else dead.push({ mv, h, verdict });
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));

    let dropped = 0;
    const skipped = new Map();
    for (const { mv, h } of dead) {
      if (!live.get(h)) { skipped.set(h, (skipped.get(h) || 0) + 1); continue; }
      delete mv.art; delete mv.artSrc; dropped++;
    }
    for (const [h, n] of skipped)
      console.warn(`  ${h} unreachable right now — left ${n} posters alone rather than guess`);
    console.log(`  dropped ${dropped} posters whose URL is genuinely gone`);
  }
  await verifyArt();

  // Belt and braces: any single image standing in for several films is a
  // placeholder by definition, whichever service supplied it.
  const uses = new Map();
  for (const mv of movies) if (mv.art) uses.set(mv.art, (uses.get(mv.art) || 0) + 1);
  let shared = 0;
  for (const mv of movies) {
    if (mv.art && uses.get(mv.art) > 2) {
      delete mv.art; delete mv.artSrc; shared++;
    }
  }
  if (shared) console.log(`  dropped ${shared} films using shared placeholder art`);

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


// ------------------------------------------ 5. ratings (IMDb, then TMDB)
// The source site's own stars are thin and barely discriminating: 481 of 981
// films, and three quarters of those are 4 or 5. External ratings replace them
// where they exist, and the star falls back in only when nothing else does.
// Everything lands on one 0-10 scale so a single control can sort them.
const IMDB_DATASET = "https://datasets.imdbws.com/title.ratings.tsv.gz";

// Only the rows matching our films are kept; the dataset itself stays in the
// cache directory and is never committed.
async function imdbRatings(wanted, cacheFile) {
  if (!fs.existsSync(cacheFile)) {
    console.log("  downloading the IMDb ratings export (~8MB)");
    const res = await fetch(IMDB_DATASET, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.warn(`  IMDb dataset failed: HTTP ${res.status}`); return new Map(); }
    fs.writeFileSync(cacheFile, Buffer.from(await res.arrayBuffer()));
  }
  const out = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(cacheFile).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const tab = line.indexOf("\t");
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const [, avg, votes] = line.split("\t");
    out.set(id, { score: parseFloat(avg), votes: parseInt(votes, 10) });
  }
  return out;
}

async function tmdbRatings(movies, env) {
  const key = env.TMDB_API_KEY;
  if (!key) { console.log("  no TMDB_API_KEY — skipping TMDB"); return new Map(); }
  // A v4 read token goes in the header; a v3 key goes in the query string.
  const v4 = key.startsWith("ey");
  const out = new Map();
  let i = 0;
  for (const mv of movies) {
    if (!mv.tmdb) continue;
    i++;
    if (i % 100 === 0) console.log(`  tmdb ${i} (${out.size} hits)`);
    const url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(mv.tmdb)}` +
                (v4 ? "" : `?api_key=${key}`);
    const file = path.join(cacheDir, `tm-${mv.id}.json`);
    let body = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (body === null) {
      try {
        const res = await fetch(url, { headers: v4
          ? { Authorization: `Bearer ${key}`, "User-Agent": UA }
          : { "User-Agent": UA } });
        body = res.ok ? await res.text() : "";
        fs.writeFileSync(file, body);
        await sleep(120);
      } catch { continue; }
    }
    if (!body) continue;
    try {
      const d = JSON.parse(body);
      if (d.vote_average > 0 && d.vote_count > 0) {
        out.set(mv.id, { score: d.vote_average, votes: d.vote_count });
      }
    } catch {}
  }
  return out;
}

async function ratings(movies) {
  const env = loadEnv();
  const wanted = new Set(movies.map((m) => m.imdb).filter(Boolean));
  const imdb = await imdbRatings(wanted, path.join(cacheDir, "imdb-ratings.tsv.gz"));
  console.log(`  imdb: ${imdb.size} of ${wanted.size} ids matched`);
  const tmdb = await tmdbRatings(movies, env);
  console.log(`  tmdb: ${tmdb.size} ratings`);

  const tally = { imdb: 0, tmdb: 0, pdt: 0, none: 0 };
  for (const mv of movies) {
    const im = mv.imdb && imdb.get(mv.imdb);
    const tm = tmdb.get(mv.id);
    // Only a real 0-10 rating becomes a score. Doubling the site's 1-5 star
    // would put 102 films at a flat 10.0 — a value no film on IMDb actually
    // reaches — and float them above everything genuinely well regarded. The
    // star stays a star, on its own scale, and is ranked below real ratings.
    delete mv.score; delete mv.votes; delete mv.scoreSrc;
    if (im) { mv.score = +im.score.toFixed(1); mv.votes = im.votes; mv.scoreSrc = "imdb"; tally.imdb++; }
    else if (tm) { mv.score = +tm.score.toFixed(1); mv.votes = tm.votes; mv.scoreSrc = "tmdb"; tally.tmdb++; }
    else if (mv.rating) tally.pdt++;
    else tally.none++;
  }
  console.log(`  scores: ${tally.imdb} imdb, ${tally.tmdb} tmdb; ${tally.pdt} left on site stars, ${tally.none} unrated`);
  return movies;
}


// ------------------------------------------- 6. Internet Archive: watchable
// The catalogue can only point at a torrent page. Many of these films are also
// held by the Internet Archive, where they play in a browser. Matching on title
// alone was hopeless — an early attempt returned a Twitter thumbnail for a
// western — but with a year to constrain it, the search becomes reliable.
async function archive(movies) {
  let asked = 0, found = 0;
  for (const mv of movies) {
    if (!mv.year) continue;   // without a year the match cannot be trusted
    asked++;
    if (asked % 100 === 0) console.log(`  archive ${asked} (${found} matched)`);
    const q = `title:("${mv.title}") AND mediatype:(movies) AND ` +
              `year:[${mv.year - 1} TO ${mv.year + 1}]`;
    const url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&rows=5&output=json";
    const body = await get(url, `ia-${mv.id}.json`, 400);
    if (!body) continue;
    let docs = [];
    try {
      // Their JSON occasionally carries raw control characters, which is a
      // parse error rather than a missing result.
      const clean = [...body].filter((c) => c.charCodeAt(0) >= 32 || c === "\n").join("");
      docs = JSON.parse(clean)?.response?.docs || [];
    } catch { continue; }

    // Strict: the item has to carry the same title. A near miss is more likely
    // a trailer, a compilation or a different film than the one we want.
    const want = norm(sortTitle(mv.title));
    const exact = docs.find((d) => norm(sortTitle(String(d.title ?? ""))) === want);
    if (!exact) continue;
    mv.ia = exact.identifier;
    found++;
  }
  console.log(`  archive.org: ${found} of ${asked} films with a year are watchable`);

  // A matching title is not a matching film: the Archive holds trailers and
  // clips under the film's own name, and roughly a fifth of the matches played
  // a minute of footage instead of the feature.
  //
  // The per-file "length" is seconds. That was worth establishing rather than
  // assuming — a small value like 44.4 reads naturally as minutes, and taking
  // it that way kept a 44 second clip of The Kid as a 68 minute film. Loading
  // the media in a browser settled it: The Kid runs 0.7 minutes, American
  // Empire runs 80.7, and both agree with the seconds reading.
  const VIDEO = /\.(mp4|m4v|ogv|mpg|mpeg|avi|mkv|webm)$/i;

  // "89 min." | "1:19:07" | "48:35"
  function statedMinutes(raw) {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    const m = t.match(/^(\d+)\s*min/i);
    if (m) return +m[1];
    const p = t.split(":").map((x) => parseInt(x, 10));
    if (p.some(Number.isNaN)) return null;
    if (p.length === 3) return p[0] * 60 + p[1] + p[2] / 60;
    if (p.length === 2) return p[0] + p[1] / 60;
    return null;
  }

  let checked = 0, dropped = 0, adopted = 0;
  for (const mv of movies) {
    if (!mv.ia) continue;
    checked++;
    if (checked % 150 === 0) console.log(`  verifying ${checked} (${dropped} dropped)`);
    const body = await get(`https://archive.org/metadata/${encodeURIComponent(mv.ia)}`,
      `iam-${mv.id}.json`, 300);
    if (!body) continue;
    let files = [], meta = {};
    try { const j = JSON.parse(body); files = j.files || []; meta = j.metadata || {}; }
    catch { continue; }

    const vids = files.filter((f) => VIDEO.test(f.name || ""));
    if (!vids.length) { delete mv.ia; dropped++; continue; }

    // Several files usually means several encodings of one film, which share a
    // duration — but a serial split across parts has different ones. Summing
    // the distinct values covers both without double counting.
    const distinct = new Set(vids.map((f) => Math.round(parseFloat(f.length) || 0)).filter(Boolean));
    const fromFiles = [...distinct].reduce((a, x) => a + x, 0) / 60;
    const mins = statedMinutes(meta.runtime) ?? fromFiles;
    if (!mins) { delete mv.ia; dropped++; continue; }

    if (mv.runtime) {
      if (mins < mv.runtime * 0.6) { delete mv.ia; dropped++; }
    } else if (mins < 4) {
      delete mv.ia; dropped++;
    } else {
      mv.runtime = Math.round(mins);
      adopted++;
    }
  }
  console.log(`  verified ${checked}: ${dropped} were clips or empty, ${adopted} supplied a runtime`);

  // An item we matched also has a thumbnail, which covers films that had no
  // poster from anywhere else.
  let filled = 0;
  for (const mv of movies) {
    if (mv.art || !mv.ia) continue;
    mv.art = `https://archive.org/services/img/${encodeURIComponent(mv.ia)}`;
    mv.artSrc = "archive";
    filled++;
  }
  console.log(`  archive.org: ${filled} posters filled from item thumbnails`);
  return movies;
}


// ------------------------------------------------- 7. director and cast
// The entity fetch already carries P57 and P161; they were simply thrown away.
// Reading them back costs one label lookup per person and gives the catalogue a
// dimension it had none of — who made the film.
async function credits(movies) {
  const WD = "https://www.wikidata.org/w/api.php";

  // Rebuild the entity map from the cached batches rather than refetching.
  const ents = {};
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.startsWith("wd-e-")) continue;
    try { Object.assign(ents, JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8")).entities || {}); } catch {}
  }

  const people = new Set();
  const want = new Map();
  for (const mv of movies) {
    const c = mv.wd && ents[mv.wd]?.claims;
    if (!c) continue;
    const ids = (p, n) => (c[p] || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, n);
    const dirs = ids("P57", 2), cast = ids("P161", 3);
    if (!dirs.length && !cast.length) continue;
    want.set(mv.id, { dirs, cast });
    [...dirs, ...cast].forEach((q) => people.add(q));
  }
  console.log(`  ${want.size} films name a director or cast; ${people.size} people to resolve`);

  const names = {};
  const list = [...people];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    if (i % 500 === 0) console.log(`  names ${i}/${list.length}`);
    const body = await get(
      `${WD}?action=wbgetentities&format=json&props=labels&languages=en&ids=${batch.join("|")}`,
      `wd-p-${batchKey(batch)}.json`, 300);
    if (!body) continue;
    try {
      for (const [q, e] of Object.entries(JSON.parse(body).entities || {})) {
        const n = e.labels?.en?.value;
        if (n) names[q] = n;
      }
    } catch {}
  }

  let withDir = 0, withCast = 0;
  for (const mv of movies) {
    const w = want.get(mv.id);
    if (!w) continue;
    const d = w.dirs.map((q) => names[q]).filter(Boolean);
    const c = w.cast.map((q) => names[q]).filter(Boolean);
    if (d.length) { mv.director = d; withDir++; }
    if (c.length) { mv.cast = c; withCast++; }
  }
  console.log(`  ${withDir} films with a director, ${withCast} with cast`);
  return movies;
}


// ------------------------------------------------ 8. runtime and last posters
// Archive item metadata carries a "length" field, but it cannot be trusted:
// The 39 Steps reports 88.34 for an 86 minute film while One Week reports 93.72
// for a 19 minute one. Wikidata's P2047 is a proper quantity with an explicit
// unit, so runtime comes from there instead.
const UNIT_MINUTE = "Q7727";
const UNIT_SECOND = "Q11574";
const UNIT_HOUR = "Q25235";

async function extras(movies) {
  const ents = {};
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.startsWith("wd-e-")) continue;
    try { Object.assign(ents, JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8")).entities || {}); } catch {}
  }

  let timed = 0;
  for (const mv of movies) {
    const d = mv.wd && ents[mv.wd]?.claims?.P2047?.[0]?.mainsnak?.datavalue?.value;
    if (!d?.amount) continue;
    const n = Math.abs(parseFloat(d.amount));
    const unit = String(d.unit || "").split("/").pop();
    const mins = unit === UNIT_SECOND ? n / 60 : unit === UNIT_HOUR ? n * 60 : n;
    // A minute or a marathon both mean the value is wrong, not the film.
    if (!(mins >= 1 && mins <= 500)) continue;
    mv.runtime = Math.round(mins);
    timed++;
  }
  console.log(`  runtime: ${timed} films`);

  // Last look for artwork. Wikipedia's lead image is a different field from the
  // Commons image already tried, so it sometimes exists where that one did not.
  const bare = movies.filter((m) => !m.art && m.wd);
  console.log(`  ${bare.length} films still have no poster and a Wikidata match`);
  const titles = new Map();
  const ids = bare.map((m) => m.wd);
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const body = await get(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${batch.join("|")}`,
      `wd-sl-${batchKey(batch)}.json`, 300);
    if (!body) continue;
    try {
      for (const [q, e] of Object.entries(JSON.parse(body).entities || {})) {
        const t = e.sitelinks?.enwiki?.title;
        if (t) titles.set(q, t);
      }
    } catch {}
  }

  let filled = 0;
  const wanted = bare.filter((m) => titles.has(m.wd));
  for (let i = 0; i < wanted.length; i += 20) {
    const chunk = wanted.slice(i, i + 20);
    const body = await get(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=original" +
      "&titles=" + encodeURIComponent(chunk.map((m) => titles.get(m.wd)).join("|")),
      `wp-img-${batchKey(chunk.map((m) => m.id))}.json`, 300);
    if (!body) continue;
    try {
      const pages = Object.values(JSON.parse(body).query?.pages || {});
      const byTitle = new Map(pages.map((p) => [p.title, p.original?.source]));
      for (const mv of chunk) {
        const src = byTitle.get(titles.get(mv.wd));
        if (!src) continue;
        mv.art = src;
        mv.artSrc = "wikipedia";
        filled++;
      }
    } catch {}
  }
  console.log(`  wikipedia lead images: ${filled} posters recovered`);
  return movies;
}


// ------------------------------------------------------ 9. descriptions
// The source site has synopses, but they are not ours to republish. Wikipedia's
// opening sentences are, under CC BY-SA, which means crediting it and linking
// back to the article each line came from — so the article title is stored
// alongside the text and the page renders both.
//
// Two sentences only. Enough to decide whether to watch something, and no more
// of someone else's writing than that needs.
// exsentences is a request, not a guarantee: it returned three or more for 124
// of 553 articles, so the two-sentence limit is enforced here instead. Common
// abbreviations are masked first, or "Dr. No" would end a sentence.
const ABBREV = /\b(Mr|Mrs|Ms|Dr|Jr|Sr|St|Co|Inc|Ltd|vs|etc|No|Capt|Lt|Sgt|Gen|Col|Prof|U\.S|U\.K)\./g;
function trimToTwoSentences(text) {
  const masked = text.replace(ABBREV, (m) => m.replace(".", "\u0000"));
  const parts = masked.split(/(?<=[.!?])\s+(?=[A-Z"\u201c])/);
  return parts.slice(0, 2).join(" ").replace(/\u0000/g, ".").trim();
}

async function descriptions(movies) {
  const WD = "https://www.wikidata.org/w/api.php";
  const WP = "https://en.wikipedia.org/w/api.php";

  // Which films have an English article at all?
  const withWd = movies.filter((m) => m.wd);
  const article = new Map();
  const qids = withWd.map((m) => m.wd);
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    if (i % 250 === 0) console.log(`  sitelinks ${i}/${qids.length}`);
    const body = await get(
      `${WD}?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${batch.join("|")}`,
      `wd-sl2-${batchKey(batch)}.json`, 300);
    if (!body) continue;
    try {
      for (const [q, e] of Object.entries(JSON.parse(body).entities || {})) {
        const t = e.sitelinks?.enwiki?.title;
        if (t) article.set(q, t);
      }
    } catch {}
  }
  console.log(`  ${article.size} of ${withWd.length} films have an English Wikipedia article`);

  const wanted = withWd.filter((m) => article.has(m.wd));
  let got = 0;
  for (let i = 0; i < wanted.length; i += 20) {
    const chunk = wanted.slice(i, i + 20);
    if (i % 200 === 0) console.log(`  extracts ${i}/${wanted.length} (${got} so far)`);
    const titles = chunk.map((m) => article.get(m.wd));
    const body = await get(
      `${WP}?action=query&format=json&redirects=1&prop=extracts&exintro=1&explaintext=1` +
      `&exsentences=2&titles=${encodeURIComponent(titles.join("|"))}`,
      `wp-ex-${batchKey(chunk.map((m) => m.id))}.json`, 300);
    if (!body) continue;
    try {
      const q = JSON.parse(body).query || {};
      // A redirect means the article we asked for answers under another name.
      const alias = new Map((q.redirects || []).map((r) => [r.from, r.to]));
      const byTitle = new Map(Object.values(q.pages || {}).map((pg) => [pg.title, pg.extract]));
      for (const mv of chunk) {
        const asked = article.get(mv.wd);
        const text = byTitle.get(alias.get(asked) ?? asked);
        if (!text) continue;
        const clean = trimToTwoSentences(text.replace(/\s+/g, " ").trim());
        if (clean.length < 30) continue;   // a stub tells the reader nothing
        mv.desc = clean;
        mv.wiki = alias.get(asked) ?? asked;
        got++;
      }
    } catch {}
  }
  console.log(`  ${got} descriptions`);
  return movies;
}

// ------------------------------------------------------------------- driver
// Phases are separable: the PDT scrape is slow and key-free, the art pass
// needs API keys. `--only pdt` / `--only art` run one at a time.
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "all";
const RATINGS_ONLY = only === "ratings";
const ARCHIVE_ONLY = only === "archive";
const CREDITS_ONLY = only === "credits";
const EXTRAS_ONLY = only === "extras";
const DESC_ONLY = only === "desc";
const stageFile = path.join(cacheDir, "stage-pdt.json");

let movies;
if (only === "desc") {
  movies = JSON.parse(fs.readFileSync(outFile, "utf8")).movies;
  console.log(`loaded ${movies.length} movies from data.json`);
  movies = await descriptions(movies);
} else if (only === "extras") {
  movies = JSON.parse(fs.readFileSync(outFile, "utf8")).movies;
  console.log(`loaded ${movies.length} movies from data.json`);
  movies = await extras(movies);
} else if (only === "credits") {
  movies = JSON.parse(fs.readFileSync(outFile, "utf8")).movies;
  console.log(`loaded ${movies.length} movies from data.json`);
  movies = await credits(movies);
} else if (only === "archive") {
  movies = JSON.parse(fs.readFileSync(outFile, "utf8")).movies;
  console.log(`loaded ${movies.length} movies from data.json`);
  movies = await archive(movies);
} else if (only === "ratings") {
  // Re-rate whatever is already published, without touching the other sources.
  movies = JSON.parse(fs.readFileSync(outFile, "utf8")).movies;
  console.log(`loaded ${movies.length} movies from data.json`);
  movies = await ratings(movies);
} else if (only === "art") {
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

if (only !== "pdt" && !RATINGS_ONLY && !ARCHIVE_ONLY && !CREDITS_ONLY && !EXTRAS_ONLY && !DESC_ONLY) {
  console.log("3. wikidata (year, ids, fallback art)");
  movies = await enrich(movies);
  console.log("4. poster art (tvdb / fanart.tv, if keys present)");
  movies = await posters(movies);
  console.log("5. ratings (IMDb dataset, then TMDB)");
  movies = await ratings(movies);
  console.log("6. archive.org (watch links and fallback posters)");
  movies = await archive(movies);
  console.log("7. director and cast");
  movies = await credits(movies);
  console.log("8. runtime and remaining posters");
  movies = await extras(movies);
  console.log("9. descriptions");
  movies = await descriptions(movies);
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
