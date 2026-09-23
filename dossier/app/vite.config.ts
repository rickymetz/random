import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Which commit this is: CI's own SHA, else the checkout's, else "dev". */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  // Settings → Updates says which build is running, so "am I on the fix?"
  // has an answer without reinstalling.
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version,
    ),
  },
  // The hub's Pages deployment serves the app under /random/ledger/
  // (set by the deploy workflow); local dev stays at /.
  base: process.env.DOSSIER_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      // A new build waits to be taken at a quiet moment — never a reload
      // mid-sentence (lib/appUpdate.ts, App.tsx).
      registerType: 'prompt',
      includeAssets: ['*.png', '*.webmanifest'],
      // The disguise choice (REQUIREMENTS.md §6.5) will eventually select
      // among a small set of neutral names/icons; this is the default.
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'A personal notebook.',
        display: 'standalone',
        background_color: '#121110',
        theme_color: '#1a1918',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        importScripts: ['sw-notify.js'],
        // The first install still takes charge of the page it came from
        // (as autoUpdate did). Updates still wait: taking over later is
        // skipWaiting's call, which only the app makes (lib/appUpdate.ts).
        clientsClaim: true,
        // The random hub's navbar (/random/nav.js) and its idea catalogue
        // sit outside this app and change on the hub's schedule: network
        // first, so they are never stale, with a copy for offline use.
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/(nav\.js|ideas\.json)$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'ledger-hub-nav' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
} as Parameters<typeof defineConfig>[0])
