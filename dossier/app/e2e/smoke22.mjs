// Chip isolation on the graph rail: a tap on a full rail leaves one chip
// on, later taps add and subtract, and the tap that would empty a group
// puts everything back instead. Circles narrow the people, not just the
// bubbles. The mentions / former / quiet lenses stay out of it.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

const TYPES = '.graph-controls .chip[data-filter-id]:not(.circle-filter)'
const CIRCLES = '.chip.circle-filter[data-filter-id]'
// Clicked through the DOM: the rail scrolls sideways, so later chips are
// off-screen and a real tap can't reach them without dragging it first.
const tap = (sel, i = 0) =>
  page.evaluate(([s, n]) => {
    const els = [...document.querySelectorAll(s)]
    if (!els[n]) throw new Error(`no chip ${n} for ${s}`)
    els[n].click()
  }, [sel, i])
const pressed = async (sel) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].map((b) => b.getAttribute('aria-pressed') === 'true'), sel)
const settle = () => page.waitForTimeout(250)
/** People currently drawn, read off the canvas's own description. */
const peopleDrawn = async () => {
  const label = await page.getAttribute('canvas.graph-canvas', 'aria-label')
  const m = /Relationship graph: (\d+) people/.exec(label ?? '')
  if (!m) fail(`could not read the canvas label: ${label}`)
  return Number(m[1])
}

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
await page.waitForSelector('text=/Added 14 people, \\d+ relationships and 3 circles/', { timeout: 30000 })
await blur(); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas', { timeout: 30000 })
const more = page.locator('.graph-controls button[aria-expanded="false"]:has-text("more")')
if (await more.count()) await more.first().click()

// --- relationship types -----------------------------------------------
const typeCount = (await pressed(TYPES)).length
if (typeCount < 3) fail(`expected at least 3 type chips, got ${typeCount}`)
if ((await pressed(TYPES)).some((p) => !p)) fail('the rail did not start with every type on')

await tap(TYPES, 1); await settle()
let on = await pressed(TYPES)
if (on.filter(Boolean).length !== 1 || !on[1]) fail(`first tap should isolate one type, got ${JSON.stringify(on)}`)
console.log('a tap on a full rail isolates that type')

await tap(TYPES, 2); await settle()
on = await pressed(TYPES)
if (!on[1] || !on[2] || on.filter(Boolean).length !== 2) fail(`tapping an off chip should add it back, got ${JSON.stringify(on)}`)
console.log('tapping an off chip adds it alongside')

await tap(TYPES, 1); await settle()
on = await pressed(TYPES)
if (on[1] || !on[2] || on.filter(Boolean).length !== 1) fail(`tapping one of two shown should hide just it, got ${JSON.stringify(on)}`)
console.log('with two showing, a tap hides just that one')

await tap(TYPES, 2); await settle()
if ((await pressed(TYPES)).some((p) => !p)) fail('tapping the last type standing should bring them all back')
if (await page.locator('.chip.hidden-status').count()) fail('"N hidden" chip lingered after everything came back')
console.log('tapping the last type standing restores every type')

// --- the lenses stay out of it ----------------------------------------
await tap(TYPES, 0); await settle()
for (const lens of ['mentions', 'former']) {
  const state = await page.getAttribute(`.graph-controls .chip:text-is("${lens}")`, 'aria-pressed')
  if (state !== 'true') fail(`isolating a type switched the ${lens} lens off`)
}
if ((await page.getAttribute('.graph-controls .chip.quiet', 'aria-pressed')) !== 'false') {
  fail('isolating a type switched the quiet lens on')
}
console.log('mentions, former and quiet are untouched by type isolation')
await page.evaluate(() => document.querySelector('.chip.hidden-status').click())
await settle()

// --- circles narrow the people ----------------------------------------
const everyone = await peopleDrawn()
const circleCount = (await pressed(CIRCLES)).length
if (circleCount !== 3) fail(`expected the sample cast's 3 circles, got ${circleCount}`)

await tap(CIRCLES, 0); await settle()
let onC = await pressed(CIRCLES)
if (onC.filter(Boolean).length !== 1 || !onC[0]) fail(`first tap should isolate one circle, got ${JSON.stringify(onC)}`)
const isolated = await peopleDrawn()
if (isolated >= everyone) fail(`isolating a circle drew ${isolated} of ${everyone} people — it narrowed nothing`)
if (isolated === 0) fail('isolating a circle emptied the graph')
console.log(`isolating a circle: ${isolated} of ${everyone} people on screen`)

