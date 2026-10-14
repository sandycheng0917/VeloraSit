# 維羅拉設計系統

**雕版目錄 (Engraved Catalogue)** — 韓系低調奢華

單一真實來源：[`design/tokens.json`](../tokens.json)（設計端）與
[`velora-frontend/src/style.css`](../../velora-frontend/src/style.css)（實作端）。
兩份的值必須一致；改色票或字級請同時改這兩支。

---

## 設計主張

維羅拉是**選品之家**：代理 VUCA（韓國居家香氛）與 SAINTMARI（韓國絲巾與純銀飾品）
兩家品牌，四條商品線彼此無關，靠的是同一雙眼睛。網站沒有購物車 ——
唯一的轉換是 LINE。因此整站的工作只有一件：讓人信任這個選品眼光到願意加 LINE。

### 簽名元素：目錄書脊 (The Catalogue Spine)

左邊距 `x=64` 一條貫穿全頁的 1px 金線，每個區塊掛一枚菱形飾釘與直排品類代碼
（`INDEX` / `CATEGORIES` / `FEATURED` / `CATALOGUE` / `PHILOSOPHY`），
每件商品帶自己的索引 `VL · SLK · 001`。

這不是裝飾性編號 —— 它在回答這門生意真正的問題：**怎麼讓擴香、絲巾與銀飾看起來出自同一個家。**

---

## 色票

> **2026-10-14 色系已改為粉紅、金、奶油。** 下表是原本奶油＋金的版本，保留作為歷史；
> 現行值以 `velora-frontend/src/style.css` 的 `:root` 為準（`--bg #FDF9F6`、`--bg-alt #FCEBE7`、
> `--surface #F9E1DB`、`--surface-deep/--rose #F2CEC6`、`--gold #C9A37D`、`--gold-deep #74533D`、
> `--rose-btn #9E5F63`、`--rose-ink #8E5257`），設計稿在 `design/pen.pen` 的「粉紅色系」畫板。

| Token | Hex | Pencil RGBA | 用途 |
|---|---|---|---|
| `--bg` | `#FDFBF7` | `#FDFBF7FF` | 頁面主背景 — 柔和暖米白 |
| `--bg-alt` | `#F8F6F0` | `#F8F6F0FF` | 交錯區塊背景 |
| `--surface` | `#F2EFE9` | `#F2EFE9FF` | 卡片底 — 奶茶杏灰 |
| `--surface-deep` | `#EBE7DF` | `#EBE7DFFF` | 次卡片 / hover 底 |
| `--gold` | `#C5A880` | `#C5A880FF` | **只做**細線、外框、實心鈕底、Toggle 開啟態 |
| `--gold-deep` | `#7E6239` | `#7E6239FF` | 金色**文字**（唯一可承載文字的金，對所有背景 ≥4.61:1） |
| `--gold-bright` | `#D4AF37` | `#D4AF37FF` | 精選標記（罕用） |
| `--ink` | `#1E1E1E` | `#1E1E1EFF` | 文字主色 — 沉穩碳墨黑 |
| `--ink-soft` | `#423E3B` | `#423E3BFF` | 次要說明字（10.6:1）。客戶手機實測兩次回報偏淡，已壓深 |
| `--ink-faint` | `#6C665F` | `#6C665FFF` | 編號、placeholder（≥4.60:1）。**線條色不可當文字用** |
| `--line` | `#E8E4DC` | `#E8E4DCFF` | 1px 髮絲邊框 |
| `--line-soft` | `#F0EDE7` | `#F0EDE7FF` | 表格列分隔 |
| `--line-strong` | `#D9D4C9` | `#D9D4C9FF` | 虛線上傳區 / 較強分隔 / placeholder |
| `--sidebar` | `#1F1D1B` | `#1F1D1BFF` | 後台側欄米黑 |
| `--sidebar-ink` | `#948E87` | `#948E87FF` | 深底上的次要文字 |
| `--green` | `#06C755` | `#06C755FF` | LINE 品牌綠 —— **只做圖示與外框** |
| `--green-deep` | `#037733` | `#037733FF` | LINE 綠**文字**（品牌綠當文字只有 1.97:1） |

### ⚠️ 金色規則（不可違反）

原規範的 `#C5A880` 在 `#FDFBF7` 上對比僅約 **1.9:1**，遠低於 WCAG AA 的 4.5:1，
**無法承載任何文字**。因此色票擴充一階：

- `#C5A880` → 線、框、實心按鈕底、Toggle 開啟態。**永不用於文字。**
- `#7E6239` → 所有金色文字。
  註：先前用過 `#A8875C`（3.23:1）與 `#8D6D40`，兩者都不足。
  **`#8D6D40` 對頁面底 `--bg` 是 4.62:1，但金字也出現在卡片底 `--surface-deep`
  `#EBE7DF` 上 —— 那裡只有 3.88:1。量對比時要以最深的背景為準，不能只量 `--bg`。**
- `#D4AF37` → 僅「精選 / FEATURED」等稀有標記。

視覺上兩者在米白底幾乎同調，不破壞低調奢華，但讓文字可讀。

