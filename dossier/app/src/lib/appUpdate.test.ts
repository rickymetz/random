import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLabel, checkForUpdate } from './appUpdate'

const withRegistration = (reg: unknown) =>
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => reg } })

afterEach(() => vi.unstubAllGlobals())

describe('checkForUpdate', () => {
  it('says so when there is nothing newer', async () => {
    withRegistration({ update: async () => undefined, installing: null, waiting: null })
    expect(await checkForUpdate()).toBe('current')
  })
  it('reports an update the moment one starts installing', async () => {
    const reg = { installing: null as unknown, waiting: null, update: async () => { reg.installing = {} } }
    withRegistration(reg)
    expect(await checkForUpdate()).toBe('updating')
  })
  it('tells a failed fetch apart from being up to date', async () => {
    withRegistration({ update: async () => { throw new TypeError('Failed to fetch') }, installing: null, waiting: null })
    expect(await checkForUpdate()).toBe('offline')
  })
  it('never claims "latest" on a device that knows it is offline', async () => {
    let asked = false
    vi.stubGlobal('navigator', {
      onLine: false,
      serviceWorker: { getRegistration: async () => ({ update: async () => { asked = true }, installing: null, waiting: null }) },
    })
    expect(await checkForUpdate()).toBe('offline')
    expect(asked).toBe(false)
  })
  it('has nothing to check without a service worker', async () => {
    withRegistration(undefined)
    expect(await checkForUpdate()).toBe('unavailable')
    vi.stubGlobal('navigator', {})
    expect(await checkForUpdate()).toBe('unavailable')
  })
})

describe('buildLabel', () => {
  it('names the version, the commit and the day it was built', () => {
    // The month's spelling is the ICU data's business ("Sep" or "Sept").
    expect(buildLabel('0.1.0', 'a1b2c3d', '2026-09-22T10:00:00Z', 'en-GB')).toMatch(/^0\.1\.0 \(a1b2c3d\), built 22 Sept? 2026$/)
  })
  it('leaves the date off rather than printing an invalid one', () => {
    expect(buildLabel('0.1.0', 'dev', 'nope')).toBe('0.1.0 (dev)')
  })
})

describe('applyUpdate', () => {
  // Module state (a build waiting, a request standing) must start clean.
  const fresh = async () => {
    vi.resetModules()
    return import('./appUpdate')
  }
  it('a request made before the build is ready lapses rather than lying in wait', async () => {
    const { applyUpdate, markUpdateReady, wireUpdate } = await fresh()
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {})
    const applied: number[] = []
    wireUpdate(async () => { applied.push(Date.now()) })
    // Asked for while the build is still installing…
    await applyUpdate()
    expect(applied).toHaveLength(0)
    // …and that install never finished. Hours later the hourly check
    // finds another: it waits for a quiet moment instead of reloading.
    vi.advanceTimersByTime(3 * 60 * 60 * 1000)
    markUpdateReady()
    await Promise.resolve()
    expect(applied).toHaveLength(0)
    vi.useRealTimers()
  })
  it('a request made just before the build is ready is honoured when it arrives', async () => {
    const { applyUpdate, markUpdateReady, wireUpdate } = await fresh()
    vi.stubGlobal('navigator', {})
    const applied: string[] = []
    wireUpdate(async () => { applied.push('now') })
    await applyUpdate()
    expect(applied).toEqual([])
    markUpdateReady()
    await Promise.resolve()
    expect(applied).toEqual(['now'])
  })
})
