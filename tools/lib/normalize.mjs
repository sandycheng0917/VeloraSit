/**
 * 值的正規化：兩個原始函式，全專案的建置期工具共用。
 *
 * 抽出來不是為了「減少重複」這種抽象的整潔，是因為這兩個函式各自帶著
 * 一次實際的事故。複製一份就是把事故的修補留在原地、新的那份重新踩一次。
 */

/**
 * Sheet 的核取方塊回 boolean，手打的可能是字串 'TRUE'／'true'。
 *
 * D1 之後仍然需要它：遷移腳本要把 Sheet 的混合型別收斂成 0/1，
 * 而 STRICT 表會在收斂失敗時直接報錯（這正是我們要的）。
 */
export const bool = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE'

/**
 * 文字欄位一律走這裡。
 *
 * 🔴 布林值視為空白。Sheet 的儲存格如果殘留核取方塊，讀回來會是
 *    true / false，String() 之後就變成字面的「false」印在商品頁上 ——
 *    2026-09-07 新增 detail_* 時真的發生過，14 件商品的「用法」
 *    全部印著 false。文字欄位收到布林值一定是資料錯了，
 *    與其把錯誤原樣印給客人看，不如當成沒填。
 */
export const str = (v) =>
  v === null || v === undefined || typeof v === 'boolean' ? '' : String(v).trim()
