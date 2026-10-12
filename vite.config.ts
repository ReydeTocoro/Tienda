import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The installed apps (Windows .exe, Android .apk) are built with VITE_PACKAGED=1 (and VITE_API_URL, VITE_PUBLIC_URL —
// see src/api/base.ts): they open their files from the device itself, so addresses are relative and there is no
// service worker (the files are already there).
const packaged = process.env.VITE_PACKAGED === '1'

// https://vite.dev/config/
export default defineConfig({
  base: packaged ? './' : '/',
  server: {
    // Dev-time stand-in for Firebase Hosting's /api rewrite to the Function: run the same API
    // locally with `npm run server` (it talks to the Supabase database).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  plugins: [
    react(),
    VitePWA({
      disable: packaged,
      // The new worker takes control by itself (skipWaiting + clientsClaim), and the page registers it and decides when to
      // restart (src/app/appUpdate.ts): so no registration script is injected, and an app on an older build also upgrades.
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Mi Tienda Pro',
        short_name: 'Tienda Pro',
        description: 'Sistema de caja registradora',
        start_url: '/',
        display: 'standalone',
        background_color: '#f3f5f7',
        theme_color: '#001c5e',
        orientation: 'any',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icons/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/logo-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/logo-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // A new version takes control as soon as it is installed (stated here, not left to `registerType`: the page
        // restarts itself when it is safe — src/app/appUpdate.ts).
        skipWaiting: true,
        clientsClaim: true,
        // woff2 too: the fonts are part of the app, and it must open — fonts and all — without internet.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,jpg,woff2}'],
        // jsPDF's optional extras (never used: receipts are plain text) — don't make every device download them.
        globIgnores: ['**/html2canvas*.js', '**/purify*.js'],
        // The API must always hit the network, never the app-shell fallback.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
