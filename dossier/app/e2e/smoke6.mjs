import { launch } from './lib.mjs'
import fs from 'node:fs'
fs.mkdirSync('/tmp/shots-smoke6', { recursive: true })
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
page.on('pageerror', (err) => fail(`page error: ${err.message}`))
page.on('dialog', (d) => d.accept())

await page.goto('http://localhost:4290')
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
await page.fill('input[type=search]', 'Ada Lovelace')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Ada Lovelace")')

// Chip input: add tags via Enter and comma, autocomplete casing reuse
// The form moves focus to its title on the next frame: type only once it
// has (a slow runner otherwise blurs the chip field mid-word, which
// commits the fragment as a chip).
const formReady = () => page.waitForFunction(() => document.activeElement?.id === 'facts-form-title')
await page.click('.section-head button:has-text("Edit")')
await formReady()
const tagInput = page.locator('.facts-form .field-label:has-text("Tags") .chip-row input')
await tagInput.fill('Climbing')
await tagInput.press('Enter')
await tagInput.fill('work,neighbor')
await page.waitForSelector('.value-chip:has-text("Climbing")')
await page.waitForSelector('.value-chip:has-text("neighbor")')
await page.click('button[type=submit]:has-text("Save")')
await page.waitForSelector('.fact >> text=Climbing, work, neighbor')
console.log('chip input: enter + comma commit, chips render')

// Vocabulary autocomplete on a second person: typing "cli" suggests "Climbing"
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Bob Chen')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Bob Chen")')
await page.click('.section-head button:has-text("Edit")')
await formReady()
const tagInput2 = page.locator('.facts-form .field-label:has-text("Tags") .chip-row input')
await tagInput2.fill('cli')
try {
  await page.waitForSelector('.chip-suggestions li[role="option"]:has-text("Climbing")')
} catch (err) {
  // What did the field look like when the suggestion never came?
  console.error('DIAG', JSON.stringify(await page.evaluate(() => {
    const a = document.activeElement
    return {
      active: a ? `${a.tagName}#${a.id}.${a.className} name=${a.getAttribute('name')} aria=${a.getAttribute('aria-label')}` : null,
      inputs: [...document.querySelectorAll('.facts-form .chip-row input')].map((i) => ({ v: i.value, focused: i === a })),
      chips: [...document.querySelectorAll('.facts-form .value-chip')].map((c) => c.textContent),
      suggestions: [...document.querySelectorAll('.chip-suggestions li')].map((c) => c.textContent),
      forms: document.querySelectorAll('.facts-form').length,
      url: location.hash,
    }
  })))
  await page.screenshot({ path: '/tmp/shots-smoke6/fail.png' }).catch(() => {})
  throw err
}
await page.click('.chip-suggestions li[role="option"]:has-text("Climbing")')
await page.waitForSelector('.value-chip:has-text("Climbing")')
await page.click('button[type=submit]:has-text("Save")')
console.log('chip vocabulary autocomplete reuses casing')

// Triage: jot a note, promote to Employer, delete note after
await page.fill('.capture-bar textarea', 'Anthropic')
await page.click('button:has-text("Save note")')
await page.waitForSelector('.notes li')
await page.click('.note-actions button:has-text("Add to Details")')
await page.selectOption('.promote-panel select', 'employer')
await page.check('.promote-panel input[type=checkbox]')
await page.click('.promote-panel button:has-text("Save")')
await page.waitForSelector('.fact >> text=Anthropic')
if (await page.locator('.notes li').count()) fail('note should be deleted after promotion')
console.log('triage promotes note to field and removes it')

// Disguise picker: switch to Planner; manifest link + title swap; persists
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.click('.disguise-option:has-text("Planner")')
const state = await page.evaluate(() => ({
  title: document.title,
  manifest: document.querySelector('link[rel="manifest"]')?.href,
  apple: document.querySelector('link[rel="apple-touch-icon"]')?.href,
  stored: localStorage.getItem('appearance'),
}))
if (state.title !== 'Planner') fail(`title: ${state.title}`)
if (!state.manifest?.includes('manifest-planner')) fail(`manifest: ${state.manifest}`)
if (!state.apple?.includes('planner')) fail(`apple icon: ${state.apple}`)
if (state.stored !== 'planner') fail(`stored: ${state.stored}`)
await page.reload()
await page.waitForSelector('input[aria-label="Passphrase"], input[aria-label="PIN"]')
const titleAfter = await page.evaluate(() => document.title)
if (titleAfter !== 'Planner') fail(`title after reload: ${titleAfter}`)
// Manifest actually fetchable
const res = await page.evaluate(async () => (await fetch('/manifest-planner.webmanifest')).status)
if (res !== 200) fail(`manifest fetch: ${res}`)
console.log('disguise swap applies, persists across reload, manifest fetchable')

await browser.close()
console.log('SMOKE6 OK')
