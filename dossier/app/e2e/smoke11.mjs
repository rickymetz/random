// Scale + iOS pass: dev stress loader, paged People list, keyboard inset CSS.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const shots = process.env.SHOTS ?? '/tmp/shots11'
import fs from 'node:fs'
fs.mkdirSync(shots, { recursive: true })
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(`page error: ${e.message}`))
page.on('dialog', (d) => d.accept())
const PASS = 'correct horse battery'
await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', PASS)
await page.fill('input[aria-label="Repeat passphrase"]', PASS)
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })

// Stress section hidden without ?dev=1
await page.goto(`${BASE}/#/settings`)
await page.waitForSelector('h2:has-text("Sample data")')
if (await page.locator('section.stress').count()) fail('stress section visible without dev flag')
await page.goto(`${BASE}/#/settings?dev=1`)
await page.waitForSelector('section.stress')
await page.selectOption('.stress-size select', '300')
await page.click('button:has-text("Add crowd")')
await page.waitForFunction(() => /Added 300 people/.test(document.querySelector('section.stress p[role="status"]')?.textContent ?? ''), null, { timeout: 60000 })
console.log('stress crowd loaded:', (await page.locator('section.stress p[role="status"]').textContent()).trim())
await page.screenshot({ path: `${shots}/stress-settings.png` })

// People list pages: 60 rows + Show more, IntersectionObserver extends on scroll
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav.tabbar a:has-text("People")')
await page.waitForSelector('.person-row')
const rows0 = await page.locator('.person-row').count()
if (rows0 !== 60) fail(`expected 60 initial rows, got ${rows0}`)
const more = page.locator('.list-more button')
if (!/Show more \(241 remaining\)/.test(await more.textContent())) fail('show more label: ' + await more.textContent())
await page.screenshot({ path: `${shots}/people-paged.png` })
await more.scrollIntoViewIfNeeded()
await page.waitForFunction(() => document.querySelectorAll('.person-row').length >= 120, null, { timeout: 5000 })
console.log('scrolling to the sentinel loads the next page')
await more.click()
await page.waitForFunction(() => document.querySelectorAll('.person-row').length >= 180, null, { timeout: 5000 })
console.log('Show more button loads another page')
// A search resets the page window
await page.fill('input[type=search]', 'ma')
await page.waitForFunction(() => document.querySelectorAll('.person-row').length <= 60, null, { timeout: 5000 })
const rowsQ = await page.locator('.person-row').count()
console.log('search resets paging:', rowsQ, 'rows')
// Snippet rows still say why they matched
await page.fill('input[type=search]', 'sailboat')
await page.waitForSelector('.person-row .snippet')
console.log('note-hit snippet shown:', (await page.locator('.person-row .snippet').first().textContent()).slice(0, 40))
await page.fill('input[type=search]', '')

// Graph with 300 people settles and reports counts
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav.tabbar a:has-text("Graph")')
await page.waitForSelector('canvas.graph-canvas[data-layout="settled"]', { timeout: 60000 })
await page.waitForTimeout(600)
console.log('graph settled:', (await page.locator('canvas.graph-canvas').getAttribute('aria-label')).split('.')[0])
await page.screenshot({ path: `${shots}/graph-300.png` })

// Keyboard inset: --kb lifts the capture bar while it has focus (iOS path)
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav.tabbar a:has-text("People")')
await page.waitForSelector('.person-row')
await page.locator('.person-row').first().click()
await page.waitForSelector('.capture-bar textarea')
await page.locator('.capture-bar textarea').focus()
const kbBottom = await page.evaluate(() => {
  document.documentElement.style.setProperty('--kb', '300px')
  document.body.classList.add('kb-open')
  const bar = document.querySelector('.capture-bar')
  const cs = getComputedStyle(bar)
  return { bottom: cs.bottom, pad: cs.paddingBottom, tabbar: getComputedStyle(document.querySelector('.tabbar')).transform }
})
if (kbBottom.bottom !== '300px') fail(`capture bar bottom with keyboard: ${JSON.stringify(kbBottom)}`)
console.log('capture bar lifts by --kb while focused:', JSON.stringify(kbBottom))
await page.screenshot({ path: `${shots}/capture-kb.png` })
await page.evaluate(() => { document.documentElement.style.removeProperty('--kb'); document.body.classList.remove('kb-open') })
// Edit form Save row too
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('.section-head button:has-text("Edit")')
await page.waitForSelector('.form-actions')
const faBottom = await page.evaluate(() => {
  document.documentElement.style.setProperty('--kb', '280px')
  return getComputedStyle(document.querySelector('.form-actions')).bottom
})
if (faBottom !== '280px') fail(`form actions bottom with keyboard: ${faBottom}`)
console.log('form Save row lifts by --kb')
await page.evaluate(() => document.documentElement.style.removeProperty('--kb'))
await page.click('.form-actions button:has-text("Cancel")')

// Remove crowd in one go
await page.goto(`${BASE}/#/settings?dev=1`)
await page.waitForSelector('section.stress')
await page.click('button:has-text("Remove crowd")')
await page.waitForFunction(() => /Removed 300 people/.test(document.querySelector('section.stress p[role="status"]')?.textContent ?? ''), null, { timeout: 60000 })
console.log('crowd removed:', (await page.locator('section.stress p[role="status"]').textContent()).trim())
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav.tabbar a:has-text("People")')
await page.waitForSelector('.empty')
console.log('SMOKE11 OK')
await browser.close()
