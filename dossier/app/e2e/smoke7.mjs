import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4181'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// Empty graph points at the sample cast
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('.empty:has-text("sample people")')

// Load the sample cast from Settings
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.click('button:has-text("Load sample people")')
await page.waitForSelector('text=Added 14 people', { timeout: 30000 })
const msg1 = await page.locator('section:has(h2:has-text("Sample data")) .hint[role=status]').textContent()
console.log('first run:', msg1.trim())
if (!/Added 14 people, 21 relationships/.test(msg1)) fail(`unexpected first-run message: ${msg1}`)

// Second run only fills gaps (nothing to fill)
await page.click('button:has-text("Load sample people")')
await page.waitForSelector('text=already here', { timeout: 30000 })
console.log('second run: idempotent')

// People list has the cast
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.waitForSelector('li >> text=Priya Raman')
await page.waitForSelector('li >> text=Grace Liu')

// Marcus has family + work + ex edges, and Dana picked up a mention edge to Ivy
await page.click('li >> text=Marcus Webb')
await page.waitForSelector('h1:has-text("Marcus Webb")')
const marcusEdges = await page.locator('.edges li').count()
if (marcusEdges < 6) fail(`Marcus has only ${marcusEdges} edges`)
console.log('Marcus edge count:', marcusEdges)
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.click('li >> text=Bruno Costa')
await page.waitForSelector('.edges li.mention-edge:has-text("Theo Martins")')
console.log('mention edge derived (Theo → Bruno)')

// How-you-connect chain exists from self through the seeded edges
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.click('li >> text=June Webb')
await page.waitForSelector('h2:has-text("How you connect")')
await page.waitForSelector('.path')
console.log('path to June:', (await page.locator('.path').textContent()).trim())

// Graph renders the cast
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForTimeout(2500)
await page.screenshot({ path: '/tmp/design-shots/15-graph-sample.png' })

// Desktop graph shot too
await page.setViewportSize({ width: 1280, height: 800 })
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/design-shots/16-graph-sample-desktop.png' })

await browser.close()
console.log('SMOKE7 OK')
