// Graph: Find lives in the app bar, opens the picker beneath it, and a
// pick centres on the person with their card open; Ctrl/Cmd+K opens it.
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
await page.click('button[type=submit]'); await page.waitForSelector('input[type=search]')
await page.goto(`${BASE}/#/settings`); await page.waitForSelector('h2:has-text("Sample data")')
await page.click('button:has-text("Load sample people")')
await page.waitForFunction(() => /Added/.test([...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Sample data')?.querySelector('p[role="status"]')?.textContent ?? ''), null, { timeout: 30000 })

// No Find button on Settings; one on the graph, inside the app bar.
if (await page.locator('.app-bar .find-button').count()) fail('find button present off the graph')
await page.goto(`${BASE}/#/graph`); await page.waitForSelector('canvas.graph-canvas[data-layout="settled"]', { timeout: 30000 })
if (!(await page.locator('.app-bar .find-button').count())) fail('no find button in the app bar on the graph')
if (await page.locator('.graph-controls .chip:has-text("Find")').count()) fail('Find chip still in the strip')

// Click → picker beneath the bar, focused.
await page.click('.app-bar .find-button')
await page.waitForSelector('#graph-find input')
if (!(await page.evaluate(() => document.activeElement?.matches('#graph-find input')))) fail('picker not focused on open')
const k0 = await page.evaluate(() => document.querySelector('.graph-canvas').__graph.transform.k)
await page.type('#graph-find input', 'Gra')
await page.click('#graph-find li:has-text("Grace")')
await page.waitForSelector('.peek-card:has-text("Grace Liu")')
await page.waitForTimeout(400)
const k1 = await page.evaluate(() => document.querySelector('.graph-canvas').__graph.transform.k)
if (k1 < Math.max(k0, 1.2) - 0.01) fail(`pick did not centre/zoom: ${k0} → ${k1}`)
if (await page.locator('#graph-find').count()) fail('picker still open after a pick')
console.log('find: app-bar button → picker → pick centres with card open')

// Escape closes the card; Ctrl+K reopens the picker; Escape closes it.
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.keyboard.press('Control+k')
await page.waitForSelector('#graph-find input')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('#graph-find'))
console.log('find: Ctrl+K opens, Escape closes')
await browser.close()
console.log('SMOKE18 OK')
