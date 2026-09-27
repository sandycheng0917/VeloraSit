# 維羅拉國際有限公司 — 專案說明

Velora International CO., LTD ——「韓國選品代理」形象網站與後台商品管理原型。
代理 VUCA（居家香氛）與 SAINTMARI（真絲長巾、純銀飾品）兩家韓國品牌。

## 專案結構

```
velora-frontend/     Vue 3 + Vite 前端
  src/admin/         後台（商品管理），只在 build:admin 進 bundle
  src/data/          catalog.js 是介面層，*.generated.js 由建置產生
velora2/             提案站（靜態，無建置流程）
site/                三站入口的選單頁
apps-script/         Google Apps Script 後端（路由、認證、匯出、讀寫）
tools/               建置期工具（產生器、注入器、遷移、退化檢查）
design/              設計交付：.pen 設計檔、規格書、素材管線
check-public.mjs     公開前稽核：哪些會進 Git、哪些會上網站
```

**商品資料在 Google Sheet，不在程式碼裡。**
Apps Script 以擁有者身分執行，所以整套架構裡沒有「Sheet 存取金鑰」這種東西。
建置時由 `tools/build-catalog.mjs` 打匯出端點取回，產生
`src/data/products.generated.js` 與 `site.generated.js`；
`catalog.js` 只剩一層形狀轉換，前台元件不知道資料從哪來。

`*.generated.js` 進版控，讓離線 `npm run dev` 有東西可看。但 **CI 讀不到 Sheet 時
必須硬失敗中止部署**，不可靜默回退到那份種子 —— 那會讓「按了發布、跑完了、
內容卻沒變」，是最糟的失敗模式。

## 常用指令

```bash
cd velora-frontend && npm run dev        # 開發（5173），對外版本
cd velora-frontend && npm run dev:admin  # 後台（也是 5173，但根路徑就是後台）
cd velora-frontend && npm run build      # 公開版建置，必須通過

node tools/build-catalog.mjs --from tools/fixture.json --images tools/images.json --out build/site
node tools/check-regression.mjs       # 內容有沒有比上一版少
node tools/inject-velora2.mjs --check # velora2 卡片注入的乾跑
node check-public.mjs --dist build/site

python design/build-assets.py         # 重建圖庫（改了 sample/ 之後）
node design/shoot.mjs                 # 產生預覽圖（需先跑 dev）
```

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

### 部署

推到 `main` 由 `.github/workflows/deploy.yml` 自動建置並發布到 GitHub Pages。

前置設定（只需一次）：repo 設為 Public，
然後 Settings → Pages → Source 選 "GitHub Actions"。

網址為 `https://<帳號>.github.io/<repo>/`；
子路徑由 workflow 以 `VITE_BASE` 自動代入，不需手動改設定。

後台程式碼在 `velora-frontend/src/admin/`，**進版控**（2026-09-06 改）。
公開版與後台版是兩個獨立站台，各自的根路由不同：
`npm run build` 的根是展示頁（部署在 `/v1/`），
`npm run build:admin` 的根是後台（部署在 `/admin/`）。
路由用 `IS_PUBLIC` 分支，Rollup 會把不需要的那一半整段移除 ——
公開版的 bundle 裡沒有後台的任何一行。

## 語言：只有繁體中文

**全站單語，不做語言切換。** 2026-09-28 拿掉了原本的繁中／English／한국어
三語切換（導覽列的切換器、`localStorage` 偏好、依瀏覽器語言自動選擇）。

- 介面字串：`src/i18n.js` 的 `UI` 表，用 `t('key')` 取用
- 商品資料：Sheet 仍然是 `{ zh, en, ko }` 形式的欄位，用 `pick(field)` 取用，
  但 `pick()` 現在一律回傳 `zh` —— **資料層沒有跟著砍**，
  因為欄位在 Sheet 裡，砍掉的是前台的呈現，不是別人已經填好的內容
- 後台本來就只有中文，不受影響

要加語言的話是把切換器加回來，不是在元件裡寫 `if (lang === 'en')`。
