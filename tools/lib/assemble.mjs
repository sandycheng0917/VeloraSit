/**
 * 影像位元組的組裝與命名。建置、遷移、驗證三支腳本共用。
 *
 * 為什麼抽出來：chunk 組裝裡有一個 'w:' 前綴的剝除步驟，以及一道
 * 端到端的 sha256 校驗。複製三份的話，前綴那一步遲早有一份寫漏 ——
 * 而症狀是網站破圖，不是任何一支腳本報錯。
 */
import { createHash } from 'node:crypto'
import { bool, str } from './normalize.mjs'

/** mime → 副檔名。Sheet 的 images 分頁有 mime 欄，那是唯一可靠的來源 */
export const MIME_EXT = {
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
}

/**
 * 把 images 分頁的列組回檔案。
 *
 * 一個 key 可能拆成多個 chunk（Sheet 單格上限 50,000 字元），
 * 依 chunk 序號串接。data 欄有 'w:' 前綴要剝掉 —— 那是為了避開
 * Google Sheets 把 + - = 開頭的儲存格當公式解析。
 *
 * 回傳 Map<key, { buf, sha, alpha, mime }>。
 *
 * 遷移到 D1 + R2 之後這個格式就不存在了（R2 沒有儲存格上限，
 * 位元組整份存），但這支仍然要留著：遷移腳本正是靠它把舊資料讀出來。
 */
export function assembleImages(rows) {
  const byKey = new Map()
  for (const r of rows) {
    const key = str(r.key)
    if (!key) continue
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(r)
  }

  const out = new Map()
  for (const [key, parts] of byKey) {
    parts.sort((a, b) => Number(a.chunk) - Number(b.chunk))
    const total = Number(parts[0].total || parts.length)
    if (parts.length !== total) {
      throw new Error(`影像 ${key} 的 chunk 不完整：有 ${parts.length} 段，宣告 ${total} 段`)
    }
    const b64 = parts.map((p) => {
      const d = String(p.data || '')
      if (!d.startsWith('w:')) throw new Error(`影像 ${key} 的 data 少了 w: 前綴`)
      return d.slice(2)
    }).join('')

    const buf = Buffer.from(b64, 'base64')
    const sha = createHash('sha256').update(buf).digest('hex')
    const want = str(parts[0].sha256)
    // 端到端校驗：chunk 順序錯亂、遺漏、被 Sheets 改寫，都在這裡被抓到，
    // 而不是變成網站上的破圖
    if (want && sha !== want) {
      throw new Error(`影像 ${key} 雜湊不符：Sheet 記 ${want.slice(0, 12)}…，實得 ${sha.slice(0, 12)}…`)
    }
    out.set(key, { buf, sha, alpha: bool(parts[0].alpha), mime: str(parts[0].mime) || 'image/webp' })
  }
  return out
}

/**
 * WebP 容器有沒有 alpha 通道。零依賴，直接讀標頭。
 *
 * 判定 alpha 是為了決定要不要套 .plate.is-cutout（去背圖用 contain、
 * 淺底、不壓暗角）。前台原本靠副檔名 .png 判斷，換成 WebP 之後那招失效，
 * 所以改成把判定結果編進檔名（.cut.webp）。
 *
 * 以這裡讀出來的為準，不信來源記的 alpha 欄 —— 瀏覽器端的偵測可能因為
 * canvas 被跨域污染而失敗。
 */
export function webpHasAlpha(buf) {
  if (buf.length < 32) return false
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') return (buf[20] & 0x10) !== 0   // 擴充格式的 ALPHA flag
  if (fourcc === 'VP8 ') return false                    // 有損簡單格式，定義上無 alpha
  if (fourcc === 'VP8L') return ((buf[24] >> 4) & 1) !== 0
  return false
}

/**
 * 檔名用內容定址：<id>-<slot>-<sha8>[.cut].webp
 *
 * 內容沒變 → 檔名沒變 → 瀏覽器與 CDN 完全命中快取。
 * 內容變了 → 檔名必變 → 立刻失效。
 *
 * 在 GitHub Pages 上這是唯一的快取控制手段（它硬送 max-age=600，
 * 固定檔名的圖片改版後最多要等十分鐘）。搬到 Cloudflare 之後就能
 * 直接對 /assets/media/* 宣告 immutable —— 但檔名規則不要跟著改，
 * 後台的 imgurl.js 是靠同一條規則自己算出網址的。
 */
export function imageFileName(key, sha, alpha, ext = 'webp') {
  return `${key}-${sha.slice(0, 8)}${alpha ? '.cut' : ''}.${ext}`
}
