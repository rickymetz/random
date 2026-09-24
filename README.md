# random — moved

**random now lives at https://rickymetz.com/** (source:
[rickymetz/rickymetz.com](https://github.com/rickymetz/rickymetz.com), in
`public/`). It's the site's home page now, with the same paths minus the
`/random` prefix: `rickymetz.github.io/random/ideas/breathe/` is
`rickymetz.com/ideas/breathe/`.

What's left here, served by GitHub Pages:

- `404.html` / `index.html` forward every old URL to the same page on
  rickymetz.com, keeping the query string and `#hash` (so Ephemera and
  Public Screening share links still land on their film).
- **Ledger, Cadence and Container Compound stay live here**, because what
  people saved in them lives in the browser, tied to this address, and
  doesn't follow the move. Each shows a "moved" bar (`nav.js`, which used to
  be the hub's navbar) linking to the same page on the new site: export or
  back up there, then import at the new address.
- `sw.js` retires the hub's old service worker: installed copies clear the
  hub's caches, unregister it and reload from the network.

Once nobody needs the old copies of those three ideas, delete them and
this repo can be archived.
