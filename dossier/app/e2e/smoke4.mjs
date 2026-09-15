import { launch } from './lib.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4174'
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1) }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
page.on('pageerror', (err) => fail(`page error: ${err.message}`))
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// Seeded self appears with a "you" badge
await page.waitForSelector('.person-row .you-badge')
console.log('self person seeded with badge')

// Add Ada & Bob
for (const name of ['Ada Lovelace', 'Bob Chen']) {
  await page.fill('input[type=search]', name)
  await page.click('button.add-person')
  await page.waitForSelector(`h1:has-text("${name}")`)
  await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
}

// Connect Me —friend→ Ada (from Ada's page: type friend, person Me)
await page.fill('input[type=search]', 'Ada')
await page.click('li >> text=Ada Lovelace')
await page.selectOption('select[aria-label="Relationship type"]', { label: 'friend' })
await page.fill('input[aria-label="Person"]', 'Me'); await page.click('.chip-suggestions li:has-text("Me")')
await page.click('form.add-form:has(.person-picker) button[type=submit]')
await page.waitForSelector('.edges li:has-text("Me")')
console.log('Me-Ada friend edge added')

// Ada mentions Bob in a note → Ada→Bob mention edge
await page.fill('.capture-bar textarea', 'Dinner with @Bob')
await page.click('.mention-suggestions li[role="option"]:has-text("Bob Chen")')
await page.click('button:has-text("Save note")')
await page.waitForSelector('.saved')

// Bob's page: How you connect = You → Ada → Bob
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Bob')
await page.click('li >> text=Bob Chen')
await page.waitForSelector('h2:has-text("How you connect")')
const pathText = await page.locator('.path').textContent()
if (!/You.*Ada Lovelace.*—mentioned→/s.test(pathText)) fail(`unexpected path: ${pathText}`)
console.log('shortest path rendered:', pathText.replace(/\s+/g, ' ').slice(0, 80))

// Mutual connections with "you": Ada connects to both Me and Bob
await page.waitForSelector('.edges li:has-text("Ada Lovelace")')
const mutualsBlock = await page.locator('section:has(h2:has-text("How you connect"))').textContent()
if (!mutualsBlock.includes('Ada Lovelace')) fail('Ada should be a mutual connection')
console.log('mutual connections listed')

// Show on graph → highlighted path chip
await page.click('.path-graph-link')
await page.waitForSelector('.chip:has-text("You → Ada Lovelace → Bob Chen")')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForTimeout(1000)
await page.screenshot({ path: '/tmp/shots/graph4.png' })
console.log('graph shows highlighted path chip')

// Reassign self via edit form checkbox, verify single self
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Ada')
await page.click('li >> text=Ada Lovelace')
await page.click('.section-head button:has-text("Edit")')
await page.click('.toggle-row:has-text("This is me") input')
await page.click('button[type=submit]:has-text("Save")')
await page.waitForSelector('.person-header .you-badge')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', '')
const badges = await page.locator('.person-row .you-badge').count()
if (badges !== 1) fail(`expected exactly 1 "you" badge, got ${badges}`)
console.log('self reassignment keeps exactly one self')

await browser.close()
console.log('SMOKE4 OK')
