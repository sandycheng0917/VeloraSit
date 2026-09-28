/**
 * 後台 API。取代原本整套 Google Apps Script 後端。
 *
 * ── 介面刻意不變 ────────────────────────────────────────────────────
 *
 * 前端只有 src/admin/api.js 一個檔案直接 fetch，而它送的是
 * `{ op, ...body }`、期待 `{ ok, ... }`。所以這裡照著同一組 op 名稱與
 * 回應形狀實作 —— 四個面板（AdminView / ListPane / EditPane / HousePane）
 * 一行都不用改。搬後端跟改 UI 是兩件事，混在一起就分不出是誰弄壞的。
 *
 * ── 跟 Apps Script 的差異 ───────────────────────────────────────────
 *
 * 少了三條限制。Apps Script 沒有 doOptions（所以只能用 text/plain）、
 * 不能設回應標頭（所以不能用 cookie）、/exec 一定 302 轉址（所以 CSP
 * 要列兩個網域）。現在後台跟 API 同源，那三條全部消失。
 *
 * 多了一件事要自己做：**祕密現在在 D1 裡**（admin_state）。
 * 🔴 那張表沒有任何讀取端點，下面每一個 op 都不回傳它的內容。
 *    新增 op 的時候不要為了除錯「先把 state 印出來看看」。
 */

const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => new Uint8Array(String(s).match(/.{1,2}/g).map((b) => parseInt(b, 16)))

const TOKEN_MS = 8 * 60 * 60 * 1000      // 令牌 8 小時
const RENEW_MS = 30 * 60 * 1000          // 剩不到 30 分鐘才換新的
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
// 🔴 10 萬是 Cloudflare Workers 的硬上限，超過會回
//    "Pbkdf2 failed: iteration counts above 100000 are not supported"。
//    實際輪數存在 admin_state.pw_iters（產生密碼時寫入），這裡只是後備值。
const PW_ITERS_DEFAULT = 100000

const ok = (o = {}) => Response.json({ ok: true, ...o })
const err = (code, extra = {}) => Response.json({ ok: false, err: code, ...extra })

/* ── 狀態 ─────────────────────────────────────────────────────────── */

async function state(db, key) {
  const r = await db.prepare('SELECT value FROM admin_state WHERE key = ?').bind(key).first()
  return r ? r.value : null
}
async function setState(db, key, value) {
  await db
    .prepare('INSERT INTO admin_state (key, value, updated) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated')
    .bind(key, String(value), new Date().toISOString())
    .run()
}

/** 出事時這是唯一的鑑識依據，所以寫入失敗也不能拖垮主流程 */
async function audit(db, op, good, note) {
  try {
    await db
      .prepare('INSERT INTO audit (at, op, ok, note) VALUES (?, ?, ?, ?)')
      .bind(new Date().toISOString(), op, good ? 1 : 0, String(note || '').slice(0, 500))
      .run()
  } catch {
    /* 記不成就算了，不要因為記帳失敗而讓使用者的操作失敗 */
  }
}

/* ── 密碼與令牌 ───────────────────────────────────────────────────── */

async function pbkdf2(pw, saltHex, iters) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unhex(saltHex), iterations: iters, hash: 'SHA-256' },
    key,
    256
  )
  return hex(bits)
}

