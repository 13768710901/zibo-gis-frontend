import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB，Cesium.js超过5MB
        runtimeCaching: [
          {
            // Cesium Ion底图瓦片缓存（Bing/Google Maps等）
            urlPattern: /^https:\/\/(tile|assets)\.cesium\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cesium-tiles-cache',
              expiration: {
                maxEntries: 500, // 最多缓存500个瓦片
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7天
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/webapi\.amap\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'amap-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7天
              }
            }
          },
          {
            urlPattern: /^https:\/\/localhost:7274\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1小时
              }
            }
          }
        ]
      },
      manifest: {
        name: '淄博GIS公共服务设施分析平台',
        short_name: '淄博GIS',
        description: '基于Vue3和Cesium的城市三维公共服务设施布局分析与可视化平台，支持灾情上报与管理',
        theme_color: '#3b82f6',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-72x72.png', sizes: '72x72', type: 'image/png' },
          { src: 'pwa-96x96.png', sizes: '96x96', type: 'image/png' },
          { src: 'pwa-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: 'pwa-144x144.png', sizes: '144x144', type: 'image/png' },
          { src: 'pwa-152x152.png', sizes: '152x152', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ],
        categories: ['navigation', 'utilities'],
        lang: 'zh-CN',
        dir: 'ltr'
      },
      devOptions: {
        enabled: false // 开发环境禁用PWA，避免缓存问题
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      cesium: resolve(__dirname, 'node_modules/cesium'),
    },
  },
  define: {
    // 静态资源实际路径为 public/cesium/Cesium，因此这里需要带上 /Cesium
    CESIUM_BASE_URL: JSON.stringify('/cesium/Cesium'),
  },
  server: {
    proxy: {
      // 让前端以 /api 开头的请求走 .NET 后端（解决 CORS + 统一代理）
      '/api': {
        target: 'https://localhost:7274',
        changeOrigin: true,
        secure: false,
      },
      // 图片上传目录代理到后端
      '/uploads': {
        target: 'https://localhost:7274',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
