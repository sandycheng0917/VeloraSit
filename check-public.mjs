/**
 * check-public.mjs — 公開前的自我稽核
 *
 *   node check-public.mjs                      內建規則 + 本機監看清單
 *   node check-public.mjs 我的手機 公司地址     只搜你當下指定的關鍵字
 *
 * 回答三個問題：
 *   ① 哪些檔案會上傳到網站伺服器？（velora-frontend/dist/）
 *   ② 哪些檔案會進 GitHub？（git 追蹤中的檔案 —— 這是唯一會被推送的東西）
 *   ③ 有沒有不該外流的東西混進去？
 *
 * ⚠️ 這支腳本本身也會進版控，所以**不能把機密字串寫在裡面**。
 *    確切的機密字串放在 .secret-watch.txt（已被 .gitignore 擋住，只存在你本機）。
 *    沒有那個檔案時，仍會用下方不含機密的通用樣式做基本檢查。
 *
 * ══ repo 轉 private 之後這支還要不要跑？要。══════════════════════
 *
 * 它做兩件事，只有一件跟「公開」有關：
 *
 *   ① 哪些會上網站（build/site 的內容清單）
 *      —— 跟 repo 可見性完全無關。網站永遠是公開的，這一項的價值不減。
 *
 *   ② 哪些進 Git、有沒有機密
 *      —— 風險降低但不歸零：CI 會把整個 repo clone 進第三方建置容器、
 *         git 歷史是永久的、而可見性只是一個會被按錯的開關。
 *
 * 寫在這裡是為了擋住「已經 private 了，這支不用跑了」那個推論。
 *
 * ══ 這支看不見的東西 ═══════════════════════════════════════════════
 *
 * 機密掃描只讀 git 追蹤中的**文字**檔（第 174 行跳過二進位副檔名）。
 * 所以 .wrangler/state/v3/d1/*.sqlite 這種「二進位 + 含成本」的檔案，
 * 它抓不到 —— 唯一的防線是 .gitignore。第 ⑥ 節就是在驗那條防線還在。
 *
 * 本腳本不修改任何東西，可以隨時重跑。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = import.meta.dirname

/**
 * 要稽核哪一份輸出。
 *
 * 預設是 velora-frontend/dist（本機 npm run build 的產物），
 * CI 會傳 --dist build/site —— 那裡是三個站台組裝完的完整輸出，
 * 才是真正會上傳的東西。寫死一個路徑的話，CI 稽核的是錯的目錄。
 */
const distIdx = process.argv.indexOf('--dist')
const DIST = distIdx !== -1 && process.argv[distIdx + 1]
  ? join(ROOT, process.argv[distIdx + 1])
  : join(ROOT, 'velora-frontend', 'dist')
const WATCH_FILE = join(ROOT, '.secret-watch.txt')

/**
 * 通用樣式：不含任何實際機密值，公開也無妨。
 * 抓的是「形狀」而非「內容」—— 韓國手機、非本公司信箱、10 位數統編。
 */
const PATTERNS = [
  [/\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b/, '疑似韓國手機號碼'],
  [/\b\d{10}\b/, '疑似 10 位數事業登記號'],
  [/[\w.+-]+@(?!velora\.com\.tw)[\w-]+\.[\w.]+/, '非本公司網域的電子信箱'],
  // 機密來源是韓文表格，只抓數字與信箱會漏掉最重要的部分。
  // 這裡只放「不指名任何人的形狀」—— 韓文姓名接職稱、表格欄位的通用用語。
  // 具體的人名、公司名、地名屬機密本身，寫進這裡等於公開它們，
  // 因此一律放 .secret-watch.txt（不進版控）。
  [/[가-힣]{2,4}\s*(과장|대리|부장|차장|사장|팀장|이사)\b/, '疑似韓文姓名＋職稱'],
  [/[가-힣]*\s*(단가|등록번호|담당자)\s*[:：]?\s*[\w\d]/, '疑似表格欄位＋值'],
  // Cloudflare 的憑證形狀。只放低誤報的兩條 ——
  // account id 與 D1 的 database_id 刻意不列：它們本來就該寫在 wrangler.toml
  // 裡（沒有 API token 就用不了），列進來只會製造每次都要人工忽略的雜訊。
  [/\bv1\.0-[0-9a-f]{40,}/, '疑似 Access service token 的密鑰'],
  [/(CF_ACCESS_CLIENT_SECRET|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["']?[\w.-]{20,}/i,
    '疑似寫死的 Cloudflare 憑證'],
]

const bytes = (n) =>
  n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB'

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else out.push({ path: p, size: st.size })
  }
  return out
}

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return '' // git grep 找不到時回傳非零，視同沒有命中
  }
}