### 金箔漸層

1px 線條不用扁平色塊，改用六段金屬漸層，讓細線像金箔反光：

```css
--gold-leaf: linear-gradient(90deg,#BC9D71 0%,#D9BD8F 20%,#EAD5A8 38%,
                             #C7A66C 52%,#E2C898 70%,#B99A6C 100%);
--gold-fill: linear-gradient(135deg,#C09A6C 0%,#DCC194 44%,#B8996B 100%);
```

用於：頁首底線、書脊、區塊飾線、選單底線、頁尾、表頭、抽屜標題列、
按鈕描邊（`padding-box` + `border-box` 雙背景，圓角不會被 `border-image` 吃掉）。

---

## 字體

| 角色 | 網頁 | `.ep` 檔內 | 規格 |
|---|---|---|---|
| Display Latin | **Marcellus** 400 | Noto Serif TC 200 | 字距 `+0.08em`，**不低於 26px** |
| Small Latin | **Noto Sans TC** 500 | — | 26px 以下的英文一律用這個（`.latin-sm`） |
| Display CJK | **Noto Serif TC** 200 | Noto Serif TC 200 | 字距 `+0.14em` |
| Body | **Noto Sans TC** 400/500 | Noto Sans TC | 行距 1.75–1.9；手機 16px |
| Index / Data | **DM Mono** 400／手機 500 | Noto Sans TC | 字距 `+0.16em`，只承載編號與資料 |

### ⚠️ 為什麼不是 Italiana

初版用 Italiana。它是**單一字重的高對比襯線體**，次筆畫近乎髮絲 ——
放大優雅，但在手機上細筆畫直接消失。客戶實測回報「英文太細、看得很吃力」，
把字級從 38px 拉到 44px 也只是變成「大的細字」，因為問題出在字體本身。

改用 **Marcellus**：取自羅馬碑刻字母，筆畫粗細接近均勻，
同樣是免費 Google Fonts 的單一字重襯線體，且碑刻血統正好呼應「雕版目錄」的設計語彙。

### ⚠️ 尺寸下限（仍然適用）

- **≥ 26px** → Marcellus（hero、區塊標題、精選品名、Logo、品類代碼）
- **< 26px** → `.latin-sm`（Noto Sans TC 500）。商品磚品名即屬此類。
- DM Mono 承載的編號在手機上提到 **12px / 500**，等寬拉丁字在小尺寸最吃虧。

中文沒有這個問題 —— Noto Sans TC 400 在 16px 下筆畫是實的，客戶也確認中文可讀。
**這是拉丁字專屬的問題，不要連中文一起調。**

**拉丁與中文刻意不配對成同一臉** —— 兩種文字視為兩個語域，
這是台韓精品站的實際做法，不是疏漏。

> `.ep` 檔內用 Noto 家族，因為 Marcellus 與 DM Mono 未安裝於本機，
> Pencil 只能使用系統字。要讓 Pencil 也顯示 Marcellus，
> 需先把字型安裝到系統或使用者字型目錄。

字級：hero 76/1.14 · h1 48/1.2 · h2 42/1.25 · h3 31/1.3 · h4 24/1.4 ·
lead 17/1.9 · body 15/1.7 · caption 13/1.6 · micro 11/1.5

---

## 幾何

- **圓角**：`4px`（按鈕、輸入框、縮圖、標籤）／`6px`（卡片、抽屜、彈窗）
- **邊框**：`1px solid #E8E4DC`
- **陰影**：
  - `--sh-ambient: 0 4px 20px rgba(0,0,0,.03)`
  - `--sh-raised: 0 8px 32px rgba(0,0,0,.05)`
  - 抽屜：`-8px 0 32px rgba(0,0,0,.05)`
- **版面**：畫布 1440 · 內容 1200 · 左右留白 120（響應式 `clamp(20px, 8.33vw, 120px)`）
- **書脊位置**：`clamp(16px, 4.4vw, 64px)`
- **間距刻度**（8 為基）：8 · 16 · 24 · 40 · 64 · 96 · 120 · 160

---

## 裝飾語彙

| 裝飾 | 做法 | 用在哪 |
|---|---|---|
| 金箔漸層線 | 六段金屬漸層取代扁平 1px | 頁首、書脊、飾線、選單、頁尾、表頭 |
| 菱形飾釘 | 45° 旋轉的 5px 方塊，取自雕版標籤的分隔飾 | 飾線中央、書脊刻度、品類件數前 |
| 雙層金框 | `border` + `outline-offset` 兩道同心金線 | 所有影像板、彈窗、QR、懸浮鈕 |
| 幽微字徽 | Marcellus 的 `V`，380px、透明度 6% | Hero 負空間、兩段理念區 |
| 紙質底紋 | `feTurbulence` 細顆粒，透明度 5.5% | 全頁背景與影像板 |

---

## 元件狀態

### 按鈕