await tap(CIRCLES, 1); await settle()
const union = await peopleDrawn()
if (union <= isolated) fail(`adding a second circle should widen the graph, ${union} vs ${isolated}`)
if (union >= everyone) fail('two of three circles drew everyone')
console.log(`a second circle widens it to ${union}`)

await tap(CIRCLES, 0); await settle()
onC = await pressed(CIRCLES)
if (onC[0] || !onC[1] || onC.filter(Boolean).length !== 1) fail(`tapping one of two shown circles should hide just it, got ${JSON.stringify(onC)}`)

await tap(CIRCLES, 1); await settle()
if ((await pressed(CIRCLES)).some((p) => !p)) fail('tapping the last circle standing should bring them all back')
if ((await peopleDrawn()) !== everyone) fail('the graph did not come back to everyone')
console.log('tapping the last circle standing restores the whole graph')

// --- a chip says what the next tap will do ----------------------------
const title = await page.getAttribute(TYPES, 'title')
if (!/^Show only /.test(title ?? '')) fail(`expected a "Show only …" hint on a full rail, got ${title}`)
await tap(TYPES, 0); await settle()
if ((await page.getAttribute(TYPES, 'title')) !== 'Show all again') fail('the isolated chip should offer the way back')
console.log('the chip names its next tap:', title)

// --- hiding yourself --------------------------------------------------
// You are joined to everyone, so the dot in the middle tells you least
// and pulls the layout hardest; the `me` lens takes it out and leaves
// the ties between your people.
await page.evaluate(() => document.querySelector('.chip.hidden-status')?.click())
await settle()
const withMe = await peopleDrawn()
const me = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('.graph-controls .chip')].find((b) => b.textContent.trim() === 'me')
  if (!el) throw new Error('no me chip on the rail')
  el.click()
})
if ((await page.getAttribute('.chip.self-lens', 'aria-pressed')) !== 'true') fail('the me lens did not start on')
await me(); await page.waitForTimeout(2500)
if ((await page.getAttribute('.chip.self-lens', 'aria-pressed')) !== 'false') fail('the me chip did not switch off')
const withoutMe = await peopleDrawn()
if (withoutMe !== withMe - 1) fail(`hiding yourself should drop one person, got ${withMe} → ${withoutMe}`)
if (!(await page.locator('.chip.hidden-status').count())) fail('hiding yourself is not counted as hidden')
console.log(`hiding yourself: ${withMe} → ${withoutMe} people`)

// It survives leaving the tab, like the other filters.
await blur(); await page.click('nav a:has-text("People"):visible')
await blur(); await page.click('nav a:has-text("Graph"):visible')
await page.waitForTimeout(2500)
if ((await page.getAttribute('.chip.self-lens', 'aria-pressed')) !== 'false') fail('the me lens did not persist')

// A path starts at you, so it brings you back — half a path is a lie.
await page.goto(`${BASE}/#/people`)
await page.fill('input[type=search]', 'Grace')
const href = await page.getAttribute('a.person-row:has-text("Grace Liu")', 'href')
await page.goto(`${BASE}/#/graph?path=${href.split('/').pop()}`)
await page.waitForSelector('.chip.focus-chip', { timeout: 15000 })
await page.waitForTimeout(2500)
if ((await peopleDrawn()) !== withMe) fail('a highlighted path should draw you even while the me lens is off')
const pathChip = (await page.locator('.chip.focus-chip').first().textContent()).trim()
if (!pathChip.startsWith('You →')) fail(`the path should still start at you, got ${pathChip}`)
console.log('a highlighted path brings you back:', pathChip)

// Show all puts you back too.
await page.evaluate(() => document.querySelector('.chip.focus-chip button')?.click())
await page.waitForTimeout(1500)
await page.evaluate(() => document.querySelector('.chip.hidden-status').click())
await page.waitForTimeout(2500)
if ((await page.getAttribute('.chip.self-lens', 'aria-pressed')) !== 'true') fail('"Show all" left you hidden')
if ((await peopleDrawn()) !== withMe) fail('"Show all" did not bring you back to the graph')
console.log('Show all brings you back')

await browser.close()
console.log('SMOKE22 OK')
