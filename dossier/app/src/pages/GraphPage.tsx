import { selectPeople, selectRelationships, useVaultStore } from '../store/vaultStore'

/**
 * Relationship graph stub. The real thing is a d3-force simulation on a
 * canvas with pan/zoom/drag, type/tag filters, and ego view
 * (REQUIREMENTS.md §4.3). For now: proof the data reaches this page.
 */
export default function GraphPage() {
  const records = useVaultStore((s) => s.records)
  const people = selectPeople(records)
  const edges = selectRelationships(records)

  return (
    <div className="graph">
      <p className="hint">
        Graph canvas goes here — {people.length} people, {edges.length} edges in the vault.
      </p>
    </div>
  )
}
