import { launch } from './lib.mjs'
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
page.on('dialog', (d) => d.accept())
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:4290')
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'x correct horse')
await page.fill('input[aria-label="Repeat passphrase"]', 'x correct horse')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
await page.fill('input[type=search]', 'Ada')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Ada")')

// (A) Save-note first tap when field is NOT focused
await page.fill('.capture-bar textarea', 'first tap should save this')
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('.capture-bar button:has-text("Save note")')
await page.waitForSelector('.notes li', { timeout: 5000 })
console.log('A: save-note first tap works')

// (B) Delete person reachable (real click, no JS dispatch)
await page.click('.section-head button:has-text("Edit")')
await page.click('.facts-form button:has-text("Delete this person")', { timeout: 6000 })
await page.waitForSelector('input[type=search]', { timeout: 5000 })
console.log('B: delete person reachable via real click')

// (C) disguise brand reactivity: change to Planner in Settings, brand updates
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav a:has-text("Settings"):visible')
await page.click('.disguise-option:has-text("Planner")')
await page.waitForFunction(() => document.querySelector('.brand')?.textContent === 'Planner', { timeout: 4000 })
console.log('C: brand follows disguise change immediately')

await browser.close()
console.log('SMOKE8 OK')
