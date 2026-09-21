# Container Compound — plan-first rework

The composer in `ideas/container-compound/` was built with its modes the
wrong way round. Editing lives in the 3D view, and the top-down site plan —
the drawing that actually shows distances, gaps and alignment — is read-only
output. This spec inverts that: **the plan sheet becomes the editor, and 3D
becomes the viewer**, with the dollhouse cutaway demoted from a mode of its
own to a toggle inside 3D.

## Where it stands today

Three tabs in `#tabbar`:

- **Compose** — the 3D scene, and the only place anything can be changed.
  Drag a unit across the ground plane, rotate 90°, duplicate, delete, add
  from the `+` drawer (which auto-places at the first free spot near the
  centre), undo/redo. Selecting a unit lifts its roof and fades its walls,
  and opens a tool strip plus an info sheet carrying the VRC separation and
  utility-core warnings.
- **Dollhouse** — the same 3D scene with every roof lifted and every wall
  faded, view-only; a tap goes straight to the info sheet.
- **Site plan** — an SVG drawn as a printed architectural sheet: paper with a
  drop shadow, a 10 ft grid heavier every 50, the one-acre property line in
  dash-dot, the gravel drive, tree canopies, utility-core radius rings, trench
  runs to each wet unit, and every unit in wall poché with its furniture, door
  swings and glazed apertures. Figma-style pan and pinch/wheel zoom to 6×,
  and PNG/SVG export. Nothing on it can be touched.

Unit geometry, furniture and code notes come from `data.js`; state is
`{ v: 1, items: [[typeId, x, z, rot], …] }` in `localStorage` and in the
base64 share link.

## Target arrangement

Two tabs: **Plan** and **3D**. The app opens on Plan, because that is where
the work happens; 3D is where you go to look at what you built. The parts
list stays where it is, behind the stats pill, reachable from both.

### Plan — the editor

The sheet keeps its drafted look at all times. Editing chrome — selection
halos, snap guides, in-flight ghosts, dimension strings — sits on top of the
drawing in a distinct redline colour, and is stripped from PNG and SVG export.
There is no separate "working canvas" appearance to switch into.

Gestures are Figma-style: press on a unit and drag moves it, press on empty
paper and drag pans the sheet, wheel or pinch zooms. No armed tool to
remember. The existing pan/zoom handler on `#site-panel` grows a hit test
against unit bounds on `pointerdown` to decide which of the two a drag is.

Editing is drafting-grade — everything Compose does today, plus what top-down
makes possible and 3D never did well:

- **Snap to edges and butt-joins.** Units snap flush to a neighbour's face,
  which is the move the 256 sq ft rule and the rated-wall rule both turn on.
- **Alignment guides** against other units and the drive.
- **Live gap dimensions** while dragging, so the 1–9 ft rated-wall problem
  shows up as you approach it rather than after you drop.

Rotation stays in 90° increments — free rotation and numeric coordinate entry
are deliberately out. Undo/redo carries over and now covers every plan edit.

**Butted units move as one.** Dragging any member of a joined cluster moves
the whole group, which is how the code already treats them (`joined`, the
256 sq ft check). Holding Alt or Shift at the start of a drag, or pressing and
holding for 450 ms, breaks a single unit out of its cluster.

**Adding** is a drag out of the `+` drawer onto the sheet: the unit snaps and
shows its gap dimensions in flight, exactly as moving an existing one does. A
plain click on a drawer row still works, but it no longer drops the unit at
the first free spot mid-acre — `findSpot()` now takes an origin, so a click
places near the middle of the current view and a duplicate lands beside the
unit it was copied from.

**Violations are drawn where they happen**, not just described in text. Hatch
the 1–9 ft gaps that need rated walls, outline a butted cluster that exceeds
the 256 sq ft permit exemption, mark a wet unit stranded outside the
utility-core radius. The existing text in the info sheet stays as the
explanation of what the redline means.

These findings are **not** editing chrome, and they export. That reverses what
this spec originally said. A mobile review put the case plainly: the redlines
are the answer to the permit question, and the exported sheet is how they get
read — so an export that carried a bare red line, a `5′ △`, and a legend
promising an explanation whose siblings had been stripped was worse than
useless. Only the live editing marks — selection halo, snap guides, in-flight
ghosts, drag dimensions — are chrome, and only those are stripped.

