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

**Solo / on GitHub Pages**: open `tv.html` and use **Open a controller tab**.
Without the relay, controllers are other tabs of the same browser
(BroadcastChannel). Add bots with **B**.

The first phone to join is the VIP and starts the game. The TV keyboard works
too: Enter starts, B / N add or remove a bot, R changes the round (or turn) count, G
cycles Playlist → Board → Microgame Gauntlet, and 1–3 pick a game.

## Files

| File | Role |
| --- | --- |
| `tv.html`, `tv.js` | The host: lobby, loser-picks, intro, game, results, podium. Authoritative for all game state. |
| `index.html`, `controller.js`, `controller.css` | The phone: join, selfie/doodle, then renders the layouts the TV sends. |
| `games/*.js` | Minigames: `flap` (free-for-all), `sling` (teams), `chomp` (1 vs rest), `snipe` (Sniper Plaza and Sniper Blackout, 1 vs rest, one engine), `tag` (Infection), `kaiju` (Kaiju), plus `gauntlet` (the Microgame Gauntlet mode: 9 microgames, lives, speed-ups). Each has a bot. |
| `board.js` | Board mode: the loop, dice, coins and stars, shop and secret items, duel spaces. |
| `net.js` | Transport: WebSocket relay, or BroadcastChannel when there's no relay. |
| `server.mjs` | Static server plus room relay (a hand-rolled WebSocket, no deps). |
| `fonts/` | Knewave (title, command words) and League Gothic (labels), The League of Moveable Type, SIL OFL 1.1 (`fonts/OFL.txt`). |
| `gfx.js`, `qr.js`, `sfx.js` | Canvas helpers and the blob renderer, a QR encoder, and synthesised SFX. |

## Adding a minigame

Export `{ id, title, kind, blurb, controls, min, max, create(ctx) }` from
`games/<id>.js` and add it to `GAMES` in `tv.js`. `create` returns
`{ describe(), start(), input(pid, msg), bot(pid, dt), update(dt), draw(g), result }`.
Call `ctx.layout(pid, {kind: "button" | "dpad" | "sling" | "wait", …})` to
choose each phone's controls. Set `result` to `{ ranking: [[pid…]…] }` or
`{ winners, losers }` when the game is over.
