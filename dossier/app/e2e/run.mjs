// Builds nothing: serves dist/ with `vite preview` and runs every smoke
// (and the axe scan) against it, one process each, in order. Exit code is
// non-zero if any fails. `node e2e/run.mjs smoke9 axe` runs a subset.
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..')
const PORT = Number(process.env.E2E_PORT ?? 4290)
const BASE = `http://localhost:${PORT}`
const PER_SMOKE_MS = Number(process.env.E2E_TIMEOUT_MS ?? 10 * 60 * 1000)

const wanted = process.argv.slice(2)
const all = readdirSync(here)
  .filter((f) => /^(smoke.*|axe)\.mjs$/.test(f))
  .sort((a, b) => {
    // smoke, smoke2 … smoke17, then axe.
    const n = (s) => (s === 'axe.mjs' ? 1e9 : Number(s.replace(/\D/g, '') || 1))
    return n(a) - n(b)
  })
const scripts = wanted.length
  ? all.filter((f) => wanted.some((w) => f === w || f === `${w}.mjs`))
  : all
if (scripts.length === 0) {
  console.error('no smokes matched', wanted)
  process.exit(2)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: app,
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stderr.on('data', (d) =>
  process.stderr.write(String(d).split('\n').filter(Boolean).map((l) => `[preview] ${l}\n`).join('')),
)
const stop = () => {
  if (!server.killed) server.kill('SIGTERM')
}
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

const waitFor = async (url, ms = 30000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`preview server did not answer at ${url}`)
}
await waitFor(BASE)

const run = (file) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [join(here, file)], {
      cwd: here,
      env: { ...process.env, BASE_URL: BASE },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      out += `\n[runner] timed out after ${PER_SMOKE_MS / 1000}s\n`
      child.kill('SIGKILL')
    }, PER_SMOKE_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ file, code, out, ms: Date.now() - t0 })
    })
  })

const results = []
for (const file of scripts) {
  process.stdout.write(`▶ ${file} … `)
  const r = await run(file)
  results.push(r)
  console.log(r.code === 0 ? `ok (${(r.ms / 1000).toFixed(0)}s)` : `FAIL (${(r.ms / 1000).toFixed(0)}s)`)
  if (r.code !== 0) console.log(r.out.split('\n').slice(-25).join('\n'))
}
stop()
const failed = results.filter((r) => r.code !== 0)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