const line = (c = '─') => console.log(c.repeat(68))
const CUSTOM = process.argv.slice(2).filter(Boolean).filter((a, i, all) => {
  if (a === '--dist') return false
  return all[i - 1] !== '--dist'
})

/* ① 會上傳到網站伺服器的 ──────────────────────────────────── */
line('═')
console.log('①  會上傳到網站伺服器的內容      velora-frontend/dist/')
line()
const dist = walk(DIST)
if (!dist.length) {
  console.log('  dist/ 不存在。先跑：cd velora-frontend && npm run build:public')
} else {
  const groups = {}
  for (const f of dist) {
    const rel = relative(DIST, f.path).replace(/\\/g, '/')
    const key = rel.includes('/') ? rel.split('/').slice(0, 2).join('/') : '(根目錄)'
    groups[key] = groups[key] || { n: 0, size: 0 }
    groups[key].n++
    groups[key].size += f.size
  }
  for (const [k, v] of Object.entries(groups).sort())
    console.log('  %s %s 檔  %s', k.padEnd(28), String(v.n).padStart(3), bytes(v.size))
  console.log('  %s %s 檔  %s', '總計'.padEnd(27), String(dist.length).padStart(3),
    bytes(dist.reduce((a, b) => a + b.size, 0)))
}

/* ② 會進 GitHub 的 ────────────────────────────────────────── */
line('═')
console.log('②  會進 GitHub 的檔案            git 追蹤中（只有這些會被推送）')
line()
const tracked = sh('git ls-files').split('\n').filter(Boolean)
if (!tracked.length) {
  console.log('  尚未 git add，或這裡不是 git repo。')
} else {
  const groups = {}
  for (const rel of tracked) {
    const key = rel.includes('/') ? rel.split('/').slice(0, 2).join('/') : '(根目錄)'
    groups[key] = (groups[key] || 0) + 1
  }
  for (const [k, n] of Object.entries(groups).sort())
    console.log('  %s %s 檔', k.padEnd(36), String(n).padStart(3))
  console.log('  %s %s 檔', '總計'.padEnd(35), String(tracked.length).padStart(3))
}

/* ③ 被擋在外面的 ──────────────────────────────────────────── */
line('═')
console.log('③  被 .gitignore 擋住、不會外流的')
line()
const ignored = sh('git status --porcelain --ignored')
  .split('\n')
  .filter((l) => l.startsWith('!!'))
  .map((l) => l.slice(3).trim())
if (!ignored.length) console.log('  （無）')
for (const p of ignored) console.log('  ✗ ' + p)

/* ④ 機密掃描 ──────────────────────────────────────────────── */
line('═')
console.log('④  機密掃描（掃 git 追蹤中的所有檔案，包含本腳本自己）')
line()

let bad = 0
function report(label, why, hits) {
  if (!hits.length) return
  bad++
  console.log('  ⚠ %s（%s）', label, why)
  for (const h of hits) console.log('      ' + h)
}

if (CUSTOM.length) {
  console.log('  （只搜你指定的 %d 個關鍵字）\n', CUSTOM.length)
  for (const kw of CUSTOM) {
    const hits = sh(`git grep -lI -e "${kw.replace(/"/g, '\\"')}"`).trim()
    report(kw, '你指定的關鍵字', hits ? hits.split('\n') : [])
  }
} else {
  // (a) 本機監看清單：確切的機密字串，只存在你的電腦上
  if (existsSync(WATCH_FILE)) {
    const words = readFileSync(WATCH_FILE, 'utf8')
      .split('\n')
      .map((l) => l.split('#')[0].trim())
      .filter(Boolean)
    console.log('  監看清單 .secret-watch.txt：%d 個字串（此檔不進版控）', words.length)
    for (const w of words) {
      const hits = sh(`git grep -lI -e "${w.replace(/"/g, '\\"')}"`).trim()
      report(w.slice(0, 4) + '…（已遮蔽）', '監看清單命中', hits ? hits.split('\n') : [])
    }
  } else {
    console.log('  找不到 .secret-watch.txt —— 只做通用樣式檢查。')
    console.log('  建議在專案根目錄建立該檔，一行一個要監看的機密字串。')
  }

  // (b) 通用樣式：不含機密值，靠「形狀」抓
  console.log('  通用樣式：%d 條', PATTERNS.length)
  for (const [re, why] of PATTERNS) {
    const hits = []
    for (const f of tracked) {
      if (/\.(png|jpe?g|webp|avif|gif|svg|ico|ep|zip|pdf|xlsx|woff2?|mp4|pen)$/i.test(f)) continue
      let text
      try {
        text = readFileSync(join(ROOT, f), 'utf8')
      } catch {
        continue
      }
      const m = text.match(re)
      if (m) hits.push(`${f}  →  ${m[0]}`)
    }
    report(String(re), why, hits)
  }
}

