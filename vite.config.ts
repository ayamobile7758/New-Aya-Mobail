import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), VitePWA({
      // 'prompt': when a new build is deployed, the new service worker installs
      // and WAITS. We never auto-activate it mid-session (so a sale is never
      // interrupted). Instead PwaManager surfaces a "يوجد تحديث جديد" banner and
      // the owner taps "تحديث" to activate + reload. This replaced 'autoUpdate',
      // which used to swap silently and left users feeling the app never updated.
      registerType: 'prompt',
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        lang: 'ar',
        dir: 'rtl',
        name: 'نظام إدارة المتاجر',
        short_name: 'نقطة البيع',
        // A-1: cloud-only — updated description to reflect that internet is required.
        description: 'نظام نقطة بيع متكامل — يتطلب اتصالاً بالإنترنت',
        theme_color: '#F9F8F5',
        background_color: '#F9F8F5',
        display: 'standalone',
        orientation: 'any',
        // Android/Chrome installability needs at least one 192px and one 512px PNG.
        // We list explicit `purpose: 'any'` icons AND a separate `maskable` entry —
        // combining both purposes on a single icon can make some launchers skip it,
        // which is why the home-screen icon was not appearing after install.
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      devOptions: { enabled: true },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 5000000,
        navigateFallback: '/index.html',
        // Delete previous-version precaches as soon as a new SW activates, so old
        // bundles never linger and the device cannot get "stuck" on an old build.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // NOTE: built JS/CSS are revisioned and handled by Workbox precache, which
          // updates them correctly on each release. We intentionally do NOT add a
          // CacheFirst rule for js/css here — that would serve stale bundles for a
          // year and defeat autoUpdate. Only truly static, non-revisioned assets
          // (fonts, images) get runtime CacheFirst below.
          {
            urlPattern: /\.(?:woff2?|woff)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 365 // immutable
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 يوماً
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
            options: {
              precacheFallback: {
                fallbackURL: '/index.html'
              }
            }
          }
        ]
      }
    }), cloudflare()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5000,
      host: '0.0.0.0',
      allowedHosts: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/.local/**', '**/.cache/**'] },
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm']
    }
  };
});