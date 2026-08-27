#!/usr/bin/env node
// Generates one static redirect page per film at f/<id>/index.html, each
// carrying that film's own Open Graph tags.
//
// Why this needs to exist at all: the real app is one page with all state in
// the URL hash (#film=123&...), and a hash is never sent to any server — a
// social unfurl bot fetches the bare page and can't see it, hash-routing or
// not, static host or dynamic one. The only way a shared link can unfurl
// with a specific film's name and poster is a real, distinct URL path for
// that film, so this generates exactly that: a tiny static page per film,
// with the real per-film metadata baked in at build time, that immediately
// redirects a human visitor into the app with that film open. A crawler
// stops at the tags; a person passes straight through.
//
// NOT part of CI — rerun by hand after data.json changes:
//   node ideas/public-screening/build-share-pages.mjs
import fs from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const outDir = path.join(root, "f");
const SITE = "https://rickymetz.github.io/random/ideas/public-screening/";

// Mirrors index.html's GENRE_LABELS -- structured data should read like
// "Sci-Fi", not the internal slug "scifi".
const GENRE_LABELS = {
  action: "Action", animation: "Animation", comedy: "Comedy", drama: "Drama",
  exploitation: "Exploitation", family: "Family", horror: "Horror",
  martialarts: "Martial Arts", musicals: "Musicals", mystery: "Mystery",
  scifi: "Sci-Fi", serial: "Serial", war: "War", westerns: "Western",
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const data = JSON.parse(fs.readFileSync(path.join(root, "data.json"), "utf8"));
const movies = data.movies;

// ISO 8601 duration, the format schema.org's Duration type requires.
function isoDuration(minutes) {
  return minutes ? `PT${minutes}M` : null;
}

// Embedded in a <script> tag, so this is JSON, not HTML -- esc() (HTML
// entities) is the wrong tool here. The one thing that actually matters
// inside a script tag is "</", which would close it early if a description
// ever contained it literally; escape the slash so the JSON survives intact.
function ldJSON(obj) {
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

function jsonLd(m, title, desc, image, destAbs) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: title,
    url: destAbs,
    image,
    description: desc,
  };
  if (m.year) ld.datePublished = String(m.year);
  if (m.genres?.length) ld.genre = m.genres.map((g) => GENRE_LABELS[g] || g);
  if (m.director?.length) ld.director = m.director.map((name) => ({ "@type": "Person", name }));
  if (m.cast?.length) ld.actor = m.cast.map((name) => ({ "@type": "Person", name }));
  const dur = isoDuration(m.runtime);
  if (dur) ld.duration = dur;
  // Only a real IMDb rating counts here -- the catalogue's own 1-5 star is a
  // different, much weaker scale (see the README), and schema.org has no
  // field for "vote, but on a scale nobody else uses."
  if (m.score && m.scoreSrc === "imdb") {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: m.score,
      ratingCount: m.votes || 1,
      bestRating: 10,
      worstRating: 1,
    };
  }
  return ld;
}

function page(m) {
  const title = m.year ? `${m.title} (${m.year})` : m.title;
  const desc = m.desc || `${title} — a public domain film, free to watch on Public Screening.`;
  const image = m.art || `${SITE}og.png`;
  const url = `${SITE}f/${encodeURIComponent(m.id)}/`;
  const dest = `../../#film=${encodeURIComponent(m.id)}`;
  const destAbs = `${SITE}#film=${encodeURIComponent(m.id)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} — Public Screening</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${destAbs}">
<meta property="og:type" content="video.movie">
<meta property="og:site_name" content="Public Screening">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(dest)}">
<script type="application/ld+json">${ldJSON(jsonLd(m, title, desc, image, destAbs))}</script>
<style>
  body { background:#16181d; color:#8b93a5; font:15px/1.6 system-ui,sans-serif;
         display:grid; place-items:center; height:100vh; margin:0; text-align:center }
  a { color:#e5a00d }
</style>
</head>
<body>
  <p>Opening <a id="to" href="${esc(dest)}">${esc(title)}</a> on Public Screening.</p>
<script>
  location.replace(${JSON.stringify(dest)});
</script>
</body>
</html>
`;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const m of movies) {
  const dir = path.join(outDir, m.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page(m));
}
console.log(`wrote ${movies.length} share pages to f/`);
