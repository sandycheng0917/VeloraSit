/**
 * Cloudflare Worker 入口：靜態站台 + D1 讀寫 API + 後台後端。
 *
 * ── 為什麼是 Worker 而不是 Pages ────────────────────────────────────
 *
 * velorasit 在 Cloudflare 上本來就是一個 Worker（Workers & Pages 清單裡
 * 顯示 "Workers build minutes"、"No active routes"，而 Pages 專案清單是空的）。
 * 2026-09-28 之前這裡放的是 Pages 形狀的設定 —— wrangler.toml 寫
 * pages_build_output_dir、API 放在 functions/api/*.js。兩者 Worker 都不認得。
 *
 * ── 路由怎麼分 ──────────────────────────────────────────────────────
 *
 * 有 [assets] 又有 main 的時候，Cloudflare 會**先找靜態檔**，找不到才進這支。
 *   /              → dist/index.html（直接由 assets 回）
 *   /admin/        → dist/admin/index.html（同上）
 *   /media/vuca/…  → dist/media/vuca/…（同上，版面用的固定素材）
 *   /media/<內容定址檔名> → 沒有實體檔，落到這裡從 D1 讀
 *   /api/*         → 落到這裡
 *   /其他          → 也落到這裡，回 index.html 給前端路由接手
 *
 * 🔴 [assets] 的 not_found_handling 一定要維持預設的 "none"。
 *    設成 "single-page-application" 的話，靜態層會在找不到檔案時直接回
 *    index.html —— 連 /api/* 與 /media/* 都會拿到 HTML，這支永遠不會執行，
 *    而且前端看到的是 200 加一份 HTML，JSON.parse 才炸。
 *
 * ── 2026-09-28：Google 全面退場 ─────────────────────────────────────
 *
 * 商品、品牌、品類、影像位元組、後台密碼全部在 D1。
 * 沒有 Google Sheet、沒有 Apps Script、沒有「發布」這個步驟 ——
 * 後台儲存的那一刻網站就改了。
 */
import { handleAdmin, handleMedia } from './admin.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // 商品資料改動不頻繁，但「改了要多久才看得到」得是可預期的。
  // 60 秒是刻意選的上限：後台改完泡杯茶回來就生效，而不是要記得清快取。
  'cache-control': 'public, max-age=60',
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })

/**
 * 🔴 錯誤一律回 5xx，不要回 200 配一包預設資料。
 *
 * 2026-09-28 之前的 functions/api/products.js 在查詢失敗時會 catch 住，
 * 然後回兩筆寫死的 Demo Product 加 HTTP 200。那讓「資料表還沒建」跟
 * 「資料庫是空的」跟「查詢寫錯了」看起來完全一樣 —— 網站正常顯示兩件
 * 不存在的商品，監控是綠的，沒有任何東西會告訴你資料庫其實沒接上。
 */
const fail = (message, status = 500) => json({ ok: false, error: message }, status)

/** 三個扁平欄位 → { zh, en, ko }。跟 catalog.js 的 tri() 是同一個約定 */
const tri = (row, field) => ({
  zh: row[`${field}_zh`] || '',
  en: row[`${field}_en`] || '',
  ko: row[`${field}_ko`] || '',
})

const TRI_FIELDS = ['name', 'tagline', 'desc', 'material', 'spec', 'detail']

/** mime → 副檔名。跟 tools/lib/assemble.mjs 的 MIME_EXT 對應 */
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

/**
 * 內容定址的檔名：<鍵>-<sha 前 8 碼>[.cut].<副檔名>
 *
 * 🔴 這條規則有三份拷貝：這裡、tools/lib/assemble.mjs 的 imageFileName()、
 *    src/admin/imgurl.js 的 publicUrl()。三個 runtime 各一份，無法共用。
 *    改任何一處都要同步另外兩處，否則算出來的網址對不到 handleMedia 查得到的圖。
 */
const fileNameOf = (key, img) =>
  `${key}-${String(img.sha256).slice(0, 8)}${img.alpha === 1 ? '.cut' : ''}.${EXT[img.mime] || 'webp'}`

