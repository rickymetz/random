// The person form each vault defines (§8.1): pick a starter pack, add a
// row of your own, answer it, see it on the dossier, find it by search,
// then retire the row and get the answers back.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const settings = async () => {
  await blur()
  await page.click('nav a:has-text("Settings"):visible')
  await page.waitForSelector('h2:has-text("The person form")')
}
// Two editors sit in Settings — the person form and the relationship
// vocabulary — and they share a row style, so every query is scoped.
const FORM = 'section:has(h2:has-text("The person form"))'
const rowNames = () =>
  page.$$eval(`${FORM} .field-defs:not(.retired-defs) .field-def-name`, (els) =>
    els.map((e) => e.textContent.replace(/(Short text|Long text|List of tags|Date|Pick one|Number|Yes or no).*$/, '').trim()),
  )

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// 1. A starter pack is a form to edit, not a blank page.
await settings()
await page.click(`${FORM} button.pack:has-text("Family & friends")`)
await page.waitForSelector(`${FORM} .field-defs .field-def-name`)
const fromPack = await rowNames()
if (fromPack.length < 4) fail(`the pack seeded too little: ${JSON.stringify(fromPack)}`)
if (!fromPack.includes('Allergies & dietary')) fail(`no allergies row: ${JSON.stringify(fromPack)}`)
console.log('pack seeded:', fromPack.join(', '))

// The same pack again adds nothing — the rows are already there.
await page.click(`${FORM} .packs-more summary`)
await page.click(`${FORM} .packs-more button.pack:has-text("Family & friends")`)
await page.waitForTimeout(400)
if ((await rowNames()).length !== fromPack.length) fail('a second run of the same pack duplicated rows')

// 2. A row of your own.
await page.click(`${FORM} button:has-text("Add a row")`)
await page.fill(`${FORM} .add-field input`, 'Fears')
await page.selectOption(`${FORM} .add-field select`, 'longText')
await page.click(`${FORM} .add-field button:has-text("Add row")`)
await page.waitForSelector(`${FORM} .field-def-name:has-text("Fears")`)
// And the form refuses a second row by the same name.
await page.click(`${FORM} button:has-text("Add a row")`)
await page.fill(`${FORM} .add-field input`, 'fears')
await page.click(`${FORM} .add-field button:has-text("Add row")`)
await page.waitForSelector(`${FORM} .error:has-text("already a row")`)
await page.click(`${FORM} .add-field button:has-text("Cancel")`)
console.log('added a row, and a duplicate name is refused')

// 3. Answer it on a person.
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Priya Raman')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Priya Raman")')
await page.click('.section-head button:has-text("Edit")')
await page.waitForSelector('legend:has-text("More details")')
const more = page.locator('fieldset:has(legend:has-text("More details"))')
await more.locator('label:has-text("Fears") textarea').fill('heights, and hospitals')
await more.locator('label:has-text("Anniversary") input').fill('Jun 21 2014')
const chip = more.locator('.field-label:has-text("Allergies & dietary") input').first()
await chip.fill('peanuts')
await chip.press('Enter')
await page.click('.facts-form button[type=submit]')
await page.waitForSelector('.section-head button:has-text("Edit")')
await page.waitForTimeout(400)

// 4. Only what was answered draws — six rows on the form, three on the page.
const shown = await page.$$eval('dl dt', (els) => els.map((e) => e.textContent.trim()))
for (const label of ['Fears', 'Anniversary', 'Allergies & dietary']) {
  if (!shown.includes(label)) fail(`${label} is not on the dossier: ${JSON.stringify(shown)}`)
}
if (shown.includes('Gift ideas')) fail('an unanswered row drew on the dossier')
console.log('the dossier shows only what was answered:', shown.join(', '))

// A date answer is formatted, not echoed back as typed.
const anniversary = await page.locator('dl dt:has-text("Anniversary") + dd').textContent()
if (!/2014/.test(anniversary)) fail(`the date did not survive: ${anniversary}`)

// A list answer is a facet, like tags and likes.
if (!(await page.locator('dl dd a.facet:has-text("peanuts")').count())) {
  fail('a list answer is not tappable')
}

// 5. Search finds it.
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'peanuts')
await page.waitForSelector('a.person-row:has-text("Priya Raman")', { timeout: 10000 })
console.log('search finds a person by what they answered')

