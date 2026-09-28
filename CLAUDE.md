# 維羅拉國際有限公司 — 專案說明

Velora International CO., LTD ——「韓國選品代理」形象網站與後台商品管理原型。
代理 VUCA（居家香氛）與 SAINTMARI（真絲長巾、純銀飾品）兩家韓國品牌。

## 專案結構

```
velora-frontend/     Vue 3 + Vite 前端，也是部署單位
  src/admin/         後台（商品管理），只在 build:admin 進 bundle
  src/data/          catalog.js 是介面層，執行時向 /api/catalog 取資料
  worker/            Cloudflare Worker：index.js 路由 + admin.js 後台後端
  migrations/        D1 的 schema（wrangler d1 migrations）
  wrangler.toml      Worker 設定（不是 Pages —— 見下方部署）
tools/               建置期工具（稽核關卡、D1 種子、影像壓縮）
  media-src/         影像來源檔。**刻意不在 public/**，見下方硬性規則
design/              設計交付：.pen 設計檔、規格書、素材管線
check-public.mjs     公開前稽核：哪些會進 Git、哪些會上網站
```

## 唯一真相是 Cloudflare D1

**商品、品牌、品類、影像位元組、後台密碼全部在 D1（`veloradb_sit`）。**
整個系統不依賴任何外部服務 —— 2026-09-28 Google 全面退場：
Apps Script 後端、兩份 Google Sheet、`repository_dispatch` 的發布流程都刪了。

```
前台  catalog.js ──fetch──> /api/catalog ──> worker/index.js ──> D1
後台  api.js     ──fetch──> /api/admin   ──> worker/admin.js  ──> D1
圖片  <img src>  ────────> /media/<內容定址檔名> ──> worker/admin.js ──> D1
```

**沒有「發布」這個步驟。** 後台按儲存的那一刻網站就改了（前台的快取是 60 秒）。
以前要跑三分鐘的 GitHub Actions，現在是一次資料庫寫入。

🔴 **沒有種子檔退路。** API 掛掉時前台顯示錯誤與重試，不會靜默拿舊資料頂上 ——
那會讓「資料庫壞了」長得跟「一切正常」一模一樣，而使用者看到的是一份
沒人知道有多舊的目錄。

🔴 **`tools/d1-seed.mjs` 是一次性遷移，不是同步工具。** 它會清空再重灌，
再跑一次等於把 2026-09-07 的舊快照蓋回去、洗掉所有後台編輯。
所以它要 `--force` 才會動。備份：
`npx wrangler d1 export veloradb_sit --remote --output backup.sql`

## 常用指令

```bash
cd velora-frontend
npm run dev          # 開發（5173）。/api/* 由 vite proxy 轉給線上 Worker，
                     # 所以本機看得到真實的 D1 資料，不必另開 wrangler
npm run dev:admin    # 後台（也是 5173，但根路徑就是後台）
npm run build        # 公開版建置，必須通過
npm run build:worker # 部署用：公開版 + 後台疊成一份 dist/（Cloudflare 跑這個）

npm run audit        # 七道稽核關卡 + check-public（build:worker 會自動跑）
npm run d1:migrate   # 套用 migrations/ 到遠端 D1
npm run cf:deploy    # 手動部署（等同 npx wrangler deploy）
```

```bash
node tools/check-admin-css.mjs        # 後台有沒有跟公開版全域樣式撞 class 名
node tools/check-gates.mjs            # 七道關卡（比對 .secret-watch.txt）
node tools/check-gates.mjs --api https://velorasit.chenghsuanno1.workers.dev
node check-public.mjs --dist velora-frontend/dist
node tools/compress-images.mjs        # 影像壓縮（產出到 tools/media-src/）

node tools/set-password.mjs           # 改後台密碼（互動輸入，不碰任何商品資料）

# 🔴 一次性遷移，會清空 D1 再重灌。正常情況下永遠不需要跑
node tools/d1-seed.mjs --force

python design/build-assets.py         # 重建圖庫（改了 sample/ 之後）
node design/shoot.mjs                 # 產生預覽圖（需先跑 dev）
```