| 元件 | 靜態 | Hover |
|---|---|---|
| `.btn-line` 探索系列 | 透明底 + 金箔描邊 + `#A8875C` 字 | 灌入金漸層、字轉 `#FFFCF6`、`0 4px 18px rgba(197,168,128,.30)` |
| `.btn-gold` 新增商品 | 金漸層實心 + `#FFFCF6` 字 | 加深漸層 + 金色光暈 |
| `.btn-ghost` 取消 | 1px `#E8E4DC` + `#686461` 字 | 邊框轉 `#D9D4C9`、字轉 `#1E1E1E` |
| `.link-gold` 查看細節 | `#A8875C` 字 + 金箔底線 | — |

### Toggle（展示狀態）

40 × 22 膠囊，圓鈕 16px：
- **開**：底 `#C5A880`，圓鈕靠右 `left: 21px`
- **關**：底 `#E8E4DC`，圓鈕靠左 `left: 3px`
- 轉場 `0.28s cubic-bezier(.22,.61,.36,1)`
- 語意：`role="switch"` + `aria-checked`

### 影像板 `.plate`

```
.plate            position:relative; display:block; overflow:hidden
.plate > img      position:absolute; inset:0; object-fit:cover
.plate::before    雙層金框（inset 17，outline-offset 5）
.plate::after     形體陰影 + 暗角
.plate.is-cutout  去背圖：底改 --bg-alt、object-fit:contain、不壓暗角
.plate.bare       無框無暗角（縮圖用）
```

⚠️ `display:block` 是必要的 —— 版面多處以 `<span>` 當影像板，
inline 元素的 `aspect-ratio` 無效，高度會塌成 0。
⚠️ `img` 必須絕對定位 —— 否則圖片原生高度會反過來把容器撐開。

---

## 影像處理原則

所有素材經 [`design/build-assets.py`](../build-assets.py) 統一處理：

1. **去背合成**：PDF 內商品照是「黑底 JPEG + 灰階遮罩」，合成回 RGBA PNG。
2. **透明偵測**：無實際透明像素的 RGBA 一律轉存 JPEG，
   讓 `.png` 副檔名真正代表「這是去背圖」，前端才能正確選擇裁切方式。
3. **統一影調**：香調意象圖（綠葉、紅櫻桃、藍海、桃紅花）原色會蓋過整頁的克制感，
   降至 **45% 飽和**並壓暖調 —— 四款仍可分辨，但落回色票，
   與黑白主視覺構成一致的影像語言。人像與商品照不套。
   跑 `python design/build-assets.py --raw` 可還原原色。
4. **壓縮**：長邊上限 1600、JPEG q86 漸進式，另產 240px 方形縮圖供後台清單使用。

---

## 動態

只有一個編排過的時刻：**主視覺載入序列**（eyebrow → 標題 → 副標 → CTA，
每段延遲 0.1–0.5s，`rise` 動畫 0.9s）。其餘皆為安靜的 hover 微互動：

- 卡片：邊框轉金、上浮 2–3px、底部金線由左展開 `0.7s`
- 輪播：`opacity` 淡入 `1.1s`，每 6 秒自動換頁
- 抽屜：`translateX` 滑入 `0.42s`

`@media (prefers-reduced-motion: reduce)` 全數關閉。

---

## 無障礙

- 所有文字對比 ≥ 4.5:1（金色文字一律 `#8D6D40`）
- 手機（≤720px）內文 17px、mono 編號 12.5px/500，小字級整批上調一階，字距收窄

  ⚠️ **手機放大規則寫在哪，取決於該 class 定義在哪。**
  Vue scoped 樣式會編成 `.t-ref[data-v-x]`，specificity（0,2,0）高過
  `style.css` 裡的全域 `.t-ref`（0,1,0）—— 全域的手機規則會被無聲蓋掉。
  凡是定義在 `.vue` scoped 區塊的 class（`.t-ref` / `.cd .n` / `.eyebrow` /
  `.attrs span` / `.t-name` / `.t-zh`），手機放大就必須寫在同一個元件裡。

  ⚠️ **字級要照實測寬度定，不要照想像的斷點。**
  圖庫在手機上是**單欄、磚寬 313px**（`minmax(160px,1fr)` 在 313px 的容器裡
  只排得下一欄），不是直覺以為的兩欄 167px。先量再定字級。 —— 細字重在小螢幕上讀中文會吃力
- 觸控目標最小 44×44px（✕、語言切換這類小字鈕靠 padding 撐開，視覺位置不變）
- **彈窗在手機不可以用 `max-height: none`** —— 那會讓面板長到內容高度、
  改由外層遮罩捲動，絕對定位的 ✕ 就跟著捲出畫面，讀完內文得一路捲回頂端才關得掉。
  正確做法：面板限制在視窗高度內、只讓內文區 `overflow:auto`，✕ 才會永遠釘在右上角；
  再於內文最後補一顆「關閉」，捲到底也不必回頭。
- `:focus-visible` 一律 2px `#A8875C` 外框 + 3px offset
- Toggle 用 `role="switch"` + `aria-checked`
- 彈窗 `role="dialog"` + `aria-modal`，Esc 關閉，開啟時鎖背景捲動
- 輪播 `role="tablist"` + `aria-selected`
- 裝飾性元素（書脊、字徽、飾線）一律 `aria-hidden="true"`
