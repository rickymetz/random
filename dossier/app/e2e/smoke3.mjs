import { launch } from './lib.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4174'
const IMG = '/home/user/random/dossier/app/public/icon-192.png'
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
await page.fill('input[type=search]', 'Ada Lovelace')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Ada Lovelace")')

// Add a photo — becomes the avatar automatically
await page.setInputFiles('article.person input[type=file]', IMG)
await page.waitForSelector('.photo-thumb img', { timeout: 15000 })
await page.waitForSelector('.photo-actions >> text=avatar ✓')
await page.waitForSelector('.person-header img.avatar')
console.log('photo added, avatar set, header shows it')

// Second photo, promote it
await page.setInputFiles('article.person input[type=file]', IMG)
await page.waitForFunction(() => document.querySelectorAll('.photo-thumb').length === 2)
await page.click('.photo-actions button:has-text("avatar")')
await page.waitForFunction(() =>
  [...document.querySelectorAll('.photo-actions span')].filter((s) => s.textContent.includes('avatar')).length === 1)
console.log('avatar promotion works, exactly one avatar')

// People list shows avatar image
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.waitForSelector('.person-row img.avatar')
console.log('people list shows avatar')

// Graph node draws (avatar path exercised; can't pixel-test easily)
// A vault with no links shows the how-to-start copy instead of a canvas;
// the person's own "See on graph" (ego view) still draws the node.
await page.click('.person-row'); await page.waitForSelector('.person h1')
await page.click('a:has-text("See on graph")')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForTimeout(1200)
await page.screenshot({ path: '/tmp/shots/graph3.png' })
console.log('graph rendered with avatar node')

// Export (with blobs), destroy, recreate, restore, avatar back
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.fill('input[aria-label="Confirm passphrase"]', 'correct horse battery')
const dlPromise = page.waitForEvent('download', { timeout: 20000 })
await page.click('button:has-text("Save backup")')
const dl = await dlPromise
const path = await dl.path()
console.log('export with photos downloaded')

await page.evaluate(async () => {
  const { destroy } = {}
  // Use the app's own destroy: type DELETE via prompt is auto-accepted? prompt returns '' on accept.
})
// destroy via UI won't work: prompt auto-accept returns '' not 'DELETE'. Wipe DB manually.
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
// The hash route survives the reload, so we land back on Settings.
await page.waitForSelector('.app-bar')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.setInputFiles('input[aria-label="Backup file"]', path)
await page.fill('input[aria-label="Backup passphrase"]', 'correct horse battery')
await page.click('button:has-text("Restore")')
await page.waitForSelector('text=Restored')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.waitForSelector('.person-row img.avatar', { timeout: 15000 })
console.log('restore brought the photos back')

// Blobs table: ciphertext only
const audit = await page.evaluate(async () => {
  const req = indexedDB.open('ledger')
  const idb = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const tx = idb.transaction(['blobs'])
  const rows = await new Promise((res, rej) => { const r = tx.objectStore('blobs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  // JPEG magic bytes FF D8 FF must not appear at the start of any stored blob
  const jpegPlain = rows.some((row) => { const b = new Uint8Array(row.blob); return b[0] === 0xff && b[1] === 0xd8 })
  return { count: rows.length, jpegPlain }
})
if (audit.jpegPlain) fail('a stored photo blob starts with plaintext JPEG magic!')
if (audit.count !== 2) fail(`expected 2 blob rows, got ${audit.count}`)
console.log(`blobs table: ${audit.count} rows, encrypted (no JPEG magic)`)

await browser.close()
console.log('SMOKE3 OK')
