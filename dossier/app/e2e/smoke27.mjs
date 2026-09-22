// Values that outgrow their box.
//
// A pick-one row's choices were one comma string in a single-line field:
// past a few words you were editing a list through a letterbox. They are
// chips now, one per choice, and the word still in the field when you tap
// Save is kept — dropping it on *any* button meant Save silently lost it.
// The writing boxes take the height of what is in them, up to a ceiling.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const FORM = 'section:has(h2:has-text("The person form"))'
const chips = () => page.$$eval(`${FORM} .value-chip`, (e) => e.map((x) => x.firstChild.textContent.trim()))
const height = (sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().height))

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
await page.click('.form-setup button:has-text("Not now")')

// ---------- choices are chips ----------
await blur()
await page.click('nav a:has-text("Settings"):visible')
await page.waitForSelector('h2:has-text("The person form")')
await page.click(`${FORM} button:has-text("Add a row")`)
await page.fill(`${FORM} .add-field input`, 'Where we met')
await page.selectOption(`${FORM} .add-field select`, 'choice')
await page.waitForSelector(`${FORM} .chip-input input`)
const CHOICES = ['work', 'a conference', 'online', 'introduced by someone', 'the gym']
const box = page.locator(`${FORM} .chip-input input`)
await box.click()
// Typed with commas, the way the old field taught: each one commits.
await box.type(CHOICES.slice(0, -1).join(', ') + ', ')
if ((await chips()).length !== 4) fail(`a typed comma should commit: ${JSON.stringify(await chips())}`)
// …and the last one is left sitting in the field when Add row is tapped.
await box.type(CHOICES[4])
if ((await chips()).length !== 4) fail('the uncommitted word should not be a chip yet')
await page.click(`${FORM} button[type=submit]:has-text("Add row")`)
await page.waitForSelector(`${FORM} .field-def-name`)
await page.click(`${FORM} .field-def-name`)
await page.waitForSelector(`${FORM} .chip-input`)
const saved = await chips()
if (saved.join('|') !== CHOICES.join('|'))
  fail(`Save must keep the word still in the field: ${JSON.stringify(saved)}`)
console.log('choices are chips, and Add row keeps the one still being typed')

// A choice comes off with its own ×, not by hunting a comma.
await page.click(`${FORM} .value-chip:has-text("the gym") button`)
if ((await chips()).includes('the gym')) fail('× should take the chip off')
await page.click(`${FORM} button[type=submit]:has-text("Save")`)
await page.waitForSelector(`${FORM} .chip-input`, { state: 'detached', timeout: 8000 })
await page.click(`${FORM} .field-def-name`)
await page.waitForSelector(`${FORM} .chip-input`)
if ((await chips()).join('|') !== CHOICES.slice(0, 4).join('|'))
  fail(`removing one choice should stick: ${JSON.stringify(await chips())}`)
console.log('one × removes one choice, and the removal saves')
await page.click(`${FORM} button:has-text("Cancel")`)

// The row's choices reach the dossier's picker.
await blur()
await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Dana Wei')
await page.keyboard.press('Enter')
await page.waitForSelector('.person h1', { timeout: 15000 })
await page.click('button:has-text("Edit")')
await page.waitForSelector('label:has-text("How we met") textarea')
const offered = await page.$$eval('label:has-text("Where we met") option', (e) =>
  e.map((o) => o.textContent.trim()).filter((t) => t !== 'Choose…'))
if (offered.join('|') !== CHOICES.slice(0, 4).join('|'))
  fail(`the dossier should offer exactly those: ${JSON.stringify(offered)}`)
console.log('the picker on a dossier offers them:', offered.join(', '))

// ---------- boxes grow to their content ----------
const MET = 'label:has-text("How we met") textarea'
const small = await height(MET)
await page.fill(MET, 'At Priya’s wedding in the spring of 2019 — we were seated at the same table and spent the whole reception arguing about whether a hot dog is a sandwich.')
await page.waitForTimeout(200)
const grown = await height(MET)
if (grown <= small + 20) fail(`a paragraph should open the box: ${small} → ${grown}`)
// Every line of it is in view, not scrolled away inside two rows.
const clipped = await page.locator(MET).evaluate((el) => el.scrollHeight - el.clientHeight > 2)
if (clipped) fail('the whole answer should be in view')
console.log(`"How we met" grows with the answer: ${small}px → ${grown}px`)

// Leaving a dirty form asks first (and that question is its own test).
await page.click('.facts-form button:has-text("Cancel")')
await page.click('button:has-text("Discard")')
await page.waitForSelector('.capture-bar textarea', { state: 'visible', timeout: 8000 })
const NOTE = '.capture-bar textarea'
await page.click(NOTE)
await page.fill(NOTE, 'Short one.')
await page.waitForTimeout(200)
const oneLine = await height(NOTE)
await page.fill(NOTE, Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a note that keeps on going.`).join(' '))
await page.waitForTimeout(200)
const tall = await height(NOTE)
if (tall <= oneLine) fail(`the note box should grow: ${oneLine} → ${tall}`)
// …but never so far that Save note leaves the screen.
if (tall > 260) fail(`the note box should stop growing well before the screen: ${tall}px`)
const saveVisible = await page.locator('.capture-bar button:has-text("Save note")').isVisible()
if (!saveVisible) fail('Save note must stay in reach however long the note is')
console.log(`the note box grows to ${tall}px and stops there, Save still in reach`)

console.log('ok')
await browser.close()
