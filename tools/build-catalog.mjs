/**
 * 產生器：Google Sheet → 兩個前台吃得下的資料。
 *
 *   node tools/build-catalog.mjs --from tools/fixture.json   # 離線開發
 *   node tools/build-catalog.mjs --api                       # CI 用，讀環境變數
 *
 * 零 npm 依賴。Node 22 以上內建 fetch 與 crypto。
 *
 * ── 輸出 ────────────────────────────────────────────────────────────
 *   velora-frontend/src/data/products.generated.js   商品陣列（扁平欄位）
 *   velora-frontend/src/data/site.generated.js       company / houses / categories
 *   velora-frontend/public/media/*.webp              商品圖
 *
 * 🔴 這三個輸出現在都不是網站直接吃的東西。2026-09-28 起商品資料在
 *    Cloudflare D1，前台執行時才取。這支的角色變成「Sheet → D1 的上游」：
 *    產生 *.generated.js，再由 tools/d1-seed.mjs 轉成 SQL 灌進 D1。
 *    圖仍然是靜態檔（走 CDN 比走資料庫快，也不吃 D1 容量）。
 *
 * ── 成本絕不外流：這裡是第 2 與第 3 層 ──────────────────────────────
 *
 *   1. 資料層隔離   cost 在 products_private，匯出端點讀不到（Apps Script 端）
 *   2. 欄位白名單   ↓ 這支：逐欄挑，絕不用 {...row} 展開
 *   3. 輸出前斷言   ↓ 這支：遞迴掃描，命中 cost 形狀就 throw
 *   4. 誘餌字串     發布前對整個輸出 grep（原本在 deploy.yml，該檔 2026-09-28
 *                  刪除後這一層目前是手動的：node check-public.mjs）
 *   5. Sheet 保護   products_private 設保護範圍
 *
 *   第 2 層用白名單而不是黑名單，是因為黑名單擋不住「日後有人在 Sheet
 *   新增了一個叫 supplier_phone 的欄位」—— 白名單預設拒絕，新欄位要
 *   明確加進來才會輸出。
 */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// 這四個模組是與遷移腳本、驗證腳本共用的。抽出去的理由寫在各自的檔頭 ——
// 簡言之：chunk 組裝與 sha256 校驗複製三份的話，遲早有一份寫漏，
// 而症狀是網站破圖，不是任何一支腳本報錯。
import { load } from './lib/export-client.mjs'
import { bool, str } from './lib/normalize.mjs'
import { MIME_EXT, imageFileName, webpHasAlpha } from './lib/assemble.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'velora-frontend', 'src', 'data')

/* ══ 欄位白名單 ═══════════════════════════════════════════════════════
   必須與 apps-script/Setup.gs 的 COLS.products 一致。
   刻意不含 cost —— 那個欄位在另一張分頁，這裡連名字都不該出現。 */

const PUBLIC_FIELDS = [
  'id', 'ref', 'category', 'house',
  'name_zh', 'name_en', 'name_ko',
  'tagline_zh', 'tagline_en', 'tagline_ko',
  'desc_zh', 'desc_en', 'desc_ko',
  'material_zh', 'material_en', 'material_ko',
  'spec_zh', 'spec_en', 'spec_ko',
  'detail_zh', 'detail_en', 'detail_ko',
  'notes_top_zh', 'notes_top_en', 'notes_top_ko',
  'notes_mid_zh', 'notes_mid_en', 'notes_mid_ko',
  'notes_base_zh', 'notes_base_en', 'notes_base_ko',
  'origin',
  'price', 'price_public',
  'listed', 'featured', 'order',
  'img_main', 'img_2', 'img_3',
  'updated',
]

/** 任何一個 key 命中就中止。這是白名單之外的第二道網 */
const FORBIDDEN_KEY = /^(cost|cost_ccy|cost_updated|fob|unit_?price|supplier|단가|원가)/i

const CATEGORY_ORDER = ['fragrance', 'scarf', 'jewelry', 'phonebag']

/* ══ 過濾與正規化 ═════════════════════════════════════════════════════ */

/**
 * 逐欄挑出白名單裡的欄位。
 * 絕不用 { ...row } —— 那會把 Sheet 上任何新增的欄位一併帶出去，
 * 包括日後某人加的 supplier_phone。
 */
