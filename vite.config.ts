import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The launch harness assigns a free port through PORT; 5173 is only the fallback
// for a plain `npm run dev`.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const port = Number(env?.PORT) || 5173

// GitHub Pages serves the repo under a /<repo-name>/ subpath.
const isGhPages = env?.GITHUB_PAGES === 'true'

export default defineConfig({
  base: isGhPages ? '/MusicalMemorization/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'Musical Memorization',
        short_name: 'MusMemo',
        description: 'Rehearsal tracks, bookmarks, and line scripts for memorizing a show.',
        start_url: '.',
        display: 'standalone',
        background_color: '#14161a',
        theme_color: '#14161a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Audio blobs and app data live in IndexedDB, not the cache — only the
        // app shell (JS/CSS/HTML) needs precaching for offline use.
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
  server: {
    // Exposed on the LAN so the app can be opened from a phone at rehearsal.
    host: true,
    port,
  },
})
