/**
 * 匯出端點的客戶端。建置、遷移、驗證三支腳本共用同一份。
 *
 * ══ 兩個來源，一種輸出 ═════════════════════════════════════════════
 *
 *   --source apps    Google Apps Script 的 /exec（現況）
 *   --source worker  Cloudflare Worker 的 /api/export（遷移目標）
 *   --from <path>    本機 JSON，離線開發用
 *
 * 三條路都回傳同一個形狀：{ src, data }。呼叫端不需要知道資料從哪來 ——
 * 這正是遷移期能「兩邊跑同一支 build-catalog、逐位元組比對輸出」的前提。
 *
 * ══ 為什麼兩邊的協定不一樣 ═════════════════════════════════════════
 *
 * Apps Script 有三條硬限制（見 apps-script/Code.gs 檔頭）：Content-Type
 * 只能是 text/plain、不得帶自訂標頭、images 必須分頁拉（單格 50,000 字元
 * 上限造成 chunk 切割）。Worker 一條都沒有，所以：
 *
 *   |              | Apps Script          | Worker                  |
 *   |--------------|----------------------|-------------------------|
 *   | Content-Type | text/plain           | application/json        |
 *   | 認證         | body 裡的 key        | key + Access service token 標頭 |
 *   | 影像         | base64 chunk 分頁    | 中繼資料一次拿，位元組逐張 GET  |
 *
 * 兩邊都跑同一道 sha256 端到端校驗，所以「搬家途中位元組被改掉」
 * 這件事在任一條路上都會被抓到。
 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { assembleImages } from './assemble.mjs'
import { bool, str } from './normalize.mjs'

/** 取 `--flag value` 形式的參數 */
export function arg(args, name) {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

/* ══ Apps Script ═══════════════════════════════════════════════════ */

async function loadFromAppsScript() {
  const url = process.env.EXEC_URL
  const key = process.env.CI_EXPORT_KEY
  if (!url || !key) {
    throw new Error(
      '需要 EXEC_URL 與 CI_EXPORT_KEY 兩個環境變數，或用 --from <fixture.json>。\n' +
      '離線開發請跑：node tools/build-catalog.mjs --from tools/fixture.json')
  }

  const post = async (body) => {
    // text/plain 是唯一能用的 Content-Type —— Apps Script 沒有 doOptions，
    // application/json 會觸發 preflight 而失敗。詳見 apps-script/Code.gs 檔頭。
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`匯出端點回 HTTP ${res.status}`)
    const j = await res.json()
    if (!j.ok) throw new Error(`匯出端點回 ${j.err}`)
    return j
  }

  const meta = await post({ op: 'export', key, part: 'meta' })

  // 影像分頁可能很大，分頁拉完
  const images = []
  for (let page = 0; ; page++) {
    const r = await post({ op: 'export', key, part: 'images', page, size: 40 })
    images.push(...r.images)
    if (!r.more) break
  }
  meta.images = images
  return { src: url.replace(/\/[^/]+$/, '/…'), data: meta }
}

/* ══ Cloudflare Worker ═════════════════════════════════════════════ */

async function loadFromWorker() {
  const url = (process.env.API_URL || '').replace(/\/$/, '')
  const key = process.env.CI_EXPORT_KEY
  if (!url || !key) {
    throw new Error('需要 API_URL 與 CI_EXPORT_KEY 兩個環境變數')
  }

  /*
   * Access 的 service token。
   *
   * /api/export 由一個獨立的 Access 應用保護，政策只收 service token ——
   * 刻意不跟 /api 共用一個應用：共用的話這把存在 CI secret 裡的 token
   * 就等於整套後台的寫入權限。
   *
   * 缺 token 時不要「試試看再說」—— 沒有它必定被 Access 擋下，
   * 而 Access 回的是登入頁的 HTML，症狀會變成看不懂的 JSON 解析失敗。
   */
  const cid = process.env.CF_ACCESS_CLIENT_ID
  const csec = process.env.CF_ACCESS_CLIENT_SECRET
  if (!cid || !csec) {
    throw new Error(
      '需要 CF_ACCESS_CLIENT_ID 與 CF_ACCESS_CLIENT_SECRET。\n' +
      '沒有它們的話請求會被 Access 擋下並回傳登入頁的 HTML，\n' +
      '症狀會是看不懂的 JSON 解析失敗，而不是「沒有權限」。')
  }
  const headers = {
    'Content-Type': 'application/json',
    'CF-Access-Client-Id': cid,
    'CF-Access-Client-Secret': csec,
  }

  const post = async (path, body) => {
    const res = await fetch(url + path, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      // 把前 200 字帶出來。Access 擋下時回的是 HTML，
      // 看到 <!DOCTYPE 就知道是 token 的問題而不是端點的問題
      throw new Error(`匯出端點回 HTTP ${res.status}：${text.slice(0, 200)}`)
    }
    let j
    try { j = JSON.parse(text) } catch {
      throw new Error(`匯出端點回了不是 JSON 的東西：${text.slice(0, 200)}`)
    }
    if (!j.ok) throw new Error(`匯出端點回 ${j.err}`)
    return j
  }

  const meta = await post('/export', { key, part: 'meta' })
  const idx = await post('/export', { key, part: 'images' })

  /*
   * 影像的位元組逐張 GET，不再塞在 JSON 裡。
   *
   * Sheet 時代必須 base64（試算表只能存文字），R2 沒有這個限制。
   * 逐張拉同時讓 sha256 校驗變得更直接：比對的是「R2 實際吐出來的位元組」
   * 對上「資料庫記的雜湊」，中間沒有 base64 編解碼這一層可以出錯。
   */
  const images = new Map()
  for (const m of idx.images || []) {
    const k = str(m.key)
    if (!k) continue
    const res = await fetch(`${url}/img/${encodeURIComponent(k)}`, { headers })
    if (!res.ok) throw new Error(`影像 ${k} 取不到位元組：HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const sha = createHash('sha256').update(buf).digest('hex')
    const want = str(m.sha256)
    if (want && sha !== want) {
      throw new Error(`影像 ${k} 雜湊不符：資料庫記 ${want.slice(0, 12)}…，實得 ${sha.slice(0, 12)}…`)
    }
    images.set(k, { buf, sha, alpha: bool(m.alpha), mime: str(m.mime) || 'image/webp' })
  }

  // data.images 保留原始中繼資料清單（給需要 thumb / bytes 的呼叫端），
  // 位元組另外放 images 這個 Map —— 與 assembleImages 的回傳型別相同
  meta.images = idx.images || []
  return { src: url, data: meta, images }
}

/* ══ 對外 ══════════════════════════════════════════════════════════ */

/**
 * 讀一份完整的目錄資料。
 *
 * 回傳 { src, data, images }：
 *   src     人看的來源描述，印在建置日誌裡
 *   data    { products, houses, categories, images(中繼資料) }
 *   images  Map<key, { buf, sha, alpha, mime }>，位元組
 */
export async function load(args = []) {
  const from = arg(args, '--from')
  if (from) {
    const data = JSON.parse(await readFile(from, 'utf8'))
    return { src: from, data, images: assembleImages(data.images || []) }
  }

  const source = arg(args, '--source') || process.env.CATALOG_SOURCE || 'apps'
  if (source === 'worker') return loadFromWorker()
  if (source === 'apps') {
    const r = await loadFromAppsScript()
    return { ...r, images: assembleImages(r.data.images || []) }
  }
  throw new Error(`不認得的 --source：${source}（只能是 apps 或 worker）`)
}
