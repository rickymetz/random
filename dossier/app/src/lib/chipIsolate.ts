/**
 * Chips filter by isolation, not subtraction. A tap on a full rail leaves
 * that one chip on, which is what you want nine times in ten: "just the
 * family", "just my colleagues". After that taps are ordinary — an off
 * chip comes back, an on chip drops out — and the tap that would empty
 * the rail puts every chip back instead, so a group never goes dark and
 * you are never one tap from a graph you can't read.
 */
export function toggleIsolate(hidden: Set<string>, pool: string[], id: string): Set<string> {
  const shown = pool.filter((x) => !hidden.has(x))
  // Nothing hidden yet: isolate.
  if (shown.length === pool.length && pool.length > 1) {
    return new Set(pool.filter((x) => x !== id))
  }
  // The last one standing, tapped again: back to everything.
  if (shown.length === 1 && shown[0] === id) return new Set()
  const next = new Set(hidden)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** What the next tap on this chip will do, for its title and label. */
export function chipAction(hidden: Set<string>, pool: string[], id: string, label: string): string {
  const shown = pool.filter((x) => !hidden.has(x))
  if (shown.length === pool.length && pool.length > 1) return `Show only ${label}`
  if (shown.length === 1 && shown[0] === id) return 'Show all again'
  return hidden.has(id) ? `Add ${label} back` : `Hide ${label}`
}
