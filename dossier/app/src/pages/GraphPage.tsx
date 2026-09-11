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
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { selectSelf, shortestPath } from '../lib/graphQueries'
import type { Relationship } from '../lib/models'
import { getPhotoUrl } from '../lib/photoCache'
import type { UnlockedVault } from '../lib/vault'
import {
  selectAvatar,
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

/** Pan/zoom/fit handles the React controls call into the canvas effect. */
interface ViewApi {
  zoom: (factor: number) => void
  fit: () => void
}

/** Filter state survives leaving and returning (per browser session). */
const FILTER_KEY = 'graph-filters'
function loadFilters(): { hidden: string[]; mentions: boolean } {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY)
    if (raw) return JSON.parse(raw) as { hidden: string[]; mentions: boolean }
  } catch {
    // Private windows may refuse; defaults are fine.
  }
  return { hidden: [], mentions: true }
}
function saveFilters(hidden: Set<string>, mentions: boolean): void {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({ hidden: [...hidden], mentions }))
  } catch {
    // ignore
  }
}

function nodeRadius(degree: number): number {
  return Math.min(NODE_R * 1.6, NODE_R * (0.85 + 0.25 * Math.log2(1 + degree)))
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  edgeId: string
  color: string
  dashed: boolean
  directed: boolean
  /** Part of the highlighted "how you connect" path (§4.4). */
  highlighted: boolean
}

type Tap = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