function pick(row) {
  const o = {}
  for (const f of PUBLIC_FIELDS) o[f] = row[f] === undefined ? '' : row[f]
  return o
}

/**
 * 輸出前的最後一道：遞迴掃描即將寫出去的物件，
 * 任何 key 長得像成本就中止整個建置。
 *
 * 這一層防的不是「我忘了過濾」（白名單已經處理），
 * 而是「日後有人為了方便，在某個地方把整列塞了進來」。
 */
function assertNoCost(node, path = '$') {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((v, i) => assertNoCost(v, `${path}[${i}]`))
    return
  }
  for (const [k, v] of Object.entries(node)) {
    if (FORBIDDEN_KEY.test(k)) {
      throw new Error(`🔴 成本欄位出現在輸出中：${path}.${k}　建置中止。`)
    }
    assertNoCost(v, `${path}.${k}`)
  }
}

/* ══ 主流程 ═══════════════════════════════════════════════════════════ */

async function main() {
  const args = process.argv.slice(2)

  // 2026-09-28 拿掉了 --out。它唯一的用途是把商品圖多寫一份到
  // <out>/assets/media/ 給 velora2，而 velora2 已經退場。留著一個
  // 不做事的旗標比沒有更糟 —— 下一個人會以為輸出位置可以換。

  // assembled 是 Map<影像鍵, { buf, sha, alpha, mime }>。
  // 它從哪裡來由 --source 決定（Apps Script 的 base64 chunk，或 Worker 的
  // 中繼資料＋逐張 GET），但兩條路都跑過同一道 sha256 端到端校驗，
  // 而且回傳同一個型別 —— 所以下面的流程不需要知道資料來自哪裡。
  const { src, data, images: assembled } = await load(args)
  console.error(`資料來源：${src}`)

  // 🔴 斷言要放在白名單「之前」。
  //
  // 放在後面的話它永遠不會觸發 —— 白名單已經把 cost 丟掉了，
  // 斷言只會看到乾淨的資料。實測確認過：注入 cost 欄位，建置照樣成功。
  // 那是一道不可達的防線，比沒有防線更糟，因為它讓人以為有在保護。
  //
  // 放在前面，它擋的就是真正該擋的威脅：匯出端點開始回傳它不該回傳的東西
  // （程式被改、部署到錯的版本、或有人把 products_private 併進 products）。
  // 那種情況下白名單仍然會過濾掉，網站不會外洩 —— 但我們會想立刻知道，
  // 而不是靜靜地繼續建置。
  assertNoCost(data, 'export')

  /*
   * 不顯示的品牌。
   *
   * houses 分頁的 listed 控制的是**品牌要不要露出**，不是商品的上下架。
   * 取消勾選之後：品牌館少一塊、商品卡上的品牌名不再出現，
   * 但那些商品照樣在架上 —— 它們只是變成「沒有掛品牌」的商品。
   *
   * 🔴 2026-09-07 改過語意。原本是整包排除，暫停 SAINTMARI 會讓 8 件
   *    絲巾與飾品從網站上消失，整個品類區塊跟著不見。那不是使用者要的：
   *    「我只是沒有要顯示品牌而已，並沒有說商品要下架。」
   *
   * 本來就沒填 house 的商品一直都是這樣運作的，所以這不是新行為，
   * 只是讓「隱藏品牌」跟「本來就沒品牌」走同一條路。
   */
  const houseOff = new Set(
    (data.houses || [])
      .filter((h) => 'listed' in h && !bool(h.listed))
      .map((h) => str(h.key))
  )
  if (houseOff.size) {
    console.error(`品牌不露出：${[...houseOff].join('、')}（商品留在架上，只是不掛品牌）`)
  }

  // ── 商品：白名單 → 正規化 ───────────────────────────────────────
  const rows = (data.products || [])
    .map(pick)
    .filter((r) => str(r.id))
    .map((r) => {
      // 不露出的品牌：把 house 留白。前台從此看不到品牌名，也不會出現
      // 指向一個不存在品牌的斷鏈（site.generated.js 只含要露出的品牌）。
      const house = houseOff.has(str(r.house)) ? '' : str(r.house)
      const o = {
        // ref（索引碼）2026-09-07 起不輸出。前台改印商品編號 id ——
        // 一個編號就夠了，兩個只會讓人不知道該報哪一個。
        // hs（報關用的商品分類號）同日起也不輸出。
        // 兩者都還在 Sheet 的 products 分頁上，只是不再進任何前端檔案。
        id: str(r.id), category: str(r.category), house,
        origin: str(r.origin) || 'KR',
        listed: bool(r.listed), featured: bool(r.featured),
        order: Number(r.order) || 0,
        updated: str(r.updated),
        images: [str(r.img_main), str(r.img_2), str(r.img_3)].filter(Boolean),
      }
      for (const base of ['name', 'tagline', 'desc', 'material', 'spec', 'detail']) {
        for (const lang of ['zh', 'en', 'ko']) o[`${base}_${lang}`] = str(r[`${base}_${lang}`])
      }
      for (const part of ['top', 'mid', 'base']) {
        for (const lang of ['zh', 'en', 'ko']) o[`notes_${part}_${lang}`] = str(r[`notes_${part}_${lang}`])
      }
      // 🔴 price_public 為 FALSE 時，price 連輸出都不產生 ——
      // 不是「輸出但前端不顯示」。沒有被輸出的東西不可能被看到。
      if (bool(r.price_public) && str(r.price)) o.price = Number(r.price)
      return o
    })
    .sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category), cb = CATEGORY_ORDER.indexOf(b.category)
      return ca !== cb ? ca - cb : a.order - b.order
    })

  if (!rows.length) throw new Error('匯出的商品是空的 —— 中止，不要產生一個沒有商品的網站')

  // ── 影像 ────────────────────────────────────────────────────────
  // （位元組已經由 load() 組好並驗過雜湊，見上面 assembled 的說明）

  /*
   * repo 素材的退路 —— **只在離線開發時生效**。
   *
   * 用 --from fixture.json 跑的時候（本機沒有 CI 金鑰），圖片得從 repo 拿，
   * 否則 npm run dev 是一片空白。但**接真的匯出端點時絕不退回** ——
   * 那時 Sheet 就是唯一的來源，缺圖必須讓建置失敗。
   *
   * 沒有這個區分的話，Sheet 是空的、建置照樣成功、網站照樣有圖，
   * 而沒有人會發現「資料其實不在 Sheet 裡」。那是最糟的一種靜默成功。
   */
  const offline = args.includes('--from')
  let legacy = {}
  const legacyPath = join(ROOT, 'tools', 'images.json')
  if (offline && existsSync(legacyPath)) {
    for (const e of JSON.parse(await readFile(legacyPath, 'utf8'))) legacy[e.key] = e.path
  }

  // 圖直接寫進 velora-frontend/public/media —— Vite 會原樣複製到 dist/media/，
  // 所以 npm run build 就產出完整的站，不必再多一步搬檔。
  // 後台的縮圖也指向同一個位置（src/admin/imgurl.js 的 publicUrl()）。
  //
  // 檔名是內容定址的（<id>-<slot>-<sha8>），內容沒變檔名就沒變，
  // 所以這些檔案進版控也不會每次建置都產生 diff，而且離線 npm run dev
  // 立刻有圖可看。
  const mediaDirs = [join(ROOT, 'velora-frontend', 'public', 'media')]
  for (const d of mediaDirs) await mkdir(d, { recursive: true })

  const fileFor = new Map()   // key → 檔名
  const stats = { sheet: 0, legacy: 0, missing: 0 }
  const orphans = []

  for (const row of rows) {
    for (const key of row.images) {
      if (fileFor.has(key)) continue

      if (assembled.has(key)) {
        const { buf, mime } = assembled.get(key)
        // 副檔名照 mime 走，不要假設一定是 WebP —— 後台在 Safari 16.4
        // 以前的瀏覽器會退回 JPEG，那時存進 Sheet 的就是 JPEG 位元組。
        // 副檔名寫 .webp 而內容是 JPEG，多數瀏覽器會嗅探後照樣顯示，
        // 但那是「剛好能動」，不是對的
        const ext = MIME_EXT[mime] || 'webp'
        const alpha = ext === 'webp' ? webpHasAlpha(buf) : ext === 'png'
        const name = imageFileName(key, createHash('sha256').update(buf).digest('hex'), alpha, ext)
        for (const d of mediaDirs) await writeFile(join(d, name), buf)
        fileFor.set(key, name)
        stats.sheet++
        continue
      }

      if (legacy[key]) {
        const abs = join(ROOT, 'velora-frontend', 'public', legacy[key].replace(/^\//, ''))
        if (existsSync(abs)) {
          const buf = await readFile(abs)
          const sha = createHash('sha256').update(buf).digest('hex')
          const ext = legacy[key].split('.').pop().toLowerCase()
          // 既有素材沿用原本的判準：build-assets.py 會把沒有透明像素的圖
          // 轉存成 JPEG，所以 .png 就代表去背圖
          const name = imageFileName(key, sha, ext === 'png', ext)
          for (const d of mediaDirs) await copyFile(abs, join(d, name))
          fileFor.set(key, name)
          stats.legacy++
          continue
        }
      }

      stats.missing++
      // 在這裡記下來。下面那個迴圈會 delete row.images，
      // 等到最後才想找是哪幾張就找不到了 —— 錯誤訊息說不出哪裡壞，
      // 價值就少一半
      orphans.push(`${row.id} → ${key}`)
    }
  }

  // 把影像鍵換成實際檔名；沒有圖的留空，前台會顯示「製版中」空版
  for (const row of rows) {
    row.files = row.images.map((k) => fileFor.get(k) || null).filter(Boolean)
    delete row.images
  }

  // ── 輸出前再驗一次 ──────────────────────────────────────────────
  // 上面已經對原始 payload 驗過，這裡是針對「白名單之後又被加工過」的路徑：
  // 產生器日後長大時，中間可能出現新的合併或補值步驟。
  assertNoCost(rows, 'products.generated')

  // ── 寫檔 ────────────────────────────────────────────────────────
  /*
   * 產生時間可由 SOURCE_DATE_EPOCH（Unix 秒數）覆寫。
   *
   * 這不是為了「可重現建置」這種抽象的好處，是為了一個具體的驗收動作：
   * 遷移到 D1 之後要能證明「換了資料來源但輸出一個位元組都沒變」——
   *
   *   SOURCE_DATE_EPOCH=0 node tools/build-catalog.mjs --source apps   --out /tmp/a
   *   SOURCE_DATE_EPOCH=0 node tools/build-catalog.mjs --source worker --out /tmp/b
   *   diff -r /tmp/a /tmp/b
   *
   * 時間戳是這兩份輸出唯一會不同的地方。不釘住它，diff 就永遠有雜訊，
   * 而有雜訊的 diff 等於沒有 diff —— 真正的差異會被淹掉。
   */
  const epoch = process.env.SOURCE_DATE_EPOCH
  const stamp = epoch && /^\d+$/.test(epoch)
    ? new Date(Number(epoch) * 1000).toISOString()
    : new Date().toISOString()

  const banner = (what) =>
    `/**\n * ${what}\n *\n` +
    ` * 由 tools/build-catalog.mjs 從 Google Sheet 產生，請勿手動編輯 ——\n` +
    ` * 下次建置就會被覆蓋。要改內容請改 Sheet。\n` +
    ` *\n * 產生時間：${stamp}\n */\n\n`

  await writeFile(join(DATA, 'products.generated.js'),
    banner('商品資料（扁平欄位，由 catalog.js 組成前台要的形狀）') +
    'export default ' + JSON.stringify(rows, null, 2) + '\n', 'utf8')

  const site = {
    houses: (data.houses || []).filter((h) => !houseOff.has(str(h.key))).map((h) => ({
      key: str(h.key), name: str(h.name), nameKo: str(h.name_ko),
      country: { zh: str(h.country_zh), en: str(h.country_en), ko: str(h.country_ko) },
      tagline: str(h.tagline),
      intro: { zh: str(h.intro_zh), en: str(h.intro_en), ko: str(h.intro_ko) },
    })),
    categories: (data.categories || []).map((c) => ({
      key: str(c.key), code: str(c.code), ref: str(c.ref),
      // name 給前台導覽列（長）、short 給後台頁籤（短）。舊的 Sheet 沒有
      // short_* 三欄，退回 name_* —— 這樣舊表也不會產生空白頁籤
      name: { zh: str(c.name_zh), en: str(c.name_en), ko: str(c.name_ko) },
      short: {
        zh: str(c.short_zh) || str(c.name_zh),
        en: str(c.short_en) || str(c.name_en),
        ko: str(c.short_ko) || str(c.name_ko),
      },
      // 相對路徑存在 Sheet 裡，站台前綴由 catalog.js 的 url() 補
      cover: str(c.cover),
      order: Number(c.order) || 0,
      /*
       * 明細表兩列的標籤，逐品類不同。
       *
       * specLabel 留空就退回「規格」—— 舊的 Sheet 沒有這幾欄，
       * 不給預設值的話明細表會出現一列沒有名字的資料。
       * detailLabel 留空則整列不輸出：沒有名字的那一格沒有意義，
       * 而硬給一個「其他」之類的通用名等於什麼都沒說。
       */
      specLabel: {
        zh: str(c.spec_label_zh) || '規格',
        en: str(c.spec_label_en) || 'Spec',
        ko: str(c.spec_label_ko) || '사양',
      },
      detailLabel: {
        zh: str(c.detail_label_zh),
        en: str(c.detail_label_en),
        ko: str(c.detail_label_ko),
      },
    })).sort((a, b) => a.order - b.order),
  }
  assertNoCost(site, 'site.generated')
  await writeFile(join(DATA, 'site.generated.js'),
    banner('品牌與品類') +
    'export const houses = ' + JSON.stringify(site.houses, null, 2) + '\n\n' +
    'export const categories = ' + JSON.stringify(site.categories, null, 2) + '\n', 'utf8')

  // ── 摘要（走 stderr，不干擾管線）────────────────────────────────
  const byCat = {}
  rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1 })
  console.error('')
  console.error(`商品 ${rows.length} 件：` + Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join('、'))
  console.error(`上架 ${rows.filter((r) => r.listed).length} 件、精選 ${rows.filter((r) => r.featured).length} 件`)
  console.error(`影像 ${fileFor.size} 張（Sheet ${stats.sheet}、既有素材 ${stats.legacy}）` +
    (stats.missing ? `，${stats.missing} 個影像鍵找不到圖 → 顯示製版中空版` : ''))
  /*
   * 有影像鍵卻拿不到位元組 —— 這在畫面上會變成「圖片製版中」的空版，
   * 看起來像刻意的設計，實際上是資料掉了。接真端點時一律失敗。
   */
  if (stats.missing && !offline) {
    throw new Error(
      `有 ${stats.missing} 個影像鍵在 Sheet 的 images 分頁裡找不到位元組：\n  ` +
      orphans.slice(0, 10).join('\n  ') +
      `\n\n這些商品在網站上會變成「圖片製版中」的空版 —— 看起來像設計，其實是資料掉了。\n` +
      `到 Apps Script 執行 checkImages 看 Sheet 裡實際有幾張，缺的用 seedImages 或從後台補上。`)
  }

  const withPrice = rows.filter((r) => r.price !== undefined).length
  console.error(`售價：${withPrice} 件有輸出（其餘 price_public 未勾選，連欄位都不產生）`)
  console.error(`寫出 ${join(DATA, 'products.generated.js')}`)
  console.error(`寫出 ${join(DATA, 'site.generated.js')}`)
  console.error(`影像寫入 ${mediaDirs.join('  ')}`)
}

/*
 * 失敗時同時用 GitHub Actions 的 ::error:: 格式印一份。
 *
 * 沒有這一段的話，錯誤只留在原始日誌裡，而摘要頁與 API 只看得到
 * 「Process completed with exit code 1」—— 要查哪裡壞掉得點進去、
 * 展開步驟、往下捲。訊息寫得再清楚，看不到就等於沒寫。
 *
 * %0A 是 Actions 的換行跳脫；直接送 \n 會讓註記只剩第一行。
 */
main().catch((e) => {
  const msg = String((e && e.message) || e)
  console.error('\n✗ ' + msg)
  if (process.env.GITHUB_ACTIONS) {
    console.log('::error::' + msg.replace(/\r?\n/g, '%0A'))
  }
  process.exit(1)
})
