# Jellybrawl — a Mario Party × Jackbox party game

The TV is the shared screen, and every player's phone is the controller: a
web page, with nothing to install. A session is a run of short minigames. Some
are **free-for-all** (everyone flaps on one screen), some are **team** games
(2v2 slingshot siege) and some are **asymmetric** (one chomper against three
hunters). An optional Mario Party-style board strings them together.

This spec records the decisions made in the kickoff interview (2026-09-23),
and splits the work into a **vertical slice** (built now, in
`ideas/jellybrawl/`) and **follow-ups**.

## Decisions

| Topic | Decision |
| --- | --- |
| Goal | A playable prototype to find out whether it's fun with friends. |
| TV platform | A web page for now, on a laptop over HDMI or AirPlayed to an Apple TV. tvOS has no web view, so native tvOS is a later port (see *Path to Apple TV*). |
| Networking | Both: a local Wi-Fi relay (Node, zero deps) by default, and a cloud relay later. The relay protocol is the same either way. |
| Joining | QR code on the TV, a short URL plus a 4-letter room code, and an App Clip later for the native version. |
| Players | 2–8 players, plus an **audience** beyond 8. |
| Bots | Optional: the host adds them in the lobby. A bot also covers for a disconnected player. |
| Structure | Both modes: **Playlist** (minigames with a scoreboard) and **Board** (Mario Party). |
| Session length | Set by the host: number of rounds or turns. |
| Board | Keep it simple: one loop with coin, red, duel, shop and star spaces. |
| Board mechanics | Items and a shop, secret info on your phone, duel spaces, end-of-game bonus stars. |
| Minigame choice | **Loser picks**: last place chooses on their phone from 3 eligible games. |
| Teams / roles | **Rotate roles**: whoever has been "the one" least often is next. |
| Minigame length | It varies by game (about 30 s to 2 min). |
| Controls | All kinds allowed: big buttons, stick/d-pad, drag/swipe and tilt (iOS needs a permission tap). |
| Phone role | Mixed: usually a controller, but some games put private info on the phone. |
| Audience | Bet on minigame winners, and send emoji reactions that float up on the TV. |
| Latency | Measure first: the lobby shows each phone's round-trip time. |
| Art | Programmer art for now, with one shared cast. |
| Cast | **Jelly blobs** in each player's colour, with the player's selfie as the face. Everything is drawn in code, and squash and stretch come free. |
| Customisation | A **selfie** at join. Anyone who skips it **draws** a face instead. Later, some games ask for a fresh selfie ("make your scariest face!"). |
| TV control | Both: the VIP phone (first to join) and the keyboard / Siri Remote. |
| Disconnects | Auto-rejoin (same tab, same seat), and a bot plays for you in the meantime. |
| Audio | Synthesised SFX on the TV (WebAudio) and phone haptics (`navigator.vibrate`, which Android supports and iOS Safari ignores). |
| Ending | A podium with awards, per-player stats, and a rematch button. |
| Hosting | Local relay first, then a free cloud host. |
| Name | **Jellybrawl** (working title). |

## The cast: jelly blobs

Every player is a round blob in their colour. The face is a circular crop of
their selfie (or their doodle) on the front of the body. The same blob
becomes each game's piece, so nothing needs new art:

- **Flap Frenzy**: the blob with little wings.
- **Chomp Chase**: the chomper is a blob with a mouth wedge, and the hunters
  are blobs with a wavy skirt.
- **Sling Siege**: the ammo is your blob, and the forts' "kings" are the
  other team's blobs wearing crowns.

Squash and stretch come from velocity (`scaleX = 1 + k·|v|`, with the area
kept). The selfie is sent as a 128×128 JPEG data URL, about 6 KB.

## Minigames

| Game | Kind | Players | Controls | Win |
| --- | --- | --- | --- | --- |
| **Flap Frenzy** | Free-for-all | 1–8 | one big button | last blob flying (placements by elimination order) |
| **Sling Siege** | Teams (even split) | 2–8 | drag back and release | pop every enemy king first; after the shot limit, the team with more kings left wins |
| **Chomp Chase** | 1 vs rest | 2–5 | d-pad / swipe | chomper: clear the dots or survive 60 s. Hunters: catch it 3 times. |
| Mash Race | Free-for-all | 2–8 | mash one button | first to the finish |
| Reaction Tap | Free-for-all | 2–8 | one button | fastest tap after "GO"; tapping early costs you the round |
| Hot Potato | Free-for-all | 3–8 | tap a player to pass | whoever holds the bomb when it pops is out |
| Tilt Maze | Free-for-all | 1–8 | tilt | first to the goal |

