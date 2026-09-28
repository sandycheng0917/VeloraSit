/**
 * 把既有的商品素材壓成 WebP，用的是後台上傳時**完全相同**的演算法。
 *
 * ── 為什麼跑在瀏覽器裡 ──────────────────────────────────────────────
 *
 * 專案的原則是零 npm 依賴（Node 22 內建 fetch / crypto 就夠）。
 * 影像編碼是唯一做不到的一件事 —— 但 Chrome 本來就在這台機器上，
 * 而且它的 canvas.toBlob('image/webp') 就是後台在瀏覽器裡用的那一支。
 *
 * 用同一個編碼器有一個具體好處：後台上傳的圖跟這裡遷移的圖，
 * 壓出來的品質特性一致，不會有「舊圖看起來跟新圖不一樣」的問題。
 *
 * ── 二維搜尋 ────────────────────────────────────────────────────────
 *
 * 檔案大小同時受尺寸與品質影響，而且非線性：同一張圖 q0.8 可能 60KB，
 * q0.7 掉到 38KB，q0.6 只掉到 34KB。單次猜一個品質必定失手 ——
 * 不是超標就是把畫質浪費掉。
 *
 * 外層由大到小試寬度，內層二分搜尋找該寬度下不超標的最高品質。
 * 取第一個成功的寬度，因為寬度優先於品質：720px q0.62 看起來
 * 比 480px q0.92 好得多。
 *
 * 用法：
 *   node tools/compress-images.mjs                # 目標 34KB
 *   node tools/compress-images.mjs --target 60000 # 放寬
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const args = process.argv.slice(2)
const ti = args.indexOf('--target')
const TARGET = ti !== -1 && args[ti + 1] ? Number(args[ti + 1]) : 34000
/** 壓不到目標值時的退路。跟後台「高畫質」那個選項同一個數字 */
const HQ_TARGET = 100000

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT_DIR = join(ROOT, 'velora-frontend', 'public', 'media', 'opt')

const legacy = JSON.parse(readFileSync(join(ROOT, 'tools', 'images.json'), 'utf8'))

/* 同一張來源可能被多個影像鍵共用（五款香氛共用同一張情境圖），
   壓一次就好，鍵各自指過去 */
const bySource = new Map()
for (const e of legacy) {
  const abs = join(ROOT, 'velora-frontend', 'public', e.path.replace(/^\//, ''))
  if (!existsSync(abs)) {
    console.error(`  – 跳過 ${e.key}：找不到 ${e.path}`)
    continue
  }
  if (!bySource.has(e.path)) bySource.set(e.path, { abs, keys: [] })
  bySource.get(e.path).keys.push(e.key)
}

/* ── 開一個瀏覽器 ─────────────────────────────────────────────── */
const { spawn } = await import('node:child_process')
const PORT = 9500 + Math.floor(Math.random() * 200)
const ud = (process.env.TEMP || '.').replace(/\x5c/g, '/') + '/vcmp' + Date.now()
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--hide-scrollbars', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + ud, 'about:blank',
], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 60 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 250))
  try { wsUrl = (await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json()).webSocketDebuggerUrl } catch {}
}
if (!wsUrl) { proc.kill(); throw new Error('Chrome 沒有開出偵錯埠') }

const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
const send = (m, p = {}, sid) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p, sessionId: sid })) })

const { result: t } = await send('Target.createTarget', { url: 'about:blank' })
const { result: s } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
const sid = s.sessionId
await send('Runtime.enable', {}, sid)

/**
 * 頁面裡跑的壓縮。跟 src/admin/image.js 的 compress() 是同一套邏輯 ——
 * 那邊吃 File 物件，這邊吃 data URI，其餘一模一樣。
 */
