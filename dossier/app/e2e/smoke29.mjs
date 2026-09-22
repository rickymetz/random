// New versions, and the notes being written when they arrive.
//
// Serves a private copy of the build and "ships a release" by changing
// that copy's service worker on disk, then checks three things:
//   1. Settings → Updates finds it on request and reopens onto it.
//   2. Found in the background while a note is being written, it waits:
//      no reload, the draft stays in the box — and it installs when the
//      app locks, the draft becoming a note as a lock always makes it.
//   3. A note being written survives a reload nobody asked for (iOS
//      closing the app, a crash): it is back in the box after unlocking.
import { launch } from './lib.mjs'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..')
// A copy of the build of our own, so shipping a "release" never touches
// the dist every other smoke is reading.
const dist = mkdtempSync(join(os.tmpdir(), 'ledger-update-'))
cpSync(join(app, 'dist'), dist, { recursive: true })
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const server = spawn(join(app, 'node_modules/.bin/vite'), ['preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: app, stdio: 'ignore' })
function cleanup() {
  try { server.kill() } catch {}
  try { rmSync(dist, { recursive: true, force: true }) } catch {}
}
const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const BASE = `http://localhost:${port}`
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break } catch {}
  await new Promise((r) => setTimeout(r, 250))
}
let release = 0
const ship = () => {
  const sw = join(dist, 'sw.js')
  writeFileSync(sw, readFileSync(sw, 'utf8') + `\n// release ${++release}\n`)
  return `release ${release}`
}
const running = () => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration()
  return (await (await fetch(r.active.scriptURL, { cache: 'no-store' })).text()).match(/release \d+/g)?.pop() ?? 'original'
})

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
let loads = 0
page.on('load', () => loads++)
await page.goto(BASE)
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 })
  .catch(() => fail('the service worker never took control'))
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

// ---------- 1. on request, from Settings ----------
await blur()
await page.click('nav a:has-text("Settings"):visible')
const UPDATES = 'section:has(h2:has-text("Updates"))'
await page.waitForSelector(UPDATES)
const status = () => page.locator(`${UPDATES} [role=status]`).innerText()
const waitStatus = async (re, what) => {
  for (let i = 0; i < 80; i++) {
    if (re.test(await status())) return
    await page.waitForTimeout(250)
  }
  fail(`${what}: ${await status()}`)
}
const blurb = await page.locator(`${UPDATES} .hint`).first().innerText()
if (!/^Version \d+\.\d+\.\d+ \([0-9a-z]+\)/.test(blurb)) fail(`the build should be named: ${blurb}`)
if (/Ledger/.test(await page.locator(UPDATES).innerText())) fail('a disguised copy must not say "Ledger"')
await page.click(`${UPDATES} button:has-text("Check for updates")`)
await waitStatus(/latest version/, 'expected "latest"')
console.log('1. names its build; nothing new:', await status())
const r1 = ship()
await page.click(`${UPDATES} button:has-text("Check for updates")`)
await unlock()
await page.waitForSelector(UPDATES, { timeout: 15000 }).catch(() => fail('unlocking should land back on Settings'))
if ((await running()) !== r1) fail(`asked for, the new version should be running: ${await running()}`)
console.log('   found on request, reopened onto it, locked:', r1)

// ---------- 2. in the background, while a note is being written ----------
await page.evaluate(() => { location.hash = '#/' })
await page.fill('input[type=search]', 'Ada Lovelace')
await page.keyboard.press('Enter')
await page.waitForSelector('.person h1')
const NOTE = '.capture-bar textarea'
await page.click(NOTE)
await page.fill(NOTE, 'Half a thought about the regatta —')
const r2 = ship()
const loadsBefore = loads
// Stand in for the hourly check.
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.waiting)), null, { timeout: 20000 })
  .catch(() => fail('the new version should install and wait'))
await page.waitForTimeout(1500)
if (loads !== loadsBefore) fail('a background update must not reload while a note is being written')
if ((await page.inputValue(NOTE)) !== 'Half a thought about the regatta —') fail('the draft should still be in the box')
console.log('2. found in the background: waits, the draft untouched')
// Locking is the quiet moment: the draft becomes a note, then the update installs.
await blur()
await page.locator('button:has-text("Lock"):visible').first().click()
await unlock()
if ((await running()) !== r2) fail(`the waiting version should install at the lock: ${await running()}`)
await page.waitForSelector('.person h1', { timeout: 15000 }).catch(async () => {
  await page.evaluate(() => { location.hash = '#/' })
})
if (!/Ada Lovelace/.test(await page.locator('main').innerText())) {
  await page.fill('input[type=search]', 'Ada Lovelace')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.person h1')
}
if (!/Half a thought about the regatta/.test(await page.locator('main').innerText()))
  fail('the draft should have become a note at the lock')
console.log('   installed at the lock; the draft was kept as a note:', r2)

// ---------- 3. a reload nobody asked for ----------
await page.click(NOTE)
await page.fill(NOTE, 'Owes me a book — the blue one')
await page.waitForTimeout(900)
await page.reload()
await unlock()
await page.waitForSelector(NOTE, { timeout: 15000 }).catch(() => fail('unlocking should land back on the dossier'))
const back = await page.inputValue(NOTE)
if (back !== 'Owes me a book — the blue one') fail(`the draft should survive a reload: ${JSON.stringify(back)}`)
console.log('3. survived a reload, back in the box:', back)

// ---------- offline ----------
await blur()
await page.click('nav a:has-text("Settings"):visible')
await page.waitForSelector(UPDATES)
await page.context().setOffline(true)
await page.click(`${UPDATES} button:has-text("Check for updates")`)
await waitStatus(/Couldn’t reach/, 'offline should say so')
await page.context().setOffline(false)
console.log('offline says so:', await status())

console.log('ok')
await browser.close()
cleanup()
