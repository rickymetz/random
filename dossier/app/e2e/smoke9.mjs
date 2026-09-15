import { launch } from './lib.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4290'
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => fail(e.message))
page.on('dialog', (d) => d.accept())
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

await page.goto(BASE)
await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('ledger'); r.onsuccess = r.onerror = r.onblocked = res }))
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.fill('input[aria-label="Choose a passphrase"]', 'correct horse battery')
await page.fill('input[aria-label="Repeat passphrase"]', 'correct horse battery')
await page.click('button[type=submit]')
await page.waitForSelector('input[type=search]')

// Seed two people
for (const name of ['Ada Lovelace', 'Bob Chen']) {
  await page.fill('input[type=search]', name)
  await page.click('button.add-person')
  await page.waitForSelector(`h1:has-text("${name}")`)
  await blur(); await page.click('nav a:has-text("People"):visible')
}

// 1. Mention picker: bare "@" lists people; ArrowDown+Enter picks by keyboard
await page.fill('input[type=search]', 'Bob')
await page.click('li >> text=Bob Chen')
const ta = page.locator('.capture-bar textarea')
await ta.fill('Dinner with @')
await page.waitForSelector('.mention-suggestions [role=option]')
const bare = await page.locator('.mention-suggestions [role=option]').count()
if (bare < 2) fail(`bare @ should list people, got ${bare}`)
await ta.press('ArrowDown')
await ta.press('Enter')
const v1 = await ta.inputValue()
// The box shows a plain @Name (the note gets the link on save).
if (!/@Me $/.test(v1)) fail(`keyboard pick did not insert the name: ${JSON.stringify(v1)}`)
console.log('mention picker: bare @ lists, arrows+Enter inserts')

// 2. Create-on-the-fly: unknown name offers "+ Add", picking it creates the person + inserts token
await ta.fill('Met @Zed Quill')
await page.waitForSelector('.mention-suggestions [role=option] >> text=Add “Zed Quill”')
await ta.press('Enter')
await page.waitForFunction(() => /@Zed Quill /.test(document.querySelector('.capture-bar textarea').value))
await page.click('.capture-bar button:has-text("Save note")')
await page.waitForSelector('.notes .mention:has-text("@Zed Quill")')
await page.waitForSelector('.edges li.mention-edge:has-text("Zed Quill")')
console.log('create-on-the-fly mention creates the person and a dashed edge')

// 3. Backlinks: Zed's page shows "Mentioned in" with Bob's note
await page.click('.notes .mention:has-text("@Zed Quill")')
await page.waitForSelector('h1:has-text("Zed Quill")')
await page.waitForSelector('section:has(h2:has-text("Mentioned in")) .notes li:has-text("Met")')
await page.waitForSelector('.mentioned-in time a:has-text("Bob Chen")')
console.log('backlinks section lists the mentioning note with its author')

// 4. Note editing re-derives edges: edit Bob's note to mention Ada instead of Zed
// The section sits near the bottom now; let the smooth scroll settle
// before clicking or the link moves under the pointer.
await page.locator('.mentioned-in time a:has-text("Bob Chen")').scrollIntoViewIfNeeded()
await page.waitForTimeout(700)
await page.click('.mentioned-in time a:has-text("Bob Chen")')
await page.waitForSelector('h1:has-text("Bob Chen")')
await page.click('.notes li:has-text("Met") button[aria-label="Edit note"]')
const ed = page.locator('.note-editor textarea')
await ed.fill('Met @Ada')
await page.waitForSelector('.mention-suggestions [role=option] >> text=Ada Lovelace')
await ed.press('Enter')
await page.click('.note-editor button:has-text("Save")')
await page.waitForSelector('.notes .mention:has-text("@Ada Lovelace")')
await page.waitForFunction(() => !document.querySelector('.edges li.mention-edge')?.textContent?.includes('Zed'))
console.log('note edit rewrites text and mention edges follow')

// 5. Rename rewrites mention labels elsewhere
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Ada')
await page.click('a.person-row:has-text("Ada Lovelace")')
await page.click('.section-head button:has-text("Edit")')
await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Ada King')
await page.click('.facts-form button[type=submit]:has-text("Save")')
await page.waitForSelector('h1:has-text("Ada King")')
await blur(); await page.click('nav a:has-text("People"):visible')
await page.fill('input[type=search]', 'Bob')
await page.click('a.person-row:has-text("Bob Chen")')
await page.waitForSelector('.notes .mention:has-text("@Ada King")')
console.log('rename rewrote @mention label in Bob\'s note')

// 6. Facet link: a tag on the details card searches for it
await page.click('.section-head button:has-text("Edit")')
const tagIn = page.getByRole('combobox', { name: 'Add Tags' })
await tagIn.fill('pottery')
await tagIn.press('Enter')
await page.click('.facts-form button[type=submit]:has-text("Save")')
await page.click('a.facet:has-text("pottery")')
await page.waitForFunction(() => document.querySelector('input[type=search]')?.value === 'pottery')
await page.waitForSelector('a.person-row:has-text("Bob Chen")')
console.log('tag facet link runs a search')

// 7. Graph: depth chips + fit control + legend present
await page.click('a.person-row:has-text("Bob Chen")')
await page.click('a:has-text("See on graph")')
await page.waitForSelector('canvas.graph-canvas')
await page.waitForSelector('.chip.depth button[aria-pressed="true"]:has-text("1 hop")')
await page.click('.chip.depth button:has-text("2 hops")')
await page.waitForSelector('.chip.depth button[aria-pressed="true"]:has-text("2 hops")')
await page.click('button[aria-label="Fit everyone in view"]')
await page.waitForSelector('.graph-legend')
console.log('graph: depth chips, fit button, legend')

await browser.close()
console.log('SMOKE9 OK')
