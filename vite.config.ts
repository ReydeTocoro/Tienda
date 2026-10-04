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
        globPatterns: ['**/*.{js,css,html,png,svg,ico,jpg}'],
        // The API must always hit the network, never the app-shell fallback.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
