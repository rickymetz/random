// Contacts import: vCard + CSV files, existing detection, filter, undo, Contact Picker.
import { launch } from './lib.mjs'
import fs from 'node:fs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const shots = '/tmp/shots19'; fs.mkdirSync(shots, { recursive: true })
const FX = new URL('./fixtures/', import.meta.url).pathname
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(`page error: ${e.message}`))
page.on('dialog', (d) => d.accept())
// A fake Contact Picker, as Chrome on Android would provide.
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'contacts', {
    value: {
      select: async () => [
        { name: ['Ada Lovelace'], email: ['ada@example.com'], tel: [] },
        { name: [], email: [], tel: ['+1 555 0199'] },
        { name: ['Theo Martins'], email: ['theo@example.com'], tel: [] },
      ],
      getProperties: async () => ['name', 'email', 'tel'],
    },
    configurable: true,
  })
})
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]'); await page.waitForSelector('input[type=search]')

// Existing person to be detected by name
await page.click('.people button:has-text("Add several")')
await page.fill('.batch-panel textarea', 'Priya Raman')
await page.click('.batch-panel button[type=submit]')
await page.waitForFunction(() => /Added 1/.test(document.querySelector('.batch-panel .status-slot')?.textContent ?? ''))
await page.click('.batch-panel button:has-text("Done")')

// 1. Bad file → message; vCard → list with details and "already here"
await page.click('.people button:has-text("Import contacts")')
await page.waitForSelector('.import-panel')
await page.setInputFiles('.import-panel input[type=file]', FX + 'notes.md')
await page.waitForSelector('.import-panel [role=alert]')
console.log('bad file:', (await page.locator('.import-panel [role=alert]').textContent()).trim())
await page.setInputFiles('.import-panel input[type=file]', FX + 'contacts.vcf')
await page.waitForSelector('.import-list li')
const names = await page.locator('.import-list .name').allTextContents()
if (names.join('|') !== 'Sam Okafor|Theo Martins|June Webb|Priya Raman') fail('names: ' + names.join('|'))
const summary = (await page.locator('.import-summary').textContent()).trim()
if (!/4 in contacts\.vcf · 1 already here · 3 selected/.test(summary)) fail('summary: ' + summary)
if (!(await page.locator('.import-list li:has-text("Priya Raman") .tag.known').count())) fail('Priya should be already here')
if (!(await page.locator('.import-list li:has-text("Priya Raman") input').isDisabled())) fail('existing row disabled')
const detail = await page.locator('.import-list li:has-text("Sam Okafor") .hint').textContent()
if (!/Head of Design, Acme Ltd · sam@example.com · \+44 7700 900123/.test(detail)) fail('detail: ' + detail)
await page.screenshot({ path: `${shots}/import-list.png` })

// 2. Uncheck one, import, verify details + note, then Undo
await page.uncheck('.import-list li:has-text("June Webb") input')
const btn = (await page.locator('.import-panel button.primary').textContent()).trim()
if (btn !== 'Import 2 people') fail('button: ' + btn)
if (!(await page.locator('.import-list li:has-text("Sam Okafor") .tag:has-text("has a note")').count())) fail('note tag missing')
const notesLabel = await page.locator('.import-panel label:has-text("Also keep")').textContent()
if (!/1 selected has one/.test(notesLabel)) fail('notes label: ' + notesLabel)
await page.click('.import-panel button.primary')
await page.waitForFunction(() => /Imported 2 people/.test(document.querySelector('.import-panel .status-slot')?.textContent ?? ''))
console.log('vcf:', (await page.locator('.import-panel .status-slot').textContent()).trim())
await page.waitForTimeout(300)
if (!(await page.locator('.import-panel button.undo').count())) fail('Undo should stay until Done')
await page.click('.import-panel button.undo')
await page.waitForFunction(() => /Import undone/.test(document.querySelector('.import-panel .status-slot')?.textContent ?? ''))
if (await page.locator('.import-panel button.undo').count()) fail('Undo gone after undo')
await page.click('.import-panel button:has-text("Done")')
await page.fill('input[type=search]', 'Sam'); await page.waitForTimeout(150)
if (await page.locator('.person-row strong:has-text("Sam Okafor")').count()) fail('undo should remove Sam')
await page.fill('input[type=search]', '')
console.log('undo: imported people removed')
// Import again for real
await page.click('.people button:has-text("Import contacts")')
await page.setInputFiles('.import-panel input[type=file]', FX + 'contacts.vcf')
await page.waitForSelector('.import-list li')
await page.check('.import-panel label:has-text("Also keep") input')
await page.click('.import-panel button.primary')
await page.waitForFunction(() => /Imported 3 people/.test(document.querySelector('.import-panel .status-slot')?.textContent ?? ''))
await page.click('.import-panel button:has-text("Done")')
await page.fill('input[type=search]', 'Sam'); await page.click('.person-row:has-text("Sam Okafor")')
await page.waitForSelector('.person h1:has-text("Sam Okafor")')
const page1 = await page.locator('.person').innerText()
for (const t of ['Head of Design', 'Acme Ltd', 'sam@example.com', 'Met at the conference.']) if (!page1.includes(t)) fail('dossier missing ' + t)
console.log('vcf import: details, contact and note on the dossier')

