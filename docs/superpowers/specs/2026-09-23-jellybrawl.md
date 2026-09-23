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
| Art | **WarioWare energy, Hotline Miami 2 / Nidhogg 2 grit** (follow-up decisions): neon on near-black, CRT post-processing, goo splats, command-word slams, bomb timers. |
| Cast | **Jelly blobs** in each player's colour, with the player's selfie as the face. Everything is drawn in code, and squash and stretch come free. |
| Customisation | A **selfie** at join. Anyone who skips it **draws** a face instead. Later, some games ask for a fresh selfie ("make your scariest face!"). |
| TV control | Both: the VIP phone (first to join) and the keyboard / Siri Remote. |
| Disconnects | Auto-rejoin (same tab, same seat), and a bot plays for you in the meantime. |
| Audio | Synthesised SFX on the TV (WebAudio) and phone haptics (`navigator.vibrate`, which Android supports and iOS Safari ignores). |
| Ending | A podium with awards, per-player stats, and a rematch button. |
| Hosting | Local relay first, then a free cloud host. |
| Name | **Jellybrawl** (working title). |

## Style: WarioWare energy, Hotline Miami 2 grit

WarioWare's pace and shouting, pushed through a Hotline Miami 2 / Nidhogg 2
filter: neon, dirty and a bit violent (the violence is jelly).

- **Command words.** Every minigame is announced with a one-word imperative
  (`FLAP!`, `LAUNCH!`, `CHOMP!`). It slams in (overshoot, settle, jitter)
  on the TV and on every phone at once.
- **Bomb timers.** Every countdown is a bomb with a burning fuse.
- **Palette.** Neon on near-black: `#ff2a6d #05d9e8 #f9f002 #39ff14 #b026ff
  #ff6b00` over `#0d0221`. Scene backgrounds are slow-turning dark sunbursts
  whose hue drifts over time, over a synthwave perspective grid.
- **Type** ("P1 · Punk brush", picked from six open-foundry pairings shown
  in the real UI): **Knewave** (a heavy brush face) for the neon title (hot
  pink, glow, occasional flicker) and for every shouted word (command words,
  headings), in white with a hard pink shadow. **League Gothic**, tracked-out
  condensed caps, is used for labels, name tags and UI (cyan for secondary
  labels). Body copy stays in the system sans. Both faces come from The
  League of Moveable Type (SIL OFL 1.1, `fonts/OFL.txt`); no multi-coloured
  lettering. Panels are dirty paper with a hard pink shadow.
- **CRT pass** (`post()` in `tv.js`): the scene is drawn at 1920×1080, then
  dropped to half resolution and scaled back up without smoothing (chunky
  pixels). Red and cyan channel copies are screened on offset (chromatic
  aberration), and the camera sways slowly. Scanlines, a vignette and
  animated grain go on top.
- **Goo.** Deaths, catches and impacts leave glossy jelly splats (with drips
  and droplets) in the victim's colour that stay for the rest of the game,
  Nidhogg-style.
- **Impact.** Screen shake scales with the hit, big hits freeze the game for
  90 ms (hit-stop), and scene changes use a striped wipe.
- **Copy.** Mean: "No bones. No mercy.", "Your friends are the enemy
  tonight.", "SPLATTERED", "DEAD KING".

Helpers live in `gfx.js` (`T` type settings, `neon`, `outlined`, `shout`, `sunburst`, `grid`, `panel`,
`bomb`, `makeSplat`/`drawSplat`, `fit`). The phone CSS mirrors them with
scanlines, the same two fonts and neon hard shadows.

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
| **Sniper Plaza** | 1 vs rest | 2–8 | runners: stick + BLEND; sniper: trackpad + FIRE | runners: steal the loot target or survive 75 s; sniper: hit every runner |
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

## Sniper Plaza

A hide-in-the-crowd sniper game, decided in a short Q&A on 2026-09-23.

- **Crowd blend.** Runners wear their own colour with a plain face (no
  selfie). They mix with about 12 AI wanderers per runner (capped near 45),
  dealt evenly across the runners' colours, so each runner has a dozen or
  so lookalikes. The sniper knows Ana is pink, but there are a dozen pink
  blobs. The sniper's colour is left out of the crowd, since any blob in it
  would be a known NPC. NPCs walk
  to random spots, pause, and do small emote bounces.
- **Solid blobs.** Blobs can't overlap or pass behind one another. Overlapping
  pairs are pushed apart and bounce (restitution 0.7) into a knockback that
  fades quickly, with a squash wobble on impact. At walking pace the crowd
  just jostles, but a runner barrelling through visibly shoves blobs aside,
  which is a tell. A bumped NPC sometimes picks a new destination, so
  crowds don't grind against each other.
- **Finding yourself.** Your phone shows a private radar with only your dot
  (and the coins). The sniper can't see it.
- **Runners.** A thumbstick (top speed equals the fastest NPC, so speed
  isn't a tell) and **BLEND**, the same emote the crowd does, with a 1.5 s
  cooldown.
- **Loot.** Up to 3 coins at a time pop up around the plaza. Only runners
  can pick them up, so greed gives you away. It's a team target (3 + 2 per
  runner), and the top thief gets +3 points if the runners win.
- **Sniper.** Drags a phone trackpad to move a magnifying scope (1.6× inside
  a 120 px circle, with the rest of the plaza dimmed) and taps **FIRE**.
  Reload is 1.5 s. Hitting an innocent means a 4 s reload and a 3 s
  **PANIC** in which the crowd scatters at runner speed, giving runners
  cover.
- **Winning.** Runners win on the loot target or by anyone surviving 75 s.
  The sniper wins by hitting every runner. Points are the usual 10 / 2, the
  role rotates like the chomper, and there are awards: Deadeye and Master
  thief.
- **Bots.** A bot sniper only suspects whoever is standing nearest a grab
  it happened to notice (grabs near its scope are noticed more often), so it
  can be fooled. Bot runners wander like NPCs and sneak toward nearby coins.

## Microgame Gauntlet (second mode)

Chosen in the lobby (VIP **Mode** button, or **G**), next to Playlist.
Everyone plays the same microgame at once. The flow is a command slam
(0.85 s), then play (3–4 s on a burning-fuse bomb), then judging (✓/✗ over
each blob, lives drop), then the next microgame. Every 5 microgames there's
a **SPEED UP!** (+18%: shorter timers, faster needles, more taps needed).
Everyone has **3 lives**; a player who runs out is OUT, and their phone
says so. Last blob standing wins. Placements follow elimination order and
pay the usual 10 / 6 / 4 / 2 / 1, so the podium, awards ("Microgame
machine") and rematch work unchanged. There's a cap of 60 microgames.

| Microgame | Phone | Pass |
| --- | --- | --- |
| MASH! | button | reach the tap target (scales with speed) |
| DON'T TAP! | a tempting "TAP ME" button | don't |
| WAIT FOR IT… | button (WAIT… → NOW!) | tap after the light turns green; early is a fail |
| SWIPE! | d-pad / swipe | match the arrow |
| MATCH! | 4 colour pads (shuffled per phone) | tap the colour on the TV |
| COUNT! | 4 number pads | count the wobbling blobs |
| STOP! | button | stop the needle in the green zone |
| HOLD IT! | button | press within the first ~half, and never let go |
| FLOAT! | button (flap) | stay between the spikes and the lava |

Each microgame is a small object in `games/gauntlet.js` (`setup`,
`layout`, `input`, `update`, `draw`, `judge`, `bot`), so adding one doesn't
touch the runner. Every microgame has a bot, so bots and dropped phones can
play.

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
