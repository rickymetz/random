import { useState, type ReactNode } from 'react'

/** A destructive action asks in place — never a browser dialog. The
 * trigger can be an icon button (a note's ×); the confirming button
 * always says the verb. */
export default function DangerConfirm({
  label,
  question,
  onConfirm,
  className = '',
  trigger,
  triggerClassName,
  triggerAriaLabel,
  keepLabel = 'Keep',
}: {
  /** The verb on the confirming button ("Delete", "Remove"). */
  label: string
  question: string
  onConfirm: () => void
  className?: string
  /** Custom content for the first-stage button; defaults to `label`. */
  trigger?: ReactNode
  /** Classes for the first-stage button; defaults to a danger button. */
  triggerClassName?: string
  triggerAriaLabel?: string
  keepLabel?: string
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button
        type="button"
        className={triggerClassName ?? `danger ${className}`}
        aria-label={triggerAriaLabel}
        title={triggerAriaLabel}
        onClick={() => setAsking(true)}
      >
        {trigger ?? label}
      </button>
    )
  }
  return (
    <span className={`confirm-row ${className}`} role="group" aria-label={question}>
      <span className="hint">{question}</span>
      <button type="button" className="danger" onClick={onConfirm} autoFocus>
        {label}
      </button>
      <button type="button" className="subtle" onClick={() => setAsking(false)}>
        {keepLabel}
      </button>
    </span>
  )
}
