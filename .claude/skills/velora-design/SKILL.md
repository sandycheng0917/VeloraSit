---
name: velora-design
description: 維羅拉國際（Velora）專案的設計系統與素材管線。要改前端版面、色票、字體、文案，或要重跑素材擷取／影像處理／Pencil .ep 產生時載入。涵蓋韓系低調奢華「雕版目錄」設計語彙、金色可讀性規則、影像板機制，以及 PDF／Excel 素材擷取的完整流程。
---

# 維羅拉設計系統與素材管線

## 這個專案是什麼

維羅拉國際有限公司（Velora International CO., LTD）是**韓國選品代理商**，
代理兩家品牌：VUCA（居家香氛擴香）與 SAINTMARI（真絲長巾、純銀飾品）。

網站**沒有購物車**，唯一的轉換是 LINE。整站的工作只有一件：
讓人信任這個選品眼光到願意加 LINE。所以：

- 展示頁**不出現購物車、下單按鈕**
- 價格**逐件由 Sheet 的 `price_public` 決定**（2026-09-06 改）。
  沒勾的商品，產生器連 `price` 欄位都不輸出到前台檔案 —— 不是輸出了再隱藏。
  成本 `cost` 是另一回事：它在 `products_private` 分頁，永遠不進任何輸出。
- 商品彈窗的行動點是「用 LINE 詢問這件」，不是「加入購物車」

## 設計語彙：雕版目錄 (Engraved Catalogue)

簽名元素是**目錄書脊**：左邊距一條貫穿全頁的 1px 金線，
每區塊掛菱形飾釘與直排代碼，每件商品帶索引 `VL · SLK · 001`。
它回答的是「怎麼讓擴香、絲巾與銀飾看起來出自同一個家」。

完整規格見 `design/spec/00-design-system.md`。以下是最容易踩錯的幾條：

### 🔴 金色規則（不可違反）

`#C5A880` 在 `#FDFBF7` 上對比僅 1.9:1，**不可承載任何文字**。

- `#C5A880` → 只做線、框、實心按鈕底、Toggle 開啟態
- `#A8875C` → 所有金色文字（對比 4.6:1，達 WCAG AA）
- `#D4AF37` → 僅稀有標記

### 🔴 字體：拉丁與中文刻意不同臉

- Display Latin：**Italiana** 400（不低於 24px，全站只出現數次）
- Display CJK：**Noto Serif TC** 200
- Body：**Noto Sans TC** 300／行距 1.7–1.9
- Index／資料：**DM Mono** 300

兩種文字視為兩個語域，**不要把它們配成同一臉** —— 這是刻意的，不是疏漏。

### 🔴 影像板 `.plate` 的兩個必要條件

```css
.plate      { display: block }              /* 多處用 <span>，inline 的 aspect-ratio 無效會塌成 0 */
.plate > img{ position: absolute; inset: 0 } /* 否則圖片原生高度會反過來撐開容器 */
```

`.plate.is-cutout` 用於去背圖（改 `contain`、底色 `--bg-alt`、不壓暗角）。
判準是副檔名 `.png` —— 因為 `build-assets.py` 會把沒有實際透明像素的圖轉存 JPEG，
所以 `.png` 可以直接當成「這是去背圖」。用 `catalog.js` 匯出的 `isCutout()`，不要另外寫。

### 文案原則

用平實的繁體中文，講具體的事，不要謎語式的句子。
避免「留著針腳的溫度」這類文藝修辭，也避免「替你挑過，你只需要…」這種居高臨下的語氣。
寫「邊緣以手工捲縫收口，垂墜時不會翻捲」這種讀者拿得到的資訊。

## 素材管線

四步都可重跑，`design/sample/` 的原始檔永不被覆寫。

```bash
python design/extract-pdf.py     # PDF → sample/extracted/（零安裝）
python design/extract-xlsx.py    # xlsx → sample/xlsx_media/（零安裝，保留儲存格對應）
python design/build-assets.py    # 去背合成 · 統一影調 · 壓縮 → public/media/ + media-manifest.js
python design/build-ep.py        # → design/velora_design.ep（Pencil 設計檔）
```

