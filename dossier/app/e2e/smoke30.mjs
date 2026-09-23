// Drafts beyond the note box: a note being edited, and the Edit form.
//
// Either kind of edit, left open when the page goes away — a reload, a
// lock, a tap on another tab — comes back open, with what was typed and
// a word saying so. Saving or cancelling it lets it go for good.
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
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
const unlock = async () => {
  await page.waitForSelector('main.unlock-main', { timeout: 30000 })
  await page.fill('input[aria-label="Passphrase"]', 'correct horse battery')
  await page.click('button[type=submit]')
  await page.waitForSelector('main.unlock-main', { state: 'detached', timeout: 15000 })
}
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const reopen = async () => {
  await page.reload()
  await unlock()
  await page.waitForSelector('.person h1', { timeout: 15000 }).catch(() => fail('unlocking should land back on the dossier'))
}
const lockAndBack = async () => {
  await blur()
  await page.locator('button:has-text("Lock"):visible').first().click()
  await unlock()
  await page.waitForSelector('.person h1', { timeout: 15000 })
}

await page.fill('input[type=search]', 'Ada Lovelace')
await page.keyboard.press('Enter')
await page.waitForSelector('.person h1')
await page.fill('.capture-bar textarea', 'Sails on Sundays')
await page.click('.capture-bar button:has-text("Save")')
await page.waitForSelector('.notes li:has-text("Sails on Sundays")')

// ---------- the Edit form ----------
const FORM = '.facts-form'
const LOCATION = `${FORM} label:has-text("Location") input`
const TAGS = `${FORM} input[aria-label="Add Tags"]`
const PRONOUNS = `${FORM} label:has-text("Pronouns") input`
await page.click('#edit-details')
await page.fill(LOCATION, 'Lisbon')
await page.fill(TAGS, 'regat') // typed, never made a chip
await page.waitForTimeout(900)
await reopen()
if (!(await page.locator(FORM).count())) fail('the Edit form should reopen after a reload')
if ((await page.inputValue(LOCATION)) !== 'Lisbon') fail('the location typed should be back')
if ((await page.inputValue(TAGS)) !== 'regat') fail('the half-typed tag should be back')
if (!(await page.locator(`${FORM} .restored-hint`).isVisible())) fail('the form should say its changes are back')
console.log('form: reopened after a reload, location and a half-typed tag back')
// Not even a pause: a lock writes it. (On a phone the tabs, Lock with
// them, step aside while the form is open; a wide window keeps them.)
await page.setViewportSize({ width: 1280, height: 900 })
await page.fill(PRONOUNS, 'she/her')
await lockAndBack()
await page.setViewportSize({ width: 390, height: 844 })
if ((await page.inputValue(PRONOUNS)) !== 'she/her') fail('a lock straight after typing should keep it')
console.log('form: typed and locked at once, still there')
await page.click(`${FORM} button:has-text("Save")`)
await page.waitForSelector(FORM, { state: 'detached' })
const details = await page.locator('main').innerText()
if (!/Lisbon/.test(details) || !/regat/.test(details)) fail(`saved details: ${details}`)
await reopen()
if (await page.locator(FORM).count()) fail('a saved form must not come back')
// Pronouns don't show on the page; the form has them.
await page.click('#edit-details')
if ((await page.inputValue(PRONOUNS)) !== 'she/her') fail('the pronouns should have been saved')
if (await page.locator(`${FORM} .restored-hint`).count()) fail('a fresh edit is not a restored one')
await page.click(`${FORM} button:has-text("Cancel")`)
await page.waitForSelector(FORM, { state: 'detached' })
console.log('form: saved, and gone for good')

await page.click('#edit-details')
await page.fill(LOCATION, 'Porto')
await page.waitForTimeout(900)
await page.click(`${FORM} button:has-text("Cancel")`)
await page.click(`${FORM} button:has-text("Discard")`)
await page.waitForSelector(FORM, { state: 'detached' })
await page.waitForTimeout(500) // forgetting is a write too; give it its moment
await reopen()
if (await page.locator(FORM).count()) fail('a discarded form must not come back')
if (/Porto/.test(await page.locator('main').innerText())) fail('discarded changes must not be saved')
console.log('form: discarded, and gone for good')

// ---------- a note being edited ----------
const EDITOR = '.note-editor'
const EDIT_BOX = `${EDITOR} textarea`
await page.click('button[aria-label="Edit note"]')
await page.fill(EDIT_BOX, 'Sails on Saturdays now')
await page.waitForTimeout(900)
await reopen()
if (!(await page.locator(EDITOR).count())) fail('the note editor should reopen after a reload')
if ((await page.inputValue(EDIT_BOX)) !== 'Sails on Saturdays now') fail('the edit should be back')
if (!(await page.locator(`${EDITOR} .restored-hint`).isVisible())) fail('the editor should say the edit is back')
console.log('note: reopened after a reload with the edit')
// Off to another tab and straight back: no pause to write in.
await page.fill(EDIT_BOX, 'Sails on Saturdays, mostly')
await blur()
await page.click('nav a:has-text("People"):visible')
await page.waitForSelector('input[type=search]')
await page.goBack()
await page.waitForSelector(EDIT_BOX).catch(() => fail('the editor should reopen coming back from another tab'))
if ((await page.inputValue(EDIT_BOX)) !== 'Sails on Saturdays, mostly') fail('the edit should survive another tab')
console.log('note: survived a trip to another tab')
await page.click(`${EDITOR} button:has-text("Save")`)
await page.waitForSelector(EDITOR, { state: 'detached' })
if (!/Sails on Saturdays, mostly/.test(await page.locator('.notes').innerText())) fail('the edit should be saved')
await reopen()
if (await page.locator(EDITOR).count()) fail('a saved edit must not come back')
await page.click('button[aria-label="Edit note"]')
await page.fill(EDIT_BOX, 'never mind')
await page.waitForTimeout(900)
await page.click(`${EDITOR} button:has-text("Cancel")`)
await page.waitForTimeout(500) // forgetting is a write too; give it its moment
await reopen()
if (await page.locator(EDITOR).count()) fail('a cancelled edit must not come back')
if (!/Sails on Saturdays, mostly/.test(await page.locator('.notes').innerText())) fail('cancel must keep the note')
console.log('note: saved or cancelled, gone for good')

await browser.close()
console.log('smoke30 ok')