async function hmac(msg, secretHex) {
  const key = await crypto.subtle.importKey(
    'raw', unhex(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

/** 定時比較。長度不同也要走完，不要提早回傳 */
function ctEq(a, b) {
  const x = String(a), y = String(b)
  if (x.length !== y.length) {
    // 長度不同就一定不相等，但仍然做一次等量的工作再回傳
    let z = 0
    for (let i = 0; i < x.length; i++) z |= x.charCodeAt(i)
    return false
  }
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))

async function issue(db) {
  const secret = await state(db, 'hmac_secret')
  const epoch = Number(await state(db, 'token_epoch')) || 1
  const exp = Date.now() + TOKEN_MS
  const payload = b64url(JSON.stringify({ exp, epoch }))
  return { token: payload + '.' + (await hmac(payload, secret)), exp }
}

/**
 * 驗令牌。
 *
 * 🔴 epoch 對不上就整批失效。密碼外洩時把 token_epoch +1，
 *    所有已發出的 8 小時令牌立刻作廢 —— 不必等它們自己過期。
 */
async function verify(db, token) {
  const t = String(token || '')
  const dot = t.indexOf('.')
  if (dot < 1) return null
  const payload = t.slice(0, dot)
  const sig = t.slice(dot + 1)
  const secret = await state(db, 'hmac_secret')
  if (!secret) return null
  if (!ctEq(sig, await hmac(payload, secret))) return null
  let p
  try {
    p = JSON.parse(unb64url(payload))
  } catch {
    return null
  }
  if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null
  const epoch = Number(await state(db, 'token_epoch')) || 1
  if (Number(p.epoch) !== epoch) return null
  return p
}

/* ── 正規化 ───────────────────────────────────────────────────────── */

const str = (v) =>
  v === null || v === undefined || typeof v === 'boolean' ? '' : String(v).trim()
const bool = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE'
const bit = (v) => (bool(v) || v === 1 ? 1 : 0)

const TRI = ['name', 'tagline', 'desc', 'material', 'spec', 'detail']
const NOTES = ['notes_top', 'notes_mid', 'notes_base']
const TEXT_COLS = [
  ...TRI.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
  ...NOTES.flatMap((f) => [`${f}_zh`, `${f}_en`, `${f}_ko`]),
]
const P_COLS = [
  'id', 'ref', 'category', 'house', 'hs', 'origin',
  'listed', 'featured', 'deleted', 'order', 'updated',
  'price', 'price_public', 'img_main', 'img_2', 'img_3',
  ...TEXT_COLS,
]

/** D1 的 0/1 轉回布林 —— 面板讀的是 Sheet 的核取方塊語意 */
function rowOut(r) {
  const o = {}
  for (const c of P_COLS) o[c] = r[c] === undefined || r[c] === null ? '' : r[c]
  o.listed = r.listed === 1
  o.featured = r.featured === 1
  o.deleted = r.deleted === 1
  o.price_public = r.price_public === 1
  o.price = r.price === null || r.price === undefined ? '' : r.price
  o.order = r.order ?? 0
  return o
}

/** 影像鍵只能是小寫英數與連字號 —— 它會變成檔名的一部分 */
const KEY_RE = /^[a-z0-9-]+$/
/** 商品編號同理，而且 renameId 會用它重組影像鍵 */
const ID_RE = /^[a-z0-9-]+$/

/* ── base64 ↔ bytes ───────────────────────────────────────────────── */

function b64ToBytes(b64) {
  const bin = atob(String(b64))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(buf) {
  const u8 = new Uint8Array(buf)
  let bin = ''
  // 分塊避免 apply 的引數上限（大圖會直接 RangeError）
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/* ══ 各 op ═══════════════════════════════════════════════════════════ */

const OPS = {
  async ping(db, b) {
    return ok({ ver: 'worker-1', at: new Date().toISOString(), ops: Object.keys(OPS).sort(), echo: b.echo ?? null })
  },

  /**
   * 密碼 → 令牌。連續失敗五次鎖十五分鐘。
   *
   * 🔴 鎖定期間直接回，不做密碼比對 —— 省下 PBKDF2 的成本，
   *    也避免鎖定期間被當成「密碼對不對」的問答機。
   */
  async login(db, b) {
    const lockUntil = Number(await state(db, 'lock_until')) || 0
    if (lockUntil > Date.now()) return err('locked')

    const salt = await state(db, 'pw_salt')
    const want = await state(db, 'pw_hash')
    if (!salt || !want) return err('not-initialised')

    const iters = Number(await state(db, 'pw_iters')) || PW_ITERS_DEFAULT
    const got = await pbkdf2(String(b.pw || ''), salt, iters)

    if (!ctEq(got, want)) {
      const fails = (Number(await state(db, 'fail_count')) || 0) + 1
      await setState(db, 'fail_count', fails)
      if (fails >= MAX_FAILS) {
        await setState(db, 'lock_until', Date.now() + LOCK_MS)
        await setState(db, 'fail_count', 0)
        await audit(db, 'login', false, `連續 ${MAX_FAILS} 次失敗，鎖定 15 分鐘`)
        return err('locked')
      }
      await audit(db, 'login', false, `密碼錯誤（第 ${fails} 次）`)
      return err('bad-pw')
    }

    await setState(db, 'fail_count', 0)
    await setState(db, 'lock_until', 0)
    const t = await issue(db)
    await audit(db, 'login', true, '')
    return ok(t)
  },

  async renew(db, b) {
    const p = await verify(db, b.token)
    if (!p) return err('auth')
    // 還很久就原樣退回，不要每次心跳都換一把新令牌
    if (p.exp - Date.now() > RENEW_MS) return ok({ token: b.token, exp: p.exp })
    return ok(await issue(db))
  },

  /** 後台要看得到全部，包含未上架與軟刪除的 —— 那是它跟前台的差別 */
  async list(db) {
    const [p, c, h] = await Promise.all([
      db.prepare(`SELECT *, "order" AS "order" FROM products ORDER BY "order" ASC, id ASC`).all(),
      db.prepare(`SELECT * FROM categories ORDER BY "order" ASC, key ASC`).all(),
      db.prepare(`SELECT * FROM houses ORDER BY "order" ASC, key ASC`).all(),
    ])
    return ok({
      products: p.results.map(rowOut),
      categories: c.results.map((r) => ({ ...r, order: r.order ?? 0 })),
      houses: h.results.map((r) => ({ ...r, listed: r.listed === 1, order: r.order ?? 0 })),
    })
  },

  async save(db, b) {
    const p = b.product
    if (!p || typeof p !== 'object') return err('bad-product')
    const id = str(p.id).toLowerCase()
    if (!id) return err('no-id')
    if (!ID_RE.test(id)) return err('bad-product', { detail: '編號只能是小寫英數與連字號' })

    const cols = ['id', 'ref', 'category', 'house', 'hs', 'origin', '"order"', 'updated',
      'listed', 'featured', 'deleted', 'price', 'price_public',
      'img_main', 'img_2', 'img_3', ...TEXT_COLS]
    const vals = [
      id, str(p.ref), str(p.category), str(p.house), str(p.hs), str(p.origin) || 'KR',
      Number(p.order) || 0, new Date().toISOString().slice(0, 10),
      bit(p.listed), bit(p.featured), bit(p.deleted),
      // price 與 price_public 各存各的。「填了價格但先不公開」是有效狀態，
      // 把 price 壓成 NULL 會在下次打開編輯頁時把數字弄丟。
      str(p.price) === '' ? null : Number(p.price),
      bit(p.price_public),
      str(p.img_main), str(p.img_2), str(p.img_3),
      ...TEXT_COLS.map((c) => str(p[c])),
    ]

    await db
      .prepare(
        `INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
        `ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`
      )
      .bind(...vals)
      .run()

    // 🔴 寫完讀回來確認。D1 的寫入是成功回報的，但「成功寫了一列
    //    但欄位對不上」這種錯（型別被 CHECK 擋掉、欄名打錯）會靜悄悄過去。
    const back = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()
    if (!back) return err('write-failed')

    await audit(db, 'save', true, id)
    return ok({ id, product: rowOut(back) })
  },

  /**
   * 軟刪除。不真的刪列：id 永不回收。
   * 真刪掉的話，日後有人建一件同名商品，舊的影像鍵、外部連結、
   * 搜尋引擎的索引會全部指向新的那件東西。
   */
  async delete(db, b) {
    const id = str(b.id).toLowerCase()
    if (!id) return err('no-id')
    const r = await db
      .prepare('UPDATE products SET deleted = ?, updated = ? WHERE id = ?')
      .bind(b.restore ? 0 : 1, new Date().toISOString().slice(0, 10), id)
      .run()
    if (!r.meta.changes) return err('not-found')
    await audit(db, 'delete', true, `${id}${b.restore ? '（還原）' : ''}`)
    return ok({ id, deleted: !b.restore })
  },

  /**
   * 改商品編號，連影像鍵一起搬。
   *
   * 🔴 影像鍵是用商品編號組的（<id>-main / <id>-2 / <id>-3）。
   *    只改 products.id 不改 images.key 的話，圖片會失聯 ——
   *    而且是靜默的：編輯頁顯示「找不到這張圖」，但原圖還躺在資料庫裡。
   */
  async renameId(db, b) {
    const from = str(b.from).toLowerCase()
    const to = str(b.to).toLowerCase()
    if (!from || !to) return err('no-id')
    if (!ID_RE.test(to)) return err('bad-product', { detail: '編號只能是小寫英數與連字號' })
    if (from === to) return ok({ from, to, changed: false })

    const exists = await db.prepare('SELECT id FROM products WHERE id = ?').bind(to).first()
    if (exists) return err('id-taken')

    const row = await db.prepare('SELECT * FROM products WHERE id = ?').bind(from).first()
    if (!row) return err('not-found')

    const stmts = []
    const moved = []
    for (const field of ['img_main', 'img_2', 'img_3']) {
      const oldKey = str(row[field])
      if (!oldKey) continue
      const suffix = oldKey.startsWith(from + '-') ? oldKey.slice(from.length + 1) : null
      if (!suffix) continue // 不是用編號組的鍵就不動它
      const newKey = `${to}-${suffix}`
      const taken = await db.prepare('SELECT key FROM images WHERE key = ?').bind(newKey).first()
      if (taken) return err('key-taken', { detail: `${newKey} 已經存在` })
      stmts.push(db.prepare('UPDATE images SET key = ? WHERE key = ?').bind(newKey, oldKey))
      moved.push(`${oldKey} → ${newKey}`)
      row[field] = newKey
    }

    stmts.push(
      db.prepare('UPDATE products SET id = ?, img_main = ?, img_2 = ?, img_3 = ?, updated = ? WHERE id = ?')
        .bind(to, str(row.img_main), str(row.img_2), str(row.img_3),
          new Date().toISOString().slice(0, 10), from)
    )
    // batch 是一個交易：圖搬了但商品沒改（或反過來）會讓圖片失聯，
    // 而那種半套狀態沒有任何畫面看得出來
    await db.batch(stmts)

    const back = await db.prepare('SELECT * FROM products WHERE id = ?').bind(to).first()
    await audit(db, 'renameId', true, `${from} → ${to}；${moved.join('、') || '沒有要搬的圖'}`)
    return ok({ from, to, changed: true, row: rowOut(back), movedImages: moved })
  },

  async saveHouse(db, b) {
    const h = b.house
    if (!h || typeof h !== 'object') return err('bad-house')
    const key = str(h.key).toLowerCase()
    if (!key || !KEY_RE.test(key)) return err('bad-house', { detail: '品牌代碼只能是小寫英數與連字號' })

    const existing = await db.prepare('SELECT key FROM houses WHERE key = ?').bind(key).first()
    if (!existing) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM houses').first()
      if ((n?.n ?? 0) >= 4) return err('too-many')
    }

    const cols = ['key', 'name', 'name_ko', 'country_zh', 'country_en', 'country_ko',
      'tagline', 'intro_zh', 'intro_en', 'intro_ko', 'listed', '"order"']
    await db
      .prepare(
        `INSERT INTO houses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
        `ON CONFLICT(key) DO UPDATE SET ${cols.filter((c) => c !== 'key').map((c) => `${c} = excluded.${c}`).join(', ')}`
      )
      .bind(key, str(h.name), str(h.name_ko), str(h.country_zh), str(h.country_en),
        str(h.country_ko), str(h.tagline), str(h.intro_zh), str(h.intro_en), str(h.intro_ko),
        h.listed === undefined ? 1 : bit(h.listed), Number(h.order) || 0)
      .run()

    await audit(db, 'saveHouse', true, key)
    return ok({ key })
  },

  /** 還有商品掛著就不准刪 —— 刪了會留下指向不存在品牌的斷鏈 */
  async deleteHouse(db, b) {
    const key = str(b.key).toLowerCase()
    if (!key) return err('no-key')
    const used = await db
      .prepare('SELECT COUNT(*) AS n FROM products WHERE house = ? AND deleted = 0')
      .bind(key).first()
    if ((used?.n ?? 0) > 0) return err('house-in-use', { detail: `還有 ${used.n} 件商品掛著` })
    const r = await db.prepare('DELETE FROM houses WHERE key = ?').bind(key).run()
    if (!r.meta.changes) return err('not-found')
    await audit(db, 'deleteHouse', true, key)
    return ok({ key })
  },

  /** 單張原圖的位元組。回 base64，形狀跟舊後端一樣 */
  async image(db, b) {
    const key = str(b.key)
    if (!key) return err('no-key')
    if (!KEY_RE.test(key)) return err('bad-key')
    const r = await db
      .prepare('SELECT key, mime, alpha, sha256, bytes, data FROM images WHERE key = ?')
      .bind(key).first()
    if (!r) return ok({ key, found: false })
    return ok({
      key, found: true, mime: r.mime, alpha: r.alpha === 1,
      sha256: r.sha256, bytes: r.bytes, chunks: 1,
      data: bytesToB64(r.data),
    })
  },

  /**
   * 中繼資料 + 96px 縮圖，不回原圖位元組。
   * 後台清單靠這一次請求就把整頁的圖畫完。
   */
  async imageIndex(db) {
    const r = await db
      .prepare('SELECT key, mime, alpha, sha256, bytes, thumb FROM images ORDER BY key').all()
    return ok({
      images: r.results.map((x) => ({
        key: x.key, mime: x.mime, alpha: x.alpha === 1,
        sha256: x.sha256, bytes: x.bytes,
        // thumb 存的是 data URI 的字串，直接給 <img src>
        thumb: x.thumb ? new TextDecoder().decode(x.thumb) : '',
      })),
    })
  },

  /** 回填既有影像的縮圖。只寫 thumb，不動位元組 */
  async saveThumb(db, b) {
    const key = str(b.key)
    if (!key) return err('no-key')
    const r = await db
      .prepare('UPDATE images SET thumb = ? WHERE key = ?')
      .bind(new TextEncoder().encode(String(b.thumb || '')), key)
      .run()
    return ok({ key, found: r.meta.changes > 0 })
  },

  /** 上傳新圖。前端已經壓好、切好 base64 區塊 */
  async upload(db, b) {
    const key = str(b.key)
    if (!key) return err('no-key')
    if (!KEY_RE.test(key)) return err('bad-key')
    const chunks = Array.isArray(b.chunks) ? b.chunks : b.data ? [b.data] : []
    if (!chunks.length) return err('no-data')

    const b64 = chunks.join('')
    let bytes
    try {
      bytes = b64ToBytes(b64)
    } catch {
      return err('incomplete', { detail: 'base64 解不開，可能上傳到一半中斷' })
    }

    // 🔴 驗 sha256。前端算過一次，這裡再算一次 —— 對不上代表傳輸中途
    //    掉了區塊，而那種檔案打開來是壞的，但資料庫看起來一切正常。
    const sha = hex(await crypto.subtle.digest('SHA-256', bytes))
    if (b.sha256 && !ctEq(sha, String(b.sha256))) {
      return err('incomplete', { detail: `雜湊不符：前端 ${String(b.sha256).slice(0, 12)}…，實得 ${sha.slice(0, 12)}…` })
    }

    await db
      .prepare(
        'INSERT INTO images (key, mime, alpha, sha256, bytes, data, thumb, updated) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ' +
        'mime = excluded.mime, alpha = excluded.alpha, sha256 = excluded.sha256, ' +
        'bytes = excluded.bytes, data = excluded.data, thumb = excluded.thumb, updated = excluded.updated'
      )
      .bind(key, str(b.mime) || 'image/webp', bit(b.alpha), sha, bytes.length, bytes,
        new TextEncoder().encode(String(b.thumb || '')), new Date().toISOString())
      .run()

    await audit(db, 'upload', true, `${key}（${(bytes.length / 1024).toFixed(1)} KB）`)
    return ok({ key, sha256: sha, bytes: bytes.length })
  },

  /**
   * 「發布」。
   *
   * 🔴 現在什麼都不用做，而這正是重點：前台是即時讀 D1 的，
   *    儲存的那一刻網站就已經改了。保留這個 op 只是為了讓舊的前端
   *    不會拿到 bad-op —— UI 上那顆按鈕應該拿掉，不是留著假裝有用。
   */
  async publish(db) {
    await audit(db, 'publish', true, '無動作：前台即時讀 D1')
    return ok({ at: new Date().toISOString(), noop: true, note: '儲存即生效，不需要發布' })
  },

  async status(db) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM products WHERE deleted = 0').first()
    return ok({ state: 'live', live: true, products: n?.n ?? 0, last_publish: null })
  },
}

/** 不需要令牌的 op。其餘一律要 */
const PUBLIC_OPS = new Set(['ping', 'login'])

export async function handleAdmin(request, env) {
  if (request.method !== 'POST') return err('bad-op', { detail: '只接受 POST' })
  if (!env.DB) return err('server', { detail: 'D1 沒有綁定' })

  let body
  try {
    body = await request.json()
  } catch {
    return err('bad-json')
  }

  const op = String(body.op || '')
  const fn = OPS[op]
  if (!fn) return err('bad-op')

  if (!PUBLIC_OPS.has(op)) {
    const p = await verify(env.DB, body.token)
    if (!p) return err('auth')
  }

  try {
    return await fn(env.DB, body)
  } catch (e) {
    // 訊息帶出來。看不懂的錯誤訊息等於沒有錯誤訊息，
    // 而這條路徑上沒有成本也沒有憑證（admin_state 沒有任何讀取端點）。
    await audit(env.DB, op, false, String((e && e.message) || e))
    return err('server', { detail: String((e && e.message) || e) })
  }
}

/**
 * GET /media/<檔名> —— 從 D1 讀圖。
 *
 * 檔名是內容定址的（<鍵>-<sha 前 8 碼>[.cut].<副檔名>），所以先用
 * sha 前綴找，再用鍵核對。這樣「同一個鍵換了新圖」時舊網址會 404
 * 而不是回新圖 —— 那正是內容定址要的性質。
 *
 * 🔴 圖片走 Worker 而不是直接走 CDN，所以快取標頭是效能的全部。
 *    內容變了檔名就變，所以可以放心 immutable。
 */
export async function handleMedia(request, env, url) {
  if (!env.DB) return new Response('no db', { status: 503 })
  const name = decodeURIComponent(url.pathname.replace(/^\/media\//, ''))
  const m = name.match(/^(.+)-([0-9a-f]{8})(\.cut)?\.(webp|jpg|jpeg|png|gif)$/)
  if (!m) return new Response('not found', { status: 404 })
  const [, key, sha8] = m

  const r = await env.DB
    .prepare('SELECT mime, data, sha256 FROM images WHERE key = ?')
    .bind(key).first()
  if (!r || String(r.sha256).slice(0, 8) !== sha8) {
    return new Response('not found', { status: 404 })
  }

  /*
   * 🔴 一定要轉成 Uint8Array 才能丟進 Response。
   *
   * D1 回 BLOB 的形狀不保證 —— 這個版本回的是**數字陣列**，而
   * `new Response([82,73,70,70,…])` 不會報錯，它會把陣列字串化成
   * "82,73,70,70,…" 然後照樣回 200。配上 content-type: image/webp，
   * 從 curl 的標頭看完全正常，只有 Content-Length 大了三倍多
   * （每個位元組變成平均 3.5 個字元）會透露真相。實際發生過。
   */
  const bytes = r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : Uint8Array.from(r.data)

  /*
   * 🔴 長度對不上就不要回 200。
   *
   * 下面掛的是 immutable、一年的快取 —— 一旦一個壞掉的回應被邊緣快取住，
   * 重新部署**救不回來**，因為那個網址的內容照定義永遠不會變。
   * 上面那個陣列字串化的 bug 就是這樣：修好並部署之後，
   * 同一個網址仍然回舊的壞資料，要加查詢字串才看得到修好的版本。
   *
   * 所以寧可讓壞掉的讀取變成一個大聲的 500（而且明確不可快取），
   * 也不要讓它安靜地變成一年份的破圖。
   */
  if (bytes.length !== r.bytes) {
    return new Response(`影像位元組長度不符：資料庫記 ${r.bytes}，實得 ${bytes.length}`, {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    })
  }

  return new Response(bytes, {
    headers: {
      'content-type': r.mime || 'image/webp',
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${r.sha256}"`,
    },
  })
}
