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
| **Sniper Blackout** | 1 vs rest | 2–8 | runners: stick + mini-map; sniper: trackpad + FIRE | same as Sniper Plaza, in the dark with cover |
| **Infection** | 1 vs rest, flipping | 3–8 | stick + DASH | touched blobs turn; last clean blob (or anyone clean at 45 s) wins |
| **Kaiju** | 1 vs rest | 2–8 | kaiju: stick + STOMP; city: stick + DASH | city: knock out the kaiju's HP with cannons; kaiju: squash everyone or outlast 60 s |
| Mash Race | Free-for-all | 2–8 | mash one button | first to the finish |
| Reaction Tap | Free-for-all | 2–8 | one button | fastest tap after "GO"; tapping early costs you the round |
| **Blob Soccer** | Teams (2v2–4v4) | 2–8 | stick + KICK | first to 3 goals, or most goals in 90 s; a draw goes to golden-goal overtime |
| **Sumo Ring** | Free-for-all | 2–8 | stick + BUMP | last blob on the shrinking ring |
| **Bumper Blobs** | Free-for-all | 2–8 | stick + BOOST | 3 lives in a spiked pen; last blob with lives (or most lives at 60 s) |
| **Coin Rush** | Free-for-all | 2–8 | stick + DASH | most coins after 45 s; spike rollers and dashes knock coins loose |
| **Hot Potato** | Free-for-all | 3–8 | stick + DASH | bump to pass the bomb (no instant pass-backs); holder is out when the secret fuse pops |
| **Paint the Town** | Teams (2v2–4v4) | 2–8 | stick + SPLAT | most floor painted after 60 s; SPLAT bursts paint and stuns rivals it hits |
| **Capture the Crown** | Teams (2v2–4v4) | 2–8 | stick + DASH | 25 s of crown-time, or the most at 75 s; the carrier is slower, can't dash, and loses it to a hard bump |
| **Jelly Dodgeball** | Teams (2v2–4v4) | 2–8 | stick + THROW | two lives each, halves of the court; last team standing, or players then lives at 75 s |
| **Snake Pit** | Free-for-all | 2–8 | stick + BOOST | tails grow when you eat; bonk a wall or a tail and you're out; last snake, or the longest at 60 s |
| **Tug of Jelly** | Teams (2v2–4v4) | 2–8 | mash PULL | drag the other team into the goo pit; taps during HEAVE! count triple; ahead at 40 s wins |
| **Relay Race** | Teams (2v2–4v4) | 2–8 | stick + JUMP | four legs in your lane (hurdles, goo, bumpers); the baton passes on at the flag; first team home |
| **Tower Stack** | Teams (2v2–4v4) | 2–8 | DROP (turns rotate) | overhang is sliced off; tallest tower at 45 s or first to 16 |
| **Bomb Squad** | Teams (2v2–4v4) | 2–8 | defuser: wires / keypad / button; the rest: the manual | defuse three modules first; three strikes and it blows |
| **Tilt Maze** | Free-for-all | 1–8 | tilt (stick fallback) | first three to the goal place; the rest rank by distance |
| **Draw Duel** | Free-for-all | 3–8 | draw, then vote | same prompt for all; anonymous gallery; most votes |
| **Haunted House** | 1 vs rest | 3–8 | hunters: stick (beam follows); ghost: stick + VANISH, private map | hunters drain the invisible ghost with flashlight beams; the ghost spooks everyone or lasts 60 s |
| **Whack-a-Blob** | 1 vs rest | 2–8 | pads: pop up / DUCK; hammer: tap a hole | moles bank a shared gem goal in 45 s; the hammer bonks them |
| **Kraken** | 1 vs rest | 2–8 | rowers: stick (raft follows the average); kraken: aim + SLAM | three buoys then the dock; slams sink the raft |
| **Tank vs Swarm** | 2 vs rest | 2–8 | driver: stick + SHAKE; gunner: aim + FIRE; swarm: stick + DASH | the tank lasts 50 s; the swarm gnaws through its armour |
| **King of the Hill Giant** | Free-for-all | 2–8 | stick + SHOVE | the longest on the hill becomes a slow giant and scores; most seconds as king |
| **Blind Pilot** | Teams (2v2–4v4) | 2–8 | pilot: stick; navigators: private track map | the TV only shows headlights; first car round the lap |
| **Greed Doors** | Free-for-all | 2–8 | pick a door (pads) | 5 rounds of secret picks; a safe door's prize is split among its pickers; the bomb door halves your gems |

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

