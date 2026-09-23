import { useEffect, useLayoutEffect, type RefObject } from 'react'

/**
 * A box that grows to what you typed.
 *
 * A long answer in a two-row peephole is unreadable and worse to edit:
 * you scroll a window instead of seeing the thing you wrote. These boxes
 * take the height of their content and stop at `maxRows`, scrolling from
 * there so a very long note can't push Save off the screen.
 *
 * Measured rather than assumed — line height follows the system text
 * size (§ Dynamic Type), so a fixed pixel guess would be wrong at 200%.
 */
export function useGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxRows = 12,
) {
  useLayoutEffect(() => fit(ref.current, maxRows), [ref, value, maxRows])
  // Text rewraps when the width changes (a rotation, the desktop column),
  // and a box laid out while hidden measured nothing: fit again then too,
  // not only on the next keystroke.
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit(el, maxRows)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, maxRows])
}

function fit(el: HTMLTextAreaElement | null, maxRows: number): void {
  if (!el) return
  const style = getComputedStyle(el)
  const line = parseFloat(style.lineHeight) || 20
  // border-box everywhere, so scrollHeight covers the padding but not
  // the border: add it back or the box loses a hairline every keystroke.
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  const max = line * maxRows + pad + border
  el.style.height = 'auto'
  const wanted = el.scrollHeight + border
  // Only the ceiling is ours. A floor belongs to the stylesheet, which
  // may be animating it (the capture bar eases open on focus): reading
  // min-height here would freeze the box at whatever the transition
  // happened to be passing through.
  el.style.height = `${Math.min(wanted, max)}px`
  el.style.overflowY = wanted > max ? 'auto' : 'hidden'
}
