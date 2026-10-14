<script setup>
/**
 * 編輯／新增商品。
 *
 * 只編中文。2026-10-14 拿掉英文與韓文欄位 —— 全站單語（見 CLAUDE.md「語言」），
 * 前台的 pick() 一律回中文，填了英韓也不會出現在任何地方。
 * 資料庫的 _en／_ko 欄位沒有砍：表單載入時整列帶進來、儲存時原樣送回，
 * 既有的英韓內容不會被這個畫面洗掉。
 *
 * 必填只有三項：商品編號、品類、中文品名。標題帶 * 的就是這三個，
 * 其餘全部可以留空 —— 一個什麼都要填的表單，實際結果是被填進假資料。
 *
 * 2026-09-07 移除成本（FOB）與 HS 碼兩個區塊。成本連後端端點一起拿掉了。
 */
import { computed, onMounted, ref, watch } from 'vue'

import * as api from './api.js'
import * as img from './image.js'
import { publicUrl } from './imgurl.js'
import * as session from './session.js'

const props = defineProps({
  product: { type: Object, default: null },
  categories: { type: Array, required: true },
  houses: { type: Array, required: true },
  imgIndex: { type: Object, default: () => ({}) },
  // 只為了算「下一個編號是幾號」。清單那邊本來就有這份資料
  products: { type: Array, default: () => [] },
})
const emit = defineEmits(['back', 'saved', 'error'])

const creating = computed(() => !props.product)

/**
 * 文字欄位。前兩個固定，後兩個的標籤隨品類變。
 *
 * spec   「規格」對香氛其實是容量、對絲巾是尺寸。同一格資料，換個說得通的名字。
 * detail  品類專屬的那一格：香氛「用法」、絲巾「收邊」、飾品「保養」、手機包「背帶」。
 *
 * 標籤來自 categories 分頁（specLabel / detailLabel），不是寫死在這裡 ——
 * 要改名或新增一條商品線，在 Sheet 上改完就好。
 * 沒有 detailLabel 的品類就不顯示那一格：沒有名字的欄位只會被亂填。
 */
const catRow = computed(() => props.categories.find((c) => c.key === form.value.category) || {})
const specLabel = computed(() => catRow.value.spec_label_zh || '規格')
const detailLabel = computed(() => catRow.value.detail_label_zh || '')

/** 各品類該填什麼的提示。空白的表單最難下手的就是「這格要寫什麼」 */
const HINTS = {
  fragrance: { spec: 'Classic Diffuser 260ml × 2', detail: '搖晃後靜置，藤枝每兩週翻面一次' },
  scarf: { spec: '90 × 90 cm', detail: '邊緣以手工捲縫收口，垂墜時不會翻捲' },
  jewelry: { spec: '鍊長約 40 + 5 cm', detail: '不戴時收進夾鏈袋，避免接觸香水' },
  phonebag: { spec: '17 × 11 × 3 cm', detail: '可拆、可調長度' },
}
const hint = computed(() => HINTS[form.value.category] || { spec: '', detail: '' })

const TEXT_FIELDS = computed(() => {
  const out = [
    { key: 'name', label: '品名', rows: 1, ph: '' },
    { key: 'tagline', label: '標語', rows: 1, ph: '' },
    { key: 'material', label: '材質', rows: 2, ph: '' },
    { key: 'spec', label: specLabel.value, rows: 1, ph: hint.value.spec },
  ]
  if (detailLabel.value) {
    out.push({ key: 'detail', label: detailLabel.value, rows: 2, ph: hint.value.detail })
  }
  return out
})
const NOTE_FIELDS = [
  { key: 'notes_top', label: '前調' },
  { key: 'notes_mid', label: '中調' },
  { key: 'notes_base', label: '後調' },
]
/** 資料庫仍是三語欄位，新增時三個都要給初值；畫面只編 zh */
const DATA_LANGS = ['zh', 'en', 'ko']

const truthy = (v) => v === true || String(v).toUpperCase() === 'TRUE'

/**
 * 商品編號的規則。跟 worker/admin.js 的 save 與 upload 是同一條 ——
 * 影像鍵是用編號組的（`<編號>-main`），所以編號不合法時，
 * 上傳會被 upload 以 bad-key 擋下來，而那個錯誤看起來跟編號無關。
 */
const ID_RE = /^[a-z0-9-]{3,40}$/
/** 後端會轉小寫再驗，影像鍵卻不轉 —— 所以前端先轉，兩條路才會拿到同一個值 */
const normId = (v) => String(v || '').trim().toLowerCase()

