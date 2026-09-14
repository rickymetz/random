import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

// Tap inside a bubble: sample canvas pixels for bubble-tinted empty space
// (bluish/colored low-luminance, not background, not a node's grey fill),
// try candidates until the circle card opens.
async function tapBubble() {
  const box = await page.locator('canvas.graph-canvas').boundingBox()
  const cands = await page.evaluate(() => {
    const c = document.querySelector('canvas.graph-canvas')
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const out = []
    for (let y = 40; y < c.height / dpr - 40; y += 24) {
      for (let x = 40; x < c.width / dpr - 40; x += 24) {
        // The canvas background is transparent; bubble fill is the circle
        // colour at ~0.11 alpha, nodes/edges/labels are far more opaque.
        const a = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3]
        if (a > 8 && a < 100) out.push({ x, y })
      }
    }
    return out
  })
  for (const p of cands) {
    await page.mouse.click(box.x + p.x, box.y + p.y)
    try {
      // A bubble tap opens the light card; Edit… opens the editor.
      await page.waitForSelector('.circle-lite', { timeout: 700 })
      await page.click('.circle-lite button:has-text("Edit…")')
      await page.waitForSelector('.circle-peek')
      return
    } catch {
      // node/edge card or nothing — dismiss and keep looking
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  fail('could not find a bubble to tap')
}


await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// 1. Sample cast seeds circles; graph shows circle chips
await blur(); await page.click('nav a:has-text("Settings"):visible')
await page.click('button:has-text("Load sample people")')
await page.waitForSelector('text=/Added 14 people, \\d+ relationships and 3 circles/', { timeout: 30000 })
console.log('sample cast seeds 3 circles')
await blur(); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('canvas.graph-canvas')
for (const name of ['Meridian Labs', 'Webb family', 'Climbing crew']) {
  await page.waitForSelector(`.chip.circle-filter:has-text("${name}")[aria-pressed="true"]`)
}
console.log('graph: three circle chips on')

// 2. Toggle a circle chip off/on persists
await page.click('.chip.circle-filter:has-text("Webb family")')
await page.waitForSelector('.chip.circle-filter:has-text("Webb family")[aria-pressed="false"]')
await blur(); await page.click('nav a:has-text("People"):visible')
await blur(); await page.click('nav a:has-text("Graph"):visible')
await page.waitForSelector('.chip.circle-filter:has-text("Webb family")[aria-pressed="false"]')
await page.click('.chip.circle-filter:has-text("Webb family")')
console.log('circle chip toggle persists across visits')

// 3. Tap a bubble → circle card; rename, focus
await page.waitForTimeout(1500)
// Find a point inside the Meridian bubble: the centroid of its members via the peek path.
// Simpler: use the People list → circle chip link → "see on graph" (focus) then card via canvas tap.
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Priya')
await page.click('a.person-row:has-text("Priya Raman")')
await page.waitForSelector('a.circle-chip:has-text("Meridian Labs")')
console.log('person card shows circle chip')
await page.click('a.circle-chip:has-text("Meridian Labs")')
await page.waitForSelector('.circle-banner:has-text("Meridian Labs")')
const rows = await page.locator('a.person-row').count()
if (rows !== 3) fail(`expected 3 Meridian members listed, got ${rows}`)
console.log('circle filter lists its 3 members')
await page.click('.circle-banner a:has-text("see on graph")')
await page.waitForSelector('.chip.focus-chip:has-text("Meridian Labs")')
await page.waitForTimeout(1200)
await tapBubble()
await page.waitForSelector('.circle-peek input[aria-label="Circle name"]', { timeout: 5000 })
console.log('tapping the bubble opens the circle card')
await page.fill('.circle-peek input[aria-label="Circle name"]', 'Meridian crew')
await page.press('.circle-peek input[aria-label="Circle name"]', 'Enter')
await page.waitForSelector('.chip.focus-chip:has-text("Meridian crew")')
console.log('rename from the card updates the chip')

// 3b. Rename collision is refused with an inline message
await page.fill('.circle-peek input[aria-label="Circle name"]', 'Webb family')
await page.press('.circle-peek input[aria-label="Circle name"]', 'Enter')
await page.waitForSelector('.circle-peek .status.error:has-text("already exists")')
await page.press('.circle-peek input[aria-label="Circle name"]', 'Escape')
console.log('duplicate name refused inline')

// 3c. Add a member from the card
await tapBubble()
await page.fill('.circle-peek input[role="combobox"]', 'Grace'); await page.click('.circle-peek .chip-suggestions li:has-text("Grace Liu")')
await page.waitForSelector('.circle-peek .members li:has-text("Grace Liu")')
console.log('add-member picker on the card works')
await page.keyboard.press('Escape')

// 3d. Chip ✎ opens the card without a bubble (keyboard path), and an empty
// circle stays deletable that way
await page.click('.chip.focus-chip button[aria-label="Show everyone"]')
await page.click('.chip-group:has-text("Webb family") button.chip-edit')
await page.waitForSelector('.circle-peek input[aria-label="Circle name"]')
console.log('chip edit button opens the card')
await page.keyboard.press('Escape')

// 4. Add a circle from a person's edit form; new name creates it
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Rosa')
await page.click('a.person-row:has-text("Rosa Delgado")')
await page.click('.section-head button:has-text("Edit")')
const circ = page.getByRole('combobox', { name: 'Add Circles' })
await circ.fill('Tide pool club')
await circ.press('Enter')
await page.click('.facts-form button[type=submit]:has-text("Save")')
await page.waitForSelector('a.circle-chip:has-text("Tide pool club")')
console.log('new circle created from the edit form')

// 5. Delete circle from the card keeps the person
await page.click('a.circle-chip:has-text("Tide pool club")')
await page.click('.circle-banner a:has-text("see on graph")')
await page.waitForTimeout(1200)
await tapBubble()
await page.click('.circle-peek button:has-text("Delete circle")')
// Asks in place: the second "Delete circle" confirms.
await page.waitForSelector('.circle-peek .confirm-row')
await page.click('.circle-peek .confirm-row button:has-text("Delete circle")')
await page.waitForFunction(() => !document.querySelector('.chip.circle-filter')?.textContent?.includes('Tide pool'))
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Rosa')
await page.waitForSelector('a.person-row:has-text("Rosa Delgado")')
console.log('deleting a circle keeps its people')

await browser.close()
console.log('SMOKE10 OK')
