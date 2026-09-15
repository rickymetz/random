import { launch } from './lib.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const shots = process.env.SHOTS ?? '/tmp/shots'
const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
page.on('pageerror', (err) => fail(`page error: ${err.message}`))
page.on('dialog', (d) => d.accept())

// 1. Create vault (passphrase + confirm)
await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })
console.log('vault created + unlocked')

// 2. Add two people (Add button sits above the list now)
await page.fill('input[type=search]', 'Ada Lovelace')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Ada Lovelace")')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Bob Chen')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Bob Chen")')
console.log('two people added')

// 3. Edit Bob's details — birthday within 5 days + a phone number
await page.click('.section-head button:has-text("Edit")')
const soon = new Date(Date.now() + 5 * 86400000)
await page
  .locator('label:has-text("Birthday") input')
  .fill(`${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`)
await page.locator('label:has-text("Job title") input').fill('Marine biologist')
await page.locator('label:has-text("Phone") input').fill('555-0100')
await page.click('button[type=submit]:has-text("Save")')
await page.waitForSelector('.fact >> text=Marine biologist')
await page.waitForSelector('.fact >> text=555-0100')
console.log('details saved (job, phone, birthday)')

// 3b. A bad birthday must show an error, not silently drop
await page.click('.section-head button:has-text("Edit")')
await page.locator('label:has-text("Birthday") input').fill('not a date')
await page.click('button[type=submit]:has-text("Save")')
await page.waitForSelector('.field-error')
await page.locator('label:has-text("Birthday") input').fill('')
await page.click('button[type=submit]:has-text("Save")')
await page.waitForSelector('.fact >> text=Marine biologist')
console.log('date validation surfaces errors')

// 4. Round-trip check: reopen the edit form and save unchanged — the
// birthday must survive (was silently truncated before the fix)
await page.click('.section-head button:has-text("Edit")')
const bdayVal = await page.locator('label:has-text("Birthday") input').inputValue()
await page.click('button[type=submit]:has-text("Save")')
if (bdayVal !== '') fail('birthday should be cleared from previous step')
await page.click('.section-head button:has-text("Edit")')
await page
  .locator('label:has-text("Birthday") input')
  .fill(`${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`)
await page.click('button[type=submit]:has-text("Save")')
await page.click('.section-head button:has-text("Edit")')
const roundTripped = await page.locator('label:has-text("Birthday") input').inputValue()
await page.click('button[type=submit]:has-text("Save")')
await page.click('.section-head button:has-text("Edit")')
const roundTripped2 = await page.locator('label:has-text("Birthday") input').inputValue()
await page.locator('button:has-text("Cancel")').click()
if (roundTripped !== roundTripped2) fail(`birthday mangled by round-trip: ${roundTripped} vs ${roundTripped2}`)
console.log('birthday survives edit round-trip:', roundTripped2)

// 5. Note with @mention in the sticky capture bar → mention edge to Ada
await page.fill('.capture-bar textarea', 'Sailing trip with @Ada')
await page.click('.mention-suggestions li[role="option"]:has-text("Ada Lovelace")')
await page.click('button:has-text("Save note")')
await page.waitForSelector('.saved')
await page.waitForSelector('.notes .mention:has-text("@Ada Lovelace")')
await page.waitForSelector('.edges li:has-text("Ada Lovelace")')
if ((await page.locator('.edges li.mention-edge').count()) !== 1) fail('expected one mention edge')
console.log('mention note + derived edge + saved flash')

// 6. Upgrade to explicit friend edge
await page.selectOption('select[aria-label="Relationship type"]', { label: 'friend' })
await page.fill('input[aria-label="Person"]', 'Ada'); await page.click('.chip-suggestions li:has-text("Ada Lovelace")')
await page.click('form.add-form:has(.person-picker) button[type=submit]')
await page.waitForFunction(() => document.querySelectorAll('.edges li.mention-edge').length === 0)
console.log('edge upgraded to explicit')