/**
 * 新增時的編號提示：vl-<品類前綴>-<下一個序號>。
 *
 * 前綴取自 categories 分頁的 ref（FRG / SLK / JWL / BAG），跟前台
 * 主視覺那一排代號、以及卡片上印的編號是同一套 —— 讀者看到
 * 「香氛 FRG」再看到「vl-frg-001」，系統就自己解釋了自己。
 *
 * 🔴 用小寫與連字號，不用 VL_FRG_001 —— 後端只收 [a-z0-9-]。
 *    以前的提示含底線與大寫，照著打的人儲存會被拒、上傳也會被拒。
 *
 * 序號是該品類目前的最大號碼加一，不是「總共幾件」：刪掉一件之後
 * 那個號碼不會回收（軟刪除的商品仍然佔著它的影像鍵），
 * 用件數算會撞到已經存在的編號。
 *
 * 這只是提示不是預設值 —— 編號建立後不可更改，值得讓人自己打一次。
 */
const idHint = computed(() => {
  const prefix = String(catRow.value.ref || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!prefix) return 'vl-xxx-001'
  const re = new RegExp('^VL[_-]' + prefix + '[_-]([0-9]+)$', 'i')
  let max = 0
  for (const p of props.products) {
    const m = re.exec(String(p.id || '').trim())
    if (m) max = Math.max(max, Number(m[1]) || 0)
  }
  return 'vl-' + prefix + '-' + String(max + 1).padStart(3, '0')
})

function blank() {
  const o = {
    id: '', category: props.categories[0]?.key || '', house: '',
    // ref（VL · FRG · 001）與 hs 畫面上不編，但一定要在這裡 ——
    // 後端的 save 是整列覆寫，表單沒帶的欄位會被寫成空字串。
    // 2026-10-14 之前這兩個不在表單裡，後台每存一次就清掉一件商品的編號。
    ref: '', hs: '',
    origin: 'KR', price: '', price_public: false,
    listed: true, featured: false, order: 0,
    img_main: '', img_2: '', img_3: '',
  }
  for (const f of [{ key: 'name' }, { key: 'tagline' }, { key: 'material' },
                   { key: 'spec' }, { key: 'detail' }, { key: 'desc' }, ...NOTE_FIELDS]) {
    for (const l of DATA_LANGS) o[`${f.key}_${l}`] = ''
  }
  return o
}

const form = ref(blank())
watch(
  () => props.product,
  (p) => {
    const base = blank()
    if (p) for (const k in base) if (k in p) base[k] = p[k]
    if (p) {
      base.price_public = truthy(p.price_public)
      base.listed = truthy(p.listed)
      base.featured = truthy(p.featured)
    }
    form.value = base
  },
  { immediate: true }
)

const isFragrance = computed(() => form.value.category === 'fragrance')

/* ── 圖片 ─────────────────────────────────────────────────────── */

const SLOTS = [
  { field: 'img_main', label: '主圖' },
  { field: 'img_2', label: '副圖一' },
  { field: 'img_3', label: '副圖二' },
]
/** 哪些欄位沒過檢查。給輸入框標粗底線用，key 是欄名 */
const bad = ref({})
const preview = ref({})       // field → objectURL 或 data URI
const meta = ref({})          // field → 壓縮結果文字
const upBusy = ref('')
const hq = ref(false)

/**
 * 把已經存在 Sheet 裡的圖抓回來預覽。
 *
 * 只在編輯頁做，清單頁不做 —— 清單一次要十幾張，光是等就二十秒，
 * 而清單要回答的問題只是「有沒有圖」。這裡只有一件商品，值得等。
 *
 * 一張抓失敗不能擋住其他張，也不能擋住整個表單：圖片是附屬品，
 * 抓不到最多是預覽空著，文字欄位照樣要能編輯。
 */
