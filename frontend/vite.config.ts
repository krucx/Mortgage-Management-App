/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// What the service worker's own global offers; this file is type-checked for Node.
type ServiceWorkerGlobal = {
  caches: { match(url: string, options: { ignoreSearch: boolean }): Promise<Response | undefined> }
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [
    react(),
    // Installable as an app, and opens without the server: the app itself is cached by a
    // service worker, but never /api, so every figure is always fresh from the backend.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Mortgage Management',
        short_name: 'Mortgages',
        description: 'Mortgages, Payments and follow-ups for a jewellery Lender, kept on their own laptop.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#8a5a00',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Pages come from the server whenever it answers, so the first start after an
        // update runs the new app; the cached one is only for when it can't be reached.
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 5,
              plugins: [
                {
                  // Offline: the cached app, whichever page was asked for.
                  handlerDidError: async () =>
                    (globalThis as unknown as ServiceWorkerGlobal).caches.match('/index.html', {
                      ignoreSearch: true,
                    }),
                },
              ],
            },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // The app's version, shown beside its name in the top bar.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Also used by `vite preview`, which serves the app without Docker (windows/run.ps1).
  // 127.0.0.1, not localhost: on Windows localhost can mean IPv6, where the API isn't.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})