const NODE_R = 14
const LABEL_ZOOM = 0.7
// Degradation ladder (§4.3): labels thin out first as the graph grows.
const LABEL_MAX_NODES = 250

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
  const focusId = params.get('focus')
  const depth = params.get('depth') === '2' ? 2 : 1
  const pathTargetId = params.get('path')
  const [peek, setPeek] = useState<Tap>(null)
  const viewApiRef = useRef<ViewApi | null>(null)

  const types = useMemo(
    () => selectRelationshipTypes(records).sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(loadFilters().hidden),
  )
  const [showMentions, setShowMentions] = useState(() => loadFilters().mentions)
  useEffect(() => {
    saveFilters(hiddenTypes, showMentions)
  }, [hiddenTypes, showMentions])

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

  const { nodes, links } = useMemo(() => {
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
    if (focusId) {
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
        color: typeById.get(e.typeId)?.color ?? '#5a554c',
        dashed: e.origin === 'mention',
        directed: (typeById.get(e.typeId)?.directed ?? false) && e.origin === 'explicit',
        highlighted: pathInfo?.edgeIds.has(e.id) ?? false,
      }))
    return { nodes, links }
  }, [records, types, hiddenTypes, showMentions, focusId, depth, pathInfo])

  const focusName = useMemo(() => {
    if (!focusId) return undefined
    const p = records.get(focusId)
    return p?.kind === 'person' ? p.displayName : undefined
  }, [records, focusId])

  const vault = useVaultStore((s) => s.vault)
  const onTap = useCallback((tap: Tap) => setPeek(tap), [])
  const onOpen = useCallback((id: string) => navigate(`/person/${id}`), [navigate])
  const pathNodeIds = pathInfo?.reason === 'ok' ? pathInfo.nodeIds : null
  const canvasRef = useCanvasGraph(
    nodes,
    links,
    focusId,
    onTap,
    onOpen,
    vault,
    pathNodeIds,
    viewApiRef,
  )

  const setDepth = (d: 1 | 2) => {
    const next = new URLSearchParams(params)
    if (d === 2) next.set('depth', '2')
    else next.delete('depth')
    setParams(next)
  }

  return (
    <div className="graph">
      <h1 className="sr-only">Graph</h1>
      <div className="graph-controls">
        {focusName && (
          <span className="chip focus-chip no-dot depth">
            {focusName}’s connections
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
                setParams(next)
              }}
              aria-label="Show everyone"
            >
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
        <button
          className={`chip ${showMentions ? '' : 'off'}`}
          aria-pressed={showMentions}
          onClick={() => setShowMentions((v) => !v)}
        >
          mentions
        </button>
      </div>
      <p className="graph-legend">
        Tap a label to hide or show that kind of link. Dotted line = mentioned in a
        note. Tap a circle for details; bigger circles know more people.
      </p>
      {nodes.length === 0 || (links.length === 0 && nodes.length <= 1) ? (
        <p className="empty">
          No people yet — <Link to="/">add someone</Link> and connect them, or load the
          sample cast from <Link to="/settings">Settings</Link> to see the graph in action.
        </p>
      ) : (
        <div className="graph-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="graph-canvas"
            tabIndex={0}
            role="application"
            aria-label={`Relationship graph: ${nodes.length} people, ${links.length} connections. Arrow keys pan, plus and minus zoom, 0 fits everyone. Person pages list the same relationships as text.`}
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
          {peek?.kind === 'node' && (
            <NodePeek
              personId={peek.id}
              onClose={() => setPeek(null)}
              onOpen={() => navigate(`/person/${peek.id}`)}
              onFocus={() => {
                setParams({ focus: peek.id })
                setPeek(null)
              }}
            />
          )}
          {peek?.kind === 'edge' && <EdgePeek edgeId={peek.id} onClose={() => setPeek(null)} />}
        </div>
      )}
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
        <strong>{person.displayName}</strong>
        {detail && <span className="hint">{detail}</span>}
      </div>
      <div className="row">
        <button onClick={onOpen}>Open</button>
        <button className="subtle" onClick={onFocus}>
          Their connections
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
          <option value="">retype…</option>
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

function useCanvasGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  focusId: string | null,
  onTap: (tap: Tap) => void,
  onOpen: (personId: string) => void,
  vault: UnlockedVault | null,
  pathNodeIds: string[] | null,
  viewApiRef: MutableRefObject<ViewApi | null>,
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const positions = positionsRef.current
    const transform = transformRef.current
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n, ...positions.get(n.id) }))
    const simLinks: GraphLink[] = links.map((l) => ({ ...l }))
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
      .force('collide', forceCollide<GraphNode>((n) => n.r * 1.5))
      // A warm layout barely stirs; a cold one settles from scratch.
      .alpha(hasCachedPositions ? 0.08 : 1)

    let rafPending = false
    const scheduleRender = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        render()
      })
    }

    simulation.on('tick', () => {
      for (const n of simNodes) {
        if (n.x !== undefined && n.y !== undefined) positions.set(n.id, { x: n.x, y: n.y })
      }
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

      const dash: [number, number] = [4 / k, 4 / k]
      const solid: never[] = []
      for (const link of simLinks) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.x == null || t.x == null) continue
        if (!inView(s.x, s.y!) && !inView(t.x, t.y!)) continue
        ctx.beginPath()
        ctx.strokeStyle = link.color
        ctx.globalAlpha = link.highlighted ? 1 : link.dashed ? 0.5 : 0.8
        ctx.lineWidth = (link.highlighted ? 3.5 : 1.5) / k
        ctx.setLineDash(link.dashed ? dash : solid)
        ctx.moveTo(s.x, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
        if (link.directed) {
          const angle = Math.atan2(t.y! - s.y!, t.x! - s.x!)
          const ax = t.x! - Math.cos(angle) * (t.r + 4)
          const ay = t.y! - Math.sin(angle) * (t.r + 4)
          const size = 6 / Math.sqrt(k)
          ctx.setLineDash(solid)
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(ax - size * Math.cos(angle - 0.5), ay - size * Math.sin(angle - 0.5))
          ctx.lineTo(ax - size * Math.cos(angle + 0.5), ay - size * Math.sin(angle + 0.5))
          ctx.closePath()
          ctx.fillStyle = link.color
          ctx.fill()
        }
      }

      ctx.globalAlpha = 1
      ctx.setLineDash(solid)
      ctx.lineWidth = 1.5 / k
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Pass 1: circles with avatar or initials, one font for all nodes.
      ctx.font = '11px system-ui'
      const visibleNodes: GraphNode[] = []
      const avatarImages = avatarImagesRef.current
      for (const node of simNodes) {
        if (node.x == null || node.y == null || !inView(node.x, node.y)) continue
        visibleNodes.push(node)
        const isFocus = node.id === focusId
        // The self node is the anchor of every "how you connect" query:
        // it gets the accent ring even when not focused.
        const ring = isFocus || node.isSelf ? '#d8a657' : '#4a463f'
        const r = node.r
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        if (image instanceof HTMLImageElement) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
          ctx.clip()
          // Cover-crop from a centered square so faces aren't stretched.
          const side = Math.min(image.naturalWidth, image.naturalHeight)
          const sx = (image.naturalWidth - side) / 2
          const sy = (image.naturalHeight - side) / 2
          ctx.drawImage(image, sx, sy, side, side, node.x - r, node.y - r, r * 2, r * 2)
          ctx.restore()
          ctx.beginPath()
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
          ctx.lineWidth = (node.isSelf ? 2.5 : 1.5) / k
          ctx.strokeStyle = ring
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
          ctx.fillStyle = isFocus ? '#d8a657' : '#2b2926'
          ctx.fill()
          ctx.lineWidth = (node.isSelf ? 2.5 : 1.5) / k
          ctx.strokeStyle = ring
          ctx.stroke()
          ctx.fillStyle = isFocus ? '#17140f' : '#ece8e1'
          ctx.fillText(node.initials, node.x, node.y)
        }
        ctx.lineWidth = 1.5 / k
      }
      // Pass 2: name labels — thinned out on big graphs (§4.3 degradation).
      const labelZoom = simNodes.length > LABEL_MAX_NODES ? 1.2 : LABEL_ZOOM
      if (k >= labelZoom) {
        ctx.font = `${11 / k}px system-ui`
        ctx.fillStyle = '#8b857a'
        for (const node of visibleNodes) {
          ctx.fillText(
            node.isSelf ? `${node.name} (you)` : node.name,
            node.x!,
            node.y! + node.r + 12 / k,
          )
        }
      }
      ctx.restore()
    }

    const resize = () => {
      const wrap = canvas.parentElement
      if (!wrap) return
      dpr = window.devicePixelRatio || 1
      width = wrap.clientWidth
      height = wrap.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
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
      const pad = NODE_R * 4
      const spanX = maxX - minX + pad * 2
      const spanY = maxY - minY + pad * 2
      const k = Math.min(maxK, Math.max(0.2, Math.min(width / spanX, height / spanY)))
      transform.k = k
      transform.x = -((minX + maxX) / 2) * k
      transform.y = -((minY + maxY) / 2) * k
      scheduleRender()
    }
    const fitAll = () => fitTo(simNodes.map((n) => n.id), 1.4)

    viewApiRef.current = {
      zoom: (factor) => {
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
    } else if (!hasCachedPositions) {
      // First layout of this session: fit everyone once it has settled,
      // so nobody starts off-screen (orphans, big casts on a phone).
      simulation.on('end', fitAll)
      fitTimer = setTimeout(fitAll, 900)
    }

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
      return bestEdge ? { kind: 'edge', id: bestEdge.edgeId } : null
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let dragNode: GraphNode | null = null
    let dragging = false
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
          simulation.alphaTarget(0.3).restart()
        }
        if (dragging) {
          const p = toGraphCoords(e.clientX, e.clientY)
          dragNode.fx = p.x
          dragNode.fy = p.y
        }
      } else {
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
  }, [nodes, links, focusId, onTap, onOpen, vault, pathNodeIds, viewApiRef])

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
