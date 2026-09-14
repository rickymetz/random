import { useState } from 'react'

/** A destructive action asks in place — never a browser dialog. */
export default function DangerConfirm({
  label,
  question,
  onConfirm,
  className = '',
}: {
  label: string
  question: string
  onConfirm: () => void
  className?: string
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" className={`danger ${className}`} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm-row" role="group" aria-label={question}>
      <span className="hint">{question}</span>
      <button type="button" className="danger" onClick={onConfirm} autoFocus>
        {label}
      </button>
      <button type="button" className="subtle" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  )
}