## Sniper Blackout (Sniper Plaza variant)

The same engine as Sniper Plaza (`makeSniper` in `games/snipe.js`), with
these differences. The second round of details came from a Q&A on
2026-09-23.

- **Players only.** No NPC crowd. Everyone is their real blob (colour and
  selfie).
- **Blackout.** The TV shows the scope (a 210 px lens at 1.35×) and, in the
  dark around it, only:
  - a **faint outline of the cover**, so the room can follow the chase, and
  - **noise ripples**: rings spreading from bush rustles (green), coin grabs
    (yellow), sprints (cyan), runner-on-runner bumps (pink) and a crate
    breaking (orange).

  Loot "+1" pops only show inside the scope.
- **Cover.** Each round places about 9 crates and 7 bushes at random.
  - *Crates* are solid: blobs slide off them, and a crate in front of a blob
    hides it and stops the shot ("THUNK!", a bullet hole). A crate
    **breaks after 2 hits** ("SMASH!"), so cover wears away, and the
    runners' maps update.
  - *Bushes* can be walked into. They hide part of whoever is inside, but
    rustle when anything moves in them, and they don't stop bullets.
- **Sniper: 2 flares** a round. A flare lights the whole plaza for 1 s,
  then fades back to dark (FLARE button next to FIRE, with a counter on the
  TV). Runners' phones buzz when one goes up.
- **Runners: SPRINT.** 2× speed for 1 s, then a 4 s cooldown, and every
  sprint leaves a trail of ripples.
- **Mini-map** (runner's phone): the crates and bushes (updated when a crate
  breaks), coins, your own dot, the live scope circle, and a red ✗ for each
  recent shot, fading over 2.5 s.
- **Loot target** is 2 + 2 per runner.
- **Bots.**
  - The blackout bot sniper only reacts to runners it can see: inside its
    scope or lit by a flare, not behind a crate, and in a bush only when it
    rustles. It chases fresh ripples and uses its flares when it's lost.
  - Bot runners sprint away and head for a crate when the scope closes in.
- **Rules check.** A headless Node check drives the game directly (20
  checks): crate/bush/open-ground shots, crates breaking on the second
  hit, the flare count and duration, sprint speed, cooldown and noise, and
  bush rustle ripples.

## Board mode (third mode)

Picked in the lobby (Mode cycles Playlist → Board → Gauntlet). It's set to
3 / 5 / 8 turns and played on one of three themed maps: the VIP's
**Board** button or **M** picks Neon City, Slime Sewers, Volcano Isle or
Random. Logic is in `board.js`; the maps are in `boards.js`.

