/**
 * Where a circle's name may sit (§4.6): somewhere touching its own
 * bubble, and nowhere else.
 *
 * The old placer tried the top corners, then below, then climbed a line
 * at a time up to seven lines away. A name that far off reads as the
 * label of whatever it lands beside — on the sample cast MERIDIAN LABS
 * settled next to Grace Liu, who isn't in it, and on a phone one bubble
 * got no name at all. These anchors all lie on the bubble's rim, so a
 * name chosen from them is attached by construction; there are enough
 * of them round the whole outline that a free one is nearly always
 * there.
 */

export interface Pt {
  x: number
  y: number
}

/** An anchor on the rim and the outward direction a name hangs from it. */
export interface RimAnchor extends Pt {
  ux: number
  uy: number
}

/** Distance from `p` to a convex hull (0 inside it). */
export function distanceToHull(p: Pt, hull: Pt[]): number {
  if (hull.length === 0) return Infinity
  if (hull.length === 1) return Math.hypot(p.x - hull[0].x, p.y - hull[0].y)
  if (hull.length >= 3 && insideConvex(p, hull)) return 0
  let best = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    best = Math.min(best, distanceToSegment(p, a, b))
    if (hull.length === 2) break
  }
  return best
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Inside a convex polygon, whichever way round its points run. */
function insideConvex(p: Pt, hull: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Points just outside the bubble whose outline is `pad` from the hull,
 * `gap` further out, in the order a name should try them: over the top
 * first (the familiar place), then down the sides, then underneath; the
 * nearer the top of the bubble, the earlier.
 */
export function rimAnchors(hull: Pt[], pad: number, gap: number, steps = 16): RimAnchor[] {
  const out: RimAnchor[] = []
  const r = pad + gap
  for (const v of hull) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      const p = { x: v.x + ux * r, y: v.y + uy * r }
      // Only the part of this ring that is the bubble's own outer edge:
      // anything nearer another member is inside the bubble.
      if (distanceToHull(p, hull) < r - 1e-6 * r - 0.5) continue
      out.push({ ...p, ux, uy })
    }
  }
  const band = (a: RimAnchor) => (a.uy <= -0.6 ? 0 : a.uy >= 0.6 ? 2 : 1)
  return out.sort((a, b) => band(a) - band(b) || a.y - b.y)
}
