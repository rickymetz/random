import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  avatar?: { blobRecordId: string; mimeType: string }
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
  const pathTargetId = params.get('path')
  const [peek, setPeek] = useState<Tap>(null)

  const types = useMemo(
    () => selectRelationshipTypes(records).sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [showMentions, setShowMentions] = useState(true)

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
      // Ego view: the focused person plus direct connections (§4.3).
      const keep = new Set([focusId])
      for (const e of edges) {
        if (e.fromId === focusId) keep.add(e.toId)
        if (e.toId === focusId) keep.add(e.fromId)
      }
      visiblePeople = people.filter((p) => keep.has(p.id))
      edges = edges.filter((e) => e.fromId === focusId || e.toId === focusId)
    }

    const ids = new Set(visiblePeople.map((p) => p.id))
    const nodes: GraphNode[] = visiblePeople.map((p) => {
      const avatar = selectAvatar(records, p.id)
      return {
        id: p.id,
        name: p.displayName,
        initials: initialsOf(p.displayName),
        avatar: avatar
          ? { blobRecordId: avatar.blobRecordId, mimeType: avatar.mimeType }
          : undefined,
      }
    })
    const links: GraphLink[] = edges
      .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
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
  }, [records, types, hiddenTypes, showMentions, focusId, pathInfo])

  const focusName = useMemo(() => {
    if (!focusId) return undefined
    const p = records.get(focusId)
    return p?.kind === 'person' ? p.displayName : undefined
  }, [records, focusId])

  const vault = useVaultStore((s) => s.vault)
  const onTap = useCallback((tap: Tap) => setPeek(tap), [])
  const pathNodeIds = pathInfo?.reason === 'ok' ? pathInfo.nodeIds : null
  const canvasRef = useCanvasGraph(nodes, links, focusId, onTap, vault, pathNodeIds)

  return (
    <div className="graph">
      <div className="graph-controls">
        {focusName && (
          <span className="chip focus-chip no-dot">
            {focusName}’s world
            <button
              className="subtle"
              onClick={() => clearParam('focus')}
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
      {nodes.length === 0 || (links.length === 0 && nodes.length <= 1) ? (
        <p className="hint">
          No people yet — <Link to="/">add someone</Link> and connect them.
        </p>
      ) : (
        <div className="graph-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="graph-canvas"
            tabIndex={0}
            role="application"
            aria-label={`Relationship graph: ${nodes.length} people, ${links.length} connections. Arrow keys pan, plus and minus zoom, 0 resets. Person pages list the same relationships as text.`}
          />
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
  const person = records.get(personId)
  if (!person || person.kind !== 'person') return null
  const detail = [person.jobTitle, person.employer].filter(Boolean).join(' @ ')
  return (
    <div className="peek-card" role="dialog" aria-label={person.displayName}>
      <div className="peek-body">
        <strong>{person.displayName}</strong>
        {detail && <span className="hint">{detail}</span>}
      </div>
      <div className="row">
        <button onClick={onOpen}>Open</button>
        <button className="subtle" onClick={onFocus}>
          Their world
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
    <div className="peek-card" role="dialog" aria-label="Edit relationship">
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
        <select defaultValue="" onChange={(e) => void retype(e.target.value)} aria-label="Change type">
          <option value="">change type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
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
  vault: UnlockedVault | null,
  pathNodeIds: string[] | null,
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
      .force('collide', forceCollide(NODE_R * 1.6))
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
          const ax = t.x! - Math.cos(angle) * (NODE_R + 4)
          const ay = t.y! - Math.sin(angle) * (NODE_R + 4)
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
        const image = node.avatar ? avatarImages.get(node.avatar.blobRecordId) : undefined
        if (image instanceof HTMLImageElement) {
          ctx.save()
          ctx.beginPath()
          ctx.arc(node.x, node.y, NODE_R, 0, Math.PI * 2)
          ctx.clip()
          // Cover-crop from a centered square so faces aren't stretched.
          const side = Math.min(image.naturalWidth, image.naturalHeight)
          const sx = (image.naturalWidth - side) / 2
          const sy = (image.naturalHeight - side) / 2
          ctx.drawImage(
            image,
            sx,
            sy,
            side,
            side,
            node.x - NODE_R,
            node.y - NODE_R,
            NODE_R * 2,
            NODE_R * 2,
          )
          ctx.restore()
          ctx.beginPath()
          ctx.arc(node.x, node.y, NODE_R, 0, Math.PI * 2)
          ctx.strokeStyle = isFocus ? '#d8a657' : '#4a463f'
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(node.x, node.y, NODE_R, 0, Math.PI * 2)
          ctx.fillStyle = isFocus ? '#d8a657' : '#2b2926'
          ctx.fill()
          ctx.strokeStyle = isFocus ? '#d8a657' : '#4a463f'
          ctx.stroke()
          ctx.fillStyle = isFocus ? '#17140f' : '#ece8e1'
          ctx.fillText(node.initials, node.x, node.y)
        }
      }
      // Pass 2: name labels — thinned out on big graphs (§4.3 degradation).
      const labelZoom = simNodes.length > LABEL_MAX_NODES ? 1.2 : LABEL_ZOOM
      if (k >= labelZoom) {
        ctx.font = `${11 / k}px system-ui`
        ctx.fillStyle = '#8b857a'
        for (const node of visibleNodes) {
          ctx.fillText(node.name, node.x!, node.y! + NODE_R + 12 / k)
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

    // "Show on graph" should actually show it: once the layout has had a
    // moment to settle, center and zoom the viewport onto the path.
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    const fitKey = pathNodeIds?.join(',') ?? ''
    if (pathNodeIds && pathNodeIds.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
      fitTimer = setTimeout(() => {
        const points = pathNodeIds
          .map((id) => positions.get(id))
          .filter((p): p is { x: number; y: number } => Boolean(p))
        if (points.length === 0) return
        const minX = Math.min(...points.map((p) => p.x))
        const maxX = Math.max(...points.map((p) => p.x))
        const minY = Math.min(...points.map((p) => p.y))
        const maxY = Math.max(...points.map((p) => p.y))
        const pad = NODE_R * 6
        const spanX = maxX - minX + pad * 2
        const spanY = maxY - minY + pad * 2
        const k = Math.min(2, Math.max(0.3, Math.min(width / spanX, height / spanY)))
        transform.k = k
        transform.x = -((minX + maxX) / 2) * k
        transform.y = -((minY + maxY) / 2) * k
        scheduleRender()
      }, 700)
    }

    const toGraphCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (clientX - rect.left - width / 2 - transform.x) / transform.k,
        y: (clientY - rect.top - height / 2 - transform.y) / transform.k,
      }
    }

    // Nearest node within a screen-space floor, so zoomed-out nodes stay
    // tappable; then nearest edge segment.
    const hitTest = (clientX: number, clientY: number): Tap | GraphNode | null => {
      const p = toGraphCoords(clientX, clientY)
      const hitR = Math.max(NODE_R, 18 / transform.k)
      let best: GraphNode | null = null
      let bestDist = hitR * hitR
      for (const node of simNodes) {
        if (node.x == null || node.y == null) continue
        const dx = p.x - node.x
        const dy = p.y - node.y
        const d = dx * dx + dy * dy
        if (d <= bestDist) {
          best = node
          bestDist = d
        }
      }
      if (best) return best
      const edgeR = 10 / transform.k
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
        const hit = hitTest(e.clientX, e.clientY)
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
          transform.x = 0
          transform.y = 0
          transform.k = 1
          break
        default:
          return
      }
      e.preventDefault()
      scheduleRender()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('keydown', onKeyDown)

    return () => {
      alive = false
      if (fitTimer !== undefined) clearTimeout(fitTimer)
      simulation.stop()
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKeyDown)
    }
  }, [nodes, links, focusId, onTap, vault, pathNodeIds])

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