console.log(bad ? `\n  ⚠ ${bad} 項命中，公開前請逐一確認是否為誤報。`
                : '\n  ✓ 全部 0 命中')

/* ⑤ 後台只能出現在 admin/ ─────────────────────────────────── */
line('═')
console.log('⑤  後台只能出現在 admin/')
line()

/**
 * 🔴 這一段原本是 `git grep -lI -e "商品管理" -- velora-frontend/dist`。
 *
 *    但 dist/ 是 gitignored，而 git grep 預設只搜「追蹤中」的檔案 ——
 *    所以它永遠回傳空、永遠通過。那道關卡空轉了很久，
 *    而空轉的關卡比沒有關卡更糟：它讓人以為有在檢查。
 *
 *    改成直接讀檔。判準也從「dist 有沒有後台」改成「後台只能在 admin/」，
 *    因為三站合一之後，輸出裡本來就會有一份後台。
 */
const ADMIN_MARKS = ['商品管理', 'vadmin', '出口單價']
const leaked = []
let adminSeen = 0
for (const f of dist) {
  if (/\.(png|jpe?g|webp|avif|gif|ico|woff2?|mp4)$/i.test(f.path)) continue
  const rel = relative(DIST, f.path).replace(/\\/g, '/')
  let text
  try {
    text = readFileSync(f.path, 'utf8')
  } catch {
    continue
  }
  const hit = ADMIN_MARKS.find((m) => text.includes(m))
  if (!hit) continue
  if (rel.startsWith('admin/')) adminSeen++
  else leaked.push(`${rel}  →  ${hit}`)
}

if (leaked.length) {
  console.log('  ✗ 後台字串出現在 admin/ 以外：')
  for (const l of leaked.slice(0, 10)) console.log('      ' + l)
} else {
  console.log('  ✓ 後台字串沒有出現在 admin/ 以外')
}

// 正向控制。沒有這一句的話，一個空的 admin 目錄會讓上面那個檢查無條件通過，
// 而「後台沒建出來」跟「後台沒外洩」在畫面上長得一模一樣
console.log(
  existsSync(join(DIST, 'admin'))
    ? adminSeen
      ? `  ✓ admin/ 確實含有後台（${adminSeen} 個檔案）`
      : '  ✗ admin/ 存在但找不到後台字串 —— 後台可能根本沒建出來'
    : '  – 這份輸出沒有 admin/（本機跑公開版建置時就是這樣，正常）'
)

/* ⑥ 機密掃描看不見的那些路徑，.gitignore 還擋著嗎 ──────────── */
line('═')
console.log('⑥  二進位機密路徑的忽略規則（第 ④ 節的掃描看不進去）')
line()

/**
 * 🔴 這一節不是重複第 ③ 節。
 *
 *    第 ③ 節列「現在本機有什麼被擋住」—— 檔案不存在時它什麼都不會說。
 *    這一節問的是「規則還在嗎」，不管檔案存不存在。
 *
 *    為什麼只驗這幾條：它們指向的是**二進位或明文機密檔**，
 *    而第 ④ 節的掃描會跳過二進位副檔名（第 193 行）。
 *    也就是說，這幾條規則一旦失效，**沒有任何其他關卡會發現**。
 *    其餘規則（*.xlsx、design/sample/ 之類）漏掉時第 ④ 節還抓得到內容。
 */
const MUST_IGNORE = [
  ['.wrangler/state/v3/d1/velora.sqlite', '本機 D1，含 FOB 成本與供應商手機（二進位）'],
  ['.dev.vars', 'wrangler dev 的本機 secrets'],
  ['tools/migrate-out/02-private.sql', '遷移輸出，含成本的明文 SQL'],
  ['backup/velora-2026-01-01.sql', 'd1 export 的備份，含 products_private'],
  ['x.private.sql', '任何位置的 *.private.sql'],
  ['.secret-watch.txt', '監看清單本身就是機密'],
  ['design/sample/x.xlsx', '供應商原始素材'],
]
let unguarded = 0
for (const [p, why] of MUST_IGNORE) {
  let ok = false
  try {
    execSync(`git check-ignore -q "${p}"`, { cwd: ROOT, stdio: 'ignore' })
    ok = true
  } catch { /* 非零＝沒被擋住 */ }
  if (!ok) unguarded++
  console.log('  %s %s', ok ? '✓' : '✗ 沒擋住！', `${p}  —— ${why}`)
}
console.log(unguarded
  ? `\n  ⚠ 有 ${unguarded} 條規則失效。這幾條沒有第二道網，請立刻修 .gitignore。`
  : '\n  ✓ 七條都還在')

line('═')