const SCRIPT = (dataUri, target) => `(async () => {
  const res = await fetch(${JSON.stringify(dataUri)})
  const blob = await res.blob()
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q))

  canvas.width = 8; canvas.height = 8
  const probe = await toBlob('image/webp', 0.8)
  const type = probe && probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg'

  // 階梯從「不超過原圖」開始。放大只會讓檔案變大、畫質變差
  // 比後台多兩級（420 / 360）。後台的階梯停在 480 是刻意的 ——
  // 再小在高解析螢幕上會糊。但這裡是一次性遷移，寧可留住這張圖
  const ladder = [1200, 1000, 900, 800, 720, 640, 560, 480, 420, 360].filter((w) => w <= bitmap.width)
  if (!ladder.length) ladder.push(bitmap.width)

  let best = null, tries = 0
  for (const w of ladder) {
    const h = Math.round((bitmap.height / bitmap.width) * w)
    canvas.width = w; canvas.height = h
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    let lo = 0.35, hi = 0.92, hit = null
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2
      const b = await toBlob(type, q); tries++
      if (b && b.size <= ${target}) { hit = { b, w, h, q }; lo = q } else { hi = q }
    }
    if (hit) { best = hit; break }
  }
  if (!best) return JSON.stringify({ ok: false, tries })

  const buf = await best.b.arrayBuffer()
  let bin = ''
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return JSON.stringify({
    ok: true, b64: btoa(bin), bytes: best.b.size, type,
    w: best.w, h: best.h, q: +best.q.toFixed(2), tries,
    ow: bitmap.width, oh: bitmap.height
  })
})()`

const MIME_OF = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

mkdirSync(OUT_DIR, { recursive: true })
const out = []
let before = 0
let after = 0
let failed = 0
const relaxed = []

for (const [path, info] of bySource) {
  const raw = readFileSync(info.abs)
  const ext = path.split('.').pop().toLowerCase()
  const dataUri = `data:${MIME_OF[ext] || 'application/octet-stream'};base64,${raw.toString('base64')}`

  /*
   * 兩段：先試目標值，壓不下去再放寬到 HQ。
   *
   * 整張都是細節的情境照（花市、布料紋理）壓不到 34KB 是常態，
   * 後台遇到同樣情況會請使用者勾「高畫質」。這裡是一次性遷移，
   * 直接自動放寬並且**明說是哪幾張**，不要靜默通過也不要中止整批。
   */
  let r = null
  let usedTarget = TARGET
  for (const tgt of [TARGET, HQ_TARGET]) {
    const { result } = await send('Runtime.evaluate', {
      expression: SCRIPT(dataUri, tgt), returnByValue: true, awaitPromise: true,
    }, sid)
    if (result.exceptionDetails) {
      console.error(`  ✗ ${path}  ${result.exceptionDetails.text}`)
      break
    }
    const got = JSON.parse(result.result.value)
    if (got.ok) { r = got; usedTarget = tgt; break }
  }
  if (!r) {
    console.error(`  ✗ ${path}  連 ${Math.round(HQ_TARGET / 1000)}KB 都壓不到`)
    failed++
    continue
  }
  if (usedTarget !== TARGET) relaxed.push(path)

  const name = path.replace(/^\/media\//, '').replace(/\.[a-z]+$/i, '').replace(/\//g, '-') + '.webp'
  writeFileSync(join(OUT_DIR, name), Buffer.from(r.b64, 'base64'))
  before += raw.length
  after += r.bytes

  console.log(
    `  ${String(Math.round(raw.length / 1024)).padStart(4)}KB → ` +
    `${String(Math.round(r.bytes / 1024)).padStart(3)}KB  ` +
    `${r.ow}×${r.oh} → ${r.w}×${r.h} q${r.q}  ${name}`
  )
  for (const key of info.keys) out.push({ key, path: name })
}

ws.close()
proc.kill()

if (failed) {
  console.error(`\n✗ ${failed} 張壓不下來，沒有寫出 images.json`)
  process.exit(1)
}

// 對照表指向壓好的檔案。原始素材留著不動 —— 它們是母片，不該被覆蓋
const jsonPath = join(ROOT, 'tools', 'images.json')
writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n', 'utf8')

console.log(`\n  ${out.length} 個影像鍵、${bySource.size} 張實體檔案`)
console.log(`  ${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024).toFixed(0)} KB` +
  `（縮到 ${((after / before) * 100).toFixed(1)}%）`)
console.log(`  對照表已更新：tools/images.json`)
if (relaxed.length) {
  console.log(`
  ⚠ ${relaxed.length} 張壓不到 ${Math.round(TARGET / 1000)}KB，` +
    `已放寬到 ${Math.round(HQ_TARGET / 1000)}KB：`)
  for (const p of relaxed) console.log(`      ${p}`)
  console.log(`    這些通常是整張都是細節的情境照。想更小就換一張單品照或去背圖。`)
}