async function loadImages() {
  for (const s of SLOTS) {
    const key = form.value[s.field]
    if (!key || preview.value[s.field]) continue

    /*
     * 先試前台那張烤好的圖。檔名內容定址，sha 在影像索引裡，所以算得出
     * 網址 —— 瀏覽器直接載、會快取，比拉回四萬字元的 base64 快得多。
     *
     * 用 fetch + HEAD 之外的方式驗它在不在：直接設成預覽，
     * <img> 載不到時的 onerror 會把它清掉並改走 API。
     * 這樣不會為了「確認存在」多打一次網路。
     */
    const url = publicUrl(key, props.imgIndex[key])
    if (url) {
      preview.value = { ...preview.value, [s.field]: url }
      meta.value = { ...meta.value, [s.field]: key }
      continue
    }

    try {
      const r = await api.getImage(session.token.value, key)
      if (r.found) {
        preview.value = { ...preview.value, [s.field]: `data:${r.mime};base64,${r.data}` }
        meta.value = { ...meta.value, [s.field]: `${key}　${(r.bytes / 1000).toFixed(1)} KB` }
      } else {
        meta.value = { ...meta.value, [s.field]: `${key}（Sheet 裡找不到這張圖）` }
      }
    } catch (e) {
      meta.value = { ...meta.value, [s.field]: `${key}（讀取失敗：${e.message}）` }
    }
  }
}
onMounted(loadImages)

/**
 * 公開網址載不到 —— 剛上傳、還沒發布時，前台上本來就還沒有那個檔案。
 * 清掉預覽並改走 API 把位元組拉回來。
 */
async function onPreviewError(field) {
  const key = form.value[field]
  preview.value = { ...preview.value, [field]: '' }
  if (!key) return
  try {
    const r = await api.getImage(session.token.value, key)
    if (r.found) {
      preview.value = { ...preview.value, [field]: `data:${r.mime};base64,${r.data}` }
      meta.value = { ...meta.value, [field]: `${key}　${(r.bytes / 1000).toFixed(1)} KB` }
    } else {
      meta.value = { ...meta.value, [field]: `${key}（Sheet 裡找不到這張圖）` }
    }
  } catch (e) {
    meta.value = { ...meta.value, [field]: `${key}（讀取失敗：${e.message}）` }
  }
}

async function pickFile(field, ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }

  /*
   * 影像鍵是 `<編號>-main`，所以編號不合法時上傳一定失敗。
   *
   * 在這裡先擋，是因為伺服器那邊回的是 bad-key —— 訊息裡沒有「編號」
   * 兩個字，看到的人不會想到要去改上面那一格。尾端多一個空白就會中，
   * 而空白在畫面上完全看不出來，所以順手 trim 回去。
   */
  const id = normId(form.value.id)
  if (!id) { emit('error', '先填好商品編號再上傳圖片 —— 影像鍵是用它組的。'); bad.value = { ...bad.value, id: true }; return }
  if (!ID_RE.test(id)) {
    emit('error', `商品編號「${id}」不能拿來組影像鍵：只接受 3–40 個小寫英數與連字號，不能有底線、空格或間隔點。先把編號改好再上傳。`)
    bad.value = { ...bad.value, id: true }
    return
  }
  form.value.id = id

  upBusy.value = field
  meta.value = { ...meta.value, [field]: '壓縮中…' }
  try {
    const target = hq.value ? img.TARGET_BYTES_HQ : img.TARGET_BYTES
    const r = await img.compress(file, {
      target,
      onProgress: (p) => {
        meta.value = { ...meta.value, [field]: `試 ${p.width}px q${p.quality.toFixed(2)} → ${(p.bytes / 1000).toFixed(1)} KB` }
      },
    })
    const b64 = await img.toBase64(r.blob)
    // 順便產一張 96px 縮圖跟著存進去。清單頁靠它一次把整頁畫完，
    // 不必等公開網址（剛上傳時本來就還沒有）或逐張打 API
    const t = await img.thumbnail(r.blob)
    const key = `${id}-${field.replace('img_', '')}`
    await api.putImage(session.token.value, {
      key,
      mime: r.type,
      alpha: await img.hasAlpha(r.blob),
      sha256: await img.sha256(r.blob),
      bytes: r.blob.size,
      thumb: t.dataUri,
      chunks: img.chunk(b64),
    })
    form.value[field] = key
    preview.value = { ...preview.value, [field]: URL.createObjectURL(r.blob) }
    meta.value = { ...meta.value, [field]: img.describe(r) }
  } catch (e) {
    meta.value = { ...meta.value, [field]: '' }
    emit('error', e.message)
  } finally {
    upBusy.value = ''
  }
}

/* ── 儲存 ─────────────────────────────────────────────────────── */

const saving = ref(false)
const fieldErrs = ref([])