**驗手機版不要直接用 `--window-size=390` 截圖。** headless Chrome 的視窗尺寸
不等於版面視埠，截出來會像是右側被切掉 —— 那是假象，會讓人去修一個不存在的
溢出。要量就開一個同源頁面、用 `<iframe width="390">` 載入站台，
再讀 `contentDocument.documentElement.scrollWidth` 與各元素的 `getBoundingClientRect()`。

## 怎麼直接看資料庫

資料全部在 Cloudflare D1，沒有 Google 試算表可以打開了。要看內容或 schema：

```bash
cd velora-frontend

npx wrangler d1 info veloradb_sit          # 大小、資料表數、近 24 小時的讀寫量
npx wrangler d1 list                       # 這個帳號有哪些資料庫

# 有哪些表
npx wrangler d1 execute veloradb_sit --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# 某張表的完整 schema（欄位、型別、CHECK 條件）
npx wrangler d1 execute veloradb_sit --remote --command "SELECT sql FROM sqlite_master WHERE name='products'"

# 查資料
npx wrangler d1 execute veloradb_sit --remote --command "SELECT id, ref, name_zh, listed, price FROM products"
```

目前有七張表：`products`、`houses`、`categories`、`images`、
`admin_state`、`audit`，加上 wrangler 自己的 `d1_migrations`。

🔴 **`--remote` 不能省。** 省略的話打的是 `.wrangler/state/` 底下的**本機**
SQLite 檔，那是 `wrangler dev` 用的空殼 —— 你會看到一個結構正確但內容不同
（或完全是空的）的資料庫，然後以為線上資料出問題了。

**dashboard 也可以**：Cloudflare → Workers & Pages → D1 → `veloradb_sit`
有一個 Console 分頁可以直接下 SQL，適合臨時查一下。

**整份倒出來**（改任何東西之前都該先做一次）：

```bash
npx wrangler d1 export veloradb_sit --remote --output ../backup/velora-YYYY-MM-DD.sql
```

`backup/` 已經被 .gitignore 擋住 —— 那份倒出來的東西含後台密碼雜湊與
HMAC 簽章密鑰（`admin_state`），不要提交，也不要丟進聊天室。

🔴 **不要直接 UPDATE `products` 來改商品。** 後台會做的事不只寫一列：
影像鍵要跟著商品編號走、`updated` 要更新、寫完要讀回來確認。
手動 SQL 繞過那些，最容易造成的後果是圖片失聯 —— 而那是靜默的，
編輯頁顯示「找不到這張圖」，但原圖還躺在資料庫裡。
要批次改就走 `/api/admin` 的 `save`。

## 開始動手前

**要改版面、色票、字體、文案或素材，先載入 `velora-design` skill**
（`.claude/skills/velora-design/`）—— 裡面有金色可讀性規則、
影像板的兩個必要 CSS 條件、文案原則與機密資料紅線，
這些踩錯了畫面會壞或會外洩商業機密。

## 硬性規則

1. **展示頁不出現購物車或下單按鈕。** 唯一轉換是 LINE。
   價格**逐件由 `products.price_public` 決定**。沒勾的商品，
   `/api/catalog` 連 `price` 這個鍵都不會輸出 —— 不是輸出了再讓前端隱藏。
   輸出了再隱藏的話價格仍然在網路回應裡，打開 devtools 就看得到。
2. **`#C5A880` 不可用於文字**（對比僅 1.9:1）。金色文字一律 `#A8875C`。
3. **不使用 Tailwind。** 設計 token 寫在 `velora-frontend/src/style.css`。
4. **Excel 的 FOB 出口單價與供應商聯絡資訊不得進入前端。**
   D1 的 schema 裡**沒有 cost 欄位，而且不打算有** —— 不設欄位跟
   「設了但查詢時不 SELECT」是兩回事，後者只要有人寫一次 `SELECT *`
   就外洩，而那行程式碼看起來無害到不會有人在 review 時停下來。
