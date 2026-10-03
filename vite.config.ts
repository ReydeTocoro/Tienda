import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Mi Tienda Pro',
        short_name: 'Tienda Pro',
        description: 'Sistema de caja registradora',
        start_url: '/',
        display: 'standalone',
        background_color: '#f2f4f3',
        theme_color: '#0c7a50',
        orientation: 'any',
        scope: '/',
        lang: 'es',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,jpg}'],
        // The API must always hit the network, never the app-shell fallback.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
