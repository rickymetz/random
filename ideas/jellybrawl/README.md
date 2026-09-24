# Jellybrawl

A Mario Party × Jackbox party game prototype. The TV is the shared screen
(`tv.html`), and every phone is a controller (`index.html`). Players are
jelly blobs with their selfie (or a doodle) as the face.

Spec: `docs/superpowers/specs/2026-09-23-jellybrawl.md`.

## Play it

**With real phones** (same Wi-Fi):

```sh
node ideas/jellybrawl/server.mjs        # zero dependencies, port 8787
```

Open the printed `…/tv.html` on the big screen: a laptop on HDMI, or a
browser AirPlayed to an Apple TV. Phones scan the QR code or go to the printed
address and type the room code.

**With real phones, on Netlify**: deploy the repo as it is. `netlify.toml`
adds `netlify/functions/jellybrawl.mjs`, which only introduces each phone to
the TV (a WebRTC offer and answer, kept for a moment in Netlify Blobs); the
game itself then runs peer-to-peer, phone to TV, so on the same Wi-Fi it never
leaves the room. Nothing to install and nothing to configure: open `tv.html`
and phones scan the QR code. Phones on a different network (mobile data) may
not get through without a TURN server: set the site's `JB_ICE_SERVERS`
environment variable to a JSON array of ICE servers, e.g.
`[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]`.
`node server.mjs --p2p` runs the same signalling locally (rooms in memory).

**Solo / on GitHub Pages**: open `tv.html` and use **Open a controller tab**.
Without the relay, controllers are other tabs of the same browser
(BroadcastChannel). Add bots with **B**.

The first phone to join is the VIP and starts the game. The TV keyboard works
too: Enter starts, B / N add or remove a bot, R changes the round (or turn) count, G
cycles Playlist → Board → Microgame Gauntlet, M picks the board map, and 1–3 pick a game.

## Files

| File | Role |
| --- | --- |
| `tv.html`, `tv.js` | The host: lobby, loser-picks, intro, game, results, podium. Authoritative for all game state. |
| `index.html`, `controller.js`, `controller.css` | The phone: join, selfie/doodle, then renders the layouts the TV sends. |
| `games/*.js` | Minigames: `flap` (free-for-all), `sling` (teams), `chomp` (1 vs rest), `snipe` (Sniper Plaza and Sniper Blackout, 1 vs rest, one engine), `tag` (Infection), `kaiju` (Kaiju), `soccer`, `paint`, `crown`, `dodgeball`, `tug`, `relay`, `stack` and `bombsquad` (teams) and `sumo`, `bumper`, `coinrush`, `potato`, `snake`, `maze` (tilt) and `draw` (free-for-all), plus the asymmetric `haunted`, `whack`, `kraken`, `tank`, `hill` and `pilot`, and the secret-pick `greed`, on the shared `arena` engine, plus `gauntlet` (the Microgame Gauntlet mode: 9 microgames, lives, speed-ups). Each has a bot. |
| `board.js`, `boards.js`, `boardart.js` | Board mode: dice, forks, coins and stars, shop and secret items, duels, events; the three themed maps (Neon City, Slime Sewers, Volcano Isle); and the board art (tiles, roads, scenery). |
| `net.js` | Transport: peer-to-peer WebRTC where the site has the signalling (Netlify), else the WebSocket relay, else BroadcastChannel. Long messages (selfies) go in pieces. |
| `signal.mjs` | The peer-to-peer signalling: rooms, offers and answers over a few HTTP calls, on any key-value store. |
| `server.mjs` | Static server plus room relay (a hand-rolled WebSocket, no deps); `--p2p` serves the signalling instead. |
| `../../netlify/functions/jellybrawl.mjs` | The signalling as a Netlify Function at `/api/jellybrawl/*`, on Netlify Blobs (vendored in `netlify/vendor/`, so no install step). |
| `fonts/` | Knewave (title, command words) and League Gothic (labels), The League of Moveable Type, SIL OFL 1.1 (`fonts/OFL.txt`). |
| `gfx.js`, `qr.js`, `sfx.js` | Canvas helpers and the blob renderer, a QR encoder, and synthesised SFX. |

## Adding a minigame

Export `{ id, title, kind, blurb, controls, min, max, create(ctx) }` from
`games/<id>.js` and add it to `GAMES` in `tv.js`. `create` returns
`{ describe(), start(), input(pid, msg), bot(pid, dt), update(dt), draw(g), result }`.
Call `ctx.layout(pid, {kind: "button" | "dpad" | "sling" | "wait", …})` to
choose each phone's controls. Set `result` to `{ ranking: [[pid…]…] }` or
`{ winners, losers }` when the game is over.
