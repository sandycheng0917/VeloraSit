-- ══════════════════════════════════════════════════════════════════
--  D1 初始 schema：商品、品牌、品類
--
--  套用：
--    npx wrangler d1 migrations apply veloradb_sit --remote
--
--  欄位形狀刻意沿用 Google Sheet 的扁平寫法（name_zh / name_en / name_ko
--  三欄，而不是一個 JSON 欄位）。理由跟 Sheet 當初一樣：一個儲存格一個值，
--  人看得懂、改得動，而且 SQL 可以直接對單一語言做查詢與排序。
--  組成前台要的 { zh, en, ko } 物件是 catalog.js 的工作，不是資料庫的。
-- ══════════════════════════════════════════════════════════════════

-- ── 🔴 這裡沒有 cost 欄位，而且永遠不會有 ─────────────────────────
--
--  成本（cost / cost_ccy / fob / unit_price / supplier_note）在 Sheet 的
--  products_private 分頁，那是 B2B 機密。
--
--  不設欄位跟「設了欄位但查詢時不 SELECT」是完全不同的兩件事：
--  後者只要有人寫了一次 SELECT *，機密就上網了，而且那行程式碼看起來
--  無害到不會有人在 review 時停下來。沒有欄位的話，成本連存進來都做不到 ——
--  這是結構上的保證，不是紀律上的。
--
--  要放成本請另外開一個資料庫，不要加在這裡。
-- ──────────────────────────────────────────────────────────────────

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  house         TEXT,
  origin        TEXT,

  -- SQLite 沒有 BOOLEAN，用 0/1。NOT NULL + DEFAULT 讓「沒填」有明確語意：
  -- 漏填的商品是上架的（跟 catalog.js 的 r.listed !== false 一致），
  -- 而不是靜悄悄從網站上消失。
  listed        INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
  featured      INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),

  -- "order" 是 SQL 保留字，一律要加雙引號。改名成 sort_order 會比較省事，
  -- 但那樣就跟 Sheet 欄名、products.generated.js、後台三處都對不上了。
  "order"       INTEGER NOT NULL DEFAULT 0,
  updated       TEXT,

  -- 🔴 NULL 表示 Sheet 的 price_public 沒有勾選 —— 不是「價格是 0」。
  --    前台判斷用 IS NULL，不要用 price > 0：真的標 0 元的商品
  --    （贈品、樣品）會被誤判成不公開。
  price         REAL,

  name_zh       TEXT NOT NULL DEFAULT '',
  name_en       TEXT NOT NULL DEFAULT '',
  name_ko       TEXT NOT NULL DEFAULT '',
  tagline_zh    TEXT NOT NULL DEFAULT '',
  tagline_en    TEXT NOT NULL DEFAULT '',
  tagline_ko    TEXT NOT NULL DEFAULT '',
  desc_zh       TEXT NOT NULL DEFAULT '',
  desc_en       TEXT NOT NULL DEFAULT '',
  desc_ko       TEXT NOT NULL DEFAULT '',
  material_zh   TEXT NOT NULL DEFAULT '',
  material_en   TEXT NOT NULL DEFAULT '',
  material_ko   TEXT NOT NULL DEFAULT '',
  spec_zh       TEXT NOT NULL DEFAULT '',
  spec_en       TEXT NOT NULL DEFAULT '',
  spec_ko       TEXT NOT NULL DEFAULT '',
  detail_zh     TEXT NOT NULL DEFAULT '',
  detail_en     TEXT NOT NULL DEFAULT '',
  detail_ko     TEXT NOT NULL DEFAULT '',

  -- 香調只有香氛用得到，其餘品類三個 slot 都是空字串。
  -- 分號分隔，跟 Sheet 一樣 —— 拆成 array 是 catalog.js 的事。
  notes_top_zh  TEXT NOT NULL DEFAULT '',
  notes_top_en  TEXT NOT NULL DEFAULT '',
  notes_top_ko  TEXT NOT NULL DEFAULT '',
  notes_mid_zh  TEXT NOT NULL DEFAULT '',
  notes_mid_en  TEXT NOT NULL DEFAULT '',
  notes_mid_ko  TEXT NOT NULL DEFAULT '',
  notes_base_zh TEXT NOT NULL DEFAULT '',
  notes_base_en TEXT NOT NULL DEFAULT '',
  notes_base_ko TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_products_listed_order ON products (listed, "order");
CREATE INDEX idx_products_category ON products (category);

-- ── 商品圖 ────────────────────────────────────────────────────────
--
-- 開一張表而不是在 products 塞一個逗號字串：順序是資料的一部分
-- （position 0 是主圖，前台的 image / thumb 都取它），而排序用字串切割
-- 表達的話，每個讀取端都要自己記得切、自己記得別 trim 掉空項。
--
-- 檔名帶內容雜湊（frg-ylang-main-b9593ddb.webp），實體檔案在
-- velora-frontend/public/media/，由 vite build 原樣複製到 dist/media/。
-- 圖不在 D1 裡 —— 靜態檔走 CDN 比走資料庫快，也不吃 D1 的容量。
CREATE TABLE product_files (
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  file       TEXT NOT NULL,
  PRIMARY KEY (product_id, position)
);

-- ── 品牌 ──────────────────────────────────────────────────────────
--
-- listed 控制的是「品牌要不要露出」，不是商品的上下架。
-- 取消勾選之後品牌館少一塊、商品卡上的品牌名不再出現，
-- 但那些商品照樣在架上 —— 它們只是變成「沒有掛品牌」的商品。
CREATE TABLE houses (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ko    TEXT NOT NULL DEFAULT '',
  country_zh TEXT NOT NULL DEFAULT '',
  country_en TEXT NOT NULL DEFAULT '',
  country_ko TEXT NOT NULL DEFAULT '',
  tagline    TEXT NOT NULL DEFAULT '',
  intro_zh   TEXT NOT NULL DEFAULT '',
  intro_en   TEXT NOT NULL DEFAULT '',
  intro_ko   TEXT NOT NULL DEFAULT '',
  listed     INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
  "order"    INTEGER NOT NULL DEFAULT 0
);

-- ── 品類 ──────────────────────────────────────────────────────────
--
-- 沒有上架商品的品類前台會自己濾掉（導覽列點進去是空的比沒有那一項更糟），
-- 所以這裡不需要 listed —— 濾除條件是「有沒有商品」，那是算出來的，
-- 不是填出來的。填出來的話就會有「勾了卻還是不見」的無解客訴。
CREATE TABLE categories (
  key              TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  ref              TEXT NOT NULL,
  name_zh          TEXT NOT NULL DEFAULT '',
  name_en          TEXT NOT NULL DEFAULT '',
  name_ko          TEXT NOT NULL DEFAULT '',
  short_zh         TEXT NOT NULL DEFAULT '',
  short_en         TEXT NOT NULL DEFAULT '',
  short_ko         TEXT NOT NULL DEFAULT '',
  cover            TEXT NOT NULL DEFAULT '',
  spec_label_zh    TEXT NOT NULL DEFAULT '',
  spec_label_en    TEXT NOT NULL DEFAULT '',
  spec_label_ko    TEXT NOT NULL DEFAULT '',
  detail_label_zh  TEXT NOT NULL DEFAULT '',
  detail_label_en  TEXT NOT NULL DEFAULT '',
  detail_label_ko  TEXT NOT NULL DEFAULT '',
  "order"          INTEGER NOT NULL DEFAULT 0
);
