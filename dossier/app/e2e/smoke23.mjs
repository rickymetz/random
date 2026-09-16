// Passkey unlock end to end, against Chromium's virtual authenticator
// with the PRF extension (the same extension iOS 18 / recent Chrome use).
// Covers the happy path and the failure that used to be silent: a passkey
// whose wrap no longer opens this vault — Face ID says yes, and before
// this the screen just sat there with no message and no way forward.
import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

const cdp = await page.context().newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    ctap2Version: 'ctap2_1',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
    hasPrf: true,
  },
})

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

const enroll = async () => {
  await blur(); await page.click('nav a:has-text("Settings"):visible')
  await page.waitForSelector('h3:has-text("Face ID")')
  // Two fields on this page are labelled "Your passphrase" (PIN and Face ID).
  const form = page.locator('form:has(button:has-text("Turn on Face ID"))')
  await form.locator('input[aria-label="Your passphrase"]').fill('correct horse battery')
  await form.locator('button:has-text("Turn on Face ID")').click()
  await page.waitForSelector('button:has-text("Turn off")', { timeout: 20000 })
}
const lock = async () => {
  await page.click('nav button:has-text("Lock"), nav a:has-text("Lock")')
  await page.waitForSelector('button:has-text("Use Face ID / fingerprint")', { timeout: 10000 })
}

// 1. Enrol, lock, and open it again with the passkey.
await enroll()
console.log('enrolled a passkey')
await lock()
await page.click('button:has-text("Use Face ID / fingerprint")')
// Unlocking lands back on the route that was open, so the tell is the
// unlock screen going away, not any one page appearing.
await page.waitForSelector('.unlock', { state: 'detached', timeout: 15000 })
if (await page.locator('button:has-text("Use Face ID / fingerprint")').count()) {
  fail('the passkey did not open the app')
}
console.log('the passkey opens the app')

// 2. A passkey that no longer opens this vault (restored or re-created
// since enrolling) says so, and retires itself instead of failing forever.
await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('ledger')
  req.onsuccess = () => {
    const tx = req.result.transaction('auth', 'readwrite')
    const store = tx.objectStore('auth')
    const all = store.getAll()
    all.onsuccess = () => {
      const row = all.result[0]
      // A different PRF salt means a different key: the wrap won't open.
      row.prfSalt = crypto.getRandomValues(new Uint8Array(32))
      store.put(row)
    }
    tx.oncomplete = () => res()
  }
}))
await lock()
await page.click('button:has-text("Use Face ID / fingerprint")')
const alert = page.locator('[role=alert]')
await alert.first().waitFor({ timeout: 15000 })
const text = (await alert.first().textContent()).trim()
if (!/passphrase/i.test(text)) fail(`a dead passkey said nothing useful: ${text}`)
console.log('dead passkey says:', text)
await page.locator('button:has-text("Use Face ID / fingerprint")').waitFor({ state: 'detached', timeout: 5000 })
  .catch(() => fail('the dead passkey is still offered on the unlock screen'))
console.log('the dead enrollment retires itself')

// 3. The passphrase still opens the vault afterwards.
await page.locator('input[type=password]').first().fill('correct horse battery')
await page.click('button[type=submit]:has-text("Open")')
await page.waitForSelector('.unlock', { state: 'detached', timeout: 15000 })
console.log('the passphrase still opens it')

// 4. Retiring is scoped to the credential that failed: another
// enrollment may still be the one that works, so it must survive.
await enroll()
const decoyId = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('ledger')
  req.onsuccess = () => {
    const tx = req.result.transaction('auth', 'readwrite')
    const store = tx.objectStore('auth')
    const all = store.getAll()
    let id = null
    all.onsuccess = () => {
      const real = all.result[0]
      id = `${real.id.slice(0, -2)}ff`
      // A second enrollment the authenticator knows nothing about, and a
      // real one whose wrap no longer matches.
      store.put({ ...real, id })
      store.put({ ...real, prfSalt: crypto.getRandomValues(new Uint8Array(32)) })
    }
    tx.oncomplete = () => res(id)
  }
}))
await lock()
await page.click('button:has-text("Use Face ID / fingerprint")')
await alert.first().waitFor({ timeout: 15000 })
const left = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('ledger')
  req.onsuccess = () => {
    const g = req.result.transaction('auth').objectStore('auth').getAll()
    g.onsuccess = () => res(g.result.map((r) => r.id))
  }
}))
if (left.length !== 1 || left[0] !== decoyId) {
  fail(`a failing passkey took the other enrollment with it: ${JSON.stringify(left)}`)
}
if (!(await page.locator('button:has-text("Use Face ID / fingerprint")').count())) {
  fail('the surviving enrollment is no longer offered')
}
console.log('only the credential that failed is retired')

await browser.close()
console.log('SMOKE23 OK')