/**
 * 送出前先在這裡驗一次。
 *
 * 伺服器仍然會驗（worker/admin.js 的 save），這裡不是取代它 —— 前端的驗證
 * 任何人都繞得過，真正的關卡在後端。這一份的用途只有一個：
 * 讓「哪一格要修」不必等一趟來回才知道，而且能指到那一格上。
 *
 * 規則刻意跟 worker/admin.js 的 save 一一對應。兩邊不一致的話，
 * 會出現「前端說可以、伺服器說不行」，那比沒有前端驗證更糟。
 */
function validate() {
  const f = form.value
  const errs = []
  const marks = {}
  const num = (v) => String(v).trim() !== '' && isNaN(Number(v))

  const id = normId(f.id)
  f.id = id
  if (!ID_RE.test(id)) {
    errs.push('商品編號要 3–40 個小寫英數或連字號' + (id ? `，收到「${id}」` : '（必填）'))
    marks.id = true
  }
  if (!String(f.name_zh || '').trim()) {
    errs.push('品名不能空白')
    marks.name_zh = true
  }
  if (!f.category) {
    errs.push('要選一個品類')
    marks.category = true
  }
  if (num(f.price)) { errs.push(`售價必須是數字，收到「${f.price}」`); marks.price = true }
  if (f.price_public && String(f.price).trim() === '') {
    errs.push('開了「在前台顯示價格」就必須填售價')
    marks.price = true
  }
  if (num(f.order)) { errs.push('排序必須是數字'); marks.order = true }

  bad.value = marks
  return errs
}

async function save() {
  fieldErrs.value = validate()
  if (fieldErrs.value.length) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }
  saving.value = true
  try {
    const r = await api.save(session.token.value, { ...form.value })
    emit('saved', (r.created ? '已新增 ' : '已儲存 ') + form.value.name_zh +
      '。要讓網站更新，回清單按「發布」。')
  } catch (e) {
    if (e.code === 'invalid' && Array.isArray(e.detail)) fieldErrs.value = e.detail
    else emit('error', e.message + (e.detail ? '　' + JSON.stringify(e.detail) : ''))
  } finally {
    saving.value = false
  }
}

/* ── 改商品編號 ───────────────────────────────────────────────── */

/**
 * 編號改得動，但要走專用端點。
 *
 * 不能靠一般的儲存：opSave_ 是用 id 找那一列的，送一個新 id 進去它會
 * 找不到舊列、當成新增，於是多一件商品而舊的還在。而且影像鍵是
 * `<編號>-main`，不跟著搬的話舊編號會被釋放出來，日後同名的新商品
 * 上傳圖片就會蓋掉這一件的圖 —— 沒有錯誤訊息，要到打開網站才看得到。
 * renameId 端點把這些一次做完，或者一開始就拒絕。
 */
const renaming = ref(false)
const newId = ref('')
const renameOpen = ref(false)

function openRename() {
  newId.value = form.value.id
  renameOpen.value = true
}

async function doRename() {
  const to = normId(newId.value)
  if (to === form.value.id) { renameOpen.value = false; return }
  if (!ID_RE.test(to)) {
    emit('error', `新編號「${to}」不合法：要 3–40 個小寫英數或連字號，不能有底線、空格或間隔點。`)
    return
  }
  if (!confirm(
    `確定把商品編號從「${form.value.id}」改成「${to}」？

` +
    `圖片的影像鍵會一起搬（${form.value.id}-main → ${to}-main），` +
    `所以圖片不會失聯。
改完要按一次「發布」，網站上的圖檔網址才會跟著更新。`
  )) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }

  renaming.value = true
  try {
    const r = await api.renameId(session.token.value, form.value.id, to)
    renameOpen.value = false
    emit('saved', `商品編號已改成 ${r.to}` +
      (r.keys && r.keys.length ? `（影像鍵搬了 ${r.keys.length} 個）` : '') +
      '。要讓網站更新，回清單按「發布」。')
  } catch (e) {
    emit('error', e.message + (e.detail ? '　' + e.detail : ''))
  } finally {
    renaming.value = false
  }
}

