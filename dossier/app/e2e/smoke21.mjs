// The installed app's bottom edge. env() is always 0 in a headless
// browser, so the home indicator's inset is stood in through --sab (the
// variable every safe-area rule reads) and the bar is measured against it.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const SAB = 34
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
page.on('pageerror', (e) => fail(`page error: ${e.message}`))
page.on('dialog', (d) => d.accept())
await page.addInitScript((sab) => {
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style')
    s.textContent = `:root { --sab: ${sab}px; --sat: 59px; }`
    document.head.append(s)
  })
}, SAB)
await page.goto(BASE)
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })

const m = await page.evaluate(() => {
  const bar = document.querySelector('.tabbar').getBoundingClientRect()
  const tabs = [...document.querySelectorAll('.tabbar a, .tabbar button')].map((el) => {
    const b = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const label = el.lastChild.nodeType === 3 ? el.lastChild : el
    const r = document.createRange()
    r.selectNodeContents(label)
    return {
      name: el.textContent.trim(),
      bottom: Math.round(b.bottom),
      contentBottom: Math.round(b.bottom - parseFloat(cs.paddingBottom)),
      textBottom: Math.round(r.getBoundingClientRect().bottom),
    }
  })
  const rule = document.querySelector('.tabbar .tab-action')
  const before = rule && getComputedStyle(rule, '::before')
  return {
    vh: innerHeight,
    bar: { top: Math.round(bar.top), bottom: Math.round(bar.bottom), h: Math.round(bar.height) },
    tabs,
    ruleBottom: before && before.bottom,
    mainPad: getComputedStyle(document.querySelector('main')).paddingBottom,
  }
})

// The bar sits on the bottom edge and is the native height plus the inset.
if (m.bar.bottom !== m.vh) fail(`the bar should reach the bottom edge: ${m.bar.bottom} of ${m.vh}`)
if (m.bar.h < 80 || m.bar.h > 90) fail(`bar height ${m.bar.h}px — expected ~84 (49 + ${SAB} inset)`)
// Every tab takes a tap all the way down: no dead strip over the indicator.
for (const t of m.tabs) {
  if (t.bottom !== m.vh) fail(`tab "${t.name}" stops at ${t.bottom}, not the bottom edge ${m.vh}`)
  if (t.contentBottom > m.vh - SAB) fail(`tab "${t.name}" puts content ${m.vh - t.contentBottom}px from the edge, inside the ${SAB}px inset`)
  if (t.textBottom > m.vh - SAB) fail(`tab "${t.name}" label runs into the home indicator`)
}
console.log(`tab bar ${m.bar.h}px: every tab reaches the edge, labels clear the ${SAB}px inset`)
// The Lock divider is inset, not a border cut short above the indicator.
if (!m.ruleBottom || parseFloat(m.ruleBottom) < SAB) fail(`the Lock divider should stop above the inset, bottom=${m.ruleBottom}`)
console.log('Lock divider is inset from the bar’s edges')
// Content clears the bar with room to spare.
const pad = parseFloat(m.mainPad)
if (pad < m.bar.h) fail(`main pads ${pad}px for a ${m.bar.h}px bar — content would sit under it`)
console.log(`main clears the bar by ${Math.round(pad - m.bar.h)}px`)

// The capture bar rides above the tabs, not under them.
await page.fill('input[type=search]', 'Ada')
await page.click('button.add-person')
await page.waitForSelector('.person h1')
await page.waitForTimeout(200)
const c = await page.evaluate(() => {
  const cap = document.querySelector('.capture-bar').getBoundingClientRect()
  const bar = document.querySelector('.tabbar').getBoundingClientRect()
  return { capBottom: Math.round(cap.bottom), barTop: Math.round(bar.top) }
})
if (c.capBottom > c.barTop + 1) fail(`the capture bar overlaps the tabs: ${c.capBottom} vs ${c.barTop}`)
console.log('capture bar sits on the tab bar, not under it')
await browser.close()
console.log('smoke21 ok')
