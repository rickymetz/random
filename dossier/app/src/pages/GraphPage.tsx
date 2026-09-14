import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import PersonPicker from '../components/PersonPicker'
import Sheet from '../components/Sheet'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { selectSelf, shortestPath } from '../lib/graphQueries'
import { CIRCLE_COLORS, colorName, type Person, type Relationship } from '../lib/models'
import { getPhotoUrl } from '../lib/photoCache'
import type { UnlockedVault } from '../lib/vault'
import {
  selectAvatar,
  selectCircles,
  selectCirclesOf,
  selectNotes,
  selectPeople,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from '../store/vaultStore'

interface GraphNode extends SimulationNodeDatum {
  id: string
  name: string
  initials: string
  /** Drawn radius — hubs are bigger (degree-scaled), like Obsidian. */
  r: number
  /** Links on the graph as drawn — ranks who stays in full at an overview. */
  degree: number
  isSelf: boolean
  avatar?: { blobRecordId: string; mimeType: string }
}

/** A circle (§4.6) with only the members currently on the graph. */
interface GraphCircle {
  id: string
  name: string
  color: string
  memberIds: string[]
  /** Members that exist at all (visible or not). */
  total: number
}

/** Pan/zoom/fit handles the React controls call into the canvas effect. */
interface ViewApi {
  zoom: (factor: number) => void
  fit: () => void
  /** Pan (and zoom to at least `minK`) so this person is centred. */
  center: (id: string, minK: number) => void
  /** Nudge the view up so this person clears a card of `bottomInset` px. */
  reveal: (id: string, bottomInset: number) => void
  isPinned: (id: string) => boolean
  unpin: (id: string) => void
  hasNode: (id: string) => boolean
  /** Frame a circle's members above a sheet of `bottomInset` px. */
  fitCircle: (circleId: string, bottomInset: number) => void
}

/** Hex → [r,g,b]. */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function hexOf([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const CANVAS_BG: [number, number, number] = rgbOf('#121110')
const mutedCache = new Map<string, string>()
/**
 * Resting edges wear a quieter version of their type colour — mixed
 * toward the app's warm neutral — so the graph reads in one register
 * with the rest of the app and gold stays the only loud thing. Every
 * muted colour still clears 3:1 on the canvas (lightened until it does).
 * Chips keep the full colour: they are the legend.
 */
function mutedColor(hex: string): string {
  const cached = mutedCache.get(hex)
  if (cached) return cached
  let rgb: [number, number, number]
  try {
    const c = rgbOf(hex)
    const n = rgbOf('#8d877c')
    rgb = [c[0] * 0.62 + n[0] * 0.38, c[1] * 0.62 + n[1] * 0.38, c[2] * 0.62 + n[2] * 0.38]
    for (let i = 0; i < 12 && contrast(rgb, CANVAS_BG) < 3; i++) {
      rgb = [rgb[0] + (255 - rgb[0]) * 0.12, rgb[1] + (255 - rgb[1]) * 0.12, rgb[2] + (255 - rgb[2]) * 0.12]
    }
  } catch {
    return hex
  }
  const out = hexOf(rgb)
  mutedCache.set(hex, out)
  return out
}
/** Circle names: the bubble's hue toned toward the caption grey. */
function tonedColor(hex: string): string {
  try {
    const c = rgbOf(hex)
    const n = rgbOf('#b5afa5')
    return hexOf([c[0] * 0.6 + n[0] * 0.4, c[1] * 0.6 + n[1] * 0.4, c[2] * 0.6 + n[2] * 0.4])
  } catch {
    return hex
  }
}

/** Filter state survives leaving and returning (per browser session). */
const FILTER_KEY = 'graph-filters'
interface Filters {
  hidden: string[]
  mentions: boolean
  hiddenCircles: string[]
}
function loadFilters(): Filters {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Filters>
      return {
        hidden: parsed.hidden ?? [],
        mentions: parsed.mentions ?? true,
        hiddenCircles: parsed.hiddenCircles ?? [],
      }
    }
  } catch {
    // Private windows may refuse; defaults are fine.
  }
  return { hidden: [], mentions: true, hiddenCircles: [] }
}
function saveFilters(hidden: Set<string>, mentions: boolean, hiddenCircles: Set<string>): void {
  try {
    sessionStorage.setItem(
      FILTER_KEY,
      JSON.stringify({ hidden: [...hidden], mentions, hiddenCircles: [...hiddenCircles] }),
    )
  } catch {
    // ignore
  }
}

/** Convex hull (monotone chain); returns points in CCW order. */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Bubble padding around member nodes, in graph units. */
const HULL_PAD = 34

function nodeRadius(degree: number): number {
  return Math.min(NODE_R * 1.6, NODE_R * (0.85 + 0.25 * Math.log2(1 + degree)))
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  edgeId: string
  color: string
  /** Relationship type label — for the text list and for line style. */
  label: string
  dashed: boolean
  directed: boolean
  /** Part of the highlighted "how you connect" path (§4.4). */
  highlighted: boolean
}

type Tap =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  /** A bubble tap: the light card (name, count, focus). */
  | { kind: 'circle'; id: string }
  /** The full editor (chip ✎, or Edit on the light card). */
  | { kind: 'circle-edit'; id: string }
  | null

const NODE_R = 14
// Degradation ladder (§4.3): labels thin out first as the graph grows.
const LABEL_MAX_NODES = 250
/** Circle chips shown inline before a “+N more” toggle. */
const CIRCLE_CHIPS_INLINE = 6

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * The relationship graph (§4.3): force-directed canvas with pan/zoom/drag,
 * relationship-type filters, mention-edge toggle, ego view via ?focus=,
 * a peek card on node tap, and edge tap-to-edit. Layout positions and the
 * viewport survive data/filter changes; keyboard: arrows pan, +/- zoom,
 * 0 resets.
 */
export default function GraphPage() {
  const records = useVaultStore((s) => s.records)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const focusParam = params.get('focus')
  const circleFocusId = params.get('circle')
  const depth = params.get('depth') === '2' ? 2 : 1
  const pathTargetId = params.get('path')
  const [peek, setPeek] = useState<Tap>(null)
  const viewApiRef = useRef<ViewApi | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [arranging, setArranging] = useState(false)
  const [showAllCircles, setShowAllCircles] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findToken, setFindToken] = useState(0)
  const openFind = useCallback(() => {
    setFinding(true)
    setFindToken((t) => t + 1)
  }, [])
  // Find lives in the app bar (a portal into its slot), not the filter
  // strip: it's navigation, the strip is the legend. Ctrl/Cmd+K opens it,
  // as it focuses search on People.
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setBarSlot(document.getElementById('appbar-slot'))
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      e.preventDefault()
      openFind()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openFind])
  // Pins change inside the canvas hook; a counter re-renders the open card.
  const [pinVersion, setPinVersion] = useState(0)
  const onPinChange = useCallback(() => setPinVersion((v) => v + 1), [])
  // The one-time gesture hint: gone for good after the first touch, and
  // the big-graph note goes when this visit's first gesture lands.
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem('graph-hint-seen') === '1'
    } catch {
      return true
    }
  })
  const [gestured, setGestured] = useState(false)
  const onGesture = useCallback(() => {
    setGestured(true)
    setHintSeen(true)
    try {
      localStorage.setItem('graph-hint-seen', '1')
    } catch {
      // Private windows may refuse; the hint just shows again next time.
    }
  }, [])

  // Graceful degradation (§4.3): past the label limit a fit-all view is
  // an unreadable hairball, so a big vault opens on your own connections
  // instead. "Show everyone" (?all=1) is one tap away.
  const self = useMemo(() => selectSelf(records), [records])
  const peopleCount = useMemo(() => selectPeople(records).length, [records])
  const bigGraph = peopleCount > LABEL_MAX_NODES
  const showAll = params.get('all') === '1'
  // Applied synchronously (not only via the URL) so the first layout is
  // the small ego graph, never a 300-node simulation that then gets
  // thrown away — and so the ego view fits itself like any cold start.
  const autoFocusId =
    bigGraph && !showAll && !focusParam && !circleFocusId && !pathTargetId
      ? (self?.id ?? null)
      : null
  const focusId = focusParam ?? autoFocusId
  // "Edit circle" from the People banner lands on the circle's card.
  const editParam = params.get('edit') === '1'
  useEffect(() => {
    if (!editParam || !circleFocusId) return
    setPeek({ kind: 'circle-edit', id: circleFocusId })
    const next = new URLSearchParams(params)
    next.delete('edit')
    setParams(next, { replace: true })
  }, [editParam, circleFocusId, params, setParams])
  useEffect(() => {
    if (!autoFocusId) return
    const next = new URLSearchParams(params)
    next.set('focus', autoFocusId)
    setParams(next, { replace: true })
  }, [autoFocusId, params, setParams])

  const types = useMemo(
    () => selectRelationshipTypes(records).sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(loadFilters().hidden),
  )
  const [showMentions, setShowMentions] = useState(() => loadFilters().mentions)
  const [hiddenCircles, setHiddenCircles] = useState<Set<string>>(
    () => new Set(loadFilters().hiddenCircles),
  )
  useEffect(() => {
    saveFilters(hiddenTypes, showMentions, hiddenCircles)
  }, [hiddenTypes, showMentions, hiddenCircles])
  const allCircles = useMemo(() => selectCircles(records), [records])
  const focusedCircle = useMemo(
    () => (circleFocusId ? allCircles.find((c) => c.id === circleFocusId) : undefined),
    [allCircles, circleFocusId],
  )

  // "Show on graph" from a dossier's how-you-connect section (§4.4).
  const pathInfo = useMemo(() => {
    if (!pathTargetId) return null
    const self = selectSelf(records)
    if (!self) return { edgeIds: new Set<string>(), names: [], nodeIds: [], reason: 'no-self' as const }
    const steps = shortestPath(records, self.id, pathTargetId)
    if (!steps) return { edgeIds: new Set<string>(), names: [], nodeIds: [], reason: 'no-path' as const }
    return {
      edgeIds: new Set(steps.filter((s) => s.via).map((s) => s.via!.id)),
      names: steps.map((s) => (s.person.isSelf ? 'You' : s.person.displayName)),
      nodeIds: steps.map((s) => s.person.id),
      reason: 'ok' as const,
    }
  }, [records, pathTargetId])

  const clearParam = useCallback(
    (name: string) => {
      const next = new URLSearchParams(params)
      next.delete(name)
      setParams(next)
    },
    [params, setParams],
  )

  const { nodes, links, circles } = useMemo(() => {
    const typeById = new Map(types.map((t) => [t.id, t]))
    const people = selectPeople(records)
    let edges = selectRelationships(records).filter((e) => {
      // Path edges bypass filters — hiding part of a highlighted chain
      // while its breadcrumb chip stays up would be a lie.
      if (pathInfo?.edgeIds.has(e.id)) return true
      if (hiddenTypes.has(e.typeId)) return false
      if (!showMentions && e.origin === 'mention') return false
      return true
    })

    let visiblePeople = people
    if (focusedCircle) {
      // Circle focus: just the members and the edges among them.
      visiblePeople = people.filter((p) => focusedCircle.memberIds.includes(p.id))
    } else if (focusId) {
      // Local graph (§4.3): the focused person plus everyone within
      // `depth` hops, drawn as the induced subgraph — edges *among*
      // neighbours stay, which is how you spot that his parents are
      // married to each other.
      const keep = new Set([focusId])
      let frontier = [focusId]
      for (let hop = 0; hop < depth; hop++) {
        const next: string[] = []
        for (const e of edges) {
          if (frontier.includes(e.fromId) && !keep.has(e.toId)) {
            keep.add(e.toId)
            next.push(e.toId)
          }
          if (frontier.includes(e.toId) && !keep.has(e.fromId)) {
            keep.add(e.fromId)
            next.push(e.fromId)
          }
        }
        frontier = next
      }
      visiblePeople = people.filter((p) => keep.has(p.id))
    }

    const ids = new Set(visiblePeople.map((p) => p.id))
    const visibleEdges = edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    const degree = new Map<string, number>()
    for (const e of visibleEdges) {
      degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1)
      degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1)
    }
    const nodes: GraphNode[] = visiblePeople.map((p) => {
      const avatar = selectAvatar(records, p.id)
      return {
        id: p.id,
        name: p.displayName,
        initials: initialsOf(p.displayName),
        r: nodeRadius(degree.get(p.id) ?? 0),
        degree: degree.get(p.id) ?? 0,
        isSelf: Boolean(p.isSelf),
        avatar: avatar
          ? { blobRecordId: avatar.blobRecordId, mimeType: avatar.mimeType }
          : undefined,
      }
    })
    const links: GraphLink[] = visibleEdges
      .map((e) => ({
        edgeId: e.id,
        source: e.fromId,
        target: e.toId,
        color: typeById.get(e.typeId)?.color ?? '#8a8a94',
        label: typeById.get(e.typeId)?.label ?? 'linked',
        dashed: e.origin === 'mention',
        directed: (typeById.get(e.typeId)?.directed ?? false) && e.origin === 'explicit',
        highlighted: pathInfo?.edgeIds.has(e.id) ?? false,
      }))
    // In circle focus only that circle draws (never another circle's
    // remnant around a shared member); elsewhere a circle whose members
    // are mostly off-graph doesn't draw a lonely disc either.
    const circles: GraphCircle[] = allCircles
      .filter((c) => (focusedCircle ? c.id === focusedCircle.id : !hiddenCircles.has(c.id)))
      .map((c) => {
        const total = c.memberIds.filter((id) => records.has(id)).length
        const visible = c.memberIds.filter((id) => ids.has(id))
        return { id: c.id, name: c.name, color: c.color, memberIds: visible, total }
      })
      .filter((c) => c.memberIds.length >= Math.min(2, c.total) && c.memberIds.length > 0)
    return { nodes, links, circles }
  }, [
    records,
    types,
    hiddenTypes,
    showMentions,
    focusId,
    focusedCircle,
    depth,
    pathInfo,
    allCircles,
    hiddenCircles,
  ])

  // In an ego view only circles with someone on screen get a chip; a
  // rail of twenty absent circles ahead of the link types was eleven
  // screens wide on a phone.
  const railCircles = useMemo(() => {
    if (!focusId) return allCircles
    const visible = new Set(nodes.map((n) => n.id))
    return allCircles.filter((c) => c.memberIds.some((id) => visible.has(id)))
  }, [allCircles, focusId, nodes])

  // A graph with no links and no circles is two dots and a legend about
  // dotted lines: show the "how to start" copy instead of the rail.
  const bare = !focusedCircle && !focusId && links.length === 0 && circles.length === 0

  const focusName = useMemo(() => {
    if (!focusId) return undefined
    const p = records.get(focusId)
    if (p?.kind !== 'person') return undefined
    return p.isSelf ? 'Your' : `${p.displayName}’s`
  }, [records, focusId])

  const vault = useVaultStore((s) => s.vault)
  const onTap = useCallback((tap: Tap) => setPeek(tap), [])
  const onOpen = useCallback((id: string) => navigate(`/person/${id}`), [navigate])
  const pathNodeIds = pathInfo?.reason === 'ok' ? pathInfo.nodeIds : null
  // A different view (ego ↔ all, 1 ↔ 2 hops, a circle) re-fits the camera.
  const viewKey = `${focusId ?? ''}|${depth}|${circleFocusId ?? ''}|${showAll ? 1 : 0}`
  const canvasRef = useCanvasGraph(
    nodes,
    links,
    circles,
    focusId,
    circleFocusId,
    onTap,
    onOpen,
    vault,
    pathNodeIds,
    viewApiRef,
    setArranging,
    peek,
    viewKey,
    onPinChange,
    onGesture,
  )
  // A card at the bottom must not cover the person it describes, and the
  // circle editor's sheet must not cover the bubble it edits.
  useLayoutEffect(() => {
    if (peek?.kind === 'node') {
      const card = wrapRef.current?.querySelector<HTMLElement>('.peek-card')
      viewApiRef.current?.reveal(peek.id, (card?.offsetHeight ?? 150) + 16)
    } else if (peek?.kind === 'circle-edit') {
      const canvas = wrapRef.current?.querySelector('canvas')?.getBoundingClientRect()
      const sheet = document.querySelector('.sheet.circle-sheet')?.getBoundingClientRect()
      if (!canvas || !sheet) return
      viewApiRef.current?.fitCircle(peek.id, Math.max(0, canvas.bottom - sheet.top) + 12)
    }
  }, [peek])
  const hiddenCount =
    types.filter((t) => t.label !== 'mentioned' && hiddenTypes.has(t.id)).length +
    (showMentions ? 0 : 1) +
    railCircles.filter((c) => hiddenCircles.has(c.id)).length
  const showAllFilters = () => {
    setHiddenTypes(new Set())
    setShowMentions(true)
    setHiddenCircles(new Set())
  }
  const allPeople = useMemo(() => selectPeople(records), [records])
  const hasSelfNode = nodes.some((n) => n.isSelf)
  const selfId = self?.id
  const findPerson = (id: string) => {
    setFinding(false)
    if (!id) return
    const api = viewApiRef.current
    if (api?.hasNode(id)) {
      setPeek({ kind: 'node', id })
      api.center(id, 1.2)
    } else {
      // Filtered out, or beyond this ego view: open their world instead.
      setParams({ focus: id })
      setPeek({ kind: 'node', id })
    }
  }
  const removeCircle = useVaultStore((s) => s.removeCircle)
  const clearCircleParam = () => {
    const next = new URLSearchParams(params)
    next.delete('circle')
    setParams(next)
  }

  const setDepth = (d: 1 | 2) => {
    const next = new URLSearchParams(params)
    if (d === 2) next.set('depth', '2')
    else next.delete('depth')
    setParams(next)
  }

  return (
    <div className={`graph ${bare ? 'bare' : ''}`}>
      <h1 className="sr-only">Graph</h1>
      {barSlot &&
        !bare &&
        createPortal(
          <button
            className={`subtle icon find-button ${finding ? 'on' : ''}`}
            aria-label="Find a person on the graph"
            aria-expanded={finding}
            aria-controls="graph-find"
            aria-keyshortcuts="Control+K Meta+K"
            title="Find (Ctrl/Cmd+K)"
            onClick={() => (finding ? setFinding(false) : openFind())}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </button>,
          barSlot,
        )}
      {finding && (
        <div
          id="graph-find"
          className="graph-find"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setFinding(false)
          }}
        >
          <PersonPicker
            people={allPeople}
            value=""
            onChange={findPerson}
            label="Find a person on the graph"
            placeholder="Type a name…"
            focusToken={findToken}
          />
          <button className="subtle icon" onClick={() => setFinding(false)} aria-label="Close">
            ×
          </button>
        </div>
      )}
      <div className="graph-controls">
        {focusName && (
          <span className="chip focus-chip no-dot depth">
            {focusName} connections
            <button
              aria-pressed={depth === 1}
              onClick={() => setDepth(1)}
              title="People they know"
            >
              1 hop
            </button>
            <button
              aria-pressed={depth === 2}
              onClick={() => setDepth(2)}
              title="…and who those people know"
            >
              2 hops
            </button>
            <button
              className="subtle"
              onClick={() => {
                const next = new URLSearchParams(params)
                next.delete('focus')
                next.delete('depth')
                if (bigGraph) next.set('all', '1')
                setParams(next)
              }}
              aria-label={bigGraph ? `All ${peopleCount} — show everyone` : 'Show everyone'}
              title={bigGraph ? `Show everyone (${peopleCount})` : 'Show everyone'}
            >
              {bigGraph ? `All ${peopleCount}` : '×'}
            </button>
          </span>
        )}
        {focusedCircle && (
          <span
            className="chip focus-chip"
            style={{ '--chip-color': focusedCircle.color } as React.CSSProperties}
          >
            Only {focusedCircle.name}
            <button className="subtle" onClick={clearCircleParam} aria-label="Show everyone">
              ×
            </button>
          </span>
        )}
        {pathInfo && (
          <span className="chip focus-chip no-dot">
            {pathInfo.reason === 'ok'
              ? pathInfo.names.join(' → ')
              : pathInfo.reason === 'no-self'
                ? 'mark yourself first: Edit → “This is me”'
                : 'no known path'}
            <button
              className="subtle"
              onClick={() => clearParam('path')}
              aria-label="Clear path"
            >
              ×
            </button>
          </span>
        )}
        {hiddenCount > 0 && (
          <button className="chip no-dot hidden-status" onClick={showAllFilters}>
            {hiddenCount} hidden · Show all
          </button>
        )}
        {railCircles.length > 0 && !focusedCircle && (
          <span className="chip-group" role="group" aria-label="Circles">
            <span className="chip-group-label" aria-hidden="true">
              Circles
            </span>
            {(showAllCircles ? railCircles : railCircles.slice(0, CIRCLE_CHIPS_INLINE)).map((c) => {
              const n = c.memberIds.length
              const on = !hiddenCircles.has(c.id)
              return (
                <span
                  key={c.id}
                  className={`chip-group ${on ? '' : 'off'}`}
                  style={{ '--chip-color': c.color } as React.CSSProperties}
                >
                  {/* Two real buttons side by side (never one inside the
                      other): toggle, and the keyboard/AT path to the card —
                      the only path for an empty circle, which draws no bubble. */}
                  <button
                    type="button"
                    className={`chip circle-filter ${on ? '' : 'off'}`}
                    aria-pressed={on}
                    aria-label={`${c.name} circle, ${n} ${n === 1 ? 'person' : 'people'} — ${on ? 'shown' : 'hidden'}`}
                    onClick={() =>
                      setHiddenCircles((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }
                  >
                    <span className="name">{c.name}</span>
                  </button>
                  <button
                    type="button"
                    className="chip-edit"
                    onClick={() => setPeek({ kind: 'circle-edit', id: c.id })}
                    aria-label={`Edit ${c.name}`}
                    title="Edit circle"
                  >
                    ✎
                  </button>
                </span>
              )
            })}
            {railCircles.length > CIRCLE_CHIPS_INLINE && (
              <button
                className="chip no-dot more"
                aria-expanded={showAllCircles}
                onClick={() => setShowAllCircles((v) => !v)}
              >
                {showAllCircles ? 'fewer' : `+${railCircles.length - CIRCLE_CHIPS_INLINE} more`}
              </button>
            )}
          </span>
        )}
        {types
          .filter((t) => t.label !== 'mentioned')
          .map((t) => (
            <button
              key={t.id}
              className={`chip ${hiddenTypes.has(t.id) ? 'off' : ''}`}
              style={{ '--chip-color': t.color } as React.CSSProperties}
              aria-pressed={!hiddenTypes.has(t.id)}
              onClick={() =>
                setHiddenTypes((prev) => {
                  const next = new Set(prev)
                  if (next.has(t.id)) next.delete(t.id)
                  else next.add(t.id)
                  return next
                })
              }
            >
              {t.label}
            </button>
          ))}
        <button
          className={`chip ${showMentions ? '' : 'off'}`}
          aria-pressed={showMentions}
          onClick={() => setShowMentions((v) => !v)}
        >
          mentions
        </button>
      </div>
      {/* Read to assistive tech via aria-describedby; sighted users get
          a one-time hint on the canvas instead of a permanent sentence. */}
      <p id="graph-help" className="graph-legend sr-only">
        {nodes.length > LABEL_MAX_NODES
          ? 'Zoomed out, only the best-connected people draw in full: zoom in to see names and everyone else, or pick a person or circle above.'
          : 'Tap a person to see who they know, and again to open them. Tap a label to filter. Dotted lines are mentions.'}
      </p>
      <div className="graph-canvas-wrap" ref={wrapRef}>
        {arranging && nodes.length > 150 && (
          <p className="graph-status" role="status">
            Arranging {nodes.length} people…
          </p>
        )}
        {!arranging && nodes.length > 0 && !bare && (
          nodes.length > LABEL_MAX_NODES ? (
            !gestured && (
              <p className="graph-hint" role="status">
                Zoom in to see everyone by name
              </p>
            )
          ) : (
            !hintSeen && (
              <p className="graph-hint" role="status">
                Tap someone to see who they know
              </p>
            )
          )
        )}
        {listOpen && (
          <GraphList nodes={nodes} links={links} onClose={() => setListOpen(false)} />
        )}
        {focusedCircle && nodes.length === 0 ? (
          <div className="empty circle-empty" role="status">
            “{focusedCircle.name}” has no members yet — add people from their pages, or
            delete it.
            <div className="row wrap">
              <button className="subtle" onClick={clearCircleParam}>
                Show everyone
              </button>
              <DangerConfirm
                label="Delete circle"
                question={`Delete “${focusedCircle.name}”? The people stay.`}
                onConfirm={() => {
                  void removeCircle(focusedCircle.id)
                  clearCircleParam()
                }}
              />
            </div>
          </div>
        ) : focusParam && records.get(focusParam)?.kind !== 'person' ? (
          <p className="empty">
            That person is no longer here.{' '}
            <button className="subtle" onClick={() => clearParam('focus')}>
              Show everyone
            </button>
          </p>
        ) : bare ? (
          <p className="empty">
            No relationships yet. Add one from a person’s page, or load the sample people
            in <Link to="/settings">Settings</Link>.
          </p>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="graph-canvas"
              tabIndex={0}
              role="application"
              aria-describedby="graph-help"
              aria-label={`Relationship graph: ${nodes.length} people, ${links.length} connections, ${circles.length} circles. Arrow keys pan, plus and minus zoom, 0 fits everyone. The list button has the same people and links as text.`}
            />
            <div className="graph-view-controls" role="group" aria-label="View">
              <button className="fine-only" onClick={() => viewApiRef.current?.zoom(1.25)} aria-label="Zoom in">
                +
              </button>
              <button className="fine-only" onClick={() => viewApiRef.current?.zoom(1 / 1.25)} aria-label="Zoom out">
                −
              </button>
              {hasSelfNode && selfId && (
                <button onClick={() => viewApiRef.current?.center(selfId, 1)} aria-label="Centre on me">
                  ◎
                </button>
              )}
              <button onClick={() => viewApiRef.current?.fit()} aria-label="Fit everyone in view">
                ⤢
              </button>
              <button
                onClick={() => setListOpen((v) => !v)}
                aria-label="See as list"
                aria-expanded={listOpen}
                aria-controls="graph-list"
              >
                ☰
              </button>
            </div>
          </>
        )}
        {peek?.kind === 'node' && (
            <NodePeek
              key={`${peek.id}:${pinVersion}`}
              personId={peek.id}
              pinned={viewApiRef.current?.isPinned(peek.id) ?? false}
              onUnpin={() => viewApiRef.current?.unpin(peek.id)}
              onClose={() => setPeek(null)}
              onOpen={() => navigate(`/person/${peek.id}`)}
              onFocus={() => {
                setParams({ focus: peek.id })
                setPeek(null)
              }}
              onPath={() => {
                setParams({ path: peek.id })
                setPeek(null)
              }}
            />
          )}
          {peek?.kind === 'edge' && (
            <EdgePeek key={peek.id} edgeId={peek.id} onClose={() => setPeek(null)} />
          )}
          {peek?.kind === 'circle' && (
            <CircleLite
              key={peek.id}
              circleId={peek.id}
              focused={circleFocusId === peek.id}
              onClose={() => setPeek(null)}
              onEdit={() => setPeek({ kind: 'circle-edit', id: peek.id })}
              onFocus={() => {
                setParams({ circle: peek.id })
                setPeek(null)
              }}
              onUnfocus={() => {
                clearCircleParam()
                setPeek(null)
              }}
            />
          )}
          {peek?.kind === 'circle-edit' && (
            <CirclePeek
              key={peek.id}
              circleId={peek.id}
              focused={circleFocusId === peek.id}
              onClose={() => setPeek(null)}
              onFocus={() => {
                setParams({ circle: peek.id })
                setPeek(null)
              }}
              onUnfocus={() => {
                clearCircleParam()
                setPeek(null)
              }}
              onDeleted={() => {
                if (circleFocusId === peek.id) clearCircleParam()
                setPeek(null)
              }}
            />
          )}
      </div>
    </div>
  )
}

