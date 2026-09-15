// Shared browser launch for the smokes. Locally, point CHROMIUM_PATH at a
// Chromium build; in CI, `npx playwright install chromium` provides one.
import { chromium } from 'playwright'

export const launch = (opts = {}) =>
  chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    ...opts,
  })
