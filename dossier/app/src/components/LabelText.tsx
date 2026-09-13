import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Form rule: a label's description sits inline in parentheses while the
 * whole label fits on one line; once it would wrap, the description drops
 * to its own small, subtle line so the label itself stays one line.
 * Measured live (the same label may fit on a tablet and wrap on a phone).
 */
export default function LabelText({ text, desc }: { text: string; desc?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !desc) return
    const measure = () => {
      // Measure the inline form, then decide.
      el.classList.remove('stacked')
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
      const wraps = el.getBoundingClientRect().height > lineHeight * 1.5
      el.classList.toggle('stacked', wraps)
      setStacked(wraps)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el.parentElement ?? el)
    return () => ro.disconnect()
  }, [desc, text])
  return (
    <span ref={ref} className={`label-text${stacked ? ' stacked' : ''}`}>
      <span className="lt-main">{text}</span>
      {desc && <span className="lt-desc">{desc}</span>}
    </span>
  )
}
