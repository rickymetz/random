// Visual bugs from a phone review.
//
// Also: the tab bar owns the strip beneath it, and the graph fits.
//
// Graph: a circle's name hangs off its own bubble — never lines away,
// where it reads as the label of whoever it lands next to — and every
// bubble gets one. Settings: "Restore" stays one word (a global
// `overflow-wrap: anywhere` let a flex row squeeze it to "Restor / e"),
// and the file choice is the app's own button, not the browser's.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// ---------- Settings: the restore row ----------
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav a:has-text("Settings"):visible')
await page.waitForSelector('h2:has-text("Restore")')
const lines = (sel) => page.locator(sel).evaluate((el) => {
  const r = document.createRange()
  r.selectNodeContents(el)
  return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size
})
const RESTORE = 'section:has(h2:has-text("Restore")) button[type=submit]'
if ((await lines(RESTORE)) !== 1) fail('"Restore" should be one line')
const [btn, input] = await Promise.all([
  page.locator(RESTORE).boundingBox(),
  page.locator('input[aria-label="Backup passphrase"]').boundingBox(),
])
if (Math.abs(btn.y - input.y) > 2 || btn.x < input.x + input.width)
  fail(`Restore should sit beside the passphrase, level with it: ${JSON.stringify({ btn, input })}`)
// At double text size the button may drop below the field, but it must
// never be split mid-word to stay beside it.
await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
await page.waitForTimeout(150)
if ((await lines(RESTORE)) !== 1) fail('at 200% text "Restore" was broken across lines')
await page.evaluate(() => { document.documentElement.style.fontSize = '' })
console.log('Restore stays one word, beside its field and at 200% text')

// The picker is our button over a hidden input, and says what it took.
if ((await page.locator('input[aria-label="Backup file"]').isVisible()))
  fail('the browser’s own file control should not be drawn')
await page.setInputFiles('input[aria-label="Backup file"]', {
  name: 'ledger-backup.ledger', mimeType: 'application/octet-stream', buffer: Buffer.from('{}'),
})
await page.waitForSelector('.file-name:has-text("ledger-backup.ledger")')
if (!(await page.locator('button:has-text("Choose another")').count())) fail('the button should offer another file')
console.log('the backup picker is the app’s own, and names the file')

// ---------- Graph: circle names on their bubbles ----------
await page.click('button:has-text("Load sample people")')
await page.waitForSelector('text=/Added 14 people/', { timeout: 30000 })
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForFunction(() => document.querySelector('canvas.graph-canvas')?.dataset.layout === 'settled', null, { timeout: 30000 })
await page.waitForTimeout(400)
const { labels, hulls } = await page.evaluate(() => {
  const g = document.querySelector('canvas.graph-canvas').__graph
  return { labels: g.labels(), hulls: g.hulls() }
})
const circleCount = Object.keys(hulls).length
if (circleCount < 3) fail(`expected the three sample circles, saw ${circleCount}`)
if (labels.circles.length !== circleCount)
  fail(`every bubble should be named: ${labels.circles.length} of ${circleCount}`)
const distToHull = (p, hull) => {
  // Enough for a test: distance to the nearest member or hull edge.
  let best = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy))
  }
  return best
}
for (const c of labels.circles) {
  // The nearest point of the name's box to the bubble's members.
  const hull = hulls[c.id]
  let near = Infinity
  for (const fx of [0, 0.25, 0.5, 0.75, 1]) for (const fy of [0, 0.5, 1]) {
    near = Math.min(near, distToHull({ x: c.x + c.w * fx, y: c.y + c.h * fy }, hull))
  }
  // HULL_PAD (34) + the rim gap + at most one line out.
  if (near > 34 + 3 + c.h + 4) fail(`a circle name sits ${Math.round(near)} units from its bubble`)
  const onName = labels.names.find((n) => c.x < n.x + n.w && c.x + c.w > n.x && c.y < n.y + n.h && c.y + c.h > n.y)
  if (onName) fail('a circle name overprints a person’s name')
}
console.log(`all ${circleCount} bubbles named, each within a line of its own rim`)

// The view buttons are drawn icons: a Unicode glyph is whatever the
// system font makes of it, and on iOS "⤢" came out half-size.
const glyphs = await page.$$eval('.graph-view-controls button', (bs) =>
  bs.filter((b) => b.offsetParent !== null).map((b) => ({ svg: !!b.querySelector('svg'), text: b.textContent.trim() })))
if (glyphs.some((g) => !g.svg || g.text)) fail(`view buttons should be icons: ${JSON.stringify(glyphs)}`)
console.log('view buttons are drawn icons:', glyphs.length)

// The graph page fits the screen exactly: `--appbar-h` said 52px while
// the bar is 61, so the page scrolled 9px under a canvas that can't be
// used to scroll it back.
const extra = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
if (extra > 0) fail(`the graph page should not scroll, but has ${extra}px to`)

// The tab bar owns everything below it: where iOS anchors it short of
// the screen's bottom, the strip beneath is more bar, not a dark band.
// Stand in for that by lifting the bar, then read the strip's colour.
await page.addStyleTag({ content: '.tabbar { bottom: 50px !important }' })
await page.waitForTimeout(200)
const shot = await page.screenshot({ clip: { x: 0, y: 844 - 70, width: 390, height: 70 } })
const [bar, strip] = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const px = (y) => [...x.getImageData(20, y, 1, 1).data].slice(0, 3)
  return [px(8), px(img.height - 6)]
}, shot.toString('base64'))
if (bar.some((v, i) => Math.abs(v - strip[i]) > 2))
  fail(`the strip under a lifted tab bar should be bar-coloured: bar ${bar}, strip ${strip}`)
console.log('the graph fits the screen, and nothing shows under the tab bar')

console.log('ok')
await browser.close()
