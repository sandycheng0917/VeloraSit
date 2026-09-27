#!/usr/bin/env node
/**
 * 把現有的商品資料轉成可以灌進 D1 的 SQL。
 *
 *   node tools/d1-seed.mjs                      # 寫到 build/d1-seed.sql
 *   node tools/d1-seed.mjs --out build/x.sql
 *
 * 然後：
 *   npx wrangler d1 execute veloradb_sit --remote --file ../build/d1-seed.sql
 *   （在 velora-frontend/ 底下跑，路徑是相對的）
 *
 * ── 來源是 *.generated.js，不是 Sheet ──────────────────────────────
 *
 * 那兩個檔案已經是 build-catalog.mjs 過濾過的結果：成本欄位在產生的時候
 * 就被擋掉了（assertNoCost），price 只有 price_public 勾選的才存在。
 * 從這裡出發等於免費繼承那一整套過濾，不需要再實作一次 ——
 * 實作第二次就會有第二種行為，而兩種行為裡總有一種是錯的。
 *
 * ── 這支是一次性的嗎 ────────────────────────────────────────────────
 *
 * 不是。Sheet 還是人編輯的地方，D1 是網站讀的地方，中間需要一條搬運。
 * 現在這條是手動的（跑 build-catalog 更新 *.generated.js，再跑這支灌 D1）。
 * 之後要自動化的話，接在 build-catalog 後面就好，形狀不用改。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'velora-frontend', 'src', 'data')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = join(ROOT, outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : join('build', 'd1-seed.sql'))

/**
 * 🔴 成本欄位的斷言。
 *
 * build-catalog.mjs 已經擋過一次，這裡是第二道 —— 不是因為不信任第一道，
 * 而是因為這支的輸入是「檔案」不是「端點」。有人手動編輯過
 * products.generated.js（註解寫了別編輯，但註解擋不住人），
 * 或是從別的分支 cherry-pick 了一份舊的，第一道就不在路徑上了。
 */
const FORBIDDEN = /^(cost|cost_[a-z]+|fob|fob_[a-z]+|unit_price|supplier|supplier_[a-z]+)$/i

function assertNoCost(rows) {
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (FORBIDDEN.test(k)) {
        throw new Error(`🔴 成本欄位出現在種子資料裡：${r.id}.${k}　中止。`)
      }
    }
  }
}

/** SQL 字串字面值。單引號要成對加倍，這是 SQLite 唯一的跳脫方式。 */
const s = (v) => (v == null ? "''" : `'${String(v).replace(/'/g, "''")}'`)
/** NULL 與空字串是不同的東西（price 尤其） */
const nOrNull = (v) => (v === undefined || v === null || v === '' ? 'NULL' : Number(v))
const bit = (v) => (v ? 1 : 0)

async function main() {
  const products = (await import(pathToFileURL(join(DATA, 'products.generated.js')).href)).default
  const site = await import(pathToFileURL(join(DATA, 'site.generated.js')).href)

  assertNoCost(products)

  const L = []
  L.push('-- 由 tools/d1-seed.mjs 產生，請勿手動編輯。')
  L.push(`-- 產生時間：${new Date().toISOString()}`)
  L.push(`-- 商品 ${products.length} 件、品牌 ${site.houses.length} 個、品類 ${site.categories.length} 個`)
  L.push('')

  // 🔴 先刪再插，而且刪的順序跟外鍵相反。
  //    product_files 參照 products，先刪 products 的話 ON DELETE CASCADE
  //    會連帶清掉，看起來沒差 —— 但 D1 預設不開外鍵強制，
  //    CASCADE 不會發生，會留下一堆指向不存在商品的孤兒圖。
  L.push('DELETE FROM product_files;')
  L.push('DELETE FROM products;')
  L.push('DELETE FROM houses;')
  L.push('DELETE FROM categories;')
  L.push('')

  const TRI = ['name', 'tagline', 'desc', 'material', 'spec', 'detail', 'notes_top', 'notes_mid', 'notes_base']
  const PCOLS = [
    'id', 'category', 'house', 'origin', 'listed', 'featured', '"order"', 'updated', 'price',
    ...TRI.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
  ]

  L.push(`-- ── 商品 ${products.length} 件 ──`)
  for (const p of products) {
    const vals = [
      s(p.id), s(p.category), s(p.house), s(p.origin),
      bit(p.listed !== false), bit(p.featured === true),
      Number(p.order || 0), s(p.updated),
      // price 只有 Sheet 勾了 price_public 才存在。沒有就是 NULL，不是 0。
      nOrNull(p.price),
      ...TRI.flatMap((f) => [s(p[`${f}_zh`]), s(p[`${f}_en`]), s(p[`${f}_ko`])]),
    ]
    L.push(`INSERT INTO products (${PCOLS.join(', ')}) VALUES (${vals.join(', ')});`)
  }
  L.push('')

  const fileCount = products.reduce((n, p) => n + (p.files || []).length, 0)
  L.push(`-- ── 商品圖 ${fileCount} 張（position 0 是主圖）──`)
  for (const p of products) {
    ;(p.files || []).forEach((f, i) => {
      L.push(`INSERT INTO product_files (product_id, position, file) VALUES (${s(p.id)}, ${i}, ${s(f)});`)
    })
  }
  L.push('')

  L.push(`-- ── 品牌 ${site.houses.length} 個 ──`)
  site.houses.forEach((h, i) => {
    L.push(
      'INSERT INTO houses (key, name, name_ko, country_zh, country_en, country_ko, tagline, ' +
        'intro_zh, intro_en, intro_ko, listed, "order") VALUES (' +
        [
          s(h.key), s(h.name), s(h.nameKo),
          s(h.country?.zh), s(h.country?.en), s(h.country?.ko),
          s(h.tagline), s(h.intro?.zh), s(h.intro?.en), s(h.intro?.ko),
          bit(h.listed !== false), Number(h.order ?? i + 1),
        ].join(', ') +
        ');'
    )
  })
  L.push('')

  L.push(`-- ── 品類 ${site.categories.length} 個 ──`)
  for (const c of site.categories) {
    L.push(
      'INSERT INTO categories (key, code, ref, name_zh, name_en, name_ko, short_zh, short_en, short_ko, ' +
        'cover, spec_label_zh, spec_label_en, spec_label_ko, ' +
        'detail_label_zh, detail_label_en, detail_label_ko, "order") VALUES (' +
        [
          s(c.key), s(c.code), s(c.ref),
          s(c.name?.zh), s(c.name?.en), s(c.name?.ko),
          s(c.short?.zh), s(c.short?.en), s(c.short?.ko),
          s(c.cover),
          s(c.specLabel?.zh), s(c.specLabel?.en), s(c.specLabel?.ko),
          s(c.detailLabel?.zh), s(c.detailLabel?.en), s(c.detailLabel?.ko),
          Number(c.order || 0),
        ].join(', ') +
        ');'
    )
  }
  L.push('')

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, L.join('\n'), 'utf8')

  console.log(`✓ ${OUT}`)
  console.log(`  商品 ${products.length} 件、圖 ${fileCount} 張、品牌 ${site.houses.length} 個、品類 ${site.categories.length} 個`)
  const priced = products.filter((p) => p.price !== undefined).length
  console.log(`  其中 ${priced} 件有公開價格（Sheet 勾了 price_public），其餘 price 為 NULL`)
}

main().catch((e) => {
  console.error('\n✗ ' + ((e && e.message) || e))
  process.exit(1)
})
