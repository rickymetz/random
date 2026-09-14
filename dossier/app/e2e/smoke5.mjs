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

// Vault creation now runs Argon2id WASM under the CSP.
const t0 = Date.now()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 30000 })
console.log(`vault created with Argon2id in ${Date.now() - t0}ms`)

const kdf = await page.evaluate(async () => {
  const req = indexedDB.open('ledger')
  const idb = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const tx = idb.transaction(['slots'])
  const slots = await new Promise((res, rej) => { const r = tx.objectStore('slots').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  return slots.map((s) => s.kdfParams.algorithm)
})
if (!kdf.every((a) => a === 'Argon2id')) fail(`expected Argon2id slots, got ${kdf}`)
console.log('both slots carry Argon2id params')

// Lock + unlock round-trip under Argon2id
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav.tabbar button:has-text("Lock")')
await page.fill('input[aria-label="Passphrase"]', 'correct horse battery')
const t1 = Date.now()
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 30000 })
console.log(`Argon2id unlock in ${Date.now() - t1}ms`)

// New discretion toggles render
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.waitForSelector('text=Shake three times')
await page.waitForSelector('text=Daily reminder')
console.log('discretion toggles present')

// Export now uses Argon2id headers and still round-trips
await page.fill('input[aria-label="Confirm passphrase"]', 'correct horse battery')
const dl = page.waitForEvent('download', { timeout: 30000 })
await page.click('button:has-text("Save backup")')
const file = await dl
const path = await file.path()
const fs = await import('node:fs')
const header = JSON.parse(fs.readFileSync(path, 'utf8'))
if (header.kdf.algorithm !== 'Argon2id') fail(`export kdf: ${header.kdf.algorithm}`)
console.log('export header carries Argon2id params')
await page.setInputFiles('input[aria-label="Backup file"]', path)
await page.fill('input[aria-label="Backup passphrase"]', 'correct horse battery')
await page.click('button:has-text("Restore")')
await page.waitForSelector('text=Restored')
console.log('Argon2id backup restores')

await browser.close()
console.log('SMOKE5 OK')