// 7. Follow-up with an OVERDUE date → must appear as late in Upcoming
await page.fill('input[aria-label="New follow-up"]', 'ask about the reef dive')
const past = new Date(Date.now() - 3 * 86400000)
await page.fill(
  '.add-form input.due',
  `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`,
)
await page.click('form.add-form:has(input[aria-label="New follow-up"]) button[type=submit]')
await page.waitForSelector('.follow-ups li:has-text("reef dive")')
console.log('overdue follow-up added')

// 8. Search finds Bob via note content, with a snippet showing why
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'sailing')
await page.waitForSelector('li >> text=Bob Chen')
await page.waitForSelector('.snippet')
console.log('full-text search hit with snippet')

// 9. Upcoming strip: birthday + overdue follow-up marked late
await page.fill('input[type=search]', '')
await page.waitForSelector('.upcoming li:has-text("Bob Chen")')
await page.waitForSelector('.upcoming .days.overdue')
console.log('upcoming shows birthday and overdue (late) follow-up')

// 10. Backup nag shows (never exported), then graph renders
await page.waitForSelector('.banner:has-text("backup")')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForTimeout(1500)
await page.screenshot({ path: `${shots}/graph2.png` })
console.log('graph canvas rendered')

// 11. Lock → wrong passphrase → correct → back on graph with data
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav.tabbar button:has-text("Lock")')
await page.waitForSelector('input[aria-label="Passphrase"]')
await page.fill('input[aria-label="Passphrase"]', 'wrong wrong wrong')
await page.click('button[type=submit]')
await page.waitForSelector('.hint.error')
await page.fill('input[aria-label="Passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('canvas.graph-canvas')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.waitForSelector('input[type=search]')
const bodyText = await page.textContent('body')
if (!bodyText.includes('Bob Chen')) fail('records missing after relock')
console.log('lock/unlock cycle keeps data')

// 12. Export via Settings marks the backup as fresh (nag disappears)
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.fill('input[aria-label="Confirm passphrase"]', 'correct horse battery')
const download = page.waitForEvent('download', { timeout: 20000 })
await page.click('button:has-text("Save backup")')
const dl = await download
console.log('export downloaded:', dl.suggestedFilename())
await page.waitForSelector('text=Backup saved')
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
if (await page.locator('.banner:has-text("backup")').count()) fail('backup nag should be gone')
console.log('backup nag cleared after export')

// 13. IndexedDB: ciphertext only, no timestamps, slots unlinkable
const audit = await page.evaluate(async () => {
  const req = indexedDB.open('ledger')
  const idb = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  const tx = idb.transaction(['records', 'slots'])
  const getAll = (store) =>
    new Promise((res, rej) => {
      const r = tx.objectStore(store).getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  const [rows, slots] = await Promise.all([getAll('records'), getAll('slots')])
  const dump = rows
    .map((row) => row.id + String.fromCharCode(...new Uint8Array(row.blob)))
    .join('|')
  const rowKeys = new Set(rows.flatMap((r) => Object.keys(r)))
  const prefixes = new Set(rows.map((r) => r.id.split(':')[0]))
  const slotDump = JSON.stringify(slots, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v).join(',') : v))
  const slotLeaks = [...prefixes].some((p) => slotDump.includes(p))
  return {
    hasPlain: /Lovelace|Chen|sailing|reef|biologist|555-0100/.test(dump),
    rowKeys: [...rowKeys].sort(),
    slotCount: slots.length,
    slotLeaks,
    rowCount: rows.length,
  }
})
if (audit.hasPlain) fail('plaintext found in IndexedDB!')
if (audit.rowKeys.join()!=='blob,id,iv') fail(`unexpected row keys: ${audit.rowKeys}`)
if (audit.slotCount !== 2) fail(`expected 2 slots, got ${audit.slotCount}`)
if (audit.slotLeaks) fail('a slot row leaks its data prefix in cleartext!')
console.log(`IndexedDB clean: ${audit.rowCount} ciphertext rows, ${audit.slotCount} unlinkable slots`)

await browser.close()
console.log('SMOKE OK')
