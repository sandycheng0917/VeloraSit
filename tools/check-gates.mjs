#!/usr/bin/env node
/**
 * 發布前的稽核關卡。任何一道沒過就不該上線。
 *
 *   node tools/check-gates.mjs
 *   node tools/check-gates.mjs --dist velora-frontend/dist
 *   node tools/check-gates.mjs --api https://velorasit.chenghsuanno1.workers.dev
 *
 * ── 為什麼從 workflow 搬進腳本 ──────────────────────────────────────
 *
 * 原本這七道寫在 .github/workflows/deploy.yml 的 run: 區塊裡。站台搬到
 * Cloudflare 之後那個檔案刪掉了，關卡跟著一起消失 —— 包括成本誘餌那道，
 * 也就是 B2B 機密外洩的主防線。
 *
 * 寫成腳本還有兩個好處：本機發布前跑得動（以前只有 CI 跑得到，
 * 你在本機根本無從檢查），而且只有一份 —— 兩個部署目標各抄一份的話，
 * 漂移是靜默的：某一邊的誘餌關卡被改壞，另一邊照樣綠燈，
 * 你要等到成本真的外洩才會知道哪一份才是實際在跑的那份。
 *
 * ── 🔴 每一關都要能失敗 ────────────────────────────────────────────
 *
 * 只會通過的關卡等於沒有關卡 —— 你分不出它是真的在檢查，
 * 還是條件寫錯了永遠回傳空。所以：
 *   · 關卡 2 是關卡 1 的反向控制（空的 admin 會讓關卡 1 無條件通過）
 *   · 關卡 3 缺環境變數時**失敗**，不是跳過
 *   · 關卡 6 是關卡 3 的補網（誘餌列被誤刪時還擋得住）
 *
 * ── 環境變數 ────────────────────────────────────────────────────────
 *
 *   COST_CANARY   必要　products_private 第 2 列 B 欄的誘餌字串
 *   SHEET_ID      選用　有給才跑關卡 4
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (n) => {
  const i = args.indexOf(n)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}

const DIST_REL = arg('--dist') || join('velora-frontend', 'dist')
const DIST = join(ROOT, DIST_REL)
const API = arg('--api')

let failed = 0
const pass = (n, msg) => console.log(`  ${n}／7　✓ ${msg}`)
const fail = (n, msg) => {
  console.error(`  ${n}／7　✗ ${msg}`)
  failed++
}

/** 列出目錄下所有檔案的相對路徑（正斜線） */
async function walk(dir, base = dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) await walk(full, base, acc)
    else acc.push(relative(base, full).split(sep).join('/'))
  }
  return acc
}

/**
 * 在輸出裡找字串或樣式。
 *
 * 🔴 用 Buffer 比對而不是逐行 grep。原本的 workflow 用 `grep -r`，
 *    而 GNU grep 預設把二進位檔當成「binary file matches」印一行就算 ——
 *    但 -l 模式下它仍然會回報，所以舊版擋得住。這裡明確讀進 Buffer
 *    再比對，是為了讓「.webp 的中繼資料裡塞了供應商電話」這種情況
 *    也一定被抓到。誘餌關卡的整個意義就是「只要洩漏路徑存在就必然被抓到」。
 */
async function scan(files, needles, { exclude = [] } = {}) {
  const hits = []
  for (const f of files) {
    if (exclude.some((d) => f === d || f.startsWith(d + '/'))) continue
    const buf = await readFile(join(DIST, f))
    for (const needle of needles) {
      const found =
        needle instanceof RegExp
          ? needle.test(buf.toString('utf8'))
          : buf.includes(Buffer.from(needle, 'utf8'))
      if (found) hits.push(`${f}（${needle}）`)
    }
  }
  return hits
}

