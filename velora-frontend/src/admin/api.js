/**
 * 後台的傳輸層。**全專案只有這個檔案直接呼叫 fetch。**
 *
 * ══ 2026-09-28：從 Google Apps Script 搬到同源的 Worker ═══════════
 *
 * 後端現在是 velora-frontend/worker/admin.js，資料在 Cloudflare D1。
 * op 名稱與回應形狀刻意跟舊後端一模一樣 —— 四個面板一行都沒有改。
 * 搬後端跟改 UI 是兩件事，混在一起就分不出是誰弄壞的。
 *
 * 三條限制跟著 Apps Script 一起消失了，這裡記下來是因為它們的痕跡
 * 還留在程式碼的形狀裡，日後有人會想「為什麼不用標頭帶令牌」：
 *
 *   1. 以前每個請求都必須是 CORS simple request（Apps Script 沒有
 *      doOptions 可以回應 preflight），所以 Content-Type 只能是
 *      text/plain、不得帶任何自訂標頭。**現在同源，兩者都解除了** ——
 *      下面已經改回 application/json。
 *   2. 以前不能設回應標頭，所以不能用 cookie 發 session。現在可以，
 *      但令牌仍然放在 body 裡：改成 cookie 要一併處理 CSRF，
 *      而那是另一件事，不順手做。
 *   3. 以前 /exec 一定 302 轉址，CSP 要列兩個 Google 網域。現在不用了。
 *
 * ══ 不再需要 VITE_EXEC_URL ═════════════════════════════════════════
 *
 * 端點是同源的固定路徑，沒有建置期變數。之前 build:worker 沒有帶
 * VITE_EXEC_URL，後台一打開就是「沒有設定端點網址」——
 * 一個只在部署後才會出現的錯誤，本機開發永遠看不到。
 */

const EXEC = '/api/admin'

/** 呼叫失敗的統一形狀。UI 只看 code，訊息給人看 */
export class ApiError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** 錯誤碼 → 給人看的中文。看不懂的錯誤訊息等於沒有錯誤訊息 */
const MESSAGES = {
  network: '連不上伺服器。檢查網路，或 Worker 是否還在部署中。',
  'bad-json': '伺服器回了看不懂的東西。通常是 Worker 拋了未捕捉的例外，或路由沒對到 /api/admin。',
  busy: '伺服器正忙，請幾秒後再試。',
  locked: '暫時無法登入，請稍後再試。',
  'bad-pw': '密碼不正確。',
  'not-initialised': '後台密碼還沒設定。執行 node tools/d1-seed.mjs --pw "密碼" 並灌進 D1。',
  auth: '登入已失效，請重新登入。',
  'bad-op': '這個版本的後端不認得這個操作，可能是部署版本太舊。',
  invalid: '有欄位沒有通過檢查。',
  'not-found': '找不到這件商品。',
  'write-failed': '寫入後讀回來對不上，資料可能沒存進去。請再試一次。',
  incomplete: '影像資料不完整，可能上傳到一半中斷了。',
  // 這幾個以前沒有對應的中文，畫面上只會顯示「未預期的錯誤：bad-key」。
  // 一個看不懂的錯誤碼等於沒有錯誤訊息 —— 使用者不知道要去改哪裡
  'bad-key': '影像鍵不合法。它是用商品編號組的，編號只能是小寫英數與連字號。',
  'bad-product': '送出的商品資料格式不對。',
  'no-key': '沒有指定影像鍵。',
  'no-id': '沒有指定商品編號。',
  'no-data': '沒有收到影像資料。',
  'bad-house': '品牌資料的格式不對。',
  'too-many': '品牌數量已達上限。',
  'house-in-use': '還有商品掛著這個品牌，不能刪。',
  'id-taken': '這個商品編號已經有人用了（不分大小寫，也包含已刪除的商品）。',
  'key-taken': '改名後的影像鍵已經存在，會蓋掉別人的圖，所以停下來了。',
  'not-found': '找不到這件商品。',
  server: '伺服器發生未預期的錯誤。',
}

export const describe = (code, fallback) => MESSAGES[code] || fallback || `未預期的錯誤：${code}`

/**
 * 發一個請求。
 *
 * 逾時用 AbortController 而不是 Promise.race —— race 只是不再等，
 * 那個請求仍然在背景跑完，連按幾次就會累積一堆看不見的在途請求。
 */
export async function call(op, body = {}, { timeout = 45000 } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)

  let res
  try {
    res = await fetch(EXEC, {
      method: 'POST',
      // 同源，沒有 preflight 的問題了（Apps Script 時代這裡只能是 text/plain）
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...body }),
      signal: ctl.signal,
    })
  } catch (e) {
    throw new ApiError('network', e.name === 'AbortError'
      ? '等太久了，伺服器沒有回應。' : describe('network'))
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // 路由沒對到時 Worker 會回 index.html（SPA fallback），那是一份 HTML。
    // 把開頭幾個字帶出來，否則畫面上只會寫「失敗」，沒有人知道發生什麼事
    throw new ApiError('bad-json', describe('bad-json'), text.slice(0, 200))
  }

  if (!json.ok) {
    throw new ApiError(json.err || 'server', describe(json.err), json.detail || json.reason || json.hint)
  }
  return json
}

/* ── 各端點的薄包裝。UI 不直接拼 op 字串 ─────────────────────────── */

export const ping = () => call('ping', { echo: Date.now() })
export const login = (pw) => call('login', { pw })
export const renew = (token) => call('renew', { token })
export const list = (token) => call('list', { token })
export const save = (token, product) => call('save', { token, product })
export const remove = (token, id, restore = false) => call('delete', { token, id, restore })
export const getImage = (token, key) => call('image', { token, key }, { timeout: 90000 })
/**
 * 中繼資料（鍵、sha、mime、alpha、bytes）加 96px 縮圖，不回原圖位元組。
 * 23 張連同縮圖約 40KB —— 後台清單靠這一次請求就把整頁的圖畫完。
 */
export const imageIndex = (token) => call('imageIndex', { token })
/** 回填既有影像的縮圖。只寫 thumb 欄，不動位元組 */
export const saveThumb = (token, key, thumb) => call('saveThumb', { token, key, thumb })
export const putImage = (token, payload) => call('upload', { token, ...payload }, { timeout: 120000 })
/*
 * publish 與 status 2026-09-28 移除。
 *
 * 資料在 D1，後台按儲存的那一刻網站就改了 —— 沒有「發布」這個步驟，
 * 也就沒有建置狀態可以查。留著一顆按了沒反應的按鈕比沒有按鈕更糟：
 * 使用者會以為自己沒存成功，然後重複按。
 */

/* 品牌。上限四家由伺服器擋，前端只是先攔一次讓錯誤來得早一點 */
/** 改商品編號。伺服器會連影像鍵一起搬，所以圖片不會失聯 */
export const renameId = (token, from, to) => call('renameId', { token, from, to }, { timeout: 90000 })

export const saveHouse = (token, house) => call('saveHouse', { token, house })
export const deleteHouse = (token, key) => call('deleteHouse', { token, key })
