import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { selectPeople, useVaultStore } from '../store/vaultStore'
import type { Person } from '../lib/models'

/**
 * Search-first home screen (scenario S2). The naive filter below is the
 * placeholder for the in-memory full-text index (MiniSearch) that covers
 * notes, fields, and tags.
 */
export default function PeoplePage() {
  const records = useVaultStore((s) => s.records)
  const upsert = useVaultStore((s) => s.upsert)
  const [query, setQuery] = useState('')

  const people = useMemo(() => {
    const all = selectPeople(records).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    )
    if (!query) return all
    const q = query.toLowerCase()
    return all.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.nicknames.some((n) => n.toLowerCase().includes(q)) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [records, query])

  const addPerson = async () => {
    const name = query.trim() || 'New person'
    const person: Person = {
      kind: 'person',
      id: crypto.randomUUID(),
      displayName: name,
      nicknames: [],
      likes: [],
      dislikes: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await upsert(person)
    setQuery('')
  }

  return (
    <div className="people">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people…"
      />
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <Link to={`/person/${p.id}`}>{p.displayName}</Link>
          </li>
        ))}
      </ul>
      <button onClick={addPerson}>+ {query.trim() ? `Add “${query.trim()}”` : 'New person'}</button>
    </div>
  )
}