const CRED_SHAPES =
  /AIza[0-9A-Za-z_-]{30,}|ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{50,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com|cik_[0-9a-f]{32}/
const COST_SHAPE = /"(cost|cost_ccy|fob|unit_price|supplier_note)"\s*:/

async function main() {
  console.log(`\n稽核關卡　輸出目錄：${DIST_REL}`)
  console.log('─'.repeat(64))

  if (!existsSync(DIST)) {
    console.error(`\n✗ 找不到 ${DIST_REL} —— 先跑 npm run build:worker`)
    process.exit(1)
  }
  const files = await walk(DIST)
  if (!files.length) {
    console.error(`\n✗ ${DIST_REL} 是空的`)
    process.exit(1)
  }

  /* ── 1 ── 對外站台就是輸出扣掉 admin/。admin 自己有一道正向的關卡 2 */
  const leak = await scan(files, ['商品管理', 'vadmin', '出口單價'], { exclude: ['admin'] })
  leak.length
    ? fail(1, `後台字串出現在對外站台 —— ${leak.slice(0, 5).join('、')}`)
    : pass(1, '對外站台不含後台')

  /* ── 2 ── 反向控制。沒有這道，一個空的 admin 目錄會讓關卡 1 無條件通過 */
  const adminFiles = files.filter((f) => f.startsWith('admin/'))
  if (!adminFiles.length) {
    fail(2, 'admin/ 目錄不存在 —— 後台根本沒建出來')
  } else {
    const found = await scan(adminFiles, ['商品管理'])
    found.length
      ? pass(2, `admin 確實含有後台（${adminFiles.length} 個檔案）`)
      : fail(2, 'admin 目錄裡找不到後台字串 —— 後台可能根本沒建出來')
  }

  /* ── 3 ── 最強的一關：把「成本有沒有洩漏」從啟發式猜測變成確定性測試。
             只要洩漏路徑存在，誘餌必然跟著洩漏。 */
  const canary = process.env.COST_CANARY
  if (!canary) {
    fail(
      3,
      '沒有設定 COST_CANARY，這是成本外洩的主要防線，不允許跳過。\n' +
        '        誘餌字串在 Sheet 的 products_private 第 2 列 B 欄。\n' +
        '        本機：export COST_CANARY="…"（PowerShell 用 $env:COST_CANARY="…"）\n' +
        '        Cloudflare：Settings → Build → Variables 加一個同名變數'
    )
  } else {
    const hit = await scan(files, [canary])
    hit.length
      ? fail(3, `誘餌字串出現在輸出裡 —— 成本資料正在外洩：${hit.slice(0, 3).join('、')}`)
      : pass(3, '誘餌沒有出現')
  }

  /* ── 4 ── 選用。沒設 SHEET_ID 就跳過，而且要說出來 ——
             靜悄悄跳過的關卡會被誤記成「通過了」 */
  if (process.env.SHEET_ID) {
    const hit = await scan(files, [process.env.SHEET_ID])
    hit.length ? fail(4, `試算表 ID 出現在輸出裡：${hit[0]}`) : pass(4, '試算表 ID 沒有出現')
  } else {
    console.log('  4／7　－ 略過：沒有設定 SHEET_ID（選用）')
  }

  /* ── 5 ── */
  const creds = await scan(files, [CRED_SHAPES])
  creds.length
    ? fail(5, `輸出裡出現看起來像憑證的字串：${creds.slice(0, 3).join('、')}`)
    : pass(5, '沒有憑證形狀的字串')

  /* ── 6 ── 關卡 3 的補網：誘餌列如果被誤刪，這一關還擋得住 */
  const costs = await scan(files, [COST_SHAPE], { exclude: ['admin'] })
  costs.length
    ? fail(6, `輸出裡出現成本欄位：${costs.slice(0, 3).join('、')}`)
    : pass(6, '沒有成本欄位')

  /* ── 7 ── 取代已退場的「velora2 原始檔沒被弄髒」。
   *
   * 🔴 那道關卡在的時候，商品資料是建置時烤進輸出的，所以掃靜態檔就等於
   *    掃了使用者會看到的全部內容。2026-09-28 資料改成執行時從 D1 取 ——
   *    關卡 1～6 掃 dist/ 再也看不到商品資料了。
   *
   *    換句話說，前六道關卡的涵蓋範圍在那天縮水了，而沒有任何東西會提醒你。
   *    這一道把稽核補回資料真正流出去的那條路：打線上的 API，
   *    對回應本身跑同一套成本檢查。
   */
  if (!API) {
    console.log('  7／7　－ 略過：沒有給 --api（發布後請補跑一次）')
  } else {
    try {
      const res = await fetch(`${API.replace(/\/$/, '')}/api/catalog`, {
        headers: { accept: 'application/json' },
      })
      const text = await res.text()
      if (!res.ok) {
        fail(7, `API 回 HTTP ${res.status}：${text.slice(0, 200)}`)
      } else {
        const bad = []
        if (canary && text.includes(canary)) bad.push('誘餌字串')
        if (COST_SHAPE.test(text)) bad.push('成本欄位')
        if (CRED_SHAPES.test(text)) bad.push('憑證形狀')
        if (process.env.SHEET_ID && text.includes(process.env.SHEET_ID)) bad.push('試算表 ID')
        bad.length
          ? fail(7, `API 回應裡出現 ${bad.join('、')} —— 成本或機密正在從資料庫外洩`)
          : pass(7, `API 回應乾淨（${(text.length / 1024).toFixed(1)} KB）`)
      }
    } catch (e) {
      fail(7, `打不到 API：${(e && e.message) || e}`)
    }
  }

  console.log('─'.repeat(64))
  if (failed) {
    console.error(`\n✗ ${failed} 道關卡沒過，中止發布。\n`)
    process.exit(1)
  }
  console.log('\n✓ 全部通過\n')
}

main().catch((e) => {
  console.error('\n✗ ' + ((e && e.stack) || e))
  process.exit(1)
})
