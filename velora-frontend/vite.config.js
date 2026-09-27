import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * base 由環境變數（或 CLI 的 --base）決定，預設為根目錄。
 *
 * 公開站在 Worker 的根目錄，所以用預設值。後台建置時由
 * `npm run build:worker` 以 `--base /admin/` 覆寫 —— 兩個建置疊成同一份
 * dist/，公開版在根、後台在 dist/admin/。
 */
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  /**
   * 開發時 /api/* 轉給線上的 Worker。
   *
   * 商品資料 2026-09-28 起在 Cloudflare D1，前台是執行時去拿的 ——
   * vite dev server 自己沒有那個端點，不轉的話開發環境會一直停在
   * 載入失敗，而錯誤訊息會像是程式壞了。
   *
   * 要打本機的 D1 就改成 http://127.0.0.1:8787 並另外跑 npm run cf:dev。
   * 預設指向線上是因為多數時候在改版面，不想為了看商品先開兩個終端機。
   */
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_ORIGIN || 'https://velorasit.chenghsuanno1.workers.dev',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    /**
     * 明確指定目標，不要用預設值。
     *
     * Vite 預設會把 media query 壓成新的範圍語法 `@media (width<=720px)`，
     * 那是 Safari 16.4 / Chrome 104 之後才支援的寫法 —— iOS 16.3 以前的
     * iPhone 會直接忽略整段規則，手機上會拿到桌機版面。
     * 這個站的使用者多半用手機，所以把底線拉到 Safari 14（iOS 14, 2020）。
     */
    target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88'],
    cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'],
  },
})
