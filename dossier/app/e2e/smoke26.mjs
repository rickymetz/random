// A newcomer adding people in bulk, both ways in (§4.1 at scale).
//
// Paste: the preview drops the "new" badge when everything is new, Undo
// takes the whole paste back, and Done lands on the list — not on the
// toggle at its tail, which after 300 people is thousands of pixels down.
// Import: a second card with the same name in one file is flagged and
// left out of "Select all new" instead of quietly becoming a second
// person. And the graph says nobody is connected yet rather than drawing
// one lone "me" disc over "Tap someone to see who they know".
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())

const FIRST = ['Ada','Bruno','Chen','Dana','Elena','Fatima','Grace','Harold','Ivy','June','Kofi','Lena']
const LAST = ['Lovelace','Costa','Wei','Kim','Sofia','Nur','Liu','Webb','Mensah','Ortiz','Rahman','Farouk']
/** n distinct names; two mods of the same period would collide. */
const names = (n) => {
  const out = []
  for (let a = 0; a < FIRST.length && out.length < n; a++)
    for (let b = 0; b < LAST.length && out.length < n; b++)
      out.push(`${FIRST[a]} ${LAST[(a + b * 5) % LAST.length]}`)
  return out
}
const at = () => page.evaluate(() => ({
  y: Math.round(scrollY),
  focus: (document.activeElement?.textContent ?? '').trim().replace(/\s+/g, ' '),
}))
/** The list heading's own count; innerText applies the uppercasing. */
const listCount = () =>
  page.evaluate(() => Number(/all people\s+(\d+)/i.exec(document.body.innerText)?.[1] ?? 0))

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// ---------- paste ----------
const list = names(120)
await page.click('button:has-text("Add several")')
await page.waitForSelector('.batch-panel')
await page.fill('.batch-panel textarea', list.join('\n'))
await page.waitForFunction(
  (n) => document.querySelectorAll('.batch-preview li').length === n, list.length, { timeout: 15000 })
if ((await page.locator('.batch-preview .tag').count()) !== 0)
  fail('every name is new, so none of them needs a "new" badge')
if (!/Add 120/.test(await page.locator('.batch-panel button[type=submit]').innerText()))
  fail('the Add button should carry the count when the summary does not')

await page.click('.batch-panel button[type=submit]')
await page.waitForFunction(() => /Added 120 people/.test(document.querySelector('.batch-panel [role=status]')?.textContent ?? ''), null, { timeout: 60000 })
if ((await listCount()) !== 121) fail(`expected 121 in the list, got ${await listCount()}`)

// A mistaken paste is one tap to take back.
await page.click('.batch-panel button:has-text("Undo")')
await page.waitForFunction(() => /Took back 120 people/.test(document.querySelector('.batch-panel [role=status]')?.textContent ?? ''), null, { timeout: 60000 })
if ((await listCount()) !== 0) fail('Undo left people behind')
if ((await page.locator('.batch-panel button:has-text("Undo")').count()) !== 0)
  fail('nothing left to undo, so the button should be gone')

// Add for real, then Done: the list, not the toggle below it.
await page.fill('.batch-panel textarea', list.join('\n'))
await page.waitForFunction(() => /Add 120/.test(document.querySelector('.batch-panel button[type=submit]')?.textContent ?? ''), null, { timeout: 15000 })
await page.click('.batch-panel button[type=submit]')
await page.waitForFunction(() => /Added 120 people/.test(document.querySelector('.batch-panel [role=status]')?.textContent ?? ''), null, { timeout: 60000 })
await page.click('.batch-panel button:has-text("Done")')
await page.waitForFunction(() => /^All people/.test((document.activeElement?.textContent ?? '').trim()), null, { timeout: 15000 })
  .catch(async () => fail(`Done should land on the list heading, landed on ${JSON.stringify(await at())}`))
if ((await at()).y !== 0) fail(`Done should land at the top of the list, at ${(await at()).y}px`)

// Recent means "you were here": 120 people nobody has opened is not it.
if ((await page.locator('.recent').count()) !== 0)
  fail('nothing has been opened yet, so there is no Recent row to show')

// ---------- import ----------
const VCF = [
  ['BEGIN:VCARD', 'VERSION:3.0', 'FN:John Smith', 'TEL;TYPE=CELL:+15550001111', 'END:VCARD'],
  ['BEGIN:VCARD', 'VERSION:3.0', 'FN:John Smith', 'EMAIL:john@example.com', 'END:VCARD'],
  ['BEGIN:VCARD', 'VERSION:3.0', 'FN:John Smith', 'END:VCARD'],
  ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Nadia Raman', 'EMAIL:nadia@example.com', 'END:VCARD'],
].map((c) => c.join('\r\n')).join('\r\n')

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.click('button:has-text("Import contacts")')
await page.waitForSelector('.import-panel')
await page.setInputFiles('.import-panel input[type=file]', {
  name: 'contacts.vcf', mimeType: 'text/vcard', buffer: Buffer.from(VCF, 'utf8'),
})
await page.waitForSelector('.import-list li')
const rows = await page.$$eval('.import-list li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
if (rows.length !== 3) fail(`the third John adds nothing and should be dropped: ${JSON.stringify(rows)}`)
if (!/same name, earlier in this file/.test(rows[1]))
  fail(`the second John should say so: ${JSON.stringify(rows)}`)
if (!/1 sharing a name/.test(await page.locator('.import-summary').innerText()))
  fail('the summary should count the namesake')
// "Select all new" is a sweep; a namesake needs a deliberate tap.
await page.click('button:has-text("Select all new")')
await page.waitForFunction(() => /Import 2 people/.test(document.querySelector('.import-panel button.primary')?.textContent ?? ''), null, { timeout: 15000 })
  .catch(async () => fail(`select-all should skip the namesake, button read ${await page.locator('.import-panel button.primary').innerText()}`))
await page.click('.import-panel button.primary')
await page.waitForSelector('.import-panel button:has-text("Undo")', { timeout: 30000 })
await page.click('.import-panel button:has-text("Done")')
await page.waitForFunction(() => /^All people/.test((document.activeElement?.textContent ?? '').trim()), null, { timeout: 15000 })
  .catch(async () => fail(`an import should land on the list too, landed on ${JSON.stringify(await at())}`))
if ((await listCount()) !== 123) fail(`expected 123 after the import, got ${await listCount()}`)

// ---------- the graph ----------
await page.evaluate(() => { location.hash = '#/graph' })
await page.waitForSelector('.graph-canvas-wrap .empty', { timeout: 20000 })
  .catch(() => fail('nobody is connected, so the graph should say so, not draw one lone disc'))
const empty = await page.locator('.graph-canvas-wrap .empty').innerText()
if (!/No connections yet/.test(empty) || !/123 people/.test(empty))
  fail(`the graph should say how many are waiting: ${JSON.stringify(empty)}`)

console.log('ok')
await browser.close()
