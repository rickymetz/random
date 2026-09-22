// Checking for updates from inside the app (Settings → Updates).
//
// An installed copy updates itself hourly, but "a fix just shipped — do
// I have it?" used to mean deleting the app and adding it back. This
// serves a private copy of the build, checks (nothing new), then ships a
// "release" by changing that copy's service worker on disk and checks
// again: the app must find it, say so, and reopen onto it.
import { launch } from './lib.mjs'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fail = (m) => { console.error('FAIL:', m); cleanup(); process.exit(1) }
const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..')

// A copy of the build of our own, so shipping a "release" never touches
// the dist every other smoke is reading.
const dist = mkdtempSync(join(os.tmpdir(), 'ledger-update-'))
cpSync(join(app, 'dist'), dist, { recursive: true })
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const server = spawn(join(app, 'node_modules/.bin/vite'), ['preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: app, stdio: 'ignore' })
let browser
function cleanup() {
  try { server.kill() } catch {}
  try { rmSync(dist, { recursive: true, force: true }) } catch {}
}
const BASE = `http://localhost:${port}`
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break } catch {}
  await new Promise((r) => setTimeout(r, 250))
}

browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
await page.goto(BASE)
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 })
  .catch(() => fail('the service worker never took control'))
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')
await page.evaluate(() => document.activeElement?.blur?.())
await page.click('nav a:has-text("Settings"):visible')

const UPDATES = 'section:has(h2:has-text("Updates"))'
await page.waitForSelector(UPDATES)
const status = () => page.locator(`${UPDATES} [role=status]`).innerText()
const waitStatus = async (re, what) => {
  for (let i = 0; i < 60; i++) {
    if (re.test(await status())) return
    await page.waitForTimeout(250)
  }
  fail(`${what}: ${await status()}`)
}
// It says which build this is — without naming the app (disguises).
const blurb = await page.locator(`${UPDATES} .hint`).first().innerText()
if (!/^Version \d+\.\d+\.\d+ \([0-9a-z]+\)/.test(blurb)) fail(`the build should be named: ${blurb}`)
if (/Ledger/.test(await page.locator(UPDATES).innerText())) fail('a disguised copy must not say "Ledger"')
console.log('names its build:', blurb.split('.')[0] + '.' + blurb.split('.')[1] + '…')

// Nothing new yet.
await page.click(`${UPDATES} button:has-text("Check for updates")`)
await waitStatus(/latest version/, 'expected "latest"')
console.log('nothing new:', await status())

// Ship a release: the service worker differs by a byte.
const sw = join(dist, 'sw.js')
writeFileSync(sw, readFileSync(sw, 'utf8') + '\n// the next release\n')
let reopened = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reopened = true })
await page.click(`${UPDATES} button:has-text("Check for updates")`)
// It reopens onto the new build, locked, by itself.
await page.waitForSelector('main.unlock-main', { timeout: 30000 })
  .catch(async () => fail(`the app should reopen on the new version; status: ${await status().catch(() => '?')}`))
if (!reopened) fail('the page never reloaded')
const active = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration()
  const res = await fetch(r.active.scriptURL, { cache: 'no-store' })
  return (await res.text()).includes('the next release')
})
if (!active) fail('the running worker is not the new release')
console.log('found the release, reopened onto it, locked')

// Offline says so, rather than claiming "latest".
const ctx = page.context()
await page.fill('input[aria-label="Passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
// Unlocking lands back where you were: Settings, on the new build.
await page.waitForSelector(UPDATES, { timeout: 15000 }).catch(() => fail('could not unlock after the update'))
await ctx.setOffline(true)
await page.click(`${UPDATES} button:has-text("Check for updates")`)
await waitStatus(/Couldn’t reach/, 'offline should say so')
await ctx.setOffline(false)
console.log('offline:', await status())

console.log('ok')
await browser.close()
cleanup()
