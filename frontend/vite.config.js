import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: false, // never ship source maps to the public site
  },
  server: {
    // Basic browser protections in dev too (the full CSP lives in nginx.conf for production).
    headers: {
      // SAMEORIGIN (not DENY) so /line-demo can show pages as LIFF views; production nginx keeps 'none'.
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    // Same-origin API in dev so the httpOnly session cookie just works.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: false },
    },
  },
})
