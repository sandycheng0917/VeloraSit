/**
 * 從影像索引算出「前台那張圖」的公開網址。
 *
 * ── 為什麼算得出來 ──────────────────────────────────────────────────
 *
 * 產生器輸出的檔名是**內容定址**的：
 *
 *     <影像鍵>-<sha256 前 8 碼>[.cut].<副檔名>
 *
 * sha256、mime、alpha 都在 Sheet 的 images 分頁裡，而 op:'imageIndex'
 * 只回這些中繼資料（23 張約 2KB）。所以後台不必為了一張縮圖
 * 把四萬字元的 base64 拉回來 —— 直接指向站台上那個檔案，
 * 瀏覽器還會幫忙快取。
 *
 * ── 🔴 這裡跟 tools/build-catalog.mjs 的 imageFileName() 是同一條規則 ──
 *
 * 兩邊必須一致。改了一邊就要改另一邊。
 *
 * 不一致的後果刻意做成「安全的」：算出來的網址 404 時，<img> 會觸發
 * error，前端退回 op:'image' 走 API。所以最壞情況只是慢回原本的速度，
 * 不會變成破圖。剛上傳、還沒發布的圖也走同一條退路 ——
 * 那時公開網址上本來就還沒有那個檔案。
 *
 * ── 🔴 2026-09-28 修了路徑，並拿掉 VITE_SITE_URL 的硬性依賴 ──────────
 *
 * 之前算的是 `${SITE}/assets/media/...`，那是 velora2 的路徑
 * （build-catalog 同時寫到兩個地方：velora-frontend/public/media/
 * 給 Vue 站，<out>/assets/media/ 給 velora2）。velora2 退場之後
 * 只剩前者，網址是 `/media/...`。
 *
 * 而且後台跟前台現在是同一個 Worker、同一個網域，所以預設走**相對路徑**
 * 就對了，不需要 CI 帶入站台網址。這一併解掉了舊的失敗模式：
 * VITE_SITE_URL 沒帶到的時候 publicUrl() 回空字串，縮圖就**全部**走 API ——
 * 而那條退路本來是設計給「個別檔案還沒發布」的，不是給「一張都不快」的。
 * 沒有人會發現，因為畫面完全正常，只是每張縮圖都多一次 API 往返。
 *
 * VITE_SITE_URL 保留成選用的覆寫：哪天後台搬到別的網域再設它。
 */

/** mime → 副檔名。跟產生器的 MIME_EXT 對應 */
const EXT = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
}

/**
 * 站台根網址。預設空字串 = 同源，算出來的是 /media/... 這種相對路徑。
 * 只有後台與前台不同網域時才需要設 VITE_SITE_URL。
 */
const SITE = String(import.meta.env.VITE_SITE_URL || '').replace(/\/$/, '')

/**
 * @param {string} key 影像鍵，例如 frg-ylang-main
 * @param {{sha256:string, mime:string, alpha:boolean}} meta 來自 op:'imageIndex'
 * @returns {string} 公開網址，算不出來時回空字串
 */
export function publicUrl(key, meta) {
  if (!key || !meta || !meta.sha256) return ''
  const ext = EXT[meta.mime] || 'webp'
  const cut = meta.alpha ? '.cut' : ''
  return `${SITE}/media/${key}-${String(meta.sha256).slice(0, 8)}${cut}.${ext}`
}