// 3. CSV: existing by e-mail (Theo), name built from given+family
await blur(); await page.click('nav.tabbar a:has-text("People")')
await page.click('.people button:has-text("Import contacts")')
await page.setInputFiles('.import-panel input[type=file]', FX + 'contacts.csv')
await page.waitForSelector('.import-list li')
const csvNames = await page.locator('.import-list .name').allTextContents()
if (csvNames.join('|') !== 'Rosa Delgado|Bruno Costa|Theo Martins') fail('csv names: ' + csvNames.join('|'))
if (!(await page.locator('.import-list li:has-text("Theo Martins") .tag.known').count())) fail('Theo already here (by e-mail)')
await page.click('.import-panel button.primary')
await page.waitForFunction(() => /Imported 2 people/.test(document.querySelector('.import-panel .status-slot')?.textContent ?? ''))
console.log('csv:', (await page.locator('.import-panel .status-slot').textContent()).trim())
await page.click('.import-panel button:has-text("Done")')

// 4. Contact Picker: name/email/tel, existing skipped, nameless falls back to the number
await page.click('.people button:has-text("Import contacts")')
await page.click('.import-panel button:has-text("Pick from contacts")')
await page.waitForSelector('.import-list li')
const picked = await page.locator('.import-list .name').allTextContents()
if (picked.join('|') !== 'Ada Lovelace|+1 555 0199|Theo Martins') fail('picked: ' + picked.join('|'))
const sum2 = (await page.locator('.import-summary').textContent()).trim()
if (!/3 in your contacts · 1 already here · 2 selected/.test(sum2)) fail('picker summary: ' + sum2)
await page.click('.import-panel button:has-text("None")')
if (!(await page.locator('.import-panel button.primary').isDisabled())) fail('none → disabled')
await page.click('.import-panel button:has-text("Select all")')
await page.click('.import-panel button.primary')
await page.waitForFunction(() => /Imported 2 people/.test(document.querySelector('.import-panel .status-slot')?.textContent ?? ''))
await page.click('.import-panel button:has-text("Done")')
// A short list still puts you back on the toggle you came from: it never
// left the screen. (A long one lands on the list heading — `smoke26`.)
await page
  .waitForFunction(() => document.activeElement?.textContent?.trim() === 'Import contacts…', null, { timeout: 2000 })
  .catch(async () => fail('focus should return to the toggle: ' + (await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))))
console.log('picker: 2 imported, focus back on toggle')

// 5. Filter on a bigger list
const big = ['Name,E-mail'].concat(Array.from({ length: 30 }, (_, i) => `Person ${i} Zed,p${i}@example.com`)).join('\n') + '\n'
fs.writeFileSync(FX + 'big.csv', big)
await page.click('.people button:has-text("Import contacts")')
await page.setInputFiles('.import-panel input[type=file]', FX + 'big.csv')
await page.waitForSelector('.import-filter')
const sel0 = (await page.locator('.import-summary').textContent()).trim()
if (!/30 in big\.csv · 0 selected/.test(sel0)) fail('big file should start unselected: ' + sel0)
if ((await page.evaluate(() => document.activeElement?.className)) !== 'import-filter') fail('filter should take focus')
if (!(await page.locator('.import-panel button.primary').isDisabled())) fail('nothing selected → disabled')
await page.keyboard.type('person 2')
await page.waitForTimeout(100)
const shown = await page.locator('.import-list .name').count()
if (shown !== 11) fail('filter should show 11 (2, 20–29): ' + shown)
await page.click('.import-panel button:has-text("Select all shown")')
const sel = (await page.locator('.import-summary').textContent()).trim()
if (!/30 in big\.csv · 11 selected/.test(sel)) fail('Select all shown: ' + sel)
await page.click('.import-panel button:has-text("None shown")')
if (!/0 selected/.test((await page.locator('.import-summary').textContent()))) fail('None shown')
await page.focus('.import-filter'); await page.keyboard.press('Escape')
if ((await page.inputValue('.import-filter')) !== '') fail('Escape should clear the filter first')
if (!(await page.locator('.import-panel').count())) fail('first Escape must not close')
await page.keyboard.press('Escape')
if (await page.locator('.import-panel').count()) fail('second Escape should close')
console.log('big file: unselected start, filter focus, select/none shown, Escape twice')
await page.screenshot({ path: `${shots}/after.png` })
console.log('SMOKE17 OK')
await browser.close()
