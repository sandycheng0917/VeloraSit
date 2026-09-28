#!/usr/bin/env node
/**
 * 一次性遷移：把 Google Sheet 的最後一份快照灌進 Cloudflare D1。
 *
 *   node tools/d1-seed.mjs --force                 # 產生 build/d1-seed.sql
 *   node tools/d1-seed.mjs --force --pw "密碼"      # 順便設後台密碼
 *
 * 🔴 **這支會把 D1 現有的商品、品牌、品類、影像整個洗掉再重灌。**
 *
 *    2026-09-28 之後 D1 就是唯一真相，後台的每一次儲存都直接寫進去。
 *    再跑一次這支等於把 Sheet 那份 2026-09-07 的舊快照蓋回去 ——
 *    所有後台的編輯全部消失，而且沒有備份。
 *
 *    所以要明確加 --force 才會動。遷移已經做完了，正常情況下
 *    你永遠不需要再跑它；留著是為了災難復原與「從零重建」的可驗證性。
 *    要先備份的話：npx wrangler d1 export veloradb_sit --remote --output backup.sql
 *
 * 然後（在 velora-frontend/ 底下）：
 *   npx wrangler d1 execute veloradb_sit --remote --file ../build/d1-seed.sql
 *
 * ── 為什麼來源是 fixture.json 而不是 *.generated.js ────────────────
 *
 * *.generated.js 是 build-catalog 過濾**後**的結果，少了 ref、hs、
 * price_public、deleted、img_* 這些欄位 —— 前台用不到，所以被丟掉了。
 * 但 D1 現在要取代 Sheet 當唯一真相，後台得編輯那些欄位。
 * fixture.json 是匯出端點的原樣快照，欄位是齊的。
 *
 * ── 🔴 成本仍然不進來 ───────────────────────────────────────────────
 *
 * fixture.json 來自 op:'export'，而那條路徑只讀得到 products / houses /
 * categories 三張分頁 —— 'products_private' 這個名字在上面不存在。
 * 下面還是再斷言一次：這支的輸入是**檔案**不是端點，有人手動編輯過、
 * 或從別的分支撈了一份舊的，第一層就不在路徑上了。
 *
 * ── 影像 ────────────────────────────────────────────────────────────
 *
 * 位元組直接進 D1 的 BLOB 欄（X'…' 十六進位字面值）。來源是
 * tools/images.json 指到的 tools/media-src/ 底下的檔案。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MIME_EXT, webpHasAlpha } from './lib/assemble.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 影像來源。
 *
 * 2026-09-28 從 velora-frontend/public/media/opt/ 搬到這裡。理由是
 * CLAUDE.md 的那條規則：**放進 public/ 就等於公開，即使沒被用到** ——
 * 那 15 個檔案是建置素材，網站從來沒有引用過它們，卻一直跟著上線。
 */
const MEDIA_SRC = join(ROOT, 'tools', 'media-src')
const args = process.argv.slice(2)
const arg = (n) => {
  const i = args.indexOf(n)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}
const OUT = join(ROOT, arg('--out') || join('build', 'd1-seed.sql'))
const PW = arg('--pw')
const FORCE = args.includes('--force')

/* ── 🔴 成本欄位的斷言 ─────────────────────────────────────────── */
const FORBIDDEN = /^(cost|cost_[a-z]+|fob|fob_[a-z]+|unit_price|supplier|supplier_[a-z]+)$/i
function assertNoCost(rows, where) {
  for (const r of rows || []) {
    for (const k of Object.keys(r || {})) {
      if (FORBIDDEN.test(k)) throw new Error(`🔴 成本欄位出現在 ${where}：${k}　中止。`)
    }
  }
}

/* ── 正規化：跟 tools/lib/normalize.mjs 同一套 ─────────────────── */
const bool = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE'
const str = (v) =>
  v === null || v === undefined || typeof v === 'boolean' ? '' : String(v).trim()

/** SQL 字串字面值。單引號成對加倍是 SQLite 唯一的跳脫方式 */
const s = (v) => `'${String(v == null ? '' : v).replace(/'/g, "''")}'`
const num = (v) => (v === '' || v === null || v === undefined ? 'NULL' : Number(v))
const bit = (v) => (v ? 1 : 0)
/** BLOB 字面值 */
const blob = (buf) => `X'${buf.toString('hex')}'`

const MIME_BY_EXT = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' }

const TRI = ['name', 'tagline', 'desc', 'material', 'spec']
const DETAIL = ['detail']
const NOTES = ['notes_top', 'notes_mid', 'notes_base']