5. 圖片路徑一律取自 `src/data/media-manifest.js`，不要手寫檔名。
6. **建置素材不要放進 `velora-frontend/public/`。** 那個目錄是原樣複製到
   網站上的，放進去就等於公開，即使沒被引用。影像來源檔放 `tools/media-src/`。
7. **內容定址的檔名規則有三份拷貝**（`tools/lib/assemble.mjs` 的
   `imageFileName()`、`src/admin/imgurl.js` 的 `publicUrl()`、
   `worker/index.js` 的 `fileNameOf()`）。三個 runtime 各一份，無法共用 ——
   改任何一處都要同步另外兩處，否則算出來的網址對不到圖。

## 部署：什麼會上網站

`npm run build` 產出的 **`velora-frontend/dist/` 就是要上傳到伺服器的全部內容**，
其餘任何東西都不會上線。Vite 的規則只有兩條：

| 位置 | 行為 |
|---|---|
| `velora-frontend/public/` | **原樣複製**到 `dist/`，網址為 `/xxx`。放進去就等於公開，即使沒被用到 |
| `velora-frontend/src/` | **只有真的被 import 的檔案**會被打包，沒引用的會被丟掉 |
| `design/`、`.claude/` | 建置完全不會碰到 |

要確認有沒有東西誤上線，跑稽核工具：

```bash
node check-public.mjs              # 哪些進 Git、哪些上網站、有無機密
node check-public.mjs 自訂關鍵字     # 用自己想到的字搜
git ls-files                       # 會被推送的完整清單（只有這些）
```

### 部署：Cloudflare Worker

站台是 **Cloudflare 上的一個 Worker**，名字叫 `velorasit`，
網址 `https://velorasit.chenghsuanno1.workers.dev`。

🔴 **它是 Worker，不是 Pages。** 兩者的設定檔形狀不一樣，混用會靜默失效：

| Pages 的寫法（❌ 不要用） | Worker 的寫法（✅） |
|---|---|
| `pages_build_output_dir = "./dist"` | `[assets] directory = "./dist"` |
| `functions/api/*.js` 資料夾慣例 | `main = "worker/index.js"` 自己分路由 |
| `wrangler pages deploy` | `wrangler deploy` |

2026-09-28 修過一次：當時設定是 Pages 形狀而專案是 Worker，
加上 `wrangler.toml`／`package.json`／dashboard 三處寫了三種專案名，
而且 `package-lock.json` 與 `package.json` 不同步讓 `npm ci` 直接中止。
改名或搬設定的時候三處要一起改。

Cloudflare 的建置設定（Workers Builds，接 GitHub）：

```
Build command     npm run build:worker
Deploy command    npx wrangler deploy
Root directory    velora-frontend
```

`npm run build:worker` 把兩個建置疊成一份 `dist/`：
公開版在根、後台版在 `dist/admin/`（順便刪掉後台那份重複的 `media/`）。
路由用 `IS_PUBLIC` 分支，Rollup 會把不需要的那一半整段移除 ——
公開版的 bundle 裡沒有後台的任何一行。

`worker/index.js` 的分工：靜態檔由 Cloudflare 的 assets 層直接回，
`/api/*` 落到 Worker 查 D1，其餘沒有對應檔案的路徑回 `index.html` 給前端路由。

🔴 `[assets]` 的 `not_found_handling` 必須維持預設的 `"none"`。
設成 `"single-page-application"` 的話靜態層會在找不到檔案時直接回 `index.html`，
`/api/*` 也一樣 —— Worker 永遠不會執行，前端拿到 200 加一份 HTML，
然後在 `JSON.parse` 才炸，錯誤訊息會指向完全無關的地方。

**GitHub Actions 的部署流程已於 2026-09-28 刪除**（`.github/workflows/deploy.yml`）。
它發布的是 GitHub Pages 上的舊三站配置（`/`、`/v1/`、`/v2/`、`/admin/`，含已退場的
velora2），跟現在的單一 Worker 沒有關係，留著只會一直失敗。

### 稽核關卡

原本寫在那個 workflow 的 `run:` 區塊裡的七道關卡已經抽成
**`tools/check-gates.mjs`**，由 `npm run build:worker` 自動執行 ——
Cloudflare 跑的就是這個指令，所以關卡真的擋在部署路徑上。