const removing = ref(false)
async function remove() {
  if (!confirm(`確定要刪除「${form.value.name_zh}」？\n\n這是軟刪除：資料還在 Sheet 上，商品編號永遠不會被重複使用，但前台會看不到它。`)) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }
  removing.value = true
  try {
    await api.remove(session.token.value, form.value.id)
    emit('saved', `已刪除 ${form.value.name_zh}。發布後前台才會消失。`)
  } catch (e) {
    emit('error', e.message)
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div>
    <button class="link quiet" style="display: flex; align-items: center; gap: 8px" @click="emit('back')">
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3">
        <path d="m12 5-5 5 5 5" />
      </svg>
      商品清單
    </button>

    <header class="head" style="padding: 14px 0 26px; align-items: flex-end">
      <div>
        <h1>{{ form.name_zh || (creating ? '新增商品' : '（未命名）') }}</h1>
        <p class="sub" style="display: flex; align-items: center; gap: 16px">
          <span class="cell mono">{{ form.id || '尚未填商品編號' }}</span>
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 24px">
        <button v-if="!creating" class="link quiet" :disabled="removing" @click="remove">
          {{ removing ? '刪除中…' : '刪除這件商品' }}
        </button>
        <button class="go" :disabled="saving" @click="save">{{ saving ? '儲存中…' : '儲存' }}</button>
      </div>
    </header>

    <div v-if="fieldErrs.length" class="warn" style="margin-bottom: 26px">
      <b>沒有儲存，以下欄位要修：</b>
      <ul style="margin: 8px 0 0; padding-left: 18px">
        <li v-for="(e, i) in fieldErrs" :key="i">{{ e }}</li>
      </ul>
    </div>

    <div class="cols">
      <!-- 左欄 -->
      <div class="colL">
        <div class="secline"><b>基本　標 <em class="req">*</em> 的是必填，其餘都可以留空</b><hr /></div>
        <div class="tri" style="padding-bottom: 24px">
          <div>
            <label>商品編號 <em class="req">*</em></label>
            <input v-if="creating" v-model.trim="form.id" type="text" :placeholder="idHint" :class="{ bad: bad.id }" />
            <template v-else>
              <div v-if="!renameOpen" class="ro" style="justify-content: space-between">
                <span style="display: flex; align-items: center; gap: 8px">
                  <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="4" y="9" width="12" height="8" /><path d="M7 9V6a3 3 0 0 1 6 0v3" />
                  </svg>
                  {{ form.id }}
                </span>
                <button class="link" style="font-size: 13px" @click="openRename">改編號</button>
              </div>
              <div v-else style="display: flex; align-items: center; gap: 12px">
                <input v-model.trim="newId" type="text" placeholder="vl-frg-001" style="flex: 1" />
                <button class="link" :disabled="renaming" @click="doRename">
                  {{ renaming ? '搬移中…' : '確定' }}
                </button>
                <button class="link quiet" :disabled="renaming" @click="renameOpen = false">取消</button>
              </div>
            </template>
            <p class="hint">
              {{ creating
                ? `慣例是 ${idHint} 這種寫法 —— VL＋品類前綴＋序號。前台的卡片會直接印它，圖片的影像鍵也是用它組的，所以不能有空格或間隔點。`
                : renameOpen
                  ? '改完圖片的影像鍵會一起搬，圖不會失聯。之後要按一次「發布」。'
                  : '前台卡片上印的就是它。要改按右邊的「改編號」' }}
            </p>
          </div>
          <div>
            <label>品類 <em class="req">*</em></label>
            <select v-model="form.category" :class="{ bad: bad.category }">
              <option value="">（請選擇）</option>
              <option v-for="c in categories" :key="c.key" :value="c.key">{{ c.name_zh }}</option>
            </select>
          </div>
        </div>
        <div class="tri" style="padding-bottom: 24px">
          <div>
            <label>品牌（選填）</label>
            <select v-model="form.house">
              <!-- 品牌是選填的：有些商品不掛品牌，前台就不顯示品牌那一欄 -->
              <option value="">（不掛品牌）</option>
              <option v-for="h in houses" :key="h.key" :value="h.key">{{ h.name }}</option>
            </select>
          </div>
          <div><label>產地（選填）</label><input v-model="form.origin" type="text" placeholder="KR" /></div>
          <div />
        </div>

        <div class="secline" style="padding-top: 16px">
          <b>文字內容　只有品名必填</b><hr />
        </div>

        <div v-for="f in TEXT_FIELDS" :key="f.key" class="fld">
          <label>{{ f.label }}<template v-if="f.key === 'name'"> <em class="req">*</em></template></label>
          <textarea
            v-model="form[`${f.key}_zh`]"
            :rows="f.rows"
            :placeholder="f.ph"
            :class="{ bad: f.key === 'name' && bad.name_zh }"
          />
        </div>

        <div class="fld">
          <label>描述</label>
          <textarea v-model="form.desc_zh" rows="4" />
        </div>

        <template v-if="isFragrance">
          <div class="secline" style="padding-top: 10px"><b>香調　僅香氛品類　以分號分隔</b><hr /></div>
          <div v-for="f in NOTE_FIELDS" :key="f.key" class="fld">
            <label>{{ f.label }}</label>
            <input v-model="form[`${f.key}_zh`]" type="text" placeholder="水蜜桃;綠意;葡萄柚" />
          </div>
        </template>
      </div>

      <!-- 右欄 -->
      <div class="colR">
        <div class="secline"><b>圖片</b><hr /></div>

        <label class="big" style="display: block; cursor: pointer">
          <img
            v-if="preview[SLOTS[0].field]"
            :src="preview[SLOTS[0].field]"
            alt=""
            @error="onPreviewError(SLOTS[0].field)"
          />
          <span
            v-else
            style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--ink-faint)"
          >{{ form.img_main ? '已有主圖（換一張請點這裡）' : '點這裡選主圖' }}</span>
          <input type="file" accept="image/*" hidden @change="(e) => pickFile('img_main', e)" />
        </label>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0 4px">
          <span class="cell mono">{{ meta.img_main || (form.img_main ? form.img_main : '尚未上傳') }}</span>
        </div>

        <div class="subimgs" style="padding-top: 12px">
          <label v-for="s in SLOTS.slice(1)" :key="s.field" class="add" style="cursor: pointer">
            <template v-if="preview[s.field]">
              <img
                :src="preview[s.field]"
                alt=""
                style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover"
                @error="onPreviewError(s.field)"
              />
            </template>
            <template v-else>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4">
                <path d="M10 4v12M4 10h12" />
              </svg>
              {{ form[s.field] ? s.label + '（已有）' : '加入' + s.label }}
            </template>
            <input type="file" accept="image/*" hidden @change="(e) => pickFile(s.field, e)" />
          </label>
        </div>

        <p class="hint" style="padding-top: 12px">
          上傳後在瀏覽器裡壓成 {{ hq ? 100 : 34 }} KB 以內的 WebP，原圖不會離開你的電腦。EXIF（含 GPS）會一併移除。
        </p>
        <div class="sw" style="padding-top: 6px">
          <span style="font-size: 12px; color: var(--ink-faint)">高畫質（放寬到 100 KB）</span>
          <span class="tog" :class="{ on: hq }">
            <em>{{ hq ? 'ON' : 'OFF' }}</em>
            <button type="button" :class="{ on: hq }" :aria-pressed="hq" @click="hq = !hq" />
          </span>
        </div>

        <div class="secline" style="padding-top: 34px"><b>上架設定</b><hr /></div>
        <div class="sw">
          <span>顯示在前台</span>
          <span class="tog" :class="{ on: form.listed }">
            <em>{{ form.listed ? 'ON' : 'OFF' }}</em>
            <button type="button" :class="{ on: form.listed }" :aria-pressed="form.listed" @click="form.listed = !form.listed" />
          </span>
        </div>
        <div class="sw">
          <span>首頁精選</span>
          <span class="tog" :class="{ on: form.featured }">
            <em>{{ form.featured ? 'ON' : 'OFF' }}</em>
            <button type="button" :class="{ on: form.featured }" :aria-pressed="form.featured" @click="form.featured = !form.featured" />
          </span>
        </div>
        <p class="hint" style="padding-bottom: 12px">精選會出現在兩個前台的首頁區塊。</p>
        <div class="sw">
          <span>排序（選填）</span>
          <input v-model="form.order" type="text" style="width: 70px; text-align: right" :class="{ bad: bad.order }" />
        </div>

        <div class="secline" style="padding-top: 34px"><b>價格</b><hr /></div>
        <div class="sw">
          <span>售價<template v-if="form.price_public"> <em class="req">*</em></template><template v-else>（選填）</template></span>
          <input
            v-model="form.price"
            type="text"
            style="width: 120px; text-align: right"
            placeholder="1280"
            :class="{ bad: bad.price }"
          />
        </div>
        <div class="sw" style="padding-top: 12px">
          <span>在前台顯示價格</span>
          <span class="tog" :class="{ on: form.price_public }">
            <em>{{ form.price_public ? 'ON' : 'OFF' }}</em>
            <button type="button" :class="{ on: form.price_public }" :aria-pressed="form.price_public" @click="form.price_public = !form.price_public" />
          </span>
        </div>
        <p class="hint">關掉時，價格不會被寫進前台檔案 —— 不是藏起來，是根本不輸出。</p>

      </div>
    </div>
  </div>
</template>
