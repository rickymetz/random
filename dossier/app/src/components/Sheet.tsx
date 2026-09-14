import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A bottom sheet for the panels that used to sit in the page (batch add,
 * import, the circle editor): a grabber, a backdrop, Tab kept inside,
 * a swipe down on the grabber to dismiss, and a height that leaves room
 * for the software keyboard (`--kb`, set by App from the visual
 * viewport) so the field you're typing in never ends up under the keys.
 * Escape and focus handling stay with the panel inside, which knows
 * whether closing needs a question first; `onDismiss` is that same path.
 */
export default function Sheet({
  id,
  label,
  labelledBy,
  onDismiss,
  className = '',
  children,
}: {
  id?: string
  label?: string
  labelledBy?: string
  onDismiss: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The page behind must not scroll while a sheet is up.
  useEffect(() => {
    document.body.classList.add('sheet-open')
    return () => document.body.classList.remove('sheet-open')
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const root = ref.current
    if (!root) return
    const focusable = [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  const drag = useRef<number | null>(null)
  return (
    <>
      <div className="sheet-backdrop" onClick={onDismiss} aria-hidden="true" />
      <div
        ref={ref}
        id={id}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
      >
        <div
          className="sheet-grabber"
          aria-hidden="true"
          onPointerDown={(e) => {
            drag.current = e.clientY
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerUp={(e) => {
            if (drag.current !== null && e.clientY - drag.current > 60) onDismiss()
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        />
        {children}
      </div>
    </>
  )
}