```bash
cd velora-frontend && npm run audit     # 七道關卡 + check-public
node tools/check-gates.mjs --api https://velorasit.chenghsuanno1.workers.dev
```

🔴 **關卡 3 比對 `.secret-watch.txt`** 的 16 個真實機密字串
（供應商姓名、手機、事業登記號、FOB 數字）。那個檔案本身就是機密，
被 .gitignore 擋住、只存在本機。沒有它也沒有 `COST_CANARY` 的話
關卡會**失敗**而不是跳過 —— 一道沒有比對來源的關卡會安靜地永遠通過，
那比沒有關卡更糟。

第 7 道換過了。原本是「velora2 原始檔沒被弄髒」，velora2 退場後改成
**打線上 `/api/catalog` 對回應跑同一套成本檢查**。
理由：前六道掃的是 `dist/`，而商品資料 2026-09-28 起不在 `dist/` 裡了 ——
關卡的涵蓋範圍在那天縮水了，而沒有任何東西會提醒你。
這一道把稽核補回資料真正流出去的那條路。

### 後台

`https://velorasit.chenghsuanno1.workers.dev/admin/`

後端是 `worker/admin.js`，資料在 D1。認證是密碼 → PBKDF2 → HMAC 簽章令牌
（8 小時），連錯五次鎖十五分鐘。祕密存在 `admin_state` 表。

🔴 `admin_state` **沒有任何讀取端點**，每個 op 都不回傳它的內容。
新增 op 的時候不要為了除錯「先把 state 印出來看看」。

🔴 密碼的 PBKDF2 只有 **10 萬輪**，那是 Cloudflare Workers 的硬上限
（超過會回 `iteration counts above 100000 are not supported`）。
OWASP 建議 31 萬，所以這裡比建議值低三倍 —— 代價是 D1 內容外洩時
離線破解快三倍。唯一能補回來的是密碼長度，**請用長通行句**。
輪數存在 `admin_state.pw_iters`，Cloudflare 放寬了改那一列即可。

🔴 令牌要整批撤銷就把 `admin_state.token_epoch` +1，
所有已發出的令牌立刻失效，不必等它們自己過期。

**改密碼**用 `node tools/set-password.mjs`（在 repo 根目錄跑）。
它互動式問兩次密碼、只改 `admin_state` 的那幾列、順便把 `token_epoch` +1
讓所有現有登入失效，然後刪掉暫存的 SQL 檔。

🔴 **不要用 `d1-seed.mjs` 改密碼。** 它也能設，但會連商品一起清空重灌 ——
那是一次性遷移工具，不是維運工具。

實測過的四件事：舊密碼失效、改密碼前發出的令牌被撤銷、新密碼可用、
商品資料一筆都沒動。

**「發布」鍵已經沒有意義** —— 儲存即生效。`publish` 這個 op 還留著
（回 `noop: true`）只是為了讓舊的前端不會拿到 `bad-op`；
UI 上那顆按鈕應該拿掉，不是留著假裝有用。

**換圖仍然需要後台上傳**（位元組直接進 D1），不需要重新部署。
只有改了 `public/media/` 底下的固定素材（品類封面、主視覺輪播）
才要重跑 `npm run build:worker && npx wrangler deploy`。

## 語言：只有繁體中文

**全站單語，不做語言切換。** 2026-09-28 拿掉了原本的繁中／English／한국어
三語切換（導覽列的切換器、`localStorage` 偏好、依瀏覽器語言自動選擇）。

- 介面字串：`src/i18n.js` 的 `UI` 表，用 `t('key')` 取用
- 商品資料：Sheet 仍然是 `{ zh, en, ko }` 形式的欄位，用 `pick(field)` 取用，
  但 `pick()` 現在一律回傳 `zh` —— **資料層沒有跟著砍**，
  因為欄位在 Sheet 裡，砍掉的是前台的呈現，不是別人已經填好的內容
- 後台本來就只有中文，不受影響

要加語言的話是把切換器加回來，不是在元件裡寫 `if (lang === 'en')`。
