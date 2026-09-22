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