async function readCatalog(db) {
  const [products, images, houses, categories] = await Promise.all([
    // 前台只看上架且沒被軟刪除的。後台走 /api/admin 的 list，看得到全部
    db.prepare('SELECT * FROM products WHERE deleted = 0 ORDER BY "order" ASC, id ASC').all(),
    db.prepare('SELECT key, mime, alpha, sha256 FROM images').all(),
    db.prepare('SELECT * FROM houses WHERE listed = 1 ORDER BY "order" ASC, key ASC').all(),
    db.prepare('SELECT * FROM categories ORDER BY "order" ASC, key ASC').all(),
  ])

  const imgByKey = new Map(images.results.map((i) => [i.key, i]))
  const fileFor = (key) => {
    const img = key && imgByKey.get(key)
    return img ? fileNameOf(key, img) : null
  }

  return {
    products: products.results.map((r) => ({
      id: r.id,
      category: r.category,
      house: r.house || '',
      origin: r.origin || '',
      listed: r.listed === 1,
      featured: r.featured === 1,
      order: r.order ?? 0,
      updated: r.updated || '',
      ...TRI_FIELDS.reduce((o, f) => ({ ...o, [f]: tri(r, f) }), {}),
      notes: { top: tri(r, 'notes_top'), middle: tri(r, 'notes_mid'), base: tri(r, 'notes_base') },
      // 沒有對應影像的鍵直接略過 —— 前台拿到的每個檔名都保證查得到圖，
      // 不會出現破圖。全都沒有的話 image 是 undefined，走「製版中」空版
      files: [r.img_main, r.img_2, r.img_3].map(fileFor).filter(Boolean),
      // 🔴 price_public 沒勾就連 price 這個鍵都不輸出。輸出了再讓前端隱藏的話，
      //    價格仍然在網路回應裡，打開 devtools 就看得到。
      ...(r.price_public !== 1 || r.price == null ? {} : { price: r.price }),
    })),
    houses: houses.results.map((h) => ({
      key: h.key,
      name: h.name,
      nameKo: h.name_ko || '',
      country: { zh: h.country_zh || '', en: h.country_en || '', ko: h.country_ko || '' },
      tagline: h.tagline || '',
      intro: { zh: h.intro_zh || '', en: h.intro_en || '', ko: h.intro_ko || '' },
      listed: h.listed === 1,
      order: h.order ?? 0,
    })),
    categories: categories.results.map((c) => ({
      key: c.key,
      code: c.code,
      ref: c.ref,
      name: { zh: c.name_zh || '', en: c.name_en || '', ko: c.name_ko || '' },
      short: { zh: c.short_zh || '', en: c.short_en || '', ko: c.short_ko || '' },
      cover: c.cover || '',
      specLabel: { zh: c.spec_label_zh || '', en: c.spec_label_en || '', ko: c.spec_label_ko || '' },
      detailLabel: { zh: c.detail_label_zh || '', en: c.detail_label_en || '', ko: c.detail_label_ko || '' },
      order: c.order ?? 0,
    })),
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    // 能走到這裡的 /media/ 代表沒有實體檔案 —— 那就是內容定址的商品圖，
    // 位元組在 D1 裡
    if (path.startsWith('/media/')) return handleMedia(request, env, url)

    if (path === '/api/admin') return handleAdmin(request, env)

    if (!path.startsWith('/api/')) {
      /*
       * 靜態檔已經由 assets 層處理掉了，能走到這裡的是「沒有對應檔案」的路徑。
       * 前台是 SPA（vue-router 的 history 模式），所以回 index.html 讓前端
       * 自己解析路徑 —— router 有一條 catch-all 會導回首頁。
       *
       * 用 new URL('/', url) 而不是把 request 原樣傳下去：原樣傳的話
       * assets 會再找一次同一個不存在的路徑，然後回 404。
       */
      const res = await env.ASSETS.fetch(new URL('/', url))
      return new Response(res.body, { status: 200, headers: res.headers })
    }

    if (!env.DB) {
      return fail('D1 沒有綁定到這個環境。檢查 wrangler.toml 的 [[d1_databases]]。', 503)
    }

    try {
      if (path === '/api/health') {
        // 探活要真的碰資料表，不能只跑 SELECT 1。
        // SELECT 1 在「資料庫連得上但一張表都沒有」的時候照樣回 ok ——
        // 而那正是最需要被告知的狀況（migration 還沒套用）。
        const t = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN " +
          "('products','houses','categories','images','admin_state','audit')"
        ).first()
        const ready = t?.n === 6
        const counts = ready
          ? await env.DB.prepare(
              'SELECT (SELECT COUNT(*) FROM products WHERE deleted = 0) AS p, ' +
              '(SELECT COUNT(*) FROM images) AS i'
            ).first()
          : null
        return json({
          ok: ready,
          tables: t?.n ?? 0,
          products: counts?.p ?? 0,
          images: counts?.i ?? 0,
          message: ready
            ? 'D1 已連線，資料表齊全'
            : `D1 連得上，但資料表不齊（應有 6 張，實得 ${t?.n ?? 0}）。` +
              '執行 npx wrangler d1 migrations apply veloradb_sit --remote',
        }, ready ? 200 : 503)
      }

      if (path === '/api/catalog') return json({ ok: true, ...(await readCatalog(env.DB)) })

      if (path === '/api/products') {
        const { products } = await readCatalog(env.DB)
        return json({ ok: true, products })
      }

      return fail(`沒有這個端點：${path}`, 404)
    } catch (e) {
      // 訊息原樣回傳。這個 API 只回公開的商品資料，沒有成本也沒有憑證，
      // 而藏起來的錯誤訊息只會讓人對著 500 猜半天。
      return fail(String((e && e.message) || e))
    }
  },
}
