// Zooming in stops growing the discs at the iOS tap target and opens up
// the space between people instead. Measured off the canvas: the painted
// run through a person's centre, and the screen distance to their
// nearest neighbour, read from the graph's position hook.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
await blur(); await page.click('nav a:has-text("Settings"):visible')
await page.click('button:has-text("Load sample people")')
await page.waitForSelector('text=/Added 14 people/', { timeout: 30000 })
await blur(); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas', { timeout: 30000 })
await page.waitForTimeout(4500)

/**
 * The most central person on screen: their disc's painted width, and how
 * far the nearest other person is. The width is measured symmetrically
 * about the centre so a link or a bubble outline grazing one side can't
 * inflate it; the ring and its antialiasing add a pixel or so each side.
 */
const probe = () => page.evaluate(() => {
  const c = document.querySelector('canvas.graph-canvas')
  const g = c.__graph
  const { width, height } = g.size()
  const t = g.transform
  const dpr = window.devicePixelRatio || 1
  const toScreen = (p) => ({ x: width / 2 + t.x + p.x * t.k, y: height / 2 + t.y + p.y * t.k })
  const all = [...g.positions.entries()].map(([id, p]) => ({ id, s: toScreen(p) }))
  const inside = all.filter((e) => e.s.x > 70 && e.s.x < width - 70 && e.s.y > 70 && e.s.y < height - 70)
  if (inside.length === 0) return null
  const mid = inside.sort((a, b) =>
    Math.hypot(a.s.x - width / 2, a.s.y - height / 2) - Math.hypot(b.s.x - width / 2, b.s.y - height / 2))[0]
  const ctx = c.getContext('2d')
  const cx = Math.round(mid.s.x * dpr)
  const cy = Math.round(mid.s.y * dpr)
  const half = Math.round(70 * dpr)
  const from = Math.max(0, cx - half)
  const row = ctx.getImageData(from, cy, half * 2, 1).data
  const centre = cx - from
  const painted = (i) => row[i * 4 + 3] > 40
  let l = centre, r = centre
  while (l > 0 && painted(l - 1)) l--
  while (r < half * 2 - 1 && painted(r + 1)) r++
  const others = all.filter((e) => e.id !== mid.id)
  return {
    k: t.k,
    diameter: (2 * Math.min(centre - l, r - centre) + 1) / dpr,
    nearest: Math.min(...others.map((e) => Math.hypot(e.s.x - mid.s.x, e.s.y - mid.s.y))),
  }
})
const zoom = async (n) => {
  for (let i = 0; i < n; i++) { await page.click('button[aria-label="Zoom in"]'); await page.waitForTimeout(220) }
  await page.waitForTimeout(700)
}

const atFit = await probe()
if (!atFit) fail('no person near the middle of the canvas to measure')
console.log('fit:', JSON.stringify(atFit))

await zoom(4)
const mid = await probe()
if (!mid) fail('lost the measured person after zooming')
console.log('zoomed in:', JSON.stringify(mid))
// 44px across, plus a ring and its antialiasing on each side.
if (mid.diameter > 52) fail(`a disc grew past the tap target: ${mid.diameter}px at k=${mid.k}`)

await zoom(6)
const far = await probe()
if (!far) fail('lost the measured person at full zoom')
console.log('zoomed further:', JSON.stringify(far))
if (far.k <= mid.k) fail(`zoom did not increase: ${mid.k} → ${far.k}`)
if (far.diameter > 52) fail(`a disc grew past the tap target: ${far.diameter}px at k=${far.k}`)
if (Math.abs(far.diameter - mid.diameter) > 4) {
  fail(`the disc kept changing size past the cap: ${mid.diameter}px → ${far.diameter}px`)
}
if (far.nearest < mid.nearest * 1.3) {
  fail(`zooming past the cap did not open up the space: ${mid.nearest}px → ${far.nearest}px`)
}
console.log(
  `past the cap the disc holds at ~${Math.round(far.diameter)}px while neighbours move ` +
    `${Math.round(mid.nearest)}px → ${Math.round(far.nearest)}px apart`,
)

await browser.close()
console.log('SMOKE24 OK')
