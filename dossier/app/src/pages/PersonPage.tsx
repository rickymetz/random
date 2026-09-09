import { useParams } from 'react-router-dom'
import { useVaultStore } from '../store/vaultStore'

/**
 * Dossier view stub. Grows into: avatar + key facts above the fold,
 * quick-capture inbox, notes with @mentions, follow-ups, relationships
 * list, and the ego-graph entry point (REQUIREMENTS.md §4.1–4.3).
 */
export default function PersonPage() {
  const { id } = useParams()
  const records = useVaultStore((s) => s.records)
  const person = id ? records.get(id) : undefined

  if (!person || person.kind !== 'person') return <p>Not found.</p>

  return (
    <article className="person">
      <h1>{person.displayName}</h1>
      <dl>
        {person.jobTitle && (
          <>
            <dt>Job</dt>
            <dd>
              {person.jobTitle}
              {person.employer ? ` @ ${person.employer}` : ''}
            </dd>
          </>
        )}
        {person.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{person.tags.join(', ')}</dd>
          </>
        )}
      </dl>
      <p className="hint">Notes, follow-ups, and relationships land here next.</p>
    </article>
  )
}
