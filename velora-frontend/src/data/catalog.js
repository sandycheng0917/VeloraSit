/**
 * 商品資料的介面層。
 *
 * 這個檔案本身**不含任何商品資料** —— 資料在 Cloudflare D1，
 * 由 worker/index.js 的 /api/catalog 提供。這裡只做兩件事：
 * 發出那一次請求，然後把扁平欄位組成前台元件要的形狀。
 *
 * ── 2026-09-28 從「建置時烤進 bundle」改成「執行時讀 D1」 ──────────
 *
 * 之前是 import PRODUCTS from './products.generated.js' —— 資料在
 * vite build 的時候就固定了，改一筆商品要重跑整條建置流程才看得到。
 * 現在資料在 D1，改完就生效（Worker 那邊的 cache-control 是 60 秒）。
 *
 * 🔴 沒有種子檔退路。API 掛掉的時候這裡回報錯誤，不會靜默拿
 *    products.generated.js 頂上 —— 那會讓「資料庫壞了」長得跟
 *    「一切正常」一模一樣，而使用者看到的是一份沒人知道有多舊的目錄。
 *    *.generated.js 還留在 repo 裡，但它現在只有一個用途：
 *    當 tools/d1-seed.mjs 的輸入。前台不再 import 它。
 *
 * ── 這裡的 export 就是對外契約 ──────────────────────────────────────
 *
 *   company / houses / categories / allCategories / products / featured
 *   mediaUrl / findCategory / categoryCount / isCutout
 *   loadCatalog / catalogState
 *
 * 🔴 products / featured / houses / categories / allCategories 現在是
 *    **ref**，不是陣列。樣板裡直接寫 `v-for="p in products"` 照常可用
 *    （script setup 的頂層 import 會自動解包），但在 <script> 裡要寫
 *    products.value。漏掉 .value 不會報錯 —— 你會對一個 RefImpl 呼叫
 *    .filter()，然後拿到 undefined is not a function，錯誤指向的地方
 *    跟原因差很遠。
 */
import { computed, shallowRef } from 'vue'

/**
 * 公司資料。刻意留在程式碼裡不進資料庫 ——
 * 它一年不會改一次，而且 LINE 連結打錯會讓唯一的轉換管道失效，
 * 那種東西不該放在隨時可編輯的地方。
 */
export const company = {
  name: {
    zh: '維羅拉國際有限公司',
    en: 'Velora International CO., LTD',
    ko: '벨로라 인터내셔널',
  },
  nameEn: 'Velora International CO., LTD',
  wordmark: 'VELORA',
  wordmarkZh: '維羅拉',
  lineId: '@velora',
  lineUrl: 'https://lin.ee/uzoQ8dl',
  email: 'hello@velora.com.tw',
  // 統編、地址、電話待確認，確定前不對外顯示；補上後於頁尾加回即可。
}

/** 部署在子路徑時所有靜態資源都要帶前綴。Cloudflare 上是根目錄，但留著不礙事 */
const BASE = import.meta.env.BASE_URL || '/'
const url = (p) => (p ? BASE.replace(/\/$/, '') + p : p)

/* ── 載入狀態 ─────────────────────────────────────────────────────── */

/**
 * 三種狀態要分得開，因為它們該顯示的東西完全不同：
 *
 *   loading            骨架版面。不是「共 0 件商品」——
 *                      那是在還不知道有幾件的時候謊報一個數字。
 *   error              明講壞掉了，並給重試。
 *   ready 且 0 件      真的沒有商品。這時才可以說「0 件」。
 */
export const catalogState = shallowRef({
  loading: true,
  error: null,
  products: [],
  houses: [],
  categories: [],
})

let inflight = null

/**
 * 取回整份目錄。重複呼叫共用同一個請求 ——
 * 元件各自 onMounted 呼叫一次是很自然的寫法，不該變成四次網路往返。
 */
export function loadCatalog({ force = false } = {}) {
  if (inflight && !force) return inflight

  catalogState.value = { ...catalogState.value, loading: true, error: null }

  inflight = fetch(url('/api/catalog'), { headers: { accept: 'application/json' } })
    .then(async (res) => {
      // 🔴 先看 content-type 再 parse。靜態層設定錯的時候 /api/catalog 會
      //    拿到 200 加一份 index.html，直接 parse 的話錯誤訊息是
      //    「Unexpected token '<'」—— 那完全指不到真正的原因。
      const type = res.headers.get('content-type') || ''
      if (!type.includes('application/json')) {
        throw new Error(`/api/catalog 回的不是 JSON（${type || '沒有 content-type'}）—— Worker 路由可能沒生效`)
      }
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    })
    .then((body) => {
      catalogState.value = {
        loading: false,
        error: null,
        products: body.products || [],
        houses: body.houses || [],
        categories: body.categories || [],
      }
      return catalogState.value
    })
    .catch((e) => {
      inflight = null // 失敗不快取，重試才有意義
      catalogState.value = {
        ...catalogState.value,
        loading: false,
        error: String((e && e.message) || e),
      }
      return catalogState.value
    })

  return inflight
}

