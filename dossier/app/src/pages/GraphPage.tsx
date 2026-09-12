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
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import PersonPicker from '../components/PersonPicker'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { selectSelf, shortestPath } from '../lib/graphQueries'
import { CIRCLE_COLORS, colorName, type Person, type Relationship } from '../lib/models'
import { getPhotoUrl } from '../lib/photoCache'
import type { UnlockedVault } from '../lib/vault'
import {
  selectAvatar,
  selectCircles,
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
  | { kind: 'circle'; id: string }
  | null

const NODE_R = 14
const LABEL_ZOOM = 0.7
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
  const [arranging, setArranging] = useState(false)
  const [showAllCircles, setShowAllCircles] = useState(false)

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
    setPeek({ kind: 'circle', id: circleFocusId })
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
  )
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
                ? 'no “me” set — mark yourself in Edit details'
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
                    onClick={() => setPeek({ kind: 'circle', id: c.id })}
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
        <button
          className={`chip ${showMentions ? '' : 'off'}`}
          aria-pressed={showMentions}
          onClick={() => setShowMentions((v) => !v)}
        >
          mentions
        </button>
      </div>
      <p className="graph-legend">
        {nodes.length > LABEL_MAX_NODES
          ? 'Too many people to name at once: zoom in to see names, or pick a person or circle above.'
          : 'Tap a label to filter. Dotted lines are mentions; tinted areas are circles — tap one to edit, tap a person for details.'}
      </p>
      {/* The text equivalent of the canvas (2.1.1 / 1.1.1): everyone shown
          and who they are linked to. */}
      <details className="graph-list">
        <summary>See as list ({nodes.length} people)</summary>
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
      </details>
      <div className="graph-canvas-wrap">
        {arranging && nodes.length > 150 && (
          <p className="graph-status" role="status">
            Arranging {nodes.length} people…
          </p>
        )}
        {focusedCircle && nodes.length === 0 ? (
          <div className="empty circle-empty" role="status">
            “{focusedCircle.name}” has no members yet — add people from their pages, or
            delete it.
            <div className="row wrap">
              <button className="subtle" onClick={clearCircleParam}>
                Show everyone
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  if (confirm(`Delete the circle “${focusedCircle.name}”? The people stay.`)) {
                    void removeCircle(focusedCircle.id)
                    clearCircleParam()
                  }
                }}
              >
                Delete circle
              </button>
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
            Nothing to connect yet. Open someone's page and add a relationship, or load the
            sample people in <Link to="/settings">Settings</Link>.
          </p>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="graph-canvas"
              tabIndex={0}
              role="application"
              aria-label={`Relationship graph: ${nodes.length} people, ${links.length} connections, ${circles.length} circles. Arrow keys pan, plus and minus zoom, 0 fits everyone. "See as list" below has the same people and links as text.`}
            />
            <div className="graph-view-controls" role="group" aria-label="View">
              <button onClick={() => viewApiRef.current?.zoom(1.25)} aria-label="Zoom in">
                +
              </button>
              <button onClick={() => viewApiRef.current?.zoom(1 / 1.25)} aria-label="Zoom out">
                −
              </button>
              <button onClick={() => viewApiRef.current?.fit()} aria-label="Fit everyone in view">
                ⤢
              </button>
            </div>
          </>
        )}
        {peek?.kind === 'node' && (
            <NodePeek
              key={peek.id}
              personId={peek.id}
              onClose={() => setPeek(null)}
              onOpen={() => navigate(`/person/${peek.id}`)}
              onFocus={() => {
                setParams({ focus: peek.id })
                setPeek(null)
              }}
            />
          )}
          {peek?.kind === 'edge' && (
            <EdgePeek key={peek.id} edgeId={peek.id} onClose={() => setPeek(null)} />
          )}
          {peek?.kind === 'circle' && (
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

/** Tap a node → peek card → through to the full dossier (§4.3). */
function NodePeek({
  personId,
  onClose,
  onOpen,
  onFocus,
}: {
  personId: string
  onClose: () => void
  onOpen: () => void
  onFocus: () => void
}) {
  const records = useVaultStore((s) => s.records)
  const cardRef = usePeekFocus(onClose)
  const person = records.get(personId)
  if (!person || person.kind !== 'person') return null
  const detail = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
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
        </strong>
        {detail && <span className="hint">{detail}</span>}
      </div>
      <div className="row">
        <button onClick={onOpen}>Open</button>
        <button className="subtle" onClick={onFocus}>
          {person.isSelf ? 'Your connections' : 'Their connections'}
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
        <button
          className="danger"
          onClick={() => {
            if (confirm('Remove this link?')) {
              void removeRelationship(rel.id)
              onClose()
            }
          }}
        >
          Remove
        </button>
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
      setStatus({ text: 'Saved ✓' })
      setTimeout(() => setStatus(null), 1800)
    }
  }
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className="peek-card circle-peek"
      role="dialog"
      aria-label={`Circle: ${circle.name}`}
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
              listAbove
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
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Delete the circle “${circle.name}”? The people stay.`)) {
              void removeCircle(circle.id)
              onDeleted()
            }
          }}
        >
          Delete circle
        </button>
      </div>
    </div>
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
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
    const hasCachedPositions = simNodes.some((n) => n.x !== undefined)

    let width = 0
    let height = 0
    let dpr = 1

    const simulation = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(simLinks)
          .id((n) => n.id)
          .distance(90),
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(0, 0))
      // Orphans hover at the rim instead of being flung off-screen.
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
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
          const k = (0.24 * alpha) / Math.max(1, Math.sqrt(members.length / 4))
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
      // A warm layout barely stirs; a cold one settles from scratch.
      .alpha(hasCachedPositions ? 0.02 : 1)

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

    // Layout state for tooling/tests (the profiler waits for 'settled').
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

      // Circle bubbles first, beneath everything (§4.6): one exact offset
      // outline of the members' convex hull — an arc of radius HULL_PAD at
      // each vertex, joined by tangents — filled once and outlined once,
      // so there is no doubled rim and identity comes from the outline
      // where fills blend.
      const circlesNow = circlesRef.current
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
        ctx.globalAlpha = 0.09
        ctx.fillStyle = c.color
        ctx.fill()
        ctx.globalAlpha = 0.45
        ctx.strokeStyle = c.color
        ctx.lineWidth = 1.25 / k
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.5 / k

      const dash: [number, number] = [4 / k, 4 / k]
      const solid: never[] = []
      // Edges batched by style — one stroke per (color, dashed, highlight)
      // instead of one per edge; hundreds of tiny strokes were the
      // single biggest cost per frame on a big cast.
      const groups = new Map<string, GraphLink[]>()
      const arrows: GraphLink[] = []
      for (const link of simLinks) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.x == null || t.x == null) continue
        if (!inView(s.x, s.y!) && !inView(t.x, t.y!)) continue
        const key = `${link.color}|${link.dashed ? 1 : 0}|${link.highlighted ? 1 : 0}|${link.label}`
        const list = groups.get(key)
        if (list) list.push(link)
        else groups.set(key, [link])
        if (link.directed) arrows.push(link)
      }
      // Highlighted (path) edges stroke last so nothing overdraws them.
      const ordered = [...groups.values()].sort(
        (a, b) => Number(a[0].highlighted) - Number(b[0].highlighted),
      )
      for (const list of ordered) {
        const first = list[0]
        ctx.beginPath()
        for (const link of list) {
          const s = link.source as GraphNode
          const t = link.target as GraphNode
          ctx.moveTo(s.x!, s.y!)
          ctx.lineTo(t.x!, t.y!)
        }
        ctx.strokeStyle = first.color
        // Full-strength lines: every edge must clear 3:1 on the canvas.
        ctx.globalAlpha = first.highlighted ? 1 : 0.95
        ctx.lineWidth = (first.highlighted ? 3.5 : first.label === 'partner' || first.label === 'married' ? 2.5 : 1.5) / k
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
        ctx.globalAlpha = link.highlighted ? 1 : 0.8
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - size * Math.cos(angle - 0.5), ay - size * Math.sin(angle - 0.5))
        ctx.lineTo(ax - size * Math.cos(angle + 0.5), ay - size * Math.sin(angle + 0.5))
        ctx.closePath()
        ctx.fillStyle = link.color
        ctx.fill()
      }

      ctx.globalAlpha = 1
      ctx.setLineDash(solid)
      ctx.lineWidth = 1.5 / k
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Pass 1: circles with avatar or initials, one font for all nodes.
      // Plain nodes (no photo, not focused, not you) share one fill path
      // and one ring path; initials skip when they'd be under ~7px.
      ctx.font = '11px system-ui'
      const visibleNodes: GraphNode[] = []
      const plain: GraphNode[] = []
      const special: GraphNode[] = []
      const avatarImages = avatarImagesRef.current
      for (const node of simNodes) {
        if (node.x == null || node.y == null || !inView(node.x, node.y)) continue
        visibleNodes.push(node)
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        if (!(image instanceof HTMLImageElement) && node.id !== focusId && !node.isSelf) {
          plain.push(node)
        } else {
          special.push(node)
        }
      }
      // Plain batch first: focused/self/photo nodes paint over it.
      if (plain.length > 0) {
        ctx.beginPath()
        for (const node of plain) {
          ctx.moveTo(node.x! + node.r, node.y!)
          ctx.arc(node.x!, node.y!, node.r, 0, Math.PI * 2)
        }
        ctx.fillStyle = '#2b2926'
        ctx.fill()
        ctx.lineWidth = 1.5 / k
        ctx.strokeStyle = '#7d786f'
        ctx.stroke()
        if (k * 11 >= 7) {
          ctx.fillStyle = '#ece8e1'
          for (const node of plain) ctx.fillText(node.initials, node.x!, node.y!)
        }
      }
      for (const node of special) {
        const isFocus = node.id === focusId
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        // The self node is the anchor of every "how you connect" query:
        // it gets the accent ring even when not focused.
        const ring = isFocus || node.isSelf ? '#d8a657' : '#7d786f'
        const r = node.r
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
          ctx.lineWidth = (node.isSelf ? 2.5 : 1.5) / k
          ctx.strokeStyle = ring
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r, 0, Math.PI * 2)
          ctx.fillStyle = isFocus ? '#d8a657' : '#2b2926'
          ctx.fill()
          ctx.lineWidth = (node.isSelf ? 2.5 : 1.5) / k
          ctx.strokeStyle = ring
          ctx.stroke()
          ctx.fillStyle = isFocus ? '#17140f' : '#ece8e1'
          ctx.fillText(node.initials, node.x!, node.y!)
        }
        ctx.lineWidth = 1.5 / k
      }
      // Pass 2: name labels — thinned out on big graphs (§4.3 degradation).
      // Density, not just count, decides when names help: a 2-hop ego
      // view of 85 people is a wall of text at 0.7; ten people in a
      // circle deserve names even at the bubble's wider fit.
      const n = simNodes.length
      const labelZoom = n > LABEL_MAX_NODES ? 1.2 : n > 60 ? 1.0 : n <= 30 ? 0.55 : LABEL_ZOOM
      if (k >= labelZoom) {
        // Names get the same dark halo as circle labels and skip when
        // they'd overprint a neighbour's name (the first one drawn wins).
        ctx.font = `${11 / k}px system-ui`
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = 'rgba(13, 12, 11, 0.85)'
        const lineH = 13 / k
        const nameBoxes: { x: number; y: number; w: number; h: number }[] = []
        for (const node of visibleNodes) {
          const text = node.isSelf ? `${node.name} (you)` : node.name
          const w = ctx.measureText(text).width
          const y = node.y! + node.r + 12 / k
          const box = { x: node.x! - w / 2, y: y - lineH, w, h: lineH }
          if (nameBoxes.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) continue
          nameBoxes.push(box)
          ctx.strokeText(text, node.x!, y)
          ctx.fillStyle = '#8b857a'
          ctx.fillText(text, node.x!, y)
        }
      }
      // Circle names last, over everything, with a dark halo. They scale
      // with zoom (floor 9px) and vanish when zoomed far out, truncate to
      // their bubble's width, and dodge nodes and each other.
      if (k >= 0.45) {
        const fontPx = Math.min(12, Math.max(9, 12 * k)) / k
        const lineH = fontPx * 1.3
        ctx.font = `600 ${fontPx}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3.5 / k
        ctx.strokeStyle = 'rgba(13, 12, 11, 0.85)'
        const placed: { x: number; y: number; w: number; h: number }[] = []
        const nodeBoxes = visibleNodes.map((nd) => ({
          x: nd.x! - nd.r,
          y: nd.y! - nd.r,
          w: nd.r * 2,
          h: nd.r * 2 + 14 / k,
        }))
        const overlaps = (b: { x: number; y: number; w: number; h: number }) => (o: typeof b) =>
          b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y
        const hits = (b: { x: number; y: number; w: number; h: number }) =>
          placed.some(overlaps(b)) || nodeBoxes.some(overlaps(b))
        for (const c of circlesNow) {
          const hull = hulls.get(c.id)
          if (!hull || hull.length === 0) continue
          const xs = hull.map((p) => p.x)
          const bubbleW = Math.max(...xs) - Math.min(...xs) + HULL_PAD * 2
          let text = c.name
          while (text.length > 3 && ctx.measureText(text).width > Math.max(bubbleW, 160 / k)) {
            text = text.slice(0, -2).trimEnd() + '…'
          }
          const w = ctx.measureText(text).width
          const cxLabel = hull.reduce((s, p) => s + p.x, 0) / hull.length
          let ly = Math.min(...hull.map((p) => p.y)) - HULL_PAD - 4 / k
          // Keep the name on screen when the bubble's top is scrolled off.
          ly = Math.max(ly, minY + NODE_R * 2 + lineH)
          let box = { x: cxLabel - w / 2, y: ly - lineH, w, h: lineH }
          for (let tries = 0; tries < 4 && hits(box); tries++) {
            ly -= lineH
            box = { ...box, y: ly - lineH }
          }
          placed.push(box)
          ctx.strokeText(text, cxLabel, ly)
          ctx.fillStyle = c.color
          ctx.fillText(text, cxLabel, ly)
        }
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
      if (sizeChanged && !userMoved) refit?.()
      scheduleRender()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement!)
    resize()

    // Center and zoom the viewport onto a set of node ids (all, or a path).
    const fitTo = (ids: Iterable<string>, maxK: number) => {
      const points = [...ids]
        .map((id) => positions.get(id))
        .filter((p): p is { x: number; y: number } => Boolean(p))
      if (points.length === 0) return
      const minX = Math.min(...points.map((p) => p.x))
      const maxX = Math.max(...points.map((p) => p.x))
      const minY = Math.min(...points.map((p) => p.y))
      const maxY = Math.max(...points.map((p) => p.y))
      const pad = circlesRef.current.length > 0 ? HULL_PAD + 18 + NODE_R : NODE_R * 4
      const spanX = maxX - minX + pad * 2
      const spanY = maxY - minY + pad * 2
      const k = Math.min(maxK, Math.max(0.2, Math.min(width / spanX, height / spanY)))
      transform.k = k
      transform.x = -((minX + maxX) / 2) * k
      transform.y = -((minY + maxY) / 2) * k
      scheduleRender()
    }
    const fitAll = () => fitTo(simNodes.map((n) => n.id), 1.4)
    refit = fitAll

    viewApiRef.current = {
      zoom: (factor) => {
        userMoved = true
        transform.k = Math.min(4, Math.max(0.15, transform.k * factor))
        scheduleRender()
      },
      fit: fitAll,
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
    } else if (!hasCachedPositions) {
      // First layout of this session: fit everyone once it has settled,
      // so nobody starts off-screen (orphans, big casts on a phone).
      simulation.on('end', fitAll)
      // Reduced motion: still give the ResizeObserver a beat to report a
      // size, or the fit runs against a zero-width canvas and clips.
      fitTimer = setTimeout(fitAll, reduceMotion ? 50 : 900)
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

    const releaseDrag = () => {
      if (dragNode) {
        dragNode.fx = null
        dragNode.fy = null
      }
      if (dragging) simulation.alphaTarget(0)
      dragNode = null
      dragging = false
    }

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = 0
      if (pointers.size === 1) {
        const hit = hitTest(e.clientX, e.clientY)
        dragNode = hit && 'name' in hit ? (hit as GraphNode) : null
        dragging = false
      } else if (pointers.size === 2) {
        // Second finger means pinch — cleanly release any node drag so it
        // isn't pinned with the simulation reheated forever.
        releaseDrag()
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
        scheduleRender()
      } else if (dragNode) {
        // Reheat only once an actual drag starts, so a plain tap doesn't
        // shift the layout.
        if (!dragging && moved > 6) {
          dragging = true
          canvas.dataset.layout = 'running'
          simulation.alphaTarget(0.3).restart()
        }
        if (dragging) {
          const p = toGraphCoords(e.clientX, e.clientY)
          dragNode.fx = p.x
          dragNode.fy = p.y
        }
      } else {
        userMoved = true
        transform.x += dx
        transform.y += dy
        scheduleRender()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (moved < 6 && pointers.size === 0) {
        const hit = hitTest(e.clientX, e.clientY, e.pointerType === 'touch')
        if (hit && 'name' in hit) onTap({ kind: 'node', id: (hit as GraphNode).id })
        else if (hit) onTap(hit as Tap)
        else onTap(null)
      }
      releaseDrag()
      pinchDist = 0
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMoved = true
      const factor = Math.exp(-e.deltaY * 0.002)
      const next = Math.min(4, Math.max(0.15, transform.k * factor))
      const rect = canvas.getBoundingClientRect()
      const cx = e.clientX - rect.left - width / 2
      const cy = e.clientY - rect.top - height / 2
      transform.x = cx - ((cx - transform.x) / transform.k) * next
      transform.y = cy - ((cy - transform.y) / transform.k) * next
      transform.k = next
      scheduleRender()
    }

    // Hover affordance (desktop): pointer cursor over a node or edge; a
    // double-click on a node opens the dossier.
    const onHover = (e: PointerEvent) => {
      if (pointers.size > 0 || e.pointerType === 'touch') return
      const hit = hitTest(e.clientX, e.clientY)
      canvas.style.cursor = hit ? 'pointer' : 'grab'
    }
    const onDblClick = (e: MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY)
      if (hit && 'name' in hit) onOpen((hit as GraphNode).id)
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
          fitAll()
          return
        default:
          return
      }
      e.preventDefault()
      scheduleRender()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointermove', onHover)
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
      simulation.stop()
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointermove', onHover)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, focusId, circleFocusId, onTap, onOpen, vault, pathNodeIds, viewApiRef, onLayout])

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
