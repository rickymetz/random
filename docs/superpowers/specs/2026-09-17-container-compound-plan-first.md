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
256 sq ft check). A modifier or long-press breaks a single unit out.

**Adding** is a drag out of the `+` drawer onto the sheet: the unit snaps and
shows its gap dimensions in flight, exactly as moving an existing one does.
`findSpot()` auto-placement is retired.

**Violations are drawn where they happen**, not just described in text. Hatch
the 1–9 ft gaps that need rated walls, outline a butted cluster that exceeds
the 256 sq ft permit exemption, mark a wet unit stranded outside the
utility-core radius. The existing text in the info sheet stays as the
explanation of what the redline means. Redlines are export-stripped along
with the rest of the editing chrome.

**Zoom reveals detail.** Past a zoom threshold the sheet starts drawing each
unit at floor-plan fidelity — the furniture labels, dimension strings and red
egress arrows that `planSVG()` draws at 22 px/ft — so zooming from site to
unit is continuous rather than hitting a wall of empty rectangles at 6×
(48 px/ft). The per-unit floor plan modal survives as the clean, printable
single-unit sheet.

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

This is the largest consequence in this spec, because it moves scenery out of
source and into state:

- `serialize()` goes to `v: 2`, carrying trees and the drive alongside items.
- `loadFrom()` accepts both. A `v: 1` payload — every share link already in
  the wild, and every browser's saved `container-compound-v1` — must still
  load, falling back to the default scenery.
- The 3D drive and trees get rebuilt from state rather than constructed once
  at startup.
- Scenery edits join the undo stack and the share link.

## Assumptions

Stated here rather than asked, and cheap to reverse:

- Selection persists across Plan ↔ 3D, so switching tabs keeps you on the
  same unit.
- The existing info sheet and its compliance text are reused as-is in Plan;
  this rework does not redesign them.
- Compose's 3D drag/rotate/duplicate/delete code is removed rather than left
  dormant behind a flag.
- Exports stay PNG and SVG of the sheet; 3D gets no screenshot export.