/* ── 轉換工具 ─────────────────────────────────────────────────────── */

/** 分號分隔的三語字串 → { zh: [], en: [], ko: [] } */
const splitTri = (field) => {
  const split = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean)
  return { zh: split(field?.zh), en: split(field?.en), ko: split(field?.ko) }
}

/**
 * 產地代碼 → 三語。資料庫存 'KR' 這種兩碼，因為那是人填的形狀；
 * 但 ProductModal 用 pick(product.origin)，要的是三語物件。
 * 沒對到的代碼原樣顯示，總比顯示空白好 —— 至少看得出漏了什麼。
 */
const ORIGIN = {
  KR: { zh: '韓國', en: 'Korea', ko: '한국' },
  TW: { zh: '台灣', en: 'Taiwan', ko: '대만' },
  JP: { zh: '日本', en: 'Japan', ko: '일본' },
}
const origin = (code) => ORIGIN[code] || { zh: code, en: code, ko: code }

/**
 * 香調只有香氛用得到。其餘品類三個 slot 都是空的，
 * 這時要回 null 而不是空物件 —— ProductModal 用 v-if="product.notes"
 * 判斷要不要畫那塊，空物件是 truthy，會畫出三個空欄位。
 */
function notesOf(raw) {
  if (!raw) return null
  const top = splitTri(raw.top)
  const middle = splitTri(raw.middle)
  const base = splitTri(raw.base)
  const any = [top, middle, base].some((n) => n.zh.length || n.en.length || n.ko.length)
  return any ? { top, middle, base } : null
}

/* ── 商品 ─────────────────────────────────────────────────────────── */

export const products = computed(() =>
  catalogState.value.products
    .map((r) => {
      const gallery = (r.files || []).map((f) => url('/media/' + f))
      return {
        id: r.id,
        category: r.category,
        house: r.house,
        name: r.name,
        tagline: r.tagline,
        desc: r.desc,
        material: r.material,
        spec: r.spec,
        detail: r.detail,
        notes: notesOf(r.notes),
        origin: origin(r.origin),
        // 沒有圖的商品 image 是 undefined，版面會走 .plate.pending 的空版樣式
        image: gallery[0],
        thumb: gallery[0],
        gallery,
        listed: r.listed !== false,
        featured: r.featured === true,
        order: r.order || 0,
        updated: r.updated,
        // price 只有 Sheet 勾了 price_public 的商品才有。API 那邊沒勾的
        // 連這個鍵都不會輸出，所以這裡不需要任何判斷 —— 沒有就是沒有
        ...(r.price === undefined ? {} : { price: r.price }),
      }
    })
    .sort((a, b) => a.order - b.order)
)

/** 首頁精選。上架且被標為精選的商品 */
export const featured = computed(() => products.value.filter((p) => p.featured && p.listed))

/* ── 品牌與品類 ───────────────────────────────────────────────────── */

/** API 回的是陣列（資料庫的自然形狀），元件用 houses[p.house] 取，要物件 */
export const houses = computed(() =>
  Object.fromEntries(catalogState.value.houses.map((h) => [h.key, h]))
)

export const allCategories = computed(() =>
  catalogState.value.categories.map((c) => ({ ...c, cover: url(c.cover) }))
)

/**
 * 前台的品類。
 *
 * 沒有上架商品的品類會被濾掉 —— 導覽列點進去是空的比沒有那一項更糟，
 * 而且品類格會變成一張沒有內容的封面圖。目前手機包是 0 件，
 * 灌了商品之後它會自己出現，不需要改程式碼。
 *
 * 後台不走這條路：後台要看得到所有品類（不然沒辦法把商品指派過去）。
 */
export const categories = computed(() =>
  allCategories.value.filter((c) => products.value.some((p) => p.category === c.key && p.listed))
)

/* ── 對外的小工具 ─────────────────────────────────────────────────── */

export { url as mediaUrl }

export const findCategory = (key) => allCategories.value.find((c) => c.key === key)

export const categoryCount = (key) => products.value.filter((p) => p.category === key).length

/**
 * 版面用哪種裁切方式取決於「這是不是去背圖」。
 *
 * .png 是舊素材的判準：build-assets.py 會把沒有實際透明像素的圖轉存 JPEG，
 * 所以留下來的 .png 一定有透明像素。
 *
 * 但 WebP 也可以有 alpha，副檔名就分不出來了 —— 所以產生器直接讀 WebP
 * 容器標頭（VP8X 的 ALPHA flag），有透明像素的檔名帶 .cut.webp。
 * 判斷寫在產生檔名的時候，不是每次渲染時猜。
 */
export const isCutout = (src) =>
  Boolean(src) && (src.endsWith('.png') || src.endsWith('.cut.webp'))
