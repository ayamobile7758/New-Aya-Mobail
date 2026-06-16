import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        manifest: {
          name: 'نظام إدارة المتاجر',
          short_name: 'نقطة البيع',
          // A-1: cloud-only — updated description to reflect that internet is required.
          description: 'نظام نقطة بيع متكامل — يتطلب اتصالاً بالإنترنت',
          theme_color: '#F9F8F5',
          background_color: '#F9F8F5',
          display: 'standalone',
          orientation: 'any',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        devOptions: { enabled: true },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
          maximumFileSizeToCacheInBytes: 5000000,
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              urlPattern: /\.(?:js|css)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'js-css-cache',
                expiration: {
                  maxAgeSeconds: 60 * 60 * 24 * 365 // سنة كاملة
                }
              }
            },
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
      })
    ],
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
