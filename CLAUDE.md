# 維羅拉國際有限公司 — 專案說明

Velora International CO., LTD ——「韓國選品代理」形象網站與後台商品管理原型。
代理 VUCA（居家香氛）與 SAINTMARI（真絲長巾、純銀飾品）兩家韓國品牌。

## 專案結構

```
velora-frontend/     Vue 3 + Vite 前端，也是部署單位
  src/admin/         後台（商品管理），只在 build:admin 進 bundle
  src/data/          catalog.js 是介面層，執行時向 /api/catalog 取資料
  worker/            Cloudflare Worker 入口：/api/* 與 SPA fallback
  migrations/        D1 的 schema（wrangler d1 migrations）
  wrangler.toml      Worker 設定（不是 Pages —— 見下方部署）
apps-script/         Google Apps Script 後端（後台仍走這條）
tools/               建置期工具（產生器、D1 種子、遷移、退化檢查）
design/              設計交付：.pen 設計檔、規格書、素材管線
check-public.mjs     公開前稽核：哪些會進 Git、哪些會上網站
velora2/             舊的靜態提案站，2026-09-28 退場（尚未刪除）
```

**商品資料在 Cloudflare D1（`veloradb_sit`），前台執行時才取回來。**
2026-09-28 之前是建置時由 `tools/build-catalog.mjs` 從 Google Sheet 取回、
烤進 `src/data/*.generated.js`，改一筆商品要重跑整條建置才看得到。
現在 `catalog.js` 打 `/api/catalog`，由 `worker/index.js` 查 D1。

`*.generated.js` 還在 repo 裡，但**前台不再 import 它們** ——
它們現在只有一個用途：當 `tools/d1-seed.mjs` 的輸入。

🔴 **沒有種子檔退路。** API 掛掉時前台顯示錯誤與重試，不會靜默拿種子頂上 ——
那會讓「資料庫壞了」長得跟「一切正常」一模一樣，而使用者看到的是一份
沒人知道有多舊的目錄。同理，`tools/build-catalog.mjs` 讀不到 Sheet 也必須硬失敗。

Sheet → D1 的搬運目前是手動的：跑 `build-catalog` 更新 `*.generated.js`，
再跑 `npm run d1:seed` 灌進 D1。要自動化的話接在 `build-catalog` 後面即可。

## 常用指令

```bash
cd velora-frontend
npm run dev          # 開發（5173）。/api/* 由 vite proxy 轉給線上 Worker，
                     # 所以本機看得到真實的 D1 資料，不必另開 wrangler
npm run dev:admin    # 後台（也是 5173，但根路徑就是後台）
npm run build        # 公開版建置，必須通過
npm run build:worker # 部署用：公開版 + 後台疊成一份 dist/（Cloudflare 跑這個）

npm run d1:migrate   # 套用 migrations/ 到遠端 D1
npm run d1:seed      # 由 *.generated.js 產生種子 SQL 並灌進遠端 D1
npm run cf:deploy    # 手動部署（等同 npx wrangler deploy）
```

```bash
node tools/build-catalog.mjs --from tools/fixture.json --images tools/images.json --out build/site
node tools/check-regression.mjs       # 內容有沒有比上一版少
node tools/check-admin-css.mjs        # 後台有沒有跟公開版全域樣式撞 class 名
node tools/d1-seed.mjs                # 只產生 SQL，不灌
node check-public.mjs --dist velora-frontend/dist

python design/build-assets.py         # 重建圖庫（改了 sample/ 之後）
node design/shoot.mjs                 # 產生預覽圖（需先跑 dev）
```

**驗手機版不要直接用 `--window-size=390` 截圖。** headless Chrome 的視窗尺寸
不等於版面視埠，截出來會像是右側被切掉 —— 那是假象，會讓人去修一個不存在的
溢出。要量就開一個同源頁面、用 `<iframe width="390">` 載入站台，
再讀 `contentDocument.documentElement.scrollWidth` 與各元素的 `getBoundingClientRect()`。

## 開始動手前

**要改版面、色票、字體、文案或素材，先載入 `velora-design` skill**
（`.claude/skills/velora-design/`）—— 裡面有金色可讀性規則、
影像板的兩個必要 CSS 條件、文案原則與機密資料紅線，
這些踩錯了畫面會壞或會外洩商業機密。

## 硬性規則

1. **展示頁不出現購物車或下單按鈕。** 唯一轉換是 LINE。
   價格則**逐件由 Sheet 的 `price_public` 決定** —— 這條在 2026-09-06 改了。
   沒勾的商品，產生器連 `price` 欄位都不會輸出到前台檔案，不是輸出了再隱藏。
   （成本 `cost` 是另一回事：它在 `products_private` 分頁，永遠不進任何輸出。）
2. **`#C5A880` 不可用於文字**（對比僅 1.9:1）。金色文字一律 `#A8875C`。
3. **不使用 Tailwind。** 設計 token 寫在 `velora-frontend/src/style.css`。
4. **Excel 的 FOB 出口單價與供應商聯絡資訊不得進入前端。**
5. 圖片路徑一律取自 `src/data/media-manifest.js`，不要手寫檔名。

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

它跑的七道稽核關卡（後台字串隔離、成本誘餌、憑證形狀…）也跟著消失了 ——
那些關卡是有價值的，只是當時寫在 workflow 的 `run:` 區塊裡而不是腳本裡。
要恢復的話從 git 歷史把 `deploy.yml` 撈出來，把關卡抽成一支 `node` 腳本
（Cloudflare 的建置指令是一行字串，放不下十幾個步驟），
再接到 `build:worker` 後面。在那之前，公開前請手動跑 `node check-public.mjs`。

## 語言：只有繁體中文

**全站單語，不做語言切換。** 2026-09-28 拿掉了原本的繁中／English／한국어
三語切換（導覽列的切換器、`localStorage` 偏好、依瀏覽器語言自動選擇）。

- 介面字串：`src/i18n.js` 的 `UI` 表，用 `t('key')` 取用
- 商品資料：Sheet 仍然是 `{ zh, en, ko }` 形式的欄位，用 `pick(field)` 取用，
  但 `pick()` 現在一律回傳 `zh` —— **資料層沒有跟著砍**，
  因為欄位在 Sheet 裡，砍掉的是前台的呈現，不是別人已經填好的內容
- 後台本來就只有中文，不受影響

要加語言的話是把切換器加回來，不是在元件裡寫 `if (lang === 'en')`。
