// Home at scale: Recent row + A–Z jump rail.
import { launch } from './lib.mjs'
import fs from 'node:fs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const shots = '/tmp/shots13'; fs.mkdirSync(shots, { recursive: true })
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(`page error: ${e.message}`))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })
// Big vault
await page.goto(`${BASE}/#/settings?dev=1`)
await page.selectOption('.stress-size select', '300')
await page.click('button:has-text("Add crowd")')
await page.waitForFunction(() => /Added 300/.test(document.querySelector('section.stress p[role="status"]')?.textContent ?? ''), null, { timeout: 60000 })
await blur(); await page.click('nav.tabbar a:has-text("People")'); await page.waitForSelector('.person-row')
// Nobody has been opened and nobody has been worked on, so there is no
// Recent row yet: a crowd that arrived all at once (a contacts import,
// say) would otherwise head the screen with six untouched strangers.
if (await page.locator('.recent').count()) fail('no visits and no edits: there is nothing recent')
console.log('no Recent row before any visit')
// Visit two dossiers
const names = []
for (const i of [3, 7]) {
  const row = page.locator('.person-row').nth(i)
  names.push((await row.locator('strong').textContent()).trim())
  await row.click(); await page.waitForSelector('.person h1'); await page.click('button.back'); await page.waitForSelector('.person-row')
}
await page.waitForFunction(() => document.querySelector('.recent h2')?.textContent === 'Recent')
const recent = await page.locator('.recent-name').allTextContents()
if ((await page.locator('.recent li').count()) !== 2) fail(`the two visits are all there is: ${recent}`)
const short = (n) => { const p = n.split(' '); return `${p[0]} ${p[p.length - 1][0]}.` }
if (recent[0] !== short(names[1]) || recent[1] !== short(names[0])) fail(`recent order: ${recent} vs ${names}`)
console.log('Recent row newest first:', recent.slice(0, 2).join(', '))
await page.screenshot({ path: `${shots}/home-recent.png` })
// Rail: hidden while the top of the page is showing; appears with the list
const rail = page.locator('.letter-rail')
if (await rail.evaluate((el) => el.classList.contains('visible'))) fail('rail visible at the top of the page')
await page.evaluate(() => window.scrollTo(0, document.querySelector('.list-heading').getBoundingClientRect().top + window.scrollY - 40))
await page.waitForFunction(() => document.querySelector('.letter-rail')?.classList.contains('visible'), null, { timeout: 3000 })
console.log('rail hidden at the top, shown once the list scrolls up')
if (!/All people/.test(await page.locator('.list-heading').textContent())) fail('list heading')
// First row of a letter should sit under app bar (52) + sticky header (~28).
const landed = (letter) => page.waitForFunction((letter) => { const h = document.querySelector(`li.letter[data-letter="${letter}"]`); const r = h?.nextElementSibling; if (!r) return false; const top = r.getBoundingClientRect().top; const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2; const bar = document.querySelector('.app-bar').getBoundingClientRect().height; return Math.abs(top - (bar + h.offsetHeight)) < 3 || (atEnd && top < 500) }, letter, { timeout: 5000 })
if ((await rail.locator('button').count()) !== 26 || (await rail.locator('.absent').count()) !== 1) fail('rail letters: ' + await rail.locator('button').count())
if ((await rail.locator('[tabindex="0"]').count()) !== 1) fail('rail should be one tab stop')
const box = await rail.boundingBox()
const yFor = (letter) => box.y + ((letter === '#' ? 0 : letter.charCodeAt(0) - 64) + 0.5) * (box.height / 27)
await page.mouse.click(box.x + box.width / 2, yFor('Z'))
// Z sits near the end of the document, so the page bottoms out instead of
// putting the header exactly under the app bar.
await landed('Z')
const rowsZ = await page.locator('.person-row').count()
console.log('tap Z: header under the app bar, rows grown to', rowsZ)
// Drag from B to M shows the bubble and lands on M
await page.mouse.move(box.x + box.width / 2, yFor('B'))
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2, yFor('G'), { steps: 4 })
await page.mouse.move(box.x + box.width / 2, yFor('M'), { steps: 4 })
const bubble = await page.locator('.rail-bubble').textContent()
await landed('M')
await page.screenshot({ path: `${shots}/rail-drag.png` })
await page.mouse.up()
if (bubble !== 'M') fail('bubble ' + bubble)
await landed('M')
if (await page.locator('.rail-bubble').count()) fail('bubble stayed after release')
console.log('drag B→M: bubble shows the letter, lands on M')
// Keyboard: one tab stop, arrows move between letters, Enter jumps and moves focus to the row
await page.focus('.letter-rail button[tabindex="0"]')
await page.keyboard.press('Home')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
const focusedLetter = await page.evaluate(() => document.activeElement?.dataset.letter)
if (focusedLetter !== 'C') fail('arrow keys: ' + focusedLetter)
await page.keyboard.press('Enter')
await landed('C')
const focusedRow = await page.evaluate(() => document.activeElement?.closest('.person-row')?.querySelector('strong')?.textContent)
if (!focusedRow || !/^C/.test(focusedRow)) fail('focus after keyboard jump: ' + focusedRow)
console.log('keyboard: arrows move, Enter jumps and focuses the first C row:', focusedRow)
// Search hides Recent + rail
await page.fill('input[type=search]', 'ma')
await page.waitForTimeout(150)
if (await page.locator('.letter-rail').count() || await page.locator('.recent').count()) fail('rail/recent visible during search')
console.log('search hides Recent and the rail')
// Back to a tiny vault: no Recent, no rail
await page.goto(`${BASE}/#/settings?dev=1`)
await page.click('button:has-text("Remove crowd")')
await page.waitForFunction(() => /Removed 300/.test(document.querySelector('section.stress p[role="status"]')?.textContent ?? ''), null, { timeout: 60000 })
await blur(); await page.click('nav.tabbar a:has-text("People")'); await page.waitForSelector('.people')
if (await page.locator('.recent').count()) fail('recent shown for a tiny vault')
if (await page.locator('.letter-rail').count()) fail('rail shown for a tiny vault')
console.log('tiny vault: no Recent, no rail')
console.log('SMOKE13 OK')
await browser.close()
