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
  // A pull-down follows the finger, as a native sheet does: from the
  // grabber always, and from anywhere in the sheet while its content is
  // scrolled to the top (a scroll and a pull must not fight). A short
  // pull springs back; past 60px it dismisses. Text fields are left to
  // the keyboard: a drag that starts on one selects text instead.
  const drag = useRef<{ y: number; active: boolean } | null>(null)
  const settle = (el: HTMLElement) => {
    el.style.transition = 'transform 160ms ease-out'
    el.style.transform = ''
    window.setTimeout(() => {
      el.style.transition = ''
    }, 180)
  }
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
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          const target = e.target as HTMLElement
          const onGrabber = Boolean(target.closest('.sheet-grabber'))
          if (!onGrabber && target.closest('input, textarea, select, [contenteditable]')) return
          const el = e.currentTarget
          if (!onGrabber && el.scrollTop > 0) return
          drag.current = { y: e.clientY, active: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dy = e.clientY - d.y
          if (!d.active) {
            // Commit to the pull only once it is clearly downward.
            if (dy < 8) return
            d.active = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          e.currentTarget.style.transform = `translateY(${Math.max(0, dy)}px)`
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d?.active) return
          const dy = e.clientY - d.y
          if (dy > 60) onDismiss()
          else settle(e.currentTarget)
        }}
        onPointerCancel={(e) => {
          if (drag.current?.active) settle(e.currentTarget)
          drag.current = null
        }}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        {children}
      </div>
    </>
  )
}