async function main() {
  if (!FORCE) {
    throw new Error(
      [
        '這支會清空 D1 的 products / houses / categories / images 再重灌，',
        '  而 D1 現在是唯一真相 —— 後台的編輯會全部消失。',
        '  確定要覆蓋就加 --force。',
        '  先備份：npx wrangler d1 export veloradb_sit --remote --output backup.sql',
      ].join('\n')
    )
  }

  const fixture = JSON.parse(await readFile(join(ROOT, 'tools', 'fixture.json'), 'utf8'))
  const imgMap = JSON.parse(await readFile(join(ROOT, 'tools', 'images.json'), 'utf8'))

  assertNoCost(fixture.products, 'fixture.products')
  assertNoCost(fixture.houses, 'fixture.houses')
  assertNoCost(fixture.categories, 'fixture.categories')

  const L = []
  L.push('-- 由 tools/d1-seed.mjs 產生，請勿手動編輯。')
  L.push(`-- 產生時間：${new Date().toISOString()}`)
  L.push('')
  L.push('DELETE FROM products;')
  L.push('DELETE FROM houses;')
  L.push('DELETE FROM categories;')
  L.push('DELETE FROM images;')
  L.push('')

  /* ── 商品 ─────────────────────────────────────────────────────── */
  const TEXT_COLS = [
    ...TRI.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
    ...DETAIL.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
    ...NOTES.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
  ]
  const P_COLS = [
    'id', 'ref', 'category', 'house', 'hs', 'origin',
    'listed', 'featured', 'deleted', '"order"', 'updated',
    'price', 'price_public',
    'img_main', 'img_2', 'img_3',
    ...TEXT_COLS,
  ]

  const products = (fixture.products || []).filter((r) => str(r.id))
  L.push(`-- ── 商品 ${products.length} 件 ──`)
  for (const r of products) {
    const vals = [
      s(str(r.id)), s(str(r.ref)), s(str(r.category)), s(str(r.house)), s(str(r.hs)),
      s(str(r.origin) || 'KR'),
      bit(bool(r.listed)), bit(bool(r.featured)), bit(bool(r.deleted)),
      Number(r.order) || 0, s(str(r.updated)),
      // price 與 price_public 分開存。「填了價格但先不公開」是一個
      // 有效的狀態，0001 把它壓成 NULL 是錯的 —— 後台一存就把數字弄丟。
      num(str(r.price)), bit(bool(r.price_public)),
      s(str(r.img_main)), s(str(r.img_2)), s(str(r.img_3)),
      ...TEXT_COLS.map((c) => s(str(r[c]))),
    ]
    L.push(`INSERT INTO products (${P_COLS.join(', ')}) VALUES (${vals.join(', ')});`)
  }
  L.push('')

  /* ── 品牌 ─────────────────────────────────────────────────────── */
  const houses = (fixture.houses || []).filter((h) => str(h.key))
  L.push(`-- ── 品牌 ${houses.length} 個 ──`)
  houses.forEach((h, i) => {
    L.push(
      'INSERT INTO houses (key, name, name_ko, country_zh, country_en, country_ko, tagline, ' +
        'intro_zh, intro_en, intro_ko, listed, "order") VALUES (' +
        [
          s(str(h.key)), s(str(h.name)), s(str(h.name_ko)),
          s(str(h.country_zh)), s(str(h.country_en)), s(str(h.country_ko)),
          s(str(h.tagline)), s(str(h.intro_zh)), s(str(h.intro_en)), s(str(h.intro_ko)),
          bit(!('listed' in h) || bool(h.listed)), Number(h.order) || i + 1,
        ].join(', ') + ');'
    )
  })
  L.push('')

  /* ── 品類 ─────────────────────────────────────────────────────── */
  const cats = (fixture.categories || []).filter((c) => str(c.key))
  L.push(`-- ── 品類 ${cats.length} 個 ──`)
  for (const c of cats) {
    L.push(
      'INSERT INTO categories (key, code, ref, name_zh, name_en, name_ko, ' +
        'short_zh, short_en, short_ko, cover, ' +
        'spec_label_zh, spec_label_en, spec_label_ko, ' +
        'detail_label_zh, detail_label_en, detail_label_ko, "order") VALUES (' +
        [
          s(str(c.key)), s(str(c.code)), s(str(c.ref)),
          s(str(c.name_zh)), s(str(c.name_en)), s(str(c.name_ko)),
          // 舊表沒有 short_* 就退回 name_*，不然後台頁籤會空白
          s(str(c.short_zh) || str(c.name_zh)),
          s(str(c.short_en) || str(c.name_en)),
          s(str(c.short_ko) || str(c.name_ko)),
          s(str(c.cover)),
          s(str(c.spec_label_zh) || '規格'),
          s(str(c.spec_label_en) || 'Spec'),
          s(str(c.spec_label_ko) || '사양'),
          s(str(c.detail_label_zh)), s(str(c.detail_label_en)), s(str(c.detail_label_ko)),
          Number(c.order) || 0,
        ].join(', ') + ');'
    )
  }
  L.push('')

  /* ── 影像：位元組直接進 BLOB ──────────────────────────────────── */
  L.push(`-- ── 影像 ${imgMap.length} 張 ──`)
  let total = 0
  const missing = []
  for (const { key, path } of imgMap) {
    const abs = join(MEDIA_SRC, path)
    if (!existsSync(abs)) {
      missing.push(`${key} → ${path}`)
      continue
    }
    const buf = await readFile(abs)
    const ext = path.split('.').pop().toLowerCase()
    const mime = MIME_BY_EXT[ext] || 'image/webp'
    // 判準跟 build-assets.py 一致：沒有透明像素的會被轉存 JPEG，
    // 所以留下來的 .png 一定有 alpha。WebP 要讀容器標頭才知道。
    const alpha = ext === 'png' ? true : ext === 'webp' ? webpHasAlpha(buf) : false
    const sha = createHash('sha256').update(buf).digest('hex')
    total += buf.length
    L.push(
      'INSERT INTO images (key, mime, alpha, sha256, bytes, data, updated) VALUES (' +
        [s(key), s(mime), bit(alpha), s(sha), buf.length, blob(buf), s(new Date().toISOString())].join(', ') +
        ');'
    )
  }
  L.push('')

  /* ── 後台密碼 ─────────────────────────────────────────────────── */
  if (PW) {
    // PBKDF2-SHA256，跟 worker/admin.js 的驗證端必須用同一組參數。
    //
    // 🔴 10 萬輪是 Cloudflare Workers 的**硬上限**，不是我們挑的數字：
    //    超過就回 "Pbkdf2 failed: iteration counts above 100000 are not supported"。
    //    OWASP 對 PBKDF2-HMAC-SHA256 的建議是 31 萬，所以這裡比建議值低。
    //
    //    代價很具體：如果有人拿到 D1 的內容，離線暴力破解會比建議值快三倍。
    //    唯一能補回來的是密碼本身的長度 —— 請用長的通行句，不要用短密碼。
    //    輪數存進 admin_state.pw_iters，之後 Cloudflare 放寬了就改那一列，
    //    不必改程式碼（worker 讀它，沒有才退回預設）。
    const ITERS = 100000
    const salt = randomBytes(16)
    const hash = pbkdf2Sync(PW, salt, ITERS, 32, 'sha256')
    const secret = randomBytes(32)
    L.push('-- ── 後台認證 ──')
    L.push("DELETE FROM admin_state;")
    L.push(`INSERT INTO admin_state (key, value, updated) VALUES ('pw_salt', ${s(salt.toString('hex'))}, ${s(new Date().toISOString())});`)
    L.push(`INSERT INTO admin_state (key, value, updated) VALUES ('pw_hash', ${s(hash.toString('hex'))}, ${s(new Date().toISOString())});`)
    L.push(`INSERT INTO admin_state (key, value, updated) VALUES ('hmac_secret', ${s(secret.toString('hex'))}, ${s(new Date().toISOString())});`)
    L.push(`INSERT INTO admin_state (key, value, updated) VALUES ('pw_iters', '${ITERS}', ${s(new Date().toISOString())});`)
    L.push(`INSERT INTO admin_state (key, value, updated) VALUES ('token_epoch', '1', ${s(new Date().toISOString())});`)
    L.push('')
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, L.join('\n'), 'utf8')

  console.log(`✓ ${OUT}`)
  console.log(`  商品 ${products.length} 件、品牌 ${houses.length} 個、品類 ${cats.length} 個`)
  console.log(`  影像 ${imgMap.length - missing.length} 張，共 ${(total / 1024 / 1024).toFixed(2)} MB`)
  const priced = products.filter((p) => bool(p.price_public)).length
  console.log(`  其中 ${priced} 件勾了 price_public（前台才會顯示價格）`)
  if (missing.length) {
    console.log(`  ⚠ ${missing.length} 張找不到檔案：${missing.slice(0, 5).join('、')}`)
  }
  console.log(PW ? '  已設定後台密碼' : '  （沒有給 --pw，不動後台密碼）')
}

main().catch((e) => {
  console.error('\n✗ ' + ((e && e.message) || e))
  process.exit(1)
})
