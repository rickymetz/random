// Per-tab memory: People and Settings come back where you left them, the
// graph keeps its camera and layout, and tapping the tab you're on pops
// to the top. A dossier always opens at the top.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
page.on('pageerror', (e) => fail(`page error: ${e.message}`))
page.on('dialog', (d) => d.accept())
const PASS = 'correct horse battery'
const scrollY = () => page.evaluate(() => Math.round(window.scrollY))
const scrollTo = async (y) => { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 2, y); await page.waitForTimeout(150) }
const tab = async (name) => { await page.evaluate(() => document.activeElement?.blur?.()); await page.click(`nav.tabbar a:has-text("${name}")`) }
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', PASS)
await page.fill('input[aria-label="Repeat passphrase"]', PASS)
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })
await page.goto(`${BASE}/#/settings?dev=1`)
await page.waitForSelector('section.stress')
await page.selectOption('.stress-size select', '300')
await page.click('button:has-text("Add crowd")')
await page.waitForFunction(() => /Added 300 people/.test(document.querySelector('section.stress p[role="status"]')?.textContent ?? ''), null, { timeout: 60000 })

// 1. People: scroll down, leave for Settings (which starts at the top), come back.
await tab('People'); await page.waitForSelector('.person-row')
await scrollTo(900)
await tab('Settings'); await page.waitForSelector('h3:has-text("Auto-lock")')
if ((await scrollY()) !== 0) fail('Settings should open at the top the first time, got ' + (await scrollY()))
await scrollTo(400)
await tab('People'); await page.waitForSelector('.person-row')
await page.waitForTimeout(100)
// Scroll anchoring may nudge the position by the height of a strip that
// rendered above the list after the restore: the same rows, a few px off.
if (!near(await scrollY(), 900, 40)) fail('People should come back at 900, got ' + (await scrollY()))
console.log('People remembers its place across a tab switch')

// 2. Settings remembers too; tapping the tab you're on pops to the top.
await tab('Settings'); await page.waitForSelector('h3:has-text("Auto-lock")')
await page.waitForTimeout(100)
if (!near(await scrollY(), 400)) fail('Settings should come back at 400, got ' + (await scrollY()))
await tab('Settings'); await page.waitForTimeout(100)
if ((await scrollY()) !== 0) fail('tapping the active Settings tab should pop to the top, got ' + (await scrollY()))
console.log('Settings remembers its place; the active tab pops to the top')

// 3. The graph keeps its camera and layout across a tab switch.
await tab('Graph')
await page.waitForSelector('canvas.graph-canvas[data-layout="settled"]', { timeout: 30000 })
const read = () => page.evaluate(() => { const g = document.querySelector('canvas.graph-canvas').__graph; return { t: { ...g.transform }, n: [...g.positions.entries()].slice(0, 5).map(([id, p]) => [id, Math.round(p.x), Math.round(p.y)]) } })
const before0 = await read()
const box = await page.locator('canvas.graph-canvas').boundingBox()
// Wheel, not a double-tap: the middle of a 300-person crowd is always someone.
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60) }
await page.waitForFunction((k0) => document.querySelector('canvas.graph-canvas').__graph.transform.k > k0 * 1.5, before0.t.k, { timeout: 5000 })
await page.waitForTimeout(500)
const before = await read()
if (!(before.t.k > before0.t.k * 1.5)) fail('the wheel should have zoomed in')
await tab('People'); await page.waitForSelector('.person-row')
if (!near(await scrollY(), 900, 40)) fail('People should still be at 900, got ' + (await scrollY()))
await tab('Graph')
await page.waitForSelector('canvas.graph-canvas[data-layout="settled"]', { timeout: 30000 })
const after = await read()
if (!near(after.t.k, before.t.k, 0.001) || !near(after.t.x, before.t.x, 1) || !near(after.t.y, before.t.y, 1)) fail(`camera should survive the tab switch: ${JSON.stringify(before.t)} → ${JSON.stringify(after.t)}`)
const moved = before.n.filter(([id, x, y]) => { const a = after.n.find((m) => m[0] === id); return !a || Math.hypot(a[1] - x, a[2] - y) > 8 })
if (moved.length) fail('layout should survive the tab switch; moved: ' + JSON.stringify(moved))
console.log('graph camera and layout survive a tab switch')

// 4. People: the active tab pops to the top; a dossier opens at the top.
await tab('People'); await page.waitForSelector('.person-row')
if (!near(await scrollY(), 900, 40)) fail('People should still be at 900, got ' + (await scrollY()))
await tab('People'); await page.waitForTimeout(100)
if ((await scrollY()) !== 0) fail('tapping the active People tab should pop to the top, got ' + (await scrollY()))
await scrollTo(900)
await page.locator('.person-row').nth(12).click()
await page.waitForSelector('.person h1')
if ((await scrollY()) !== 0) fail('a dossier should open at the top, got ' + (await scrollY()))
console.log('active People tab pops to the top; a dossier opens at the top')
await browser.close()
console.log('smoke20 ok')
