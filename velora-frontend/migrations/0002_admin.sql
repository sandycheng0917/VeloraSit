-- ══════════════════════════════════════════════════════════════════
--  D1 成為唯一真相：補齊後台需要的欄位、影像、認證與稽核
--
--  0001 的 schema 只夠前台顯示 —— 它是從 *.generated.js 來的，
--  而那份資料已經被 build-catalog 過濾掉一半欄位了。後台要編輯，
--  就得存下 Sheet 原本有的每一個欄位（成本那幾欄除外，永遠除外）。
--
--  套用：npx wrangler d1 migrations apply veloradb_sit --remote
-- ══════════════════════════════════════════════════════════════════

-- ── 補回 Sheet 上有、但前台用不到的欄位 ───────────────────────────
--
-- ref（索引碼 VL · FRG · 001）與 hs（報關號）2026-09-07 起不輸出到前台，
-- 但它們**在 Sheet 上一直都在**，是人維護的資料。D1 取代 Sheet 之後
-- 不存它們就等於把那些資料丟掉 —— 前台不顯示是呈現的決定，
-- 不是「這個欄位不存在」。
ALTER TABLE products ADD COLUMN ref TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN hs TEXT NOT NULL DEFAULT '';

-- price 與 price_public 是兩件事。price 是數字，price_public 是「要不要公開」。
-- 0001 只存了 price（而且沒勾的存 NULL），那讓「填了價格但先不公開」
-- 這個狀態無法表達 —— 後台一存就會把數字弄丟。
ALTER TABLE products ADD COLUMN price_public INTEGER NOT NULL DEFAULT 0 CHECK (price_public IN (0, 1));

-- 軟刪除。不真的刪列：id 永不回收。真刪掉的話，日後有人建一件同名商品，
-- 舊的影像鍵、外部連結、搜尋引擎的索引會全部指向新的那件東西。
ALTER TABLE products ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1));

-- 影像鍵（不是檔名）。檔名是內容定址算出來的，會隨內容改變；
-- 鍵是穩定的，跟著商品走。改商品編號時兩者都要搬（見 renameId）。
ALTER TABLE products ADD COLUMN img_main TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN img_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN img_3 TEXT NOT NULL DEFAULT '';

-- ── 影像 ──────────────────────────────────────────────────────────
--
-- 位元組直接存進 D1。原本它們在第二份 Google Sheet 裡，切成一格四萬字元的
-- base64 區塊 —— 那是為了繞過儲存格上限，不是好的設計，只是當時唯一的辦法。
--
-- 🔴 為什麼可以存進資料庫：目前 26 張共 2.5MB，D1 免費額度 5GB。
--    代價是圖片走 Worker 而不是直接走 CDN，所以 /media/ 的回應一定要帶
--    長效的 Cache-Control —— 內容定址的檔名代表內容變了檔名就變，
--    所以可以放心 immutable 快取，不會有「改了圖但使用者看到舊的」。
--
-- thumb 是 96px 的縮圖，後台清單一次把整頁畫完，不必逐張拉原圖。
CREATE TABLE images (
  key     TEXT PRIMARY KEY,
  mime    TEXT NOT NULL,
  alpha   INTEGER NOT NULL DEFAULT 0 CHECK (alpha IN (0, 1)),
  sha256  TEXT NOT NULL,
  bytes   INTEGER NOT NULL,
  data    BLOB NOT NULL,
  thumb   BLOB,
  updated TEXT NOT NULL DEFAULT ''
);

-- 檔名是算出來的（key-sha8[.cut].ext），查詢時要能反查回 key。
-- 建索引而不是存一份檔名欄位：存了就要維護兩份，而它們一定會不同步。
CREATE INDEX idx_images_sha ON images (sha256);

-- ── 後台認證 ──────────────────────────────────────────────────────
--
-- 原本在 Apps Script 的指令碼屬性裡。搬過來之後 Worker 就不需要任何
-- 外部服務 —— 但也代表**祕密現在在 D1 裡**，所以：
--
-- 🔴 pw_hash 存的是 PBKDF2 的結果，不是密碼。hmac_secret 用來簽令牌。
--    兩者都不該出現在任何回應裡；worker/admin.js 的每個 op 都不回傳
--    admin_state 的內容，而且這張表沒有任何讀取端點。
--
-- 🔴 token_epoch 是一次撤銷所有令牌的開關。密碼外洩時把它 +1，
--    所有已發出的 8 小時令牌立刻失效 —— 不必等它們自己過期。
CREATE TABLE admin_state (
  key     TEXT PRIMARY KEY,
  value   TEXT NOT NULL,
  updated TEXT NOT NULL DEFAULT ''
);

-- ── 稽核 ──────────────────────────────────────────────────────────
-- 出事時這是唯一的鑑識依據。寫入失敗不能拖垮主流程（見 worker/admin.js）。
CREATE TABLE audit (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   TEXT NOT NULL,
  op   TEXT NOT NULL,
  ok   INTEGER NOT NULL CHECK (ok IN (0, 1)),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_at ON audit (at DESC);

-- ── product_files 退場 ────────────────────────────────────────────
--
-- 它存的是「解析後的檔名」，而檔名現在可以從 products.img_* 接 images
-- 算出來。留著就是兩份真相，而它們一定會不同步 ——
-- 後台改了圖卻忘了同步這張表的話，前台會指向一個不存在的檔案。
DROP TABLE product_files;
