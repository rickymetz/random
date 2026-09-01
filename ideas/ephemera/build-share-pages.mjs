#!/usr/bin/env node
// Generates one static page per item at f/<id>/index.html, each with that
// item's own Open Graph tags.
//
// A #item= hash is never sent to any server, so an unfurl bot fetching the
// address-bar link sees the bare page and learns nothing about which film
// was open. A real distinct path per item is the only thing that unfurls.
//
// NOT part of CI — rerun by hand after data.json changes:
//   node ideas/ephemera/build-share-pages.mjs
import fs from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const outDir = path.join(root, "f");
const SITE = "https://rickymetz.github.io/random/ideas/ephemera/";
const IA = "https://archive.org";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ldJSON = (o) => JSON.stringify(o).replace(/<\//g, "<\\/");

const data = JSON.parse(fs.readFileSync(path.join(root, "data.json"), "utf8"));

function page(m) {
  const title = m.y ? `${m.t} (${m.y})` : m.t;
  const desc = m.d || `${title} — an ephemeral film from the Prelinger Archives, free to watch on Ephemera.`;
  const image = `${IA}/services/img/${encodeURIComponent(m.id)}`;
  const url = `${SITE}f/${encodeURIComponent(m.id)}/`;
  const dest = `../../#item=${encodeURIComponent(m.id)}`;
  const destAbs = `${SITE}#item=${encodeURIComponent(m.id)}`;

  const ld = {
    "@context": "https://schema.org", "@type": "Movie",
    name: title, url: destAbs, image, description: desc,
  };
  if (m.y) ld.datePublished = String(m.y);
  // ISO 8601 duration. m.r is whole minutes, so PT<n>M is the exact form.
  // Guarded rather than truthy-checked: emitting PT0M would assert a zero-length
  // film, which is worse than saying nothing. 91% of items carry a runtime; the
  // rest simply omit the field.
  if (Number.isInteger(m.r) && m.r > 0) ld.duration = `PT${m.r}M`;
  if (m.g?.length) {
    ld.genre = m.g.map((g) => (data.tags.find((t) => t.slug === g) || {}).label || g);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} — Ephemera</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(destAbs)}">
<meta property="og:type" content="video.movie">
<meta property="og:site_name" content="Ephemera">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(dest)}">
<script type="application/ld+json">${ldJSON(ld)}</script>
<style>
  body { background:#15191b; color:#8b9aa0; font:15px/1.6 system-ui,sans-serif;
         display:grid; place-items:center; height:100vh; margin:0; text-align:center }
  a { color:#5fb3a1 }
</style>
</head>
<body>
  <p>Opening <a href="${esc(dest)}">${esc(title)}</a> on Ephemera.</p>
<script>location.replace(${JSON.stringify(dest)});</script>
</body>
</html>
`;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
// This author-time script runs on a case-preserving but case-INsensitive
// filesystem (macOS APFS). Two distinct Archive identifiers differing only
// in case (e.g. "MacleansToot" / "macleanstoot") would silently collide
// into a single directory there -- the dir keeps whichever id created it
// first, the file keeps whichever id wrote last -- and that collision would
// then be committed as a single, wrongly-labeled page, with the other id's
// URL 404ing on the case-sensitive host. Guard against that the same way we
// guard against unsafe characters: skip and warn rather than silently
// clobber.
//
// This check is applied unconditionally on purpose: it keeps the committed
// output byte-identical regardless of which machine runs the generator.
const seenLower = new Set();
for (const m of data.items) {
  // Identifiers come from Archive and are [A-Za-z0-9._-]; verify before
  // using one as a directory name. Reject all-dot identifiers (., .., etc.)
  // separately because . is otherwise legal, but path.join(outDir, "..") would
  // escape to ideas/ephemera/ and overwrite the live app.
  if (!/^[A-Za-z0-9._-]+$/.test(m.id) || /^\.+$/.test(m.id)) {
    console.warn(`  skipping unsafe identifier: ${m.id}`);
    continue;
  }
  const lower = m.id.toLowerCase();
  if (seenLower.has(lower)) {
    console.warn(`  skipping case-insensitive duplicate identifier: ${m.id}`);
    continue;
  }
  seenLower.add(lower);
  const dir = path.join(outDir, m.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), page(m));
  n++;
}
console.log(`wrote ${n} share pages to f/`);