**Zoom reveals detail.** Past 2× the sheet starts drawing each unit at
floor-plan fidelity — the furniture labels, finished-interior line, dimension
string and red egress arrows that `planSVG()` draws at 22 px/ft — so zooming
from site to unit is continuous rather than hitting a wall of empty rectangles
at 6× (48 px/ft). At that fidelity the room name moves off the footprint so it
stops covering the furniture labels. The per-unit floor plan modal survives as
the clean, printable single-unit sheet.

Zooming resizes the SVG rather than CSS-scaling it. Scaling the layer makes
the browser stretch a rasterised bitmap, which turns the small drafting text
to mush exactly when you have zoomed in to read it; giving the SVG its real
width and height re-renders the vectors. Panning stays a cheap translate, and
export normalises the sheet back to its own scale.

### 3D — the viewer

Orbit, sun cycle, recentre, and a **dollhouse toggle**. Tapping a unit still
selects it and opens the info sheet and its floor plan, so 3D remains useful
for "what is that, and does it comply" — but nothing can be moved, rotated,
added or deleted there. The tool strip, the `+` FAB and the edge tools do not
appear in 3D.

The dollhouse toggle, on, lifts every roof and fades every wall, as Dollhouse
mode does today. Off, containers are solid — but selecting a single unit still
peeks that one, which is the behaviour Compose has now. Both readings survive;
the `mode === "dollhouse" || it === selected` test in the animate loop becomes
`dollhouseOn || it === selected`.

## Editable site context

The gravel drive and the trees become editable — they are currently fixed
scenery (`TREES`, a hardcoded array; the drive, two meshes pinned at
`(52, 56)` and `(52, 10)`). The parcel itself stays a fixed Virginia acre.

Both are dragged directly on the sheet. A tree is cleared with a double-tap
and the drive rotates in 90° steps with one; neither joins the unit selection
model, so the info sheet and tool strip stay about units. A tree is added from
its own row in the `+` drawer, the same drag-out gesture as a unit.

This is the largest consequence in this spec, because it moves scenery out of
source and into state:

- `serialize()` goes to `v: 2`, carrying trees and the drive alongside items.
- `loadFrom()` accepts both. A `v: 1` payload — every share link already in
  the wild, and every browser's saved `container-compound-v1` — must still
  load, falling back to the default scenery.
- The 3D drive and trees get rebuilt from state rather than constructed once
  at startup.
- Scenery edits join the undo stack and the share link.

## What the mobile review changed

The rework above was designed and validated on a desktop viewport. A six-way
review on a 390×844 phone found nine blockers, most of which existed only at
phone width. The ones that reshaped the design:

- **Annotation is sized in screen pixels, not sheet units.** The sheet is
  drawn at 8 px/ft and its type was authored so the fitted view lands near 1:1
  — which it does at a desktop fit of about 1.5, and does not at a phone fit of
  0.379, where every label rendered between 3.2 and 5.3 px. Labels, rules and
  dashes now divide by the current zoom, so footprints scale and the writing on
  them does not. Exports re-emit at 1:1 rather than cloning the screen, so the
  drawing no longer depends on how far you happened to be pinched in.
- **The fit has a floor and measures the real chrome.** It reserved two magic
  numbers (118 top, 34 bottom) against 116 px of actual bottom chrome, running
  the drawing under buttons where it could not be pressed. It now measures what
  is on screen and never shrinks below 0.5, letting the compound overflow and
  be panned instead of shrinking it to fit an acre of empty grass.
- **The detail tier is relative to the fit**, with hysteresis. As an absolute
  2.0 it was one pinch away on a desktop and five on a phone.
- **The 3D scene only renders on the 3D tab.** Its loop was unconditional, so
  the tab the app opens on was running 501 draw calls and 27 ms of main-thread
  work per frame behind an opaque sheet. That was not only battery: it starved
  the main thread badly enough that the 380 ms double-tap window — the only
  route to clearing a tree or rotating the drive — became unreachable.
- **Findings export; chrome does not** (above).
- **Moving a unit no longer requires a drag.** Arrow keys nudge, and the Move
  button — which until the review was a permanently-highlighted control with no
  event listener at all — arms a tap-to-place.
- **Clusters announce themselves.** The only cluster outline was a >256 sq ft
  violation marker, so a legal butted pair moved as a group with nothing on
  screen to predict it.

## What the second review changed