/**
 * Peek cards open from canvas taps with no natural focus target: move
 * focus into the card so it's announced and Escape closes it, then hand
 * focus back to the canvas.
 */
function usePeekFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const opener = document.activeElement
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])
  return ref
}

/** Everyone shown and who they're linked to — the text twin of the
 * canvas (2.1.1 / 1.1.1), as an overlay so it costs the canvas nothing. */
function GraphList({
  nodes,
  links,
  onClose,
}: {
  nodes: GraphNode[]
  links: GraphLink[]
  onClose: () => void
}) {
  const ref = usePeekFocus(onClose)
  return (
    <div
      id="graph-list"
      ref={ref}
      tabIndex={-1}
      className="graph-list"
      role="dialog"
      aria-label={`People on the graph (${nodes.length})`}
    >
      <div className="graph-list-head">
        <strong>
          {nodes.length} {nodes.length === 1 ? 'person' : 'people'}
        </strong>
        <button className="subtle icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <ul>
        {nodes.map((n) => {
          const mine = links.filter((l) => l.source === n.id || l.target === n.id)
          return (
            <li key={n.id}>
              <Link to={`/person/${n.id}`}>{n.isSelf ? `${n.name} (you)` : n.name}</Link>
              {mine.length > 0 && (
                <span className="hint">
                  {' — '}
                  {mine
                    .map((l) => {
                      const otherId = l.source === n.id ? l.target : l.source
                      const other = nodes.find((o) => o.id === otherId)
                      return `${other?.name ?? '?'} (${l.dashed ? 'mentioned' : l.label})`
                    })
                    .join(', ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A destructive action asks in place — never a browser dialog. */
function DangerConfirm({
  label,
  question,
  onConfirm,
}: {
  label: string
  question: string
  onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button className="danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm-row" role="group" aria-label={question}>
      <span className="hint">{question}</span>
      <button className="danger" onClick={onConfirm} autoFocus>
        {label}
      </button>
      <button className="subtle" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  )
}

/** Tap a node → peek card → through to the full dossier (§4.3). The card
 * answers "who is this?" the way you'd ask it: how you know them, whose
 * circles they're in, how many people they're linked to. */
function NodePeek({
  personId,
  pinned,
  onUnpin,
  onClose,
  onOpen,
  onFocus,
  onPath,
}: {
  personId: string
  pinned: boolean
  onUnpin: () => void
  onClose: () => void
  onOpen: () => void
  onFocus: () => void
  onPath: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const cardRef = usePeekFocus(onClose)
  const person = records.get(personId)
  const facts = useMemo(() => {
    if (!person || person.kind !== 'person') return null
    const self = selectSelf(records)
    const rels = selectRelationships(records)
    const mine = rels.filter((e) => e.fromId === personId || e.toId === personId)
    let howKnown: string | null = null
    let pathExists = false
    if (self && !person.isSelf) {
      const direct = mine.find((e) => e.fromId === self.id || e.toId === self.id)
      if (direct) {
        const t = records.get(direct.typeId)
        const label = t?.kind === 'relationshipType' ? t.label : 'linked'
        howKnown = direct.origin === 'mention' ? 'mentioned in your notes' : label
        pathExists = true
      } else {
        const steps = shortestPath(records, self.id, personId)
        if (steps && steps.length > 2) {
          howKnown = `${steps.length - 1} hops, via ${steps[1].person.displayName}`
          pathExists = true
        } else if (steps) pathExists = true
      }
    }
    const circles = selectCirclesOf(records, personId).map((c) => c.name)
    const notes = selectNotes(records, personId)
    const last = notes.reduce((m, n) => Math.max(m, n.createdAt), 0)
    const months = last ? Math.floor((Date.now() - last) / (30 * 86400000)) : null
    return {
      howKnown,
      pathExists,
      circles,
      links: mine.length,
      lastNote: months === null ? null : months < 1 ? 'this month' : months < 12 ? `${months} mo ago` : `${Math.floor(months / 12)} yr ago`,
    }
  }, [records, person, personId])
  if (!person || person.kind !== 'person' || !facts) return null
  const detail = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
  const meta = [
    facts.links > 0 ? `${facts.links} ${facts.links === 1 ? 'link' : 'links'}` : 'no links yet',
    facts.circles.length > 0 ? facts.circles.join(', ') : null,
    facts.lastNote ? `last note ${facts.lastNote}` : null,
  ].filter(Boolean)
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className="peek-card"
      role="dialog"
      aria-label={person.displayName}
    >
      <div className="peek-body">
        <strong>
          {person.displayName}
          {person.isSelf && <span className="you-badge">you</span>}
          {facts.howKnown && <span className="how-known">{facts.howKnown}</span>}
        </strong>
        {detail && <span className="hint">{detail}</span>}
        <span className="hint meta">{meta.join(' · ')}</span>
      </div>
      <div className="row wrap">
        <button onClick={onOpen}>Open</button>
        <button className="subtle" onClick={onFocus}>
          {person.isSelf ? 'Your connections' : 'Their connections'}
        </button>
        {facts.pathExists && !person.isSelf && (
          <button className="subtle" onClick={onPath}>
            How you connect
          </button>
        )}
        {pinned && (
          <button className="subtle" onClick={onUnpin} title="Let the layout move them again">
            Unpin
          </button>
        )}
        <button className="subtle icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  )
}

/** Tap a bubble → the light card: name, size, focus. Editing (rename,
 * colour, members, delete) sits behind Edit… and the chip's ✎. */
function CircleLite({
  circleId,
  focused,
  onClose,
  onEdit,
  onFocus,
  onUnfocus,
}: {
  circleId: string
  focused: boolean
  onClose: () => void
  onEdit: () => void
  onFocus: () => void
  onUnfocus: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const cardRef = usePeekFocus(onClose)
  const circle = records.get(circleId)
  if (!circle || circle.kind !== 'circle') return null
  const n = circle.memberIds.filter((id) => records.has(id)).length
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className="peek-card circle-lite"
      role="dialog"
      aria-label={`Circle: ${circle.name}`}
      style={{ '--chip-color': circle.color } as React.CSSProperties}
    >
      <div className="peek-body">
        <strong>
          <span className="circle-dot" aria-hidden="true" />
          {circle.name}
        </strong>
        <span className="hint">
          {n} {n === 1 ? 'person' : 'people'}
        </span>
      </div>
      <div className="row wrap">
        {focused ? (
          <button onClick={onUnfocus}>Show everyone</button>
        ) : (
          <button onClick={onFocus}>Only this circle</button>
        )}
        <button className="subtle" onClick={onEdit}>
          Edit…
        </button>
        <button className="subtle icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  )
}

/** Tap an edge → edit its type or remove it (§4.3, §4.2 upgrade-in-one-tap). */
function EdgePeek({ edgeId, onClose }: { edgeId: string; onClose: () => void }) {
  const records = useVaultStore((s) => s.records)
  const addRelationship = useVaultStore((s) => s.addRelationship)
  const removeRelationship = useVaultStore((s) => s.removeRelationship)
  const cardRef = usePeekFocus(onClose)
  const [pendingType, setPendingType] = useState('')
  const edge = records.get(edgeId)
  const types = useMemo(
    () =>
      selectRelationshipTypes(records)
        .filter((t) => t.label !== 'mentioned')
        .sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  if (!edge || edge.kind !== 'relationship') return null
  const rel = edge as Relationship
  const from = records.get(rel.fromId)
  const to = records.get(rel.toId)
  if (from?.kind !== 'person' || to?.kind !== 'person') return null
  const currentType = records.get(rel.typeId)

  const retype = async (typeId: string) => {
    if (!typeId) return
    // addRelationship replaces any mention edge between the pair, so this
    // is the one-tap upgrade path for dashed edges.
    await removeRelationship(rel.id)
    await addRelationship(rel.fromId, rel.toId, typeId)
    onClose()
  }

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className="peek-card"
      role="dialog"
      aria-label="Edit relationship"
    >
      <div className="peek-body">
        <strong>
          {from.displayName} — {to.displayName}
        </strong>
        <span className="hint">
          {currentType?.kind === 'relationshipType' ? currentType.label : 'link'}
          {rel.origin === 'mention' ? ' (from a mention)' : ''}
        </span>
      </div>
      <div className="row">
        {/* Applied via the button, never on select change: arrow-keying
            through a closed select fires change per step on Windows,
            which would rewrite the relationship just by exploring. */}
        <select
          value={pendingType}
          onChange={(e) => setPendingType(e.target.value)}
          aria-label="Change type"
        >
          <option value="">Change to…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {pendingType && (
          <button onClick={() => void retype(pendingType)}>Apply</button>
        )}
        <DangerConfirm
          label="Remove"
          question="Remove this link?"
          onConfirm={() => {
            void removeRelationship(rel.id)
            onClose()
          }}
        />
        <button className="subtle icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  )
}

/** Tap a bubble (or a chip's ✎) → rename, recolor, add/remove members,
 * focus, or delete it (§4.6). */
function CirclePeek({
  circleId,
  focused,
  onClose,
  onFocus,
  onUnfocus,
  onDeleted,
}: {
  circleId: string
  focused: boolean
  onClose: () => void
  onFocus: () => void
  onUnfocus: () => void
  onDeleted: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const updateCircle = useVaultStore((s) => s.updateCircle)
  const removeCircle = useVaultStore((s) => s.removeCircle)
  const cardRef = usePeekFocus(() => {
    // Escape/outside-tap must not throw away a rename that blur would
    // have saved: commit first, then close.
    if (dirty) void commitName()
    onClose()
  })
  const circle = records.get(circleId)
  const [name, setName] = useState(circle?.kind === 'circle' ? circle.name : '')
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  if (!circle || circle.kind !== 'circle') return null
  const members = circle.memberIds
    .map((id) => records.get(id))
    .filter((p): p is Person => p?.kind === 'person')
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  const others = selectPeople(records)
    .filter((p) => !circle.memberIds.includes(p.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  const dirty = name.trim() !== circle.name
  const commitName = async () => {
    const next = name.trim()
    if (!next || next === circle.name) {
      setName(circle.name)
      return
    }
    const result = await updateCircle({ ...circle, name: next })
    if (result === 'name-taken') {
      setStatus({ text: `A circle called “${next}” already exists.`, error: true })
    } else {
      setStatus({ text: 'Saved' })
      setTimeout(() => setStatus(null), 1800)
    }
  }
  return (
    <Sheet
      className="circle-sheet"
      label={`Circle: ${circle.name}`}
      onDismiss={() => {
        if (dirty) void commitName()
        onClose()
      }}
    >
    <div
      ref={cardRef}
      tabIndex={-1}
      className="circle-peek"
      style={{ '--chip-color': circle.color } as React.CSSProperties}
    >
      <button className="subtle icon peek-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="peek-body">
        <div className="name-row">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setStatus(null)
              }}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitName()
                }
              }}
              aria-label="Circle name"
              aria-invalid={status?.error ? true : undefined}
            />
          </label>
          {dirty && (
            <button className="primary" onClick={() => void commitName()}>
              Save
            </button>
          )}
        </div>
        <span className={`status ${status?.error ? 'error' : ''}`} role="status">
          {status?.text}
        </span>
        <span className="swatches" role="group" aria-label="Circle color">
          {CIRCLE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch ${color === circle.color ? 'selected' : ''}`}
              style={{ background: color }}
              aria-label={`Color ${colorName(color)}`}
              aria-pressed={color === circle.color}
              onClick={() => void updateCircle({ ...circle, color })}
            />
          ))}
        </span>
        <ul className="members" aria-label="Members">
          {members.map((p) => (
            <li key={p.id}>
              <Link to={`/person/${p.id}`}>{p.displayName}</Link>
              <button
                onClick={() =>
                  void updateCircle({
                    ...circle,
                    memberIds: circle.memberIds.filter((m) => m !== p.id),
                  })
                }
                aria-label={`Remove ${p.displayName} from ${circle.name}`}
              >
                ×
              </button>
            </li>
          ))}
          {members.length === 0 && others.length === 0 && <li className="hint">No one yet.</li>}
        </ul>
        {others.length > 0 && (
          <div className="add-member">
            <PersonPicker
              people={others}
              value=""
              onChange={(id) => {
                if (id) void updateCircle({ ...circle, memberIds: [...circle.memberIds, id] })
              }}
              label={`Add a person to ${circle.name}`}
              placeholder="Type a name to add…"
              pickedMessage={(p) => `${p.displayName} added to ${circle.name}`}
            />
          </div>
        )}
      </div>
      <div className="row wrap">
        {focused ? (
          <button onClick={onUnfocus}>Show everyone</button>
        ) : (
          <button onClick={onFocus}>Only this circle</button>
        )}
        <Link className="subtle-link" to={`/?circle=${circle.id}`}>
          See as list →
        </Link>
      </div>
      <div className="row peek-danger">
        <DangerConfirm
          label="Delete circle"
          question={`Delete “${circle.name}”? The people stay.`}
          onConfirm={() => {
            void removeCircle(circle.id)
            onDeleted()
          }}
        />
      </div>
    </div>
    </Sheet>
  )
}

function useCanvasGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  circles: GraphCircle[],
  focusId: string | null,
  circleFocusId: string | null,
  onTap: (tap: Tap) => void,
  onOpen: (personId: string) => void,
  vault: UnlockedVault | null,
  pathNodeIds: string[] | null,
  viewApiRef: MutableRefObject<ViewApi | null>,
  onLayout: (running: boolean) => void,
  selected: Tap,
  viewKey: string,
  onPinChange: () => void,
  onGesture: () => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // What's lit (the open card's subject) is read by the painter through a
  // ref: a selection repaints, it never restarts the layout.
  const selectedRef = useRef<Tap>(selected)
  // People dropped by hand stay put (fx/fy) across effect runs.
  const pinnedRef = useRef(new Set<string>())
  const lastViewKeyRef = useRef<string>('')
  // All three survive effect re-runs so a filter toggle or record edit
  // neither explodes the layout, resets the viewport, nor re-decodes
  // avatar images.
  const positionsRef = useRef(new Map<string, { x: number; y: number }>())
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const avatarImagesRef = useRef(new Map<string, HTMLImageElement | 'loading' | 'failed'>())
  // Fit-to-path camera runs once per distinct path, not on every re-render.
  const lastFitKeyRef = useRef<string>('')
  // Circles are read through a ref so recolouring or hiding a bubble
  // repaints without restarting the simulation (no layout jiggle);
  // only membership changes reheat it, explicitly.
  const circlesRef = useRef(circles)
  const simRef = useRef<{ reheat: () => void; render: () => void } | null>(null)
  const membershipKey = circles.map((c) => `${c.id}:${c.memberIds.join(',')}`).join('|')
  useEffect(() => {
    circlesRef.current = circles
    simRef.current?.render()
  }, [circles])
  useEffect(() => {
    simRef.current?.reheat()
  }, [membershipKey])
  useEffect(() => {
    selectedRef.current = selected
    simRef.current?.render()
  }, [selected])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

    const positions = positionsRef.current
    const transform = transformRef.current
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n, ...positions.get(n.id) }))
    const nodeById = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: GraphLink[] = links.map((l) => ({ ...l }))
    // Last-drawn bubble outlines, for tap hit-testing.
    const hulls = new Map<string, { x: number; y: number }[]>()
    const cachedCount = simNodes.filter((n) => n.x !== undefined).length
    const hasCachedPositions = cachedCount > 0
    // Share of the cast the layout has never placed: ~0 for a filter
    // toggle, most of it for "2 hops" or "All 315" from an ego view.
    const newFraction = 1 - cachedCount / Math.max(1, simNodes.length)
    // Newcomers start beside a placed neighbour (else the focus, else the
    // crowd's centre) with a little scatter — not on d3's spiral at the
    // origin, where a barely-warm simulation packed them into a hex grid.
    if (cachedCount > 0 && cachedCount < simNodes.length) {
      const near = new Map<string, { x: number; y: number }[]>()
      const add = (id: string, other: GraphNode) => {
        if (other.x === undefined || other.y === undefined) return
        const list = near.get(id) ?? []
        list.push({ x: other.x, y: other.y })
        near.set(id, list)
      }
      for (const l of simLinks) {
        const a = nodeById.get(l.source as string)
        const b = nodeById.get(l.target as string)
        if (!a || !b) continue
        add(a.id, b)
        add(b.id, a)
      }
      const placed = simNodes.filter((n) => n.x !== undefined)
      const focus = focusId ? nodeById.get(focusId) : undefined
      const fallback =
        focus && focus.x !== undefined && focus.y !== undefined
          ? { x: focus.x, y: focus.y }
          : {
              x: placed.reduce((sum, n) => sum + n.x!, 0) / placed.length,
              y: placed.reduce((sum, n) => sum + n.y!, 0) / placed.length,
            }
      for (const n of simNodes) {
        if (n.x !== undefined) continue
        const pts = near.get(n.id)
        const base =
          pts && pts.length > 0
            ? {
                x: pts.reduce((sum, q) => sum + q.x, 0) / pts.length,
                y: pts.reduce((sum, q) => sum + q.y, 0) / pts.length,
              }
            : fallback
        const angle = Math.random() * Math.PI * 2
        const dist = 40 + Math.random() * 50
        n.x = base.x + Math.cos(angle) * dist
        n.y = base.y + Math.sin(angle) * dist
      }
    }
    for (const n of simNodes) {
      if (pinnedRef.current.has(n.id) && n.x != null && n.y != null) {
        n.fx = n.x
        n.fy = n.y
      }
    }
    const viewChanged = viewKey !== lastViewKeyRef.current
    lastViewKeyRef.current = viewKey

    let width = 0
    let height = 0
    let dpr = 1

    // Link length follows the tie: household ties short, the same circle
    // a little longer, other explicit links longer, mentions longest —
    // so families and teams read as knots rather than one even mesh.
    const circleOf = new Map<string, Set<string>>()
    for (const c of circlesRef.current) {
      for (const id of c.memberIds) {
        const set = circleOf.get(id) ?? new Set<string>()
        set.add(c.id)
        circleOf.set(id, set)
      }
    }
    const shareCircle = (a: string, b: string) => {
      const sa = circleOf.get(a)
      const sb = circleOf.get(b)
      if (!sa || !sb) return false
      for (const id of sa) if (sb.has(id)) return true
      return false
    }
    const linkDistance = (l: GraphLink) => {
      if (l.dashed) return 130
      if (l.label === 'married' || l.label === 'partner' || l.label === 'parent of') return 60
      const a = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string)
      const b = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string)
      return shareCircle(a, b) ? 72 : 100
    }
    // Rim gravity is aspect-aware (set in resize): a portrait canvas pulls
    // harder sideways so the cloud stretches to fill the screen's height.
    const gravityX = forceX(0).strength(0.04)
    const gravityY = forceY(0).strength(0.04)
    const simulation = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(simLinks)
          .id((n) => n.id)
          .distance(linkDistance),
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(0, 0))
      // Orphans hover at the rim instead of being flung off-screen.
      .force('x', gravityX)
      .force('y', gravityY)
      // Gentle clustering (§4.6): members drift toward their circle's
      // centroid so bubbles stay compact; edges still dominate.
      .force('circles', (alpha: number) => {
        for (const c of circlesRef.current) {
          const members = c.memberIds
            .map((id) => nodeById.get(id))
            .filter((n): n is GraphNode => Boolean(n && n.x != null && n.y != null))
          if (members.length < 2) continue
          const cx = members.reduce((s, n) => s + n.x!, 0) / members.length
          const cy = members.reduce((s, n) => s + n.y!, 0) / members.length
          // Strong enough to matter (≈6× the rim gravity), still well under
          // link strength; eased for big circles so they don't crush.
          const k = (0.34 * alpha) / Math.max(1, Math.sqrt(members.length / 4))
          for (const n of members) {
            n.vx = (n.vx ?? 0) + (cx - n.x!) * k
            n.vy = (n.vy ?? 0) + (cy - n.y!) * k
          }
        }
      })
      .force('collide', forceCollide<GraphNode>((n) => n.r * 1.5))
      // Big casts cool faster (~170 ticks instead of ~300): on a phone
      // each tick+paint of hundreds of nodes is tens of milliseconds, and
      // the extra settling buys no legibility.
      // Small ego views are readable after a second too — the long
      // tail of drift just feels slow.
      .alphaDecay(simNodes.length > 150 || simNodes.length < 30 ? 0.04 : 0.0228)
      // A warm layout barely stirs; a cold one settles from scratch; a
      // different view runs warm enough to untangle, and one that grew
      // by a third or more hot enough to place the newcomers.
      .alpha(
        hasCachedPositions
          ? Math.max(viewChanged ? 0.5 : 0.02, Math.min(1, 3 * newFraction))
          : 1,
      )

    // Reduced motion: settle synchronously and paint once — no animated
    // layout, no reheats on circle changes.
    if (reduceMotion) {
      simulation.stop()
      for (let i = 0; i < 180; i++) simulation.tick()
      for (const n of simNodes) {
        if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y })
      }
    }

    let rafPending = false
    const scheduleRender = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        render()
      })
    }

    simRef.current = {
      render: scheduleRender,
      reheat: () => {
        if (!reduceMotion) {
          canvas.dataset.layout = 'running'
          onLayout(true)
          simulation.alpha(0.06).restart()
        } else scheduleRender()
      },
    }

    // Layout state for tooling/tests (the profiler waits for 'settled'),
    // and a read-only window onto positions and the camera so a test can
    // aim a tap at a person without guessing pixels.
    ;(canvas as HTMLCanvasElement & { __graph?: unknown }).__graph = {
      positions,
      transform,
      size: () => ({ width, height }),
    }
    canvas.dataset.layout = reduceMotion ? 'settled' : 'running'
    onLayout(!reduceMotion)
    simulation.on('end.settle', () => {
      canvas.dataset.layout = 'settled'
      onLayout(false)
      scheduleRender()
    })
    // Painting hundreds of nodes costs far more than stepping the
    // simulation, so on a big cast the layout phase paints every other
    // tick (dragging always paints — a finger needs every frame).
    // `dragging` is owned by the pointer handlers further down.
    let dragging = false
    const big = simNodes.length > 150
    let tickCount = 0
    simulation.on('tick', () => {
      // While the layout is still hot nobody can read it: advance two
      // steps per painted frame so the settled picture arrives sooner.
      if (simulation.alpha() > 0.4) simulation.tick()
      for (const n of simNodes) {
        if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y })
      }
      tickCount += 1
      if (big && !dragging && tickCount % 2 === 1) return
      scheduleRender()
    })

    // Kick off avatar decodes; each finished image triggers a re-render.
    // Keyed by blobRecordId so replacing an avatar never keeps drawing
    // the old (possibly deleted) photo. `alive` stops repaints from a
    // superseded effect run drawing a stale graph over the current one.
    let alive = true
    const avatarImages = avatarImagesRef.current
    if (vault) {
      for (const node of simNodes) {
        const key = node.avatar?.blobRecordId
        if (!key || avatarImages.has(key)) continue
        avatarImages.set(key, 'loading')
        void getPhotoUrl(vault, node.avatar!.blobRecordId, node.avatar!.mimeType)
          .then((url) => {
            if (!url) {
              avatarImages.set(key, 'failed')
              return
            }
            const image = new Image()
            image.onload = () => {
              avatarImages.set(key, image)
              if (alive) scheduleRender()
            }
            image.onerror = () => avatarImages.set(key, 'failed')
            image.src = url
          })
          .catch(() => avatarImages.set(key, 'failed'))
      }
    }

    // Interaction state the painter reads: hover (mouse), a pressed
    // finger, and how far the rest has faded (eased over ~150 ms).
    let hoverId: string | null = null
    let pressedId: string | null = null
    let dimT = 0
    type Lit = { nodes: Set<string>; edges: Set<string>; anchor: string | null }
    let lastLit: Lit | null = null
    const linkEnds = (l: GraphLink) => ({
      s: typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string),
      t: typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string),
    })
    // What is lit right now: the open card's person and their
    // neighbours, an edge and its ends, the how-you-connect path, or
    // (desktop, nothing open) whoever the pointer is over.
    const litSet = (): Lit | null => {
      const sel = selectedRef.current
      const lit: Lit = { nodes: new Set(), edges: new Set(), anchor: null }
      const around = (id: string) => {
        lit.nodes.add(id)
        lit.anchor = id
        for (const l of simLinks) {
          const { s, t } = linkEnds(l)
          if (s === id || t === id) {
            lit.edges.add(l.edgeId)
            lit.nodes.add(s)
            lit.nodes.add(t)
          }
        }
      }
      if (sel?.kind === 'node' && nodeById.has(sel.id)) around(sel.id)
      else if (sel?.kind === 'edge') {
        const l = simLinks.find((x) => x.edgeId === sel.id)
        if (!l) return null
        const { s, t } = linkEnds(l)
        lit.edges.add(l.edgeId)
        lit.nodes.add(s)
        lit.nodes.add(t)
      } else if (pathNodeIds && pathNodeIds.length > 0) {
        for (const id of pathNodeIds) lit.nodes.add(id)
        for (const l of simLinks) if (l.highlighted) lit.edges.add(l.edgeId)
      } else if (hoverId && nodeById.has(hoverId)) around(hoverId)
      else return null
      return lit
    }

    function render() {
      if (!ctx || !canvas) return
      const k = transform.k
      ctx.save()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.scale(dpr, dpr)
      ctx.translate(width / 2 + transform.x, height / 2 + transform.y)
      ctx.scale(k, k)

      // Viewport bounds in graph coordinates, with margin, for culling.
      const minX = (-width / 2 - transform.x) / k - NODE_R * 2
      const maxX = (width / 2 - transform.x) / k + NODE_R * 2
      const minY = (-height / 2 - transform.y) / k - NODE_R * 2
      const maxY = (height / 2 - transform.y) / k + NODE_R * 2
      const inView = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY

      const lit = litSet()
      if (lit) lastLit = lit
      const dimTarget = lit ? 1 : 0
      if (dimT !== dimTarget) {
        if (reduceMotion) dimT = dimTarget
        else {
          dimT += (dimTarget - dimT) * 0.35
          if (Math.abs(dimT - dimTarget) < 0.03) dimT = dimTarget
          else scheduleRender()
        }
      }
      // While fading back out, keep dimming the last lit set's complement.
      const active = lit ?? (dimT > 0 ? lastLit : null)
      const sel = selectedRef.current
      const selectedId = sel?.kind === 'node' ? sel.id : null
      const unlitEdgeAlpha = 1 - dimT * 0.86
      const unlitNodeAlpha = 1 - dimT * 0.7
      const isLitNode = (id: string) => !active || active.nodes.has(id)

      // Level of detail follows density, like map markers (§4.3): at an
      // overview only the best-connected people draw in full, the rest
      // are small dots and the edges among them drop; zooming in thins
      // the view and brings everyone back. Density is people per
      // 100×100 css px of canvas, counting only those in view.
      const inViewNodes: GraphNode[] = []
      for (const node of simNodes) {
        if (node.x != null && node.y != null && inView(node.x, node.y)) inViewNodes.push(node)
      }
      const cells = (width * height) / 10000
      const density = inViewNodes.length / Math.max(1, cells)
      const detail = density <= 1.1 ? 2 : density <= 2.6 ? 1 : 0
      const dots = new Set<string>()
      if (detail < 2) {
        const ranked = inViewNodes.slice().sort((a, b) => b.degree - a.degree)
        const nA = Math.max(12, Math.ceil(ranked.length * 0.25))
        const nB = Math.ceil(ranked.length * 0.35)
        ranked.forEach((nd, i) => {
          const tier = i < nA ? 0 : i < nA + nB ? 1 : 2
          const keep =
            nd.isSelf ||
            nd.id === focusId ||
            nd.id === selectedId ||
            nd.id === pressedId ||
            (active?.nodes.has(nd.id) ?? false) ||
            (pathNodeIds?.includes(nd.id) ?? false)
          if (!keep && (detail === 0 ? tier >= 1 : tier >= 2)) dots.add(nd.id)
        })
      }

      // Circle bubbles first, beneath everything (§4.6): one exact offset
      // outline of the members' convex hull — an arc of radius HULL_PAD at
      // each vertex, joined by tangents — filled once and outlined once,
      // so there is no doubled rim and identity comes from the outline
      // where fills blend. Past six bubbles the fills would stack into a
      // wash, so only the outlines draw.
      const circlesNow = circlesRef.current
      const fillHulls = circlesNow.length <= 6
      hulls.clear()
      for (const c of circlesNow) {
        const pts = c.memberIds
          .map((id) => nodeById.get(id))
          .filter((n): n is GraphNode => Boolean(n && n.x != null && n.y != null))
          .map((n) => ({ x: n.x!, y: n.y! }))
        if (pts.length === 0) continue
        const hull = convexHull(pts)
        hulls.set(c.id, hull)
        const n = hull.length
        ctx.beginPath()
        if (n === 1) {
          ctx.arc(hull[0].x, hull[0].y, HULL_PAD, 0, Math.PI * 2)
        } else {
          for (let i = 0; i < n; i++) {
            const v = hull[i]
            const p = hull[(i - 1 + n) % n]
            const q = hull[(i + 1) % n]
            const aIn = Math.atan2(v.y - p.y, v.x - p.x) - Math.PI / 2
            const aOut = Math.atan2(q.y - v.y, q.x - v.x) - Math.PI / 2
            ctx.arc(v.x, v.y, HULL_PAD, aIn, n === 2 ? aIn + Math.PI : aOut)
          }
        }
        ctx.closePath()
        const quiet = active ? 0.5 : 1
        if (fillHulls) {
          ctx.globalAlpha = 0.07 * quiet
          ctx.fillStyle = c.color
          ctx.fill()
        }
        ctx.globalAlpha = 0.32 * quiet
        ctx.strokeStyle = c.color
        ctx.lineWidth = 1 / k
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.5 / k

      const dash: [number, number] = [4 / k, 4 / k]
      const solid: never[] = []
      // Edges batched by style — one stroke per (color, dashed, highlight,
      // lit) instead of one per edge; hundreds of tiny strokes were the
      // single biggest cost per frame on a big cast.
      const groups = new Map<string, GraphLink[]>()
      const arrows: GraphLink[] = []
      const litEdge = (l: GraphLink) => !active || active.edges.has(l.edgeId)
      for (const link of simLinks) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.x == null || t.x == null) continue
        if (!inView(s.x, s.y!) && !inView(t.x, t.y!)) continue
        const on = litEdge(link)
        // A link to a dot is minor: faint at mid detail, and at low detail
        // gone when both ends are dots (a minor road between hamlets).
        const ds = dots.has(s.id)
        const dt = dots.has(t.id)
        if (ds && dt && detail === 0) continue
        const minor = ds || dt
        const key = `${link.color}|${link.dashed ? 1 : 0}|${link.highlighted ? 1 : 0}|${link.label}|${on ? 1 : 0}|${minor ? 1 : 0}`
        const list = groups.get(key)
        if (list) list.push(link)
        else groups.set(key, [link])
        if (link.directed && !minor) arrows.push(link)
      }
      // Lit and highlighted (path) edges stroke last so nothing overdraws them.
      const ordered = [...groups.values()].sort(
        (a, b) =>
          Number(litEdge(a[0])) - Number(litEdge(b[0])) ||
          Number(a[0].highlighted) - Number(b[0].highlighted),
      )
      for (const list of ordered) {
        const first = list[0]
        const on = litEdge(first)
        ctx.beginPath()
        for (const link of list) {
          const s = link.source as GraphNode
          const t = link.target as GraphNode
          ctx.moveTo(s.x!, s.y!)
          ctx.lineTo(t.x!, t.y!)
        }
        // Resting edges wear the muted type colour; a lit neighbourhood
        // or path gets the full colour and an extra stroke of weight.
        // Every resting line still clears 3:1 on the canvas.
        const minor =
          dots.has((first.source as GraphNode).id) || dots.has((first.target as GraphNode).id)
        ctx.strokeStyle = on && active ? first.color : mutedColor(first.color)
        ctx.globalAlpha = (on ? 1 : unlitEdgeAlpha) * (minor ? (detail === 0 ? 0.3 : 0.45) : 1)
        const base = first.highlighted ? 3.5 : first.label === 'partner' || first.label === 'married' ? 2.25 : 1.25
        ctx.lineWidth = (minor ? 1 : base + (on && active ? 0.75 : 0)) / k
        // Shape, not just hue: mentions dotted, exes long-dashed, partners thick.
        ctx.setLineDash(first.dashed ? dash : first.label === 'ex' ? [10 / k, 5 / k] : solid)
        ctx.stroke()
      }
      ctx.setLineDash(solid)
      for (const link of arrows) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        const angle = Math.atan2(t.y! - s.y!, t.x! - s.x!)
        const ax = t.x! - Math.cos(angle) * (t.r + 4)
        const ay = t.y! - Math.sin(angle) * (t.r + 4)
        const size = 6 / Math.sqrt(k)
        const on = litEdge(link)
        ctx.globalAlpha = on ? 0.9 : unlitEdgeAlpha * 0.8
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - size * Math.cos(angle - 0.5), ay - size * Math.sin(angle - 0.5))
        ctx.lineTo(ax - size * Math.cos(angle + 0.5), ay - size * Math.sin(angle + 0.5))
        ctx.closePath()
        ctx.fillStyle = on && active ? link.color : mutedColor(link.color)
        ctx.fill()
      }

      ctx.globalAlpha = 1
      ctx.setLineDash(solid)
      ctx.lineWidth = 1 / k
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Pass 1: discs with avatar or initials, one font for all nodes.
      // Plain nodes (no photo, not focused, not you, not lit) share one
      // fill path and one ring path; initials skip when under ~7px.
      ctx.font = '600 11px system-ui'
      const visibleNodes: GraphNode[] = []
      const plain: GraphNode[] = []
      const faded: GraphNode[] = []
      const special: GraphNode[] = []
      const dotNodes: GraphNode[] = []
      const avatarImages = avatarImagesRef.current
      for (const node of inViewNodes) {
        visibleNodes.push(node)
        if (dots.has(node.id)) {
          dotNodes.push(node)
          continue
        }
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        const hasPhoto = image instanceof HTMLImageElement
        const isSpecial =
          hasPhoto || node.id === focusId || node.isSelf || node.id === selectedId || node.id === pressedId
        if (isSpecial) special.push(node)
        else if (!isLitNode(node.id)) faded.push(node)
        else plain.push(node)
      }
      const drawBatch = (batch: GraphNode[], alpha: number) => {
        if (batch.length === 0) return
        ctx.globalAlpha = alpha
        ctx.beginPath()
        for (const node of batch) {
          ctx.moveTo(node.x! + node.r, node.y!)
          ctx.arc(node.x!, node.y!, node.r, 0, Math.PI * 2)
        }
        ctx.fillStyle = '#232120'
        ctx.fill()
        ctx.lineWidth = 1 / k
        ctx.strokeStyle = '#7d786f'
        ctx.stroke()
        if (k * 11 >= 7) {
          ctx.fillStyle = '#ece8e1'
          for (const node of batch) ctx.fillText(node.initials, node.x!, node.y!)
        }
        ctx.globalAlpha = 1
      }
      // Dots underneath, faded next, plain over them, then the special few.
      if (dotNodes.length > 0) {
        const dr = 3.5 / k
        ctx.globalAlpha = active ? unlitNodeAlpha : 1
        ctx.beginPath()
        for (const node of dotNodes) {
          ctx.moveTo(node.x! + dr, node.y!)
          ctx.arc(node.x!, node.y!, dr, 0, Math.PI * 2)
        }
        ctx.fillStyle = '#7d786f'
        ctx.fill()
        ctx.globalAlpha = 1
      }
      drawBatch(faded, unlitNodeAlpha)
      drawBatch(plain, 1)
      for (const node of special) {
        const isFocus = node.id === focusId
        const isSelected = node.id === selectedId
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        ctx.globalAlpha = isLitNode(node.id) || isSelected ? 1 : unlitNodeAlpha
        // Gold is yours alone; the focus of an ego view and the person
        // whose card is open get a bright ring instead.
        const r = isFocus ? node.r + 3 : node.r
        const ring = node.isSelf ? '#d8a657' : isFocus || isSelected ? '#ece8e1' : '#7d786f'
        const ringW = node.isSelf ? 1.5 : isFocus || isSelected ? 2.5 : 1
        if (image instanceof HTMLImageElement) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2)
          ctx.clip()
          // Cover-crop from a centered square so faces aren't stretched.
          const side = Math.min(image.naturalWidth, image.naturalHeight)
          const sx = (image.naturalWidth - side) / 2
          const sy = (image.naturalHeight - side) / 2
          ctx.drawImage(image, sx, sy, side, side, node.x! - r, node.y! - r, r * 2, r * 2)
          ctx.restore()
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2)
          ctx.lineWidth = ringW / k
          ctx.strokeStyle = ring
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2)
          ctx.fillStyle = node.isSelf ? '#d8a657' : node.id === pressedId ? '#3a3733' : '#2b2926'
          ctx.fill()
          ctx.lineWidth = ringW / k
          ctx.strokeStyle = ring
          ctx.stroke()
          ctx.fillStyle = node.isSelf ? '#17140f' : '#ece8e1'
          ctx.fillText(node.initials, node.x!, node.y!)
        }
        if (isSelected) {
          // A soft outer halo says "this one" even under a photo.
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r + 5 / k, 0, Math.PI * 2)
          ctx.globalAlpha = 0.28
          ctx.lineWidth = 3 / k
          ctx.strokeStyle = '#ece8e1'
          ctx.stroke()
          ctx.globalAlpha = 1
        }
      }
      ctx.globalAlpha = 1
      // Pinned people wear a small tick at the ring's top-right.
      if (pinnedRef.current.size > 0) {
        ctx.fillStyle = '#ece8e1'
        for (const node of visibleNodes) {
          if (!pinnedRef.current.has(node.id)) continue
          const a = -Math.PI / 4
          ctx.beginPath()
          ctx.arc(node.x! + Math.cos(a) * node.r, node.y! + Math.sin(a) * node.r, 2.5 / k, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.lineWidth = 1 / k
      // Pass 2: name labels get a budget from screen area, like map
      // labels: the most important people are named first (the card's
      // subject, you, the focus, lit neighbours, then hubs) and zooming
      // in frees budget for the rest. Dots are never named; a lit
      // neighbourhood is always named, whatever the zoom.
      const nameBudget = Math.max(8, Math.floor(cells * 1.1))
      // At reduced detail names dodge only the people drawn in full: the
      // dots are minor, and a hub's name matters more than a dot under it.
      const nodeBoxes = visibleNodes
        .filter((nd) => !dots.has(nd.id))
        .map((nd) => ({ id: nd.id, x: nd.x! - nd.r, y: nd.y! - nd.r, w: nd.r * 2, h: nd.r * 2 }))
      const overlaps = (b: { x: number; y: number; w: number; h: number }) => (o: typeof b) =>
        b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y
      const nameBoxes: { x: number; y: number; w: number; h: number }[] = []
      {
        // Names read as captions: `--text-2` on a halo of the canvas
        // colour, and the people who matter most are named first — the
        // card's subject, you, the focus, lit neighbours, then hubs.
        // Screen-sized: 12px at every zoom, like a map label.
        ctx.font = `500 ${12 / k}px system-ui`
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = 'rgba(18, 17, 16, 0.9)'
        ctx.textBaseline = 'alphabetic'
        const lineH = 14 / k
        const rank = (nd: GraphNode) =>
          (nd.id === selectedId || nd.id === active?.anchor ? 4000 : 0) +
          (nd.isSelf ? 3000 : 0) +
          (nd.id === focusId ? 2000 : 0) +
          (active && active.nodes.has(nd.id) ? 1000 : 0) +
          nd.r
        const order = visibleNodes.slice().sort((a, b) => rank(b) - rank(a))
        let named = 0
        for (const node of order) {
          const litNode = isLitNode(node.id)
          if (active && !litNode) continue
          if (dots.has(node.id)) continue
          const exempt =
            node.id === selectedId || node.id === active?.anchor || (active?.nodes.has(node.id) ?? false)
          if (!exempt && named >= nameBudget) continue
          const text = node.isSelf ? `${node.name} (you)` : node.name
          const w = ctx.measureText(text).width
          // Below the disc, else above it; skip when both would overprint.
          const candidates = [node.y! + node.r + 13 / k, node.y! - node.r - 5 / k]
          let placed = false
          for (const y of candidates) {
            // A little taller than the glyphs so two names never abut.
            const box = { x: node.x! - w / 2 - 2 / k, y: y - lineH, w: w + 4 / k, h: lineH * 1.3 }
            if (nameBoxes.some(overlaps(box))) continue
            if (nodeBoxes.some((o) => o.id !== node.id && overlaps(box)(o))) continue
            nameBoxes.push(box)
            ctx.strokeText(text, node.x!, y)
            ctx.fillStyle = node.id === selectedId || node.id === active?.anchor ? '#ece8e1' : '#b5afa5'
            ctx.fillText(text, node.x!, y)
            placed = true
            break
          }
          if (placed && !exempt) named++
        }
      }
      // Circle names last: small caps in the bubble's hue toned toward
      // the caption grey, hung off the bubble's top edge wherever they
      // don't cover anyone. They shrink with zoom (floor 9px) and vanish
      // far out or when there are too many bubbles to name.
      if (k >= 0.45 && (circlesNow.length <= 8 || k >= 0.8)) {
        const fontPx = Math.min(11, Math.max(9, 11 * k)) / k
        const lineH = fontPx * 1.3
        ctx.font = `600 ${fontPx}px system-ui`
        const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
        if ('letterSpacing' in spaced) spaced.letterSpacing = '0.06em'
        ctx.textBaseline = 'alphabetic'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = 'rgba(18, 17, 16, 0.8)'
        const placed: { x: number; y: number; w: number; h: number }[] = [...nameBoxes]
        const captionBoxes = visibleNodes.map((nd) => ({
          x: nd.x! - nd.r - 4 / k,
          y: nd.y! - nd.r - 4 / k,
          w: nd.r * 2 + 8 / k,
          h: nd.r * 2 + 18 / k,
        }))
        const hits = (b: { x: number; y: number; w: number; h: number }) =>
          placed.some(overlaps(b)) || captionBoxes.some(overlaps(b))
        for (const c of circlesNow) {
          const hull = hulls.get(c.id)
          if (!hull || hull.length === 0) continue
          const xs = hull.map((p) => p.x)
          const ys = hull.map((p) => p.y)
          const left = Math.min(...xs) - HULL_PAD
          const right = Math.max(...xs) + HULL_PAD
          const top = Math.min(...ys) - HULL_PAD
          const bubbleW = right - left
          let text = c.name.toUpperCase()
          while (text.length > 3 && ctx.measureText(text).width > Math.max(bubbleW - 16 / k, 140 / k)) {
            text = text.slice(0, -2).trimEnd() + '…'
          }
          const w = ctx.measureText(text).width
          // The hull's corners are its members, so a name inside the
          // bubble always sits on someone: it hangs just above the top
          // edge instead — at the left corner, the middle, the right
          // corner — and climbs a line at a time when those are taken.
          const inset = 6 / k
          const bottom = Math.max(...ys) + HULL_PAD
          const aboveY = Math.max(top - 5 / k, minY + NODE_R * 2 + lineH)
          const belowY = bottom + lineH
          const cx = (left + right) / 2
          const options: { x: number; y: number; align: CanvasTextAlign }[] = [
            { x: left + inset, y: aboveY, align: 'left' },
            { x: cx, y: aboveY, align: 'center' },
            { x: right - inset, y: aboveY, align: 'right' },
            { x: left + inset, y: belowY, align: 'left' },
            { x: cx, y: belowY, align: 'center' },
            { x: right - inset, y: belowY, align: 'right' },
            { x: left + inset, y: aboveY - lineH, align: 'left' },
            { x: cx, y: aboveY - lineH, align: 'center' },
          ]
          // Past the fixed slots, step away a line at a time above and
          // below so two bubbles sharing an edge never print over each
          // other; as a last resort take a slot that only crosses lines,
          // never a person or their name.
          for (let extra = 2; extra < 8; extra++) {
            options.push({ x: cx, y: aboveY - lineH * extra, align: 'center' })
            options.push({ x: cx, y: belowY + lineH * extra, align: 'center' })
          }
          const boxFor = (o: { x: number; y: number; align: CanvasTextAlign }) => {
            const bx = o.align === 'left' ? o.x : o.align === 'right' ? o.x - w : o.x - w / 2
            return { x: bx, y: o.y - lineH, w, h: lineH * 1.25 }
          }
          let chosen = options.find((o) => !hits(boxFor(o)))
          if (!chosen) chosen = options.find((o) => !captionBoxes.some(overlaps(boxFor(o))))
          if (!chosen) continue
          placed.push(boxFor(chosen))
          ctx.textAlign = chosen.align
          ctx.globalAlpha = active ? 0.6 : 1
          ctx.strokeText(text, chosen.x, chosen.y)
          ctx.fillStyle = tonedColor(c.color)
          ctx.fillText(text, chosen.x, chosen.y)
          ctx.globalAlpha = 1
        }
        if ('letterSpacing' in spaced) spaced.letterSpacing = '0px'
        ctx.textAlign = 'center'
      }
      ctx.lineWidth = 1.5 / k
      ctx.restore()
    }

    // Until the user pans or zooms, a viewport change (rotation, resize,
    // tab bar appearing) re-frames everyone instead of cropping the edges.
    let userMoved = false
    let refit: (() => void) | null = null
    const resize = () => {
      const wrap = canvas.parentElement
      if (!wrap) return
      dpr = window.devicePixelRatio || 1
      const sizeChanged = wrap.clientWidth !== width || wrap.clientHeight !== height
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      if (sizeChanged && width > 0 && height > 0) {
        // Squared so a phone's 1.5:1 canvas pulls sideways hard enough
        // to matter against the links; capped so nothing collapses.
        gravityX.strength(Math.min(0.12, 0.04 * Math.max(1, height / width) ** 2))
        gravityY.strength(Math.min(0.12, 0.04 * Math.max(1, width / height) ** 2))
      }
      if (sizeChanged && !userMoved) refit?.()
      scheduleRender()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement!)
    resize()

    // Every camera move eases over 250 ms (instant under reduced motion).
    // A move requested mid-flight builds on where the camera is heading.
    let animRaf = 0
    let animTarget: { x: number; y: number; k: number } | null = null
    const cameraGoal = () => animTarget ?? transform
    const animateTo = (target: { x: number; y: number; k: number }) => {
      cancelAnimationFrame(animRaf)
      if (reduceMotion) {
        Object.assign(transform, target)
        animTarget = null
        scheduleRender()
        return
      }
      animTarget = target
      const from = { ...transform }
      const t0 = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 250)
        const e = 1 - (1 - t) ** 3
        transform.x = from.x + (target.x - from.x) * e
        transform.y = from.y + (target.y - from.y) * e
        transform.k = from.k + (target.k - from.k) * e
        scheduleRender()
        if (t < 1) animRaf = requestAnimationFrame(step)
        else animTarget = null
      }
      animRaf = requestAnimationFrame(step)
    }
    // Zoom about a point given relative to the canvas centre.
    const zoomAt = (factor: number, cx: number, cy: number, animate = false) => {
      if (!animate) {
        cancelAnimationFrame(animRaf)
        animTarget = null
      }
      const next = Math.min(4, Math.max(0.15, transform.k * factor))
      const target = {
        k: next,
        x: cx - ((cx - transform.x) / transform.k) * next,
        y: cy - ((cy - transform.y) / transform.k) * next,
      }
      if (animate) animateTo(target)
      else {
        Object.assign(transform, target)
        scheduleRender()
      }
    }

    // Center and zoom the viewport onto a set of node ids (all, or a
    // path), keeping the bottom `inset` px clear (an open card).
    const fitTo = (ids: Iterable<string>, maxK: number, inset = 0) => {
      const points = [...ids]
        .map((id) => positions.get(id))
        .filter((p): p is { x: number; y: number } => Boolean(p))
      if (points.length === 0) return
      const minX = Math.min(...points.map((p) => p.x))
      const maxX = Math.max(...points.map((p) => p.x))
      const minY = Math.min(...points.map((p) => p.y))
      const maxY = Math.max(...points.map((p) => p.y))
      const pad = circlesRef.current.length > 0 ? HULL_PAD + 12 + NODE_R : NODE_R * 3
      const spanX = maxX - minX + pad * 2
      const spanY = maxY - minY + pad * 2
      const usableH = Math.max(80, height - inset)
      const k = Math.min(maxK, Math.max(0.2, Math.min(width / spanX, usableH / spanY)))
      animateTo({
        k,
        x: -((minX + maxX) / 2) * k,
        y: -((minY + maxY) / 2) * k - inset / 2,
      })
    }
    // Small casts may sit a little larger; big ones never past 1.4.
    const fitAll = () => fitTo(simNodes.map((n) => n.id), simNodes.length <= 30 ? 1.6 : 1.4)
    refit = fitAll

    viewApiRef.current = {
      zoom: (factor) => {
        userMoved = true
        zoomAt(factor, 0, 0, true)
      },
      fit: () => {
        userMoved = false
        fitAll()
      },
      center: (id, minK) => {
        const p = positions.get(id)
        if (!p) return
        userMoved = true
        const k = Math.max(cameraGoal().k, minK)
        animateTo({ k, x: -p.x * k, y: -p.y * k })
      },
      reveal: (id, bottomInset) => {
        const p = positions.get(id)
        if (!p) return
        const goal = cameraGoal()
        const sy = p.y * goal.k + goal.y + height / 2
        const limit = height - bottomInset - 32
        if (sy > limit) {
          userMoved = true
          animateTo({ ...goal, y: goal.y - (sy - limit) })
        }
      },
      isPinned: (id) => pinnedRef.current.has(id),
      unpin: (id) => {
        pinnedRef.current.delete(id)
        const node = nodeById.get(id)
        if (node) {
          node.fx = null
          node.fy = null
        }
        if (!reduceMotion) {
          canvas.dataset.layout = 'running'
          simulation.alpha(Math.max(simulation.alpha(), 0.1)).restart()
        }
        scheduleRender()
      },
      hasNode: (id) => nodeById.has(id),
      fitCircle: (circleId, bottomInset) => {
        const c = circlesRef.current.find((x) => x.id === circleId)
        if (!c || c.memberIds.length === 0) return
        userMoved = true
        fitTo(c.memberIds, Math.max(1.2, cameraGoal().k), bottomInset)
      },
    }

    // "Show on graph" should actually show it: once the layout has had a
    // moment to settle, center and zoom the viewport onto the path.
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    const fitKey = pathNodeIds?.join(',') ?? ''
    if (pathNodeIds && pathNodeIds.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
      fitTimer = setTimeout(() => fitTo(pathNodeIds, 2), 700)
    } else if (circleFocusId && lastFitKeyRef.current !== `circle:${circleFocusId}`) {
      // Focusing a circle re-frames on its members.
      lastFitKeyRef.current = `circle:${circleFocusId}`
      fitTimer = setTimeout(fitAll, reduceMotion ? 50 : 400)
    } else if (!hasCachedPositions || viewChanged || newFraction > 0.3) {
      // First layout of this session, or a different view (ego ↔ all,
      // 1 ↔ 2 hops): fit everyone once it has settled, so nobody starts
      // off-screen and an eight-person ego view fills the canvas.
      simulation.on('end', fitAll)
      // Reduced motion: still give the ResizeObserver a beat to report a
      // size, or the fit runs against a zero-width canvas and clips.
      fitTimer = setTimeout(fitAll, reduceMotion ? 50 : newFraction === 0 ? 300 : 900)
    }
    if (reduceMotion) scheduleRender()

    const toGraphCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (clientX - rect.left - width / 2 - transform.x) / transform.k,
        y: (clientY - rect.top - height / 2 - transform.y) / transform.k,
      }
    }

    // Nearest node within a screen-space floor, so zoomed-out nodes stay
    // tappable; then nearest edge segment. On touch the edge tolerance is
    // tighter: in a dense cluster the space between nodes is laced with
    // line segments, and a fat-finger miss should dismiss, not open a
    // card with a destructive Remove.
    const hitTest = (
      clientX: number,
      clientY: number,
      coarse = false,
    ): Tap | GraphNode | null => {
      const p = toGraphCoords(clientX, clientY)
      let best: GraphNode | null = null
      let bestDist = Infinity
      for (const node of simNodes) {
        if (node.x == null || node.y == null) continue
        const hitR = Math.max(node.r, 18 / transform.k)
        const dx = p.x - node.x
        const dy = p.y - node.y
        const d = dx * dx + dy * dy
        if (d <= hitR * hitR && d < bestDist) {
          best = node
          bestDist = d
        }
      }
      if (best) return best
      const edgeR = (coarse ? 6 : 10) / transform.k
      let bestEdge: GraphLink | null = null
      let bestEdgeDist = edgeR * edgeR
      for (const link of simLinks) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.x == null || t.x == null) continue
        const d = pointSegmentDistSq(p.x, p.y, s.x, s.y!, t.x!, t.y!)
        if (d <= bestEdgeDist) {
          bestEdge = link
          bestEdgeDist = d
        }
      }
      if (bestEdge) return { kind: 'edge', id: bestEdge.edgeId }
      // Finally, bubbles: inside the padded hull (or within the pad of it).
      // The band never shrinks below a finger's width on screen.
      const band = Math.max(HULL_PAD, 22 / transform.k)
      for (const c of circlesRef.current) {
        const hull = hulls.get(c.id)
        if (!hull || hull.length === 0) continue
        if (hull.length === 1) {
          const dx = p.x - hull[0].x
          const dy = p.y - hull[0].y
          if (dx * dx + dy * dy <= band * band) return { kind: 'circle', id: c.id }
          continue
        }
        let inside = hull.length >= 3
        for (let i = 0; i < hull.length && inside; i++) {
          const a = hull[i]
          const b = hull[(i + 1) % hull.length]
          if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) inside = false
        }
        if (inside) return { kind: 'circle', id: c.id }
        for (let i = 0; i < hull.length; i++) {
          const a = hull[i]
          const b = hull[(i + 1) % hull.length]
          if (pointSegmentDistSq(p.x, p.y, a.x, a.y, b.x, b.y) <= band * band) {
            return { kind: 'circle', id: c.id }
          }
        }
      }
      return null
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let dragNode: GraphNode | null = null
    let moved = 0
    let pinchDist = 0
    let pressTimer: ReturnType<typeof setTimeout> | undefined
    let pendingNode: GraphNode | null = null
    let wasMulti = false
    let lastTap = { t: 0, x: 0, y: 0 }
    let gestured = false
    const noteGesture = () => {
      if (gestured) return
      gestured = true
      onGesture()
    }

    const beginDrag = () => {
      dragging = true
      canvas.dataset.layout = 'running'
      // Only the neighbourhood eases while a person is carried; the
      // whole cast no longer reshuffles behind a drag.
      simulation.alphaTarget(0.1).restart()
    }
    const releaseDrag = () => {
      if (pressTimer !== undefined) clearTimeout(pressTimer)
      pressTimer = undefined
      pendingNode = null
      if (dragNode) {
        if (dragging) {
          // Dropped by hand: stays put (fx/fy kept) until unpinned.
          if (!pinnedRef.current.has(dragNode.id)) {
            pinnedRef.current.add(dragNode.id)
            onPinChange()
          }
        } else if (!pinnedRef.current.has(dragNode.id)) {
          dragNode.fx = null
          dragNode.fy = null
        }
      }
      if (dragging) simulation.alphaTarget(0)
      dragNode = null
      dragging = false
      if (pressedId) {
        pressedId = null
        scheduleRender()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = 0
      noteGesture()
      if (pointers.size === 1) {
        wasMulti = false
        const hit = hitTest(e.clientX, e.clientY)
        const node = hit && 'name' in hit ? (hit as GraphNode) : null
        dragging = false
        if (node && e.pointerType === 'touch') {
          // Touch: a finger that lands on a person pans until it has
          // held for a moment, then picks them up (like rearranging a
          // Home Screen). A mouse picks up straight away.
          pendingNode = node
          pressTimer = setTimeout(() => {
            pressTimer = undefined
            if (!pendingNode || moved > 6 || pointers.size !== 1) return
            dragNode = pendingNode
            pendingNode = null
            pressedId = dragNode.id
            dragNode.fx = dragNode.x
            dragNode.fy = dragNode.y
            beginDrag()
            try {
              navigator.vibrate?.(10)
            } catch {
              // Not every browser offers it.
            }
            scheduleRender()
          }, 350)
        } else if (node) {
          dragNode = node
          pressedId = node.id
          scheduleRender()
        }
      } else if (pointers.size === 2) {
        // Second finger means pinch — cleanly release any node drag so it
        // isn't pinned with the simulation reheated forever.
        if (dragging) releaseDrag()
        else {
          if (pressTimer !== undefined) clearTimeout(pressTimer)
          pressTimer = undefined
          pendingNode = null
          dragNode = null
        }
        wasMulti = true
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      moved += Math.abs(dx) + Math.abs(dy)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const rect = canvas.getBoundingClientRect()
        const mx = (a.x + b.x) / 2 - rect.left - width / 2
        const my = (a.y + b.y) / 2 - rect.top - height / 2
        if (pinchDist > 0 && dist > 0) {
          const next = Math.min(4, Math.max(0.15, transform.k * (dist / pinchDist)))
          // Anchor the zoom to the pinch midpoint, not the canvas center.
          transform.x = mx - ((mx - transform.x) / transform.k) * next
          transform.y = my - ((my - transform.y) / transform.k) * next
          transform.k = next
        }
        // Two-finger pan follows the midpoint.
        transform.x += dx / 2
        transform.y += dy / 2
        pinchDist = dist
        userMoved = true
        scheduleRender()
      } else if (dragNode) {
        // Reheat only once an actual drag starts, so a plain tap doesn't
        // shift the layout.
        if (!dragging && moved > 6) beginDrag()
        if (dragging) {
          const p = toGraphCoords(e.clientX, e.clientY)
          dragNode.fx = p.x
          dragNode.fy = p.y
        }
      } else {
        if (pendingNode && moved > 6) {
          // The finger is panning, not holding.
          if (pressTimer !== undefined) clearTimeout(pressTimer)
          pressTimer = undefined
          pendingNode = null
        }
        userMoved = true
        transform.x += dx
        transform.y += dy
        scheduleRender()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      // A pointer that went down elsewhere (a picker row that closed
      // under the finger) is not a tap on the canvas.
      if (!pointers.has(e.pointerId)) return
      pointers.delete(e.pointerId)
      if (wasMulti) {
        if (pointers.size === 0) {
          // Two fingers down and up without moving: zoom out a step.
          if (moved < 6) zoomAt(0.5, 0, 0, true)
          wasMulti = false
          releaseDrag()
          pinchDist = 0
        }
        return
      }
      if (moved < 6 && pointers.size === 0) {
        const now = performance.now()
        const isDouble =
          now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 20
        lastTap = { t: now, x: e.clientX, y: e.clientY }
        const hit = hitTest(e.clientX, e.clientY, e.pointerType === 'touch')
        const node = hit && 'name' in hit ? (hit as GraphNode) : null
        const sel = selectedRef.current
        if (node) {
          // A second tap on the person whose card is open goes through
          // to their page — the touch twin of double-click.
          if (sel?.kind === 'node' && sel.id === node.id) onOpen(node.id)
          else onTap({ kind: 'node', id: node.id })
        } else if (sel) {
          // With a card open, a tap anywhere else only dismisses — never
          // opens a different card (a Remove button under a stray finger).
          onTap(null)
        } else if (isDouble && e.pointerType === 'touch') {
          const rect = canvas.getBoundingClientRect()
          zoomAt(2, e.clientX - rect.left - width / 2, e.clientY - rect.top - height / 2, true)
        } else if (hit) onTap(hit as Tap)
        else onTap(null)
      }
      if (pointers.size === 0) {
        releaseDrag()
        pinchDist = 0
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMoved = true
      noteGesture()
      const rect = canvas.getBoundingClientRect()
      zoomAt(
        Math.exp(-e.deltaY * 0.002),
        e.clientX - rect.left - width / 2,
        e.clientY - rect.top - height / 2,
      )
    }

    // Hover (desktop): pointer cursor over a node or edge, and with no
    // card open the hovered person's neighbourhood lights up; a
    // double-click on empty space zooms in there.
    const onHover = (e: PointerEvent) => {
      if (pointers.size > 0 || e.pointerType === 'touch') return
      const hit = hitTest(e.clientX, e.clientY)
      canvas.style.cursor = hit ? 'pointer' : 'grab'
      const id = hit && 'name' in hit ? (hit as GraphNode).id : null
      if (id !== hoverId) {
        hoverId = id
        scheduleRender()
      }
    }
    const onLeave = () => {
      if (hoverId) {
        hoverId = null
        scheduleRender()
      }
    }
    const onDblClick = (e: MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY)
      if (hit) return
      const rect = canvas.getBoundingClientRect()
      zoomAt(2, e.clientX - rect.left - width / 2, e.clientY - rect.top - height / 2, true)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const pan = 40
      if (e.key !== '0') userMoved = true
      switch (e.key) {
        case 'ArrowLeft':
          transform.x += pan
          break
        case 'ArrowRight':
          transform.x -= pan
          break
        case 'ArrowUp':
          transform.y += pan
          break
        case 'ArrowDown':
          transform.y -= pan
          break
        case '+':
        case '=':
          transform.k = Math.min(4, transform.k * 1.2)
          break
        case '-':
          transform.k = Math.max(0.15, transform.k / 1.2)
          break
        case '0':
          userMoved = false
          fitAll()
          return
        default:
          return
      }
      e.preventDefault()
      noteGesture()
      scheduleRender()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointermove', onHover)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKeyDown)

    return () => {
      alive = false
      viewApiRef.current = null
      simRef.current = null
      if (fitTimer !== undefined) clearTimeout(fitTimer)
      cancelAnimationFrame(animRaf)
      if (pressTimer !== undefined) clearTimeout(pressTimer)
      simulation.stop()
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointermove', onHover)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, focusId, circleFocusId, onTap, onOpen, vault, pathNodeIds, viewApiRef, onLayout, viewKey])

  return canvasRef
}

function pointSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq))
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy
}