`build-assets.py --raw` 可略過統一影調，還原原色。

**改了商品資料或圖片後，`design/build-ep.py` 裡的文案也要同步** ——
`.ep` 是獨立產生的，不會自動跟著 `catalog.js` 走。

## 前端

```bash
cd velora-frontend && npm run dev     # http://localhost:5173  /  /admin
npm run build                         # 必須通過
node design/shoot.mjs                 # 截圖 → design/exports/
python design/crop-exports.py         # 把長圖切成區段
```

- **不使用 Tailwind**。設計 token 直接寫在 `src/style.css`，
  因為每個字距、行距、髮絲線都被精確指定，utility class 反而要大量 arbitrary value。
- 商品資料的介面層是 `src/data/catalog.js`，但**資料本身在 Cloudflare D1** ——
  它執行時打 `/api/catalog`。新增一條商品線是在 D1 的 `categories` 表加一筆，
  導覽列、品類格、後台 Tab 都會自動跟上。
- `products` / `featured` / `categories` / `houses` 是 **computed ref**，不是陣列。
  樣板裡直接用沒問題（`script setup` 的頂層 import 會自動解包），
  但在 `<script>` 裡要寫 `.value`。漏掉不會報錯 —— 你會對一個 RefImpl 呼叫
  `.filter()`，錯誤指向的地方跟原因差很遠。
- 圖片路徑由 `media-manifest.js` 提供，**不要手寫檔名**。

## 🔴 機密資料

`design/sample/Jewelry accessories/絲巾與飾品.xlsx` 含 B2B 機密：
供應商事業登記號（欄 F）、業務姓名與手機（欄 G）、FOB 出口單價（欄 P/Q）。

**這些欄位不得進入 `catalog.js` 或任何前端檔案。**
接後端時應存於受權限控管的資料表，由伺服器端驗證身分後才回傳。
公開展示頁顯示的價格是 Sheet 的 `price`，而且只在 `price_public` 勾選時才輸出。
FOB 出口單價（`cost`）與供應商資訊是另一個層級，永遠不進任何前端檔案。

## 語言：只有繁體中文

**2026-09-28 拿掉三語切換。** 導覽列的切換器、`localStorage` 偏好、
依瀏覽器語言自動選擇全部移除，`<html lang="zh-Hant-TW">` 寫死在 `index.html`。

- `t('key')` 取介面字串（`src/i18n.js` 的 `UI` 表，只有中文）
- `pick(field)` 取商品資料的 `{ zh, en, ko }` 欄位，一律回 `zh`
- **`pick()` 的 `zh → en → ko` fallback 鏈不要砍。** Sheet 與 D1 的 `en`／`ko`
  欄位還在，後台也還在收；砍掉的是前台的呈現，不是別人已經輸入的內容。
  某件商品只填了 `en` 沒填 `zh` 時，退到 `en` 至少看得到東西
- 要加語言的話是把切換器加回來，不是在元件裡寫 `if (lang === 'en')`

新增商品時中文品名與描述必填。驗證要打 API，不能 import `catalog.js` ——
商品資料 2026-09-28 起在 Cloudflare D1，`catalog.js` 的 `products` 是一個
**執行時才填的 Vue ref**，node 裡 import 它只會拿到空陣列：

```bash
curl -s https://velorasit.chenghsuanno1.workers.dev/api/catalog | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const bad=JSON.parse(s).products.filter(p=>!p.name?.zh);
  console.log(bad.length?'缺中文品名: '+bad.map(p=>p.id).join(', '):'OK')})"
```

## 截圖的坑

`design/shoot.mjs` 已處理，但如果你要自己截圖：

- 網址用 `127.0.0.1` 不要用 `localhost` —— Vite 預設只綁 IPv6 `::1`
  （用 `npx vite --host 127.0.0.1` 啟動）
- `--screenshot=` 路徑在 Windows 要用**反斜線**，正斜線會靜默失敗
- 每次用全新的 `--user-data-dir`，而且**不要在瀏覽器關閉時立刻刪**；
  殘留的半刪目錄會讓之後每一次啟動都失敗（連 `about:blank` 都截不出來）
- **Chrome 比 Edge 穩定**，優先用 Chrome
