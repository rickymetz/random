import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  selectPeople,
  selectRelationships,
  selectRelationshipTypes,
  useVaultStore,
} from '../store/vaultStore'

interface GraphNode extends SimulationNodeDatum {
  id: string
  name: string
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  color: string
  dashed: boolean
  directed: boolean
}

const NODE_R = 14
const LABEL_ZOOM = 0.7

/**
 * The relationship graph (§4.3): force-directed canvas with pan/zoom/drag,
 * relationship-type filters, mention-edge toggle, ego view via ?focus=,
 * and tap-through to dossiers.
 */
export default function GraphPage() {
  const records = useVaultStore((s) => s.records)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const focusId = params.get('focus')

  const types = useMemo(
    () => selectRelationshipTypes(records).sort((a, b) => a.label.localeCompare(b.label)),
    [records],
  )
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [showMentions, setShowMentions] = useState(true)

  const { nodes, links } = useMemo(() => {
    const typeById = new Map(types.map((t) => [t.id, t]))
    const people = selectPeople(records)
    let edges = selectRelationships(records).filter((e) => {
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
    const nodes: GraphNode[] = visiblePeople.map((p) => ({ id: p.id, name: p.displayName }))
    const links: GraphLink[] = edges
      .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
      .map((e) => ({
        source: e.fromId,
        target: e.toId,
        color: typeById.get(e.typeId)?.color ?? '#55555e',
        dashed: e.origin === 'mention',
        directed: (typeById.get(e.typeId)?.directed ?? false) && e.origin === 'explicit',
      }))
    return { nodes, links }
  }, [records, types, hiddenTypes, showMentions, focusId])

  const focusName = focusId
    ? selectPeople(records).find((p) => p.id === focusId)?.displayName
    : undefined

  const onTapNode = useCallback(
    (personId: string) => navigate(`/person/${personId}`),
    [navigate],
  )
  const canvasRef = useCanvasGraph(nodes, links, focusId, onTapNode)

  return (
    <div className="graph">
      <div className="graph-controls">
        {focusName && (
          <span className="chip focus-chip">
            {focusName}’s world
            <button className="subtle" onClick={() => setParams({})} aria-label="Show everyone">
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
              style={{ borderColor: t.color }}
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
          onClick={() => setShowMentions((v) => !v)}
        >
          mentions
        </button>
      </div>
      {nodes.length === 0 ? (
        <p className="hint">
          No people yet — <Link to="/">add someone</Link> and connect them.
        </p>
      ) : (
        <canvas ref={canvasRef} className="graph-canvas" />
      )}
    </div>
  )
}

function useCanvasGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  focusId: string | null,
  onTapNode: (id: string) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Positions persist per mount; d3 mutates these copies, not the store.
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }))
    const simLinks: GraphLink[] = links.map((l) => ({ ...l }))

    let width = 0
    let height = 0
    const transform = { x: 0, y: 0, k: 1 }
    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect()
      width = rect.width
      height = Math.max(320, window.innerHeight - rect.top - 24)
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.height = `${height}px`
      render()
    }

    const simulation: Simulation<GraphNode, GraphLink> = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(simLinks)
          .id((n) => n.id)
          .distance(90),
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide(NODE_R * 1.6))
      .on('tick', () => render())

    function render() {
      ctx!.save()
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      ctx!.scale(dpr, dpr)
      ctx!.translate(width / 2 + transform.x, height / 2 + transform.y)
      ctx!.scale(transform.k, transform.k)

      for (const link of simLinks) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.x == null || t.x == null) continue
        ctx!.beginPath()
        ctx!.strokeStyle = link.color
        ctx!.globalAlpha = link.dashed ? 0.5 : 0.8
        ctx!.lineWidth = 1.5 / transform.k
        ctx!.setLineDash(link.dashed ? [4 / transform.k, 4 / transform.k] : [])
        ctx!.moveTo(s.x!, s.y!)
        ctx!.lineTo(t.x!, t.y!)
        ctx!.stroke()
        if (link.directed) {
          // Arrowhead just outside the target node.
          const angle = Math.atan2(t.y! - s.y!, t.x! - s.x!)
          const ax = t.x! - Math.cos(angle) * (NODE_R + 4)
          const ay = t.y! - Math.sin(angle) * (NODE_R + 4)
          const size = 6 / Math.sqrt(transform.k)
          ctx!.setLineDash([])
          ctx!.beginPath()
          ctx!.moveTo(ax, ay)
          ctx!.lineTo(ax - size * Math.cos(angle - 0.5), ay - size * Math.sin(angle - 0.5))
          ctx!.lineTo(ax - size * Math.cos(angle + 0.5), ay - size * Math.sin(angle + 0.5))
          ctx!.closePath()
          ctx!.fillStyle = link.color
          ctx!.fill()
        }
      }

      ctx!.globalAlpha = 1
      ctx!.setLineDash([])
      for (const node of simNodes) {
        if (node.x == null) continue
        const isFocus = node.id === focusId
        ctx!.beginPath()
        ctx!.arc(node.x!, node.y!, NODE_R, 0, Math.PI * 2)
        ctx!.fillStyle = isFocus ? '#4f9cf9' : '#2c2c34'
        ctx!.fill()
        ctx!.strokeStyle = isFocus ? '#e8e8ec' : '#4f9cf9'
        ctx!.lineWidth = 1.5 / transform.k
        ctx!.stroke()
        const initials = node.name
          .split(/\s+/)
          .map((w) => w[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
        ctx!.fillStyle = '#e8e8ec'
        ctx!.font = `${11}px system-ui`
        ctx!.textAlign = 'center'
        ctx!.textBaseline = 'middle'
        ctx!.fillText(initials, node.x!, node.y!)
        if (transform.k >= LABEL_ZOOM) {
          ctx!.font = `${11 / transform.k}px system-ui`
          ctx!.fillStyle = '#8a8a94'
          ctx!.fillText(node.name, node.x!, node.y! + NODE_R + 12 / transform.k)
        }
      }
      ctx!.restore()
    }

    const toGraphCoords = (clientX: number, clientY: number) => {
      const rect = canvas!.getBoundingClientRect()
      return {
        x: (clientX - rect.left - width / 2 - transform.x) / transform.k,
        y: (clientY - rect.top - height / 2 - transform.y) / transform.k,
      }
    }

    const hitNode = (clientX: number, clientY: number): GraphNode | null => {
      const p = toGraphCoords(clientX, clientY)
      for (const node of simNodes) {
        if (node.x == null) continue
        const dx = p.x - node.x!
        const dy = p.y - node.y!
        if (dx * dx + dy * dy <= NODE_R * NODE_R * 1.4) return node
      }
      return null
    }

    // Pointer state: one pointer pans or drags a node; two pinch-zoom.
    const pointers = new Map<number, { x: number; y: number }>()
    let dragNode: GraphNode | null = null
    let moved = 0
    let pinchDist = 0

    const onPointerDown = (e: PointerEvent) => {
      canvas!.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = 0
      if (pointers.size === 1) {
        dragNode = hitNode(e.clientX, e.clientY)
        if (dragNode) {
          simulation.alphaTarget(0.3).restart()
          const p = toGraphCoords(e.clientX, e.clientY)
          dragNode.fx = p.x
          dragNode.fy = p.y
        }
      } else if (pointers.size === 2) {
        dragNode = null
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
        if (pinchDist > 0) {
          const factor = dist / pinchDist
          transform.k = Math.min(4, Math.max(0.15, transform.k * factor))
        }
        pinchDist = dist
        render()
      } else if (dragNode) {
        const p = toGraphCoords(e.clientX, e.clientY)
        dragNode.fx = p.x
        dragNode.fy = p.y
      } else {
        transform.x += dx
        transform.y += dy
        render()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (dragNode) {
        simulation.alphaTarget(0)
        dragNode.fx = null
        dragNode.fy = null
        if (moved < 6) onTapNode(dragNode.id)
        dragNode = null
      }
      pinchDist = 0
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.002)
      const next = Math.min(4, Math.max(0.15, transform.k * factor))
      // Zoom around the cursor.
      const rect = canvas!.getBoundingClientRect()
      const cx = e.clientX - rect.left - width / 2
      const cy = e.clientY - rect.top - height / 2
      transform.x = cx - ((cx - transform.x) / transform.k) * next
      transform.y = cy - ((cy - transform.y) / transform.k) * next
      transform.k = next
      render()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', resize)
    resize()

    return () => {
      simulation.stop()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', resize)
    }
  }, [nodes, links, focusId, onTapNode])

  return canvasRef
}