The first three are in the slice. The four party classics are follow-ups
(they're small, and they test the button, tilt and "phone shows a list"
controls).

Scoring in Playlist mode: free-for-all placements pay 10 / 6 / 4 / 2 / 1 points.
Team and asymmetric winners get 10 each and losers 2. In Board mode the same
payouts are coins.

## Architecture

```
 phones (index.html)  ⇄  relay (server.mjs, /ws)  ⇄  TV (tv.html)
                          or BroadcastChannel (same browser)
```

- **The TV is authoritative.** It runs all the game logic. Phones send
  intents (`btn`, `dir`, `aim`, `fire`, `tilt`) and render whatever
  **layout** the TV sends them (`wait`, `button`, `dpad`, `sling`, `lobby`,
  `choose`, …). A phone is a thin client, so a new minigame never touches
  the controller code unless it needs a new kind of control.
- **Relay** (`server.mjs`): zero dependencies. It serves the folder and relays
  JSON over WebSocket, per room. The same protocol works on a cloud host.
  A player reconnecting with the same `pid` replaces their old socket, and the
  TV sees a `join` for a seat it knows, which is how rejoin works.
- **Local mode** (`BroadcastChannel`): used when there's no relay, e.g. on
  GitHub Pages. Controllers are other tabs in the same browser, which is
  enough to try everything alone.
- **Latency probe**: the TV pings each phone every 2 s, and the lobby shows
  the RTT. It's the input for deciding how twitchy a game can be.
- **Bots** implement the same intent interface as phones, so a game can't
  tell a bot from a person. A disconnected seat is driven by its game's bot
  until the phone rejoins.

## Path to Apple TV

tvOS has no WKWebView, so the TV page can't simply be wrapped. The options,
in order of effort:

1. **AirPlay a browser tab** (Mac or iPad → Apple TV). Works today, with a
   little added latency on the TV side.
2. **Native shell plus JavaScriptCore.** JavaScriptCore *is* available on
   tvOS. Run the same game logic (the minigame modules are plain JS) in a
   `JSContext` and render its draw calls with SpriteKit or Metal. The phones
   keep using the web controller, and the TV app talks to the cloud relay
   with `URLSessionWebSocketTask`.
3. **Full native rewrite** in Swift/SpriteKit, once the designs are proven.

Joining on the native build: the QR code opens the controller URL, and an
**App Clip** can take the same URL for a smoother experience on iPhone. The
Siri Remote drives menus through the focus engine, and the VIP phone mirrors
them.

## Vertical slice (this PR)

- The relay server (local Wi-Fi) and BroadcastChannel fallback. A room code,
  a join URL and a **QR code** on the TV.
- A phone join flow: code, name, **selfie**, with **draw a face** as the
  fallback, then auto-rejoin on reload.
- A lobby with blob avatars, RTT per player, **Add bot**, and a round count
  (3 / 5 / 8) that the VIP or the keyboard sets.
- **Playlist mode**: **loser picks** from 3 eligible games on their phone
  (random on the first round), an intro card with controls, the minigame,
  then results and the scoreboard.
- **Flap Frenzy**, **Sling Siege** and **Chomp Chase**, each with a bot.
  Chomp rotates the chomper role.
- Synthesised SFX on the TV and haptics on phones.
- The end screen: a podium, awards (most flaps, sharpshooter, best chomper,
  …) and a **rematch** button.

## Follow-ups

1. Board mode: a loop board, dice on phones, coin, red, duel and star
   spaces, a shop, items kept secret on phones, bonus stars.
2. Party classics: Mash Race, Reaction Tap, Hot Potato, Tilt Maze (with the
   iOS motion permission).
3. Audience: seats past 8 (and anyone who opts in) get bets and emoji
   reactions.
4. Selfie prompts before some games.
5. A cloud relay deployment (Fly.io / Render / Cloudflare Durable Objects),
   and a `?relay=` param to point at it.
6. A tvOS shell (option 2 above) and an App Clip.
