import { launch } from './lib.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4174'
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1) }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 390, height: 720 } })
page.on('pageerror', (err) => fail(`page error: ${err.message}`))
page.on('dialog', (d) => d.accept())

let prfAvailable = false
try {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, hasPrf: true,
      automaticPresenceSimulation: true,
    },
  })
  prfAvailable = true
} catch (e) {
  console.log('no PRF virtual authenticator:', e.message)
}

// Fresh vault
await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]', { timeout: 15000 })
await page.fill('input[type=search]', 'Ada Lovelace')
await page.click('button.add-person')
await page.waitForSelector('h1:has-text("Ada Lovelace")')
console.log('vault + person ready')

// Arm PIN (now with confirm field), enroll biometrics, set auto-lock 1 min
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.fill('input[aria-label="New PIN"]', '4321')
await page.fill('input[aria-label="Repeat new PIN"]', '4321')
await page.fill('.pin-form input[aria-label="Your passphrase"]', 'correct horse battery')
await page.click('form.pin-form button:has-text("Turn on")')
await page.waitForSelector('text=PIN is on')
console.log('PIN armed (with confirmation)')

if (prfAvailable) {
  await page.fill('input[aria-label="Your passphrase"]', 'correct horse battery')
  await page.click('form:has(input[aria-label="Your passphrase"]) button:has-text("Turn on")')
  try {
    await page.waitForSelector('text=On — your face', { timeout: 15000 })
    console.log('biometric enrolled')
  } catch {
    console.log('biometric enrollment did not complete')
    prfAvailable = false
  }
}

await page.selectOption('select[aria-label="Inactivity auto-lock"]', '1')
await page.waitForSelector('text=Saved.')
console.log('auto-lock set to 1 min')

// Type a capture draft, then go idle: the auto-lock must flush the draft
// and land on the PIN screen (timer lock keeps the PIN armed).
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.click('li >> text=Ada Lovelace')
await page.fill('.capture-bar textarea', 'draft fact: loves square-rigged sailboats')
console.log('waiting ~70s for inactivity auto-lock (warning should appear first)…')
await page.waitForSelector('.lock-warning', { timeout: 60000 })
console.log('lock warning shown')
await page.waitForSelector('input[aria-label="PIN"]', { timeout: 40000 })
console.log('auto-locked to PIN screen')

// Wrong PIN burns an attempt; auto-submit fires at 4 digits.
await page.fill('input[aria-label="PIN"]', '9999')
await page.waitForSelector('text=Wrong PIN — 4 tries left.')
await page.fill('input[aria-label="PIN"]', '4321')
await page.waitForSelector('.app-bar', { timeout: 15000 })
console.log('PIN auto-submit unlock works')

// The draft survived as a note.
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("People"):visible')
await page.click('li >> text=Ada Lovelace')
await page.waitForSelector('.notes >> text=square-rigged sailboats')
console.log('auto-lock flushed the capture draft into a note')

// Toggle between passphrase and PIN screens (two-way door).
// Use a quick lock via another auto path: background grace is too slow;
// use panic Lock then verify PIN is GONE (panic disarms it).
await page.click('button.lock-button')
await page.waitForSelector('input[aria-label="Passphrase"]')
if (await page.locator('input[aria-label="PIN"]').count()) fail('panic lock left PIN screen')
if (await page.locator('button:has-text("Use PIN")').count()) fail('panic lock left PIN armed')
console.log('panic lock discards the PIN session')

if (prfAvailable) {
  await page.click('button:has-text("Unlock with biometrics")')
  await page.waitForSelector('.app-bar', { timeout: 15000 })
  console.log('biometric unlock works after panic')
} else {
  await page.fill('input[aria-label="Passphrase"]', 'correct horse battery')
  await page.click('button[type=submit]')
  await page.waitForSelector('.app-bar')
}

// Re-arm PIN and verify the passphrase screen offers "Use PIN" (two-way).
await page.evaluate(() => document.activeElement?.blur?.()); await page.click('nav a:has-text("Settings"):visible')
await page.fill('input[aria-label="New PIN"]', '2468')
await page.fill('input[aria-label="Repeat new PIN"]', '2468')
await page.fill('.pin-form input[aria-label="Your passphrase"]', 'correct horse battery')
await page.click('form.pin-form button:has-text("Turn on")')
await page.waitForSelector('text=PIN is on')
// Trigger timer lock quickly: set auto-lock to 1 min again? Already 1min; instead
// use the store-free path: wait is long, so simulate via visibility grace: set 5s.
await page.selectOption('select[aria-label="Background lock grace period"]', '5')
await page.waitForSelector('text=Saved.')
const cdp2 = await page.context().newCDPSession(page)
await cdp2.send('Emulation.setDocumentFeatureState', { featureName: 'visibility', enabled: false }).catch(() => null)
// Fallback: dispatch visibilitychange with hidden via override
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForSelector('input[aria-label="PIN"]', { timeout: 15000 })
console.log('background grace lock landed on PIN screen')
await page.click('button:has-text("Use passphrase")')
await page.waitForSelector('input[aria-label="Passphrase"]')
await page.click('button:has-text("Use PIN")')
await page.waitForSelector('input[aria-label="PIN"]')
console.log('passphrase <-> PIN is a two-way door')
await page.fill('input[aria-label="PIN"]', '2468')
await page.waitForSelector('.app-bar', { timeout: 15000 })

// Auth table audit: wrapped material only, no timestamps, no slot links.
const audit = await page.evaluate(async () => {
  const req = indexedDB.open('ledger')
  const idb = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  if (!idb.objectStoreNames.contains('auth')) return { rows: 0, leaks: false, keys: [] }
  const tx = idb.transaction(['auth', 'slots'])
  const getAll = (s) => new Promise((res, rej) => { const r = tx.objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const [auth, slots] = await Promise.all([getAll('auth'), getAll('slots')])
  const dump = JSON.stringify(auth, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v).join(',') : v))
  const leaks = slots.some((s) => dump.includes(s.id)) || /Lovelace|correct horse/.test(dump)
  const keys = [...new Set(auth.flatMap((r) => Object.keys(r)))].sort()
  return { rows: auth.length, leaks, keys }
})
if (audit.leaks) fail('auth rows leak slot ids or plaintext!')
if (audit.keys.includes('createdAt')) fail('auth rows carry timestamps!')
console.log(`auth table: ${audit.rows} rows, keys=[${audit.keys}], no leaks`)

await browser.close()
console.log('SMOKE2 OK')
