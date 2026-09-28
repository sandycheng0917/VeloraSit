#!/usr/bin/env node
/**
 * 改後台密碼。**只動 admin_state 的那幾列，不碰商品、圖片、品牌、品類。**
 *
 *   node tools/set-password.mjs               # 互動輸入（建議）
 *   node tools/set-password.mjs --sql-only    # 只產生 SQL，自己決定何時套用
 *   node tools/set-password.mjs --local       # 改本機 D1（wrangler dev 用的）
 *
 * ── 為什麼需要這支 ──────────────────────────────────────────────────
 *
 * tools/d1-seed.mjs 也能設密碼，但它會 `DELETE FROM products` 再重灌 ——
 * 那是一次性遷移，不是維運工具。開始用後台之後再跑它，
 * 所有編輯都會被 2026-09-07 的舊快照蓋掉。
 *
 * 所以改密碼要有一條不碰資料的路，就是這支。
 *
 * ── 🔴 密碼請用長的通行句 ───────────────────────────────────────────
 *
 * PBKDF2 只有 10 萬輪，那是 Cloudflare Workers 的硬上限
 * （超過會回 "iteration counts above 100000 are not supported"）。
 * OWASP 對 PBKDF2-HMAC-SHA256 的建議是 31 萬 —— 也就是說這裡比建議值
 * 低三倍，如果 D1 的內容外洩，離線暴力破解會快三倍。
 *
 * 輪數補不回來，只有密碼長度可以。四個以上不相關的詞（20 字元以上）
 * 遠勝於一個有大小寫數字符號的短密碼。
 */
import { spawnSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (n) => {
  const i = args.indexOf(n)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}

const SQL_ONLY = args.includes('--sql-only')
const LOCAL = args.includes('--local')
const DB = arg('--db') || 'veloradb_sit'
const OUT = join(ROOT, 'build', 'set-password.sql')

/** 跟 worker/admin.js 的驗證端必須用同一組參數 */
const ITERS = 100000

const MIN_LEN = 12

/**
 * 隱藏輸入的提示。
 *
 * 🔴 不要用 --pw 傳密碼：它會留在 shell 的歷史紀錄裡，而那個檔案
 *    通常沒有任何保護。真的要用（腳本化）就自己清 history。
 */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    if (!input.isTTY) {
      reject(new Error(
        '這個終端機不是互動式的，讀不到鍵盤輸入。\n' +
        '  改用：npm run set-password -- --pw "你的通行句"\n' +
        '  （用完請清掉 shell 歷史紀錄）'
      ))
      return
    }

    /*
     * 🔴 一定要回顯遮罩字元，不能什麼都不顯示。
     *
     * 第一版完全不回顯（照 sudo 的做法），結果使用者打字看不到任何反應，
     * 回報「好像卡住了」—— 而那個判斷是對的：一個沒有任何回饋的提示，
     * 跟當掉在畫面上是同一件事。安全性來自「別人看不到內容」，
     * 不是「連你自己都看不到有沒有在輸入」。
     *
     * 用原始模式逐字元處理，不用 readline 的 _writeToOutput 掛勾 ——
     * 那是內部 API，而且在不同終端機上行為不一致。
     */
    process.stdout.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')

    let buf = ''
    const done = (err, value) => {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
      process.stdout.write('\n')
      err ? reject(err) : resolve(value)
    }

    /*
     * 🔴 吞掉開頭那個落單的換行。
     *
     * Windows 的 Enter 在原始模式下可能送 \r\n 兩個字元。第一個 \r 讓
     * 這一輪結束，而 \n 還留在串流裡 —— 下一輪 askHidden（「再輸入一次」）
     * 一 resume 就收到它，立刻以空字串結束。
     * 症狀是第二個提示閃過去、然後說「兩次輸入不一致」，
     * 而使用者根本沒有機會打第二次。
     */
    let first = true

    function onData(ch) {
      for (const c of ch) {
        if (first && c === '\n' && buf === '') { first = false; continue }
        first = false
        if (c === '\r' || c === '\n') return done(null, buf)
        if (c === '\u0003') return done(new Error('已取消，沒有做任何變更。')) // Ctrl+C
        if (c === '\u0004') return done(null, buf)                              // Ctrl+D
        if (c === '\u007f' || c === '\b') {
          if (buf) {
            buf = buf.slice(0, -1)
            // 退格、蓋掉、再退格 —— 只寫 \b 的話星號還留在畫面上
            process.stdout.write('\b \b')
          }
          continue
        }
        // 其餘控制字元忽略（方向鍵之類的會送 escape 序列，不要收進密碼裡）
        if (c < ' ') continue
        buf += c
        process.stdout.write('*')
      }
    }

    input.on('data', onData)
  })
}