**Maps are graphs with forks.** Each space is a node with one or two
`next`s. When you pass a fork, your phone asks which way, labelling each
path with its distance to the star (15 s, then it auto-picks; bots mostly
head for the star and avoid tolls they can't afford). The TV pulses arrows
and labels at the fork.

| Map | Layout | Gimmick |
| --- | --- | --- |
| **Neon City** | a stadium loop and a straight shortcut across the middle | the shortcut starts with a **TOLL** space: 6 coins every time you pass it |
| **Slime Sewers** | a figure-8: two loops meeting at a junction (West or East tunnel each lap) | a **pipe** on each loop warps you to the other |
| **Volcano Isle** | an island loop, a 5-space crater path through the volcano (vs 12 round the island) and an 11-space beach detour | the crater is lined with red spaces and has a **▲ volcano**: land on it and every rival pays you 3 |

**Spaces** (all maps):
- blue +3, red −3
- shop, duel (VS)
- **?** events: +6 coins, −5, a tailwind that hops you 3 more, or a mystery
  item
- plus each map's toll, pipe or volcano

**Everything else is unchanged:**
- The star costs 20 and is bought on passing, then moves to a random plain
  blue space.
- The shop sells Double dice, Warp and Pickpocket (secret items).
- Duels are one gauntlet microgame for up to 10 coins.
- After each turn there's a minigame whose points pay out as coins.
- Most stars wins, with coins as the tiebreak.

The HUD is now a top bar (turn and map, whose go, dice, standings), which
leaves the middle of the screen free for paths.

**Board art** (`boardart.js`):
- Spaces are chunky extruded tiles with drawn icons: a coin, a hazard bar,
  a money sack, crossed swords, a purple ?, a striped toll barrier, a pipe
  mouth and a mini volcano.
- Roads are smooth Catmull-Rom curves in each map's style: neon-kerbed
  asphalt with a dashed centre line (City), slatted steel walkways over a
  slime glow (Sewers) and a pebbled sand trail (Volcano).
- Scenery is seeded, so it's the same every game, and kept off the roads:
  - City: rooftops with AC units, water towers and neon signs.
  - Sewers: flagstones, moss, grates, bolted pipes and glowing slime pools.
  - Volcano: surf, sand and grass, a shaded cone with lava rivers, palms
    and rocks.
- The static layer is painted once into a cached canvas. Only the animation
  redraws each frame: flickering neon and searchlights, rippling and
  bubbling slime with drips, and shoreline foam, lava glow, smoke and
  embers.
- Tokens cast shadows, and the moving player gets a glowing ring.

**Tests.** A Node rules check (22 checks):
- every map is connected, on screen, has no overlapping spaces, and labels
  every branch;
- forks prompt the phone, and the toll charges;
- pipes warp;
- the volcano pays out, and the crater really is the shortcut;
- shop, star and the minigame hand-off still work.

## Infection and Kaiju (asymmetric additions)

**Infection** (`games/tag.js`):
- Patient zero starts in the middle, among pillars to juke around.
- A real touch (overlap, not a graze) infects you. Infected blobs turn
  near-black with a toxic-green glow and a ☣ tag, a look no player colour
  shares.
- Speeds: patient zero 238, clean 230, the newly infected 205, so the horde
  is slower than its leader. Everyone gets DASH (2.4× for 0.28 s, 2.5 s
  cooldown).
- Ranking: survivors first, then the infected, latest-turned first. Patient
  zero gets +2 coins/points per tag. Award: Patient zero.

**Kaiju** (`games/kaiju.js`):
- A giant blob in a neon city walks through buildings, flattening them.
- STOMP has a 0.7 s windup that roots the kaiju and shows a red ring, then
  squashes everyone in the ring. It has a 1.6 s cooldown.
- The city charges 4 cannon pads by standing on them (faster with more blobs
  on a pad). A full pad fires at the kaiju for 1 HP.
- HP is 1 + 1.5 per city blob, and charge time grows slightly with the
  city's size, so bigger lobbies don't swamp it.
- Awards: Stomper, Artillery and Wrecking ball.

**Balance.** A headless simulation (25 all-bot rounds each at 3, 5 and 8
players):
- Kaiju wins 72% / 52% / 44% of rounds, down from a 80%-to-0% swing before
  tuning.
- Bot Infection rounds last 13–26 s. The rules favour the horde, and human
  dodging should stretch them; a real playtest should decide.

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
| TAP EXACTLY N! | button | exactly N taps (your count stays hidden until judging) |
| BIGGER! | swipe | swipe toward the bigger number |
| SIMON SAYS! | swipe | repeat the flashed arrow sequence (3, or 4 when fast) |
| DODGE! | swipe | shift into the one safe spot before the rocks drop |
| PUMP IT! | button | fill the leaking balloon into the green band; overfill pops it |
| MATH! | 4 number pads | tap the answer |
| ODD ONE OUT! | 4 pads | pick the blob with a different colour |
| ON THE BEAT! | button | hit at least 3 of 4 beats (±0.22 s), at most 1 stray tap |
| SWIPE THE WORD! | swipe | follow the word, not the arrow |
| REMEMBER! | 4 colour pads | recall the colour that flashed, then hid |
| GREEN LIGHT! | button | 5 taps on green; a tap on red fails, except in a 0.35 s grace just after it turns |
| **BOSS: MEGA SIMON!** | swipe | 6 arrows, 9 s |
| **BOSS: MEGA MASH!** | button | a big tap target over 6 s |

That's 20 microgames plus 2 bosses. Every 10th microgame is a boss: a
longer slam ("BOSS STAGE"), harder, and clearing it wins back a lost life
(award: Boss slayer). A headless Node check runs every microgame with bots
at normal and top speed, so each one runs, judges cleanly, and has a sane
bot pass rate (it caught GREEN LIGHT! being unwinnable without the grace
window).

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


1. Board mode extras: bonus stars, more maps, and map-specific events
   (e.g. a timed volcano eruption).
2. The rest of the team / free-for-all pack (see below).
3. Audience: seats past 8 (and anyone who opts in) get bets and emoji
   reactions.
4. Selfie prompts before some games.
5. A cloud relay deployment (Fly.io / Render / Cloudflare Durable Objects),
   and a `?relay=` param to point at it.
6. A tvOS shell (option 2 above) and an App Clip.

## Team and free-for-all pack

A shared top-down engine (`games/arena.js`) drives these: bodies with
acceleration and friction, a dash, bouncy mass-weighted collisions, walls or a
round arena, and helpers for bot steering, drawing, stick layouts and results.
Team games split players into Pink and Cyan (2v2, 3v3, 4v4) and fill an odd
count with a ghost bot that never appears in the results.

Batch 1 (built): Blob Soccer, Sumo Ring, Bumper Blobs, Coin Rush, Hot Potato.
Headless all-bot sims (12 rounds at 2/4/5/8 players) check that every round
finishes and ghosts never place. Soccer bots aim at a moving spot in the goal
mouth (identical aims deadlocked 1v1s), keep one keeper and push the rest up.
Before those changes most rounds ended 0–0; now nearly all get a winner.

Batch 2 (built): Paint the Town, Capture the Crown, Jelly Dodgeball, Snake Pit
and Tug of Jelly. Dodgeball needed the most tuning: with one life and full
aim-lead it was over in 10 s; two lives, slower throws, half the lead and a
lives tie-break give 40–75 s rounds that mostly end with a winner.

Batch 3 (built) added three phone layouts: `tilt` (DeviceOrientation, with
the iOS permission tap, re-levelling, and a thumbstick fallback), `draw` (a
square canvas that streams finished strokes, normalised to 0–1, to the TV)
and `bomb` (manual pages plus the defuser's wires, keypad or hold button).
`pads` gained `multi`, `cols` and per-pad label colours.

- **Relay Race**: both lanes share one mirrored course. The runner rotates
  each leg (1v1 runs all four). Bots fluff about one hurdle in eight.
- **Tower Stack**: turns rotate within the team. The swing speeds up with
  height. A clean miss costs 1.6 s.
- **Bomb Squad**: modules are wires (3–5, KTANE-style rules keyed on count,
  colours and serial parity), a keypad (four of six symbol columns, where
  exactly one column holds all four), and a button (tap or hold; on a hold,
  release on the strip colour's digit). The defuser rotates per module. The
  manual is split between the human teammates who aren't defusing; with
  nobody to read to, the defuser gets all of it.
- **Tilt Maze**: a recursive-backtracker maze with extra loops. Holes sit
  only in straight corridors, pushed to one side, never next to each other
  or on a checkpoint. Blobs pass through each other. Bot testing found
  three traps: holes on corners, back-to-back holes on opposite sides, and
  a crowd shoving each other in at a respawn.
- **Draw Duel**: a secret prompt, 45 s to draw with a live TV gallery, 20 s
  to vote (you can't vote for yourself), then the reveal. Bots doodle a
  face and a few scribbles.

## Asymmetric pack

Picked from a multiple-choice round: Haunted House, Whack-a-Blob, Kraken
(1 vs rest), Blind Pilot (hidden info), Tank vs Swarm and King of the Hill
Giant (lopsided teams). The lone role rotates through the existing
`pickOne()`, which picks whoever has played a lone role least this game.

- The radar now draws walls, thick "road" lines, coloured dots and a target
  ring. There's a new `nav` layout (a big private map, no stick) for Blind
  Pilot's navigators. The ghost's map reuses the stick layout's radar.
- **Haunted House**: the TV is dark except the flashlight cones (the lit
  room is redrawn inside a clip of the cones). Tells: the ghost drips
  glowing ectoplasm, and a hunter shivers (their phone buzzes) when it's
  within 260 px. A spook takes 0.7 s of contact, plus 1.2 s ÷ hunters.
- **Whack-a-Blob**: all phone pads. The hammer lands 0.42 s after the tap
  with a closing ring. The gem goal per mole was tuned by bot play (crowds
  are harder to bonk).
- **Kraken**: the raft follows the average of every rower's stick. Two
  tentacles, a 1.1 s shadow warning, and a hit only inside the ring.
- **Tank vs Swarm**: the crew is two from 4 players up; below that, one
  driver with an auto-aiming turret that fires faster, and a little extra
  armour. Bot swarmers pad the swarm to 6 and never score. SHAKE flings
  the hangers-on and leaves them dizzy.
- **King of the Hill Giant**: whoever has been on the hill longest (at
  least 1 s) is crowned. "Alone on the hill" deadlocked when everyone
  rushed it. The giant grows to 2.3× size with more mass and less speed.
- **Blind Pilot**: a loop of 10 waypoints. Off the road is mud (38%
  speed). A pilot with no human navigator gets the map on their own phone.

Balance: a scratch `boss.mjs` plays 24–40 all-bot rounds per player count
and reports the lone role's win rate. It exposed frame-rate-dependent bot
rolls (switched to rate × dt) and one-sided openings: the Kraken won 100%,
the ghost 100% against one hunter, the swarm ~95%. All are now roughly
20–65% across counts, which is about as tight as bots-vs-bots gets.

## Multi-persona review and what changed

Five reviewers read the code, spec and screenshots independently: a party
host, a competitive player, a game designer, an accessibility reviewer and
a staff engineer. Their findings were fixed in seven commits, in this order.

1. **Robustness.**
   - The TV frame loop schedules itself first and catches errors. A
     crashing minigame becomes a no-score tie instead of a frozen TV.
   - Phones run one reconnect loop with backoff. It stops when the seat
     opens elsewhere or the room closes.
   - The relay caps frames at 512 KB, budgets hosting and joining per IP,
     caps the room count, and keeps a room for 60 s so the TV can reclaim
     it with a secret token.
   - Rescanning the QR code with the same name reclaims your seat.
   - Board mode sets up players who join mid-session.
2. **Exploits.**
   - Input is budgeted: a button press counts only after a release, at
     most 14 a second.
   - The stick always sends its final value.
   - Final ties break on wins, then last finish, then co-champions.
   - Timing microgames subtract half the phone's ping.
   - Draw Duel bots vote at random.
   - On the board, last place moves first and the volcano is capped.
   - The odd human's team is random, with the bot on the short side.
   - King of the Hill resets everyone's hill time on a topple.
3. **Readability.**
   - Small text and name tags are drawn sharp after the CRT pass.
   - Team blobs get team outlines and P/C badges.
   - Shake is smooth and capped, and Hot Potato's pulse stays under 3 Hz.
   - Colour-only verdicts carry ✓/✗.
4. **Nobody idle.** Wait screens get emoji reactions. Knocked-out players
   drop goo puddles into arena games.
5. **Scoring and flow.**
   - A lone-role win pays 15 and a loss pays 5.
   - The last round is double points, and a clear leader often takes the
     lone role.
   - Results slide into standings order and call out lead changes.
   - The intro shows a role card with READY.
   - The face step can be skipped.
   - The VIP can pause, skip a game or end the night.
6. **Accessibility settings and performance.**
   - Settings: motion, CRT (full, light or off), text size, colour-blind
     shapes, brightness, and phone buzz.
   - Phone: pinch-zoom and labels.
   - Effects run on real frame time.
   - Draw Duel and Paint cache their drawing, and Snake bots think at
     10 Hz.
   - The CRT pass drops to light automatically when frames run slow.
7. **Roster.**
   - Loser-picks offers three games from three different categories
     (brawl, hunt, race, timing, brains, aim), weighted by √size, with no
     near-twins (Sumo/Bumper, Sniper/Blackout, Crown/Hill) and never the
     family just played.
   - Greed Doors is new: secret simultaneous picks, split prizes, and a
     bomb door.
   - Bomb Squad is 120 s.

Still open from the review:
- Board mode depth: bonus stars, a catch-up event, and a star-stealing
  item.
- Relay's benched teammates.
- Tug of Jelly has no decisions.
- A "Boss Rush" playlist.
- Jelly Curling.
