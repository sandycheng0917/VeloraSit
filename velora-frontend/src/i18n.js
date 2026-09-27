/**
 * 介面字串：全站只有繁體中文。
 *
 * 2026-09-28 拿掉三語切換。語言不再是狀態 —— 沒有 ref、沒有 watch、
 * 沒有 localStorage，`<html lang="zh-Hant-TW">` 寫死在 index.html 裡。
 *
 * 兩個工具照舊：
 *   t('key', ...args)   介面字串（下面的 UI 表，%s 為插入點）
 *   pick(field)         商品資料的語言欄位，形如 { zh, en, ko }
 *
 * 🔴 pick() 的 fallback 鏈不要砍。Sheet 的 en / ko 欄位還在，也還有人在填 ——
 *    砍掉的是前台的呈現，不是別人已經輸入的內容。某件商品只填了 en 沒填 zh
 *    的時候，退到 en 至少看得到東西；直接回 field.zh 會變成空白的商品卡。
 */

export const pick = (field) => {
  if (field == null) return ''
  if (typeof field === 'string') return field
  return field.zh ?? field.en ?? field.ko ?? ''
}

const UI = {
  searchPlaceholder: '搜尋商品、品類或編號',
  searchLabel: '搜尋商品',
  openSearch: '開啟搜尋',
  clearSearch: '清除搜尋',
  lineConsult: '用 LINE 諮詢',
  menu: '開關選單',
  langLabel: '切換語言',
  heroEyebrow: '2026 秋季 — 韓國選件',
  heroSub1: '來自韓國的居家香氛、真絲長巾與純銀飾品。',
  heroSub2: '每一件都經手挑過，才放進這裡。',
  explore: '探索系列',
  askOnLine: '或直接用 LINE 問我們 →',
  heroCarousel: '主視覺輪播',
  slideN: '第 %s 張',
  catKicker: '%s家韓國品牌 · %s條商品線',
  catTitle: '%s大品類',
  catTitleEm: 'Curated',
  selected: '件選件',
  featKicker: '本季精選',
  featTitle: '精選展示',
  featTitleEm: 'Showcase',
  viewAll: '看全部 %s 件',
  viewDetails: '查看細節',
  allSelections: '全部選件',
  all: '全部',
  searchResult: '搜尋結果',
  noResult: '找不到符合的商品。',
  noResultHint: '換個關鍵字，或看看其他品類。',
  resetFilter: '看全部選件',
  philKicker1: '理念 — 選件標準',
  philKicker2: '理念 — 低調的定義',
  philBody1: '維羅拉不做全品項。我們代理兩家韓國品牌：VUCA 做居家香氛，SAINTMARI 做真絲長巾與純銀飾品。每一季只留下經得起反覆使用的那幾件，標準只有一個 —— 三年後你還會想用它。',
  philBody2: '低調不是沒有主張，而是把主張放進材質、比例與收邊裡。一條真絲長巾的捲邊、一只銀戒收得多細、一支擴香在空間裡停留多久 —— 這些細節不會出現在標籤上，但你用過就知道。',
  brand: '品牌',
  material: '材質',
  spec: '規格',
  origin: '產地',
  noteTop: '前調',
  noteMiddle: '中調',
  noteBase: '後調',
  askAboutThis: '用 LINE 詢問這件',
  close: '關閉',
  viewShot: '檢視第 %s 張',
  ftCategories: '品類',
  ftInformation: '關於維羅拉',
  ftLine: 'LINE 官方帳號',
  ftStory: '品牌故事',
  ftStandard: '選件標準',
  ftPrivacy: '隱私權政策',
  ftTerms: '服務條款',
  ftEmail: '信箱',
  lineNote: '選件問題、庫存與到貨都在 LINE 上回覆。',
  lineTitle: '維羅拉國際 LINE 官方帳號',
  addFriend: '加入好友',
  rights: '版權所有',
  represents: '代理品牌 VUCA · SAINTMARI（韓國）',
}

export const num = (n) => String(n)

export function t(key, ...args) {
  const value = UI[key]
  if (!value) return key
  let text = String(value)
  args.forEach((arg) => {
    text = text.replace('%s', String(arg))
  })
  return text
}