async function readPassword() {
  const given = arg('--pw')
  if (given) {
    console.error('⚠ 用 --pw 傳密碼會留在 shell 歷史紀錄裡，記得清掉。\n')
    return given
  }
  const a = await askHidden('新密碼（會顯示為 *，至少 12 字元）：')
  const b = await askHidden('再輸入一次：')
  if (a !== b) throw new Error('兩次輸入不一致，沒有做任何變更。')
  return a
}

function sqlLine(key, value, now) {
  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`
  return (
    `INSERT INTO admin_state (key, value, updated) VALUES (${esc(key)}, ${esc(value)}, ${esc(now)}) ` +
    `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated;`
  )
}

async function main() {
  const pw = await readPassword()
  if (!pw || pw.length < MIN_LEN) {
    throw new Error(
      `密碼至少要 ${MIN_LEN} 個字元（實得 ${pw ? pw.length : 0}）。\n` +
      '  PBKDF2 的輪數被平台限制在 10 萬，比建議值低三倍 ——\n' +
      '  補回來的唯一方法是長度。四個不相關的詞比一個短的複雜密碼強得多。'
    )
  }

  const now = new Date().toISOString()
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(pw, salt, ITERS, 32, 'sha256')

  const lines = [
    '-- 由 tools/set-password.mjs 產生。只改後台密碼，不碰任何商品資料。',
    `-- 產生時間：${now}`,
    '',
    sqlLine('pw_salt', salt.toString('hex'), now),
    sqlLine('pw_hash', hash.toString('hex'), now),
    sqlLine('pw_iters', String(ITERS), now),
    '',
    '-- 🔴 換密碼就要讓已經發出去的令牌全部失效。',
    '--    不做的話，舊密碼外洩時對方手上那把 8 小時的票仍然能用 ——',
    '--    你改了密碼卻以為安全了，那是最糟的一種「以為」。',
    '--    worker/admin.js 的 verify() 會比對 token_epoch，對不上就拒絕。',
    "UPDATE admin_state SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated = " +
      `'${now}' WHERE key = 'token_epoch';`,
    "INSERT INTO admin_state (key, value, updated) SELECT 'token_epoch', '2', " +
      `'${now}' WHERE NOT EXISTS (SELECT 1 FROM admin_state WHERE key = 'token_epoch');`,
    '',
    '-- 順便解掉鎖定狀態：改密碼的人通常就是被自己鎖在外面的那個',
    sqlLine('fail_count', '0', now),
    sqlLine('lock_until', '0', now),
  ]

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, lines.join('\n') + '\n', 'utf8')

  if (SQL_ONLY) {
    console.log(`\n✓ 已寫出 ${OUT}`)
    console.log('  套用：cd velora-frontend && npx wrangler d1 execute ' +
      `${DB} ${LOCAL ? '--local' : '--remote'} --file ../build/set-password.sql`)
    console.log('  🔴 套用後請刪掉那個檔案 —— 它含密碼雜湊與鹽。')
    return
  }

  console.log('\n套用到 D1…')

  /*
   * 直接跑 wrangler 的 JS 入口，不經過 npx。
   *
   * 🔴 Windows 上不能用 spawnSync('npx.cmd', …)：Node 18.20／20.12 之後
   *    禁止不經 shell 直接執行 .bat/.cmd（CVE-2024-27980），
   *    症狀是 exit code 為 null 而且沒有任何錯誤訊息 —— 看起來像 wrangler
   *    自己失敗了，實際上它根本沒被啟動。踩過。
   *
   *    改用 shell: true 也能動，但那會把參數交給 shell 解析；
   *    直接指定 node + 入口檔沒有那個面。
   */
  const cli = join(ROOT, 'velora-frontend', 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!existsSync(cli)) {
    throw new Error(`找不到 wrangler（${cli}）。先在 velora-frontend 跑 npm ci。`)
  }
  const r = spawnSync(
    process.execPath,
    [cli, 'd1', 'execute', DB, LOCAL ? '--local' : '--remote', '--file', OUT],
    { cwd: join(ROOT, 'velora-frontend'), stdio: 'inherit' }
  )

  // 🔴 無論成功失敗都要刪掉。失敗時留著更危險 ——
  //    那是個沒人記得的檔案，裡面是雜湊與鹽。
  await rm(OUT, { force: true })

  if (r.status !== 0) {
    throw new Error(`wrangler 失敗（exit ${r.status}）。密碼沒有改動。`)
  }

  console.log('\n✓ 密碼已更新，所有現有的登入令牌同時失效。')
  console.log('  暫存的 SQL 檔已刪除。')
}

main().catch((e) => {
  console.error('\n✗ ' + ((e && e.message) || e))
  process.exit(1)
})