// 6. Retiring keeps the answers and offers them back.
await settings()
await page.click(`${FORM} .field-def-name:has-text("Fears")`)
await page.click(`${FORM} .editor-actions button:has-text("Retire row")`)
await page.waitForSelector(`${FORM} h3:has-text("Retired rows")`)
const retiredLine = await page.locator(`${FORM} .retired-defs li:has-text("Fears")`).innerText()
if (!/1 person answered/.test(retiredLine)) fail(`the retired row lost its count: ${retiredLine}`)
if ((await rowNames()).includes('Fears')) fail('a retired row is still on the form')
console.log('retired:', retiredLine.replace(/\n/g, ' · '))

// Off the dossier, and out of search, while the answer waits.
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'hospitals')
await page.waitForTimeout(600)
if (await page.locator('a.person-row').count()) fail('a retired row is still searchable')
await page.fill('input[type=search]', 'Priya')
await page.click('a.person-row:has-text("Priya Raman")')
await page.waitForSelector('h1:has-text("Priya Raman")')
if (await page.locator('dl dt:has-text("Fears")').count()) fail('a retired row still draws')

await settings()
await page.click(`${FORM} .retired-defs li:has-text("Fears") button:has-text("Restore")`)
await page.waitForTimeout(500)
if (!(await rowNames()).includes('Fears')) fail('Restore did not bring the row back')
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'hospitals')
await page.waitForSelector('a.person-row:has-text("Priya Raman")', { timeout: 10000 })
console.log('Restore brings the row and every answer back')

// 7. The relationship vocabulary (§8.2): rename lands on every tie,
// a word in use retires, an unused one goes for good.
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Sam Okafor')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Sam Okafor")')
await page.fill('form.add-form input[role="combobox"]', 'Priya')
await page.click('form.add-form .chip-suggestions li:has-text("Priya Raman")')
await page.selectOption('form.add-form select[aria-label="Relationship type"]', { label: 'coworker' })
await page.click('form.add-form .add-submit')
await page.waitForSelector('.roles-list li:has-text("Priya Raman") .role-chip:has-text("coworker")')

await settings()
await page.waitForSelector('h2:has-text("Kinds of relationship")')
const vocab = page.locator('section:has(h2:has-text("Kinds of relationship"))')
await vocab.locator('.field-def-name:has-text("coworker")').click()
if (!/1 tie/.test(await vocab.locator('.add-field').innerText())) {
  fail('the editor did not say how many ties a rename would touch')
}
await vocab.locator('.add-field input').fill('colleague')
await vocab.locator('.editor-actions button:has-text("Save")').click()
await page.waitForSelector('.field-def-name:has-text("colleague")')
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Sam')
await page.click('a.person-row:has-text("Sam Okafor")')
await page.waitForSelector('.roles-list .role-chip:has-text("colleague")')
console.log('renaming a word lands on the ties that use it')

// A word in use retires and leaves the tie alone.
await settings()
await vocab.locator('.field-def-name:has-text("colleague")').click()
await vocab.locator('.editor-actions button:has-text("Retire word")').click()
await page.waitForSelector('h3:has-text("Retired words")')
if (!/still on 1 tie/.test(await vocab.locator('.retired-defs').innerText())) {
  fail('a retired word lost count of the ties still carrying it')
}
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Sam')
await page.click('a.person-row:has-text("Sam Okafor")')
await page.waitForSelector('.roles-list .role-chip:has-text("colleague")')
// ...but is no longer on offer for a new one.
const offered = await page.$$eval('form.add-form select[aria-label="Relationship type"] option', (o) =>
  o.map((e) => e.textContent.trim()),
)
if (offered.includes('colleague')) fail('a retired word is still offered for new links')
console.log('a retired word keeps its ties and leaves the picker')

// An unused word is deleted outright.
await settings()
await vocab.locator('.field-def-name:has-text("roommate")').click()
const verb = await vocab.locator('.editor-actions button').first().textContent()
if (verb.trim() !== 'Delete word') fail(`an unused word should offer deletion, got "${verb}"`)
await vocab.locator('.editor-actions button:has-text("Delete word")').click()
await page.waitForTimeout(500)
if (await vocab.locator('.field-def-name:has-text("roommate")').count()) {
  fail('an unused word survived deletion')
}
console.log('an unused word is deleted outright')

await browser.close()
console.log('SMOKE25 OK')
