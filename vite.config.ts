import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MaBills - Minhas Financas',
        short_name: 'MaBills',
        description: 'Controle de gastos e orcamento por categoria',
        lang: 'pt-BR',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // O proprio script do service worker nao entra no precache: ele e
        // carregado por importScripts, e precachear geraria uma segunda copia
        // que envelhece sozinha.
        globIgnores: ['push-sw.js'],
        // Handlers de push e de clique na notificacao. O modo generateSW nao
        // aceita codigo proprio no arquivo gerado, entao eles entram por aqui.
        importScripts: ['/push-sw.js'],
        // A API nunca entra no precache. Ela usa NetworkFirst com fallback
        // para o cache, para o app abrir offline com os ultimos dados.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Sem ancora ^: o Workbox testa o padrao contra a URL COMPLETA
            // (https://host/api/...), entao ancorar na barra inicial nunca casaria
            // e o cache offline da API ficaria silenciosamente desligado.
            urlPattern: /\/api\/(summary|transactions|categories|budgets|accounts|breakdown|trends)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mabills-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Em dev o Vite serve o front e repassa a API para o wrangler dev.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
