// Roles on a link: a pair carries several roles, a role can be dated and
// marked former, former ties hide on the graph, and "how you connect"
// walks current ties first.
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
await page.click('button[type=submit]'); await page.waitForSelector('input[type=search]')
await page.goto(`${BASE}/#/settings`); await page.waitForSelector('h2:has-text("Sample data")')
await page.click('button:has-text("Load sample people")')
await page.waitForFunction(() => /Added/.test([...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Sample data')?.querySelector('p[role="status"]')?.textContent ?? ''), null, { timeout: 30000 })

// The seed's "ex" is a former partner now; no "ex" type anywhere.
await page.goto(`${BASE}/#/`); await page.waitForSelector('.person-row')
await page.fill('input[type=search]', 'Marcus'); await page.click('a.person-row:has-text("Marcus Webb")'); await page.waitForSelector('#relationships-heading')
const rosa = page.locator('.roles-list li:has-text("Rosa Delgado")')
if ((await rosa.locator('.role-chip.former').textContent()).trim() !== 'former partner') fail('Rosa should be a former partner')
if ((await page.locator('form.add-form select[aria-label="Relationship type"] option', { hasText: /^ex$/ }).count()) !== 0) fail('"ex" still offered as a type')

// A second role on the same pair via "+ role".
await page.click('.roles-list button[aria-label="Add another role for Rosa Delgado"]')
if (!(await page.evaluate(() => document.activeElement?.matches('form.add-form select[aria-label="Relationship type"]')))) fail('+ role should focus the type select')
await page.selectOption('form.add-form select[aria-label="Relationship type"]', { label: 'coworker' })
await page.click('form.add-form .add-submit')
await page.waitForSelector('.roles-list li:has-text("Rosa Delgado") .role-chip:has-text("coworker")')
if ((await rosa.locator('.role-chip').count()) !== 2) fail('Rosa should have two role chips')
// The same role again is a no-op.
await page.click('.roles-list button[aria-label="Add another role for Rosa Delgado"]')
await page.selectOption('form.add-form select[aria-label="Relationship type"]', { label: 'coworker' })
await page.click('form.add-form .add-submit'); await page.waitForTimeout(300)
if ((await rosa.locator('.role-chip').count()) !== 2) fail('duplicate role should not stack')
console.log('roles: former partner + coworker on one pair; duplicate skipped')

// Date the former role in its editor; the chip's label carries the dates.
await rosa.locator('.role-chip.former').click(); await page.waitForSelector('.role-editor')
await page.fill('.role-editor input[aria-label="Since"]', '2019')
await page.fill('.role-editor input[aria-label="Until"]', 'Jun 2021'); await page.keyboard.press('Enter')
await page.waitForFunction(() => /2019–Jun 2021/.test(document.querySelector('.role-chip.former')?.getAttribute('aria-label') ?? ''))
// Bad date → in-place error, nothing saved.
await page.fill('.role-editor input[aria-label="Until"]', 'whenever'); await page.keyboard.press('Enter')
await page.waitForSelector('.role-editor .status-slot:has-text("Try a year")')
await page.fill('.role-editor input[aria-label="Until"]', 'Jun 2021'); await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
await page.waitForFunction(() => !document.querySelector('.role-editor'))
console.log('role editor: dates saved, bad date rejected in place')

// Copy as text says it the way people do.
const text = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Copy as text/.test(b.textContent))
  if (!btn) return ''
  let out = ''
  const orig = navigator.clipboard.writeText
  navigator.clipboard.writeText = (t) => { out = t; return Promise.resolve() }
  btn.click(); await new Promise((r) => setTimeout(r, 200))
  navigator.clipboard.writeText = orig
  return out
})
if (text && !/Rosa Delgado: former partner \(2019–Jun 2021\)/.test(text)) fail('copy as text: ' + text.split('\n').filter((l) => /Rosa/.test(l)).join(' | '))
if (text) console.log('copy as text lists the former role with its dates')

// Graph: the pair fans into two strands; the "former" chip hides one.
await page.goto(`${BASE}/#/graph`); await page.waitForSelector('canvas.graph-canvas[data-layout="settled"]', { timeout: 30000 })
const links = () => page.evaluate(() => Number(/(\d+) connections/.exec(document.querySelector('canvas.graph-canvas').getAttribute('aria-label'))?.[1]))
const before = await links()
await page.click('.graph-controls .chip.former'); await page.waitForTimeout(300)
if ((await links()) !== before - 1) fail(`former chip should hide one link: ${before} → ${await links()}`)
await page.click('.chip.hidden-status'); await page.waitForTimeout(300)
if ((await links()) !== before) fail('Show all should restore the former link')
console.log('graph: former chip hides the former strand; Show all restores it')

// How you connect: Rosa's current tie (coworker) is the path, not the former one.
await page.goto(`${BASE}/#/`); await page.waitForSelector('.person-row')
await page.fill('input[type=search]', 'Rosa'); await page.click('a.person-row:has-text("Rosa Delgado")'); await page.waitForSelector('h2:has-text("How you connect")')
const pathText = (await page.locator('.path').textContent()).replace(/\s+/g, ' ')
if (!/coworker|friend/.test(pathText) || /former/.test(pathText)) fail('path should use a current tie: ' + pathText)
console.log('how you connect walks current ties:', pathText.slice(0, 80))
await browser.close()
console.log('SMOKE19 OK')
