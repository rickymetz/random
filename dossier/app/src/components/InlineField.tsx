import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Form rule: a label and its control share one row (label left, control
 * at the right edge) while the label fits on one line. Once the label
 * would wrap to two or more lines, the row goes block-level: label above,
 * control full width. Measured live, like LabelText.
 */
export default function InlineField({
  label,
  desc,
  children,
  className = '',
}: {
  label: string
  desc?: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLLabelElement>(null)
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const text = el.querySelector<HTMLElement>('.if-label')
    if (!text) return
    const measure = () => {
      el.classList.remove('stacked')
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 20
      const wraps = text.getBoundingClientRect().height > lineHeight * 1.5
      el.classList.toggle('stacked', wraps)
      setStacked(wraps)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el.parentElement ?? el)
    return () => ro.disconnect()
  }, [label, desc])
  return (
    <label ref={ref} className={`inline-field ${className}${stacked ? ' stacked' : ''}`}>
      <span className="if-label">
        {label}
        {desc && <span className="lt-desc">{desc}</span>}
      </span>
      {children}
    </label>
  )
}