A six-way review of the finished thing — an architect who permits container
builds in Virginia, a desktop creative-tools designer, a typographer, a product
designer, a senior engineer and an adversarial QA pass — found six blockers.
The substantive changes:

**The compliance model was confidently wrong in three places.** `gapBetween`
returned 0 both for two units touching and for one sitting inside another, so
two containers could occupy the same ground and be priced, counted and
labelled "2 JOINED · MOVE TOGETHER" with no finding — and snapping pulled you
into it. There is now a signed overlap test, the editor refuses the move, and a
loaded layout that contains one is redlined. The 256 sq ft permit exemption was
applied by area alone, but Virginia exempts detached accessory structures
"used as tool and storage sheds, playhouses and similar uses" — habitable space
gets no size exemption at any area, so a bedroom butted to its bath read as
exempt at 240 sq ft. The exemption is now a function of `accessory` use in
`data.js`, and the app states the permit position per unit and per compound.
And the property line, drawn in surveyor's dash-dot, was checked nowhere; a
unit crossing it is now a finding. The aperture-blocking rule was enforced on
every edit path but not on `loadFrom`, so a shared link could carry an illegal
butt silently — it is now drawn and counted like any other finding.

**The state model could not survive being interrupted.** `loadFrom` minted
fresh ids, so any mid-gesture restore orphaned the drag and left a selection
whose Delete deleted nothing while popping an unrelated undo entry — and the
"hold the selection by id" fix written in the mobile round could never have
worked. Ids now restart from 1 with each load, gestures are aborted before the
model is replaced, and one `tryEdit` runs every rejectable change: legality is
tested *before* the history stacks are touched, because pushing undo clears the
redo branch and every rejected action was silently destroying a redo the user
could still see.

**A malformed payload bricked the app permanently.** Rows were destructured
blind and the type guard was a plain-object lookup, so `toString` passed it;
because the boot was a bare statement, a throw meant the resize listener and
the render loop never attached, and the blank result reloaded blank forever.
There is now a `normalize()` at the untrusted boundary — coordinates coerced
and clamped to the sheet, rotations wrapped, unknown types dropped, counts
capped — and the boot catches, clears the bad payload and falls back.

**Receiving a share link destroyed the visitor's own compound**, because
`loadFrom` wrote to the single save slot unconditionally. A hash-loaded layout
is now visitor state: shown, not adopted, until you edit it or press Save a
copy. The hash is re-encoded on save so the address bar stops advertising the
sender's original, and a `hashchange` listener makes pasting a link into an
open tab work.

**The mobile hardening had cost desktop.** At >=900px the details card and the
zoom column both docked right, and the card won, so opening details made zoom,
fit — and, through a phone-only rule, rotate, duplicate and delete —
unreachable. The tool-strip hide is now scoped to phones and the columns share
one gutter. The plan also ignored window resizing entirely, the one event that
only happens on a desktop.

Smaller, from the same pass: the add button steps aside instead of vanishing
after every add; the shipped example no longer lands in violation with a
driveway through a building; `clusterOf` reuses the union-find the compliance
pass already ran, instead of flood-filling once per member; the export no
longer leaves the screen in a different detail tier; findings read as sentences
and units are pluralised; labels too wide for their unit set along it rather
than across it; and the copy branches on pointer type instead of telling a
desktop user to pinch.

### Known and deferred

Worth recording rather than discovering again: the sheet still does not rotate
for portrait; there is no numeric coordinate entry, no multi-select and no
snap-suppress modifier; the type scale is still ad hoc and the unit tints
composite to near-identical off-whites; the code redline and the utility trench
are within half a luminance point in greyscale; the title block remains
export-only, so the colour legend is not readable on screen; the 3D view's roof
pops rather than fades, the dollhouse cutaway drops every unit shadow, and the
three sun states do not change the sky; there is still one anonymous save slot;
and `main.js` is one ~2600-line module whose render path is steered by several
coupled flags.

## Assumptions

Stated here rather than asked, and cheap to reverse:

- Selection persists across Plan ↔ 3D, so switching tabs keeps you on the
  same unit, and dragging a unit selects it.
- The existing info sheet and its compliance text are reused as-is in Plan;
  this rework does not redesign them.
- Compose's 3D drag/rotate/duplicate/delete code is removed rather than left
  dormant behind a flag.
- Exports stay PNG and SVG of the sheet; 3D gets no screenshot export.
