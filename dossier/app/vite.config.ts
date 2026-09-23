import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // The hub's Pages deployment serves the app under /random/ledger/
  // (set by the deploy workflow); local dev stays at /.
  base: process.env.DOSSIER_BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
