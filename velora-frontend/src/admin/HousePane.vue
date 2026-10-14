<script setup>
/**
 * 品牌維護。
 *
 * 為什麼上限是四家：前台的品牌區是一列橫排的格子，四格是桌機一列
 * 還讀得完的極限。第五家不是「再加一格」，是要換一種版面 ——
 * 所以上限寫死在這裡與 worker/admin.js 的 saveHouse，兩邊都擋。
 *
 * 刪除只在「沒有商品掛著」時才可能。要停掉一個還有商品的品牌，
 * 正確的動作是關掉「顯示在前台」—— 那是可逆的，而且商品會留在架上，
 * 只是不再掛品牌名。硬刪會讓那些商品指向不存在的代碼，
 * 而那些商品從此每一次儲存都會失敗。
 */
import { computed, ref, watch } from 'vue'

import * as api from './api.js'
import * as session from './session.js'

const props = defineProps({
  houses: { type: Array, required: true },
  products: { type: Array, required: true },
})
const emit = defineEmits(['saved', 'error'])

/** 跟 worker/admin.js 的 saveHouse 是同一個數字。改一邊就要改另一邊 */
const MAX = 4

const truthy = (v) => v === true || String(v).toUpperCase() === 'TRUE'

function blank() {
  return {
    // 只編中文；_en／_ko 與 name_ko 仍是資料庫欄位，給初值、原樣送回
    key: '', name: '', name_ko: '',
    country_zh: '韓國', country_en: 'Korea', country_ko: '한국',
    tagline: '', intro_zh: '', intro_en: '', intro_ko: '',
    listed: true,
  }
}

/** null＝沒在編輯；物件＝正在編輯。creating 由 key 是不是新的決定 */
const form = ref(null)
const creating = ref(false)
const saving = ref(false)
const removing = ref('')
const errs = ref([])
const bad = ref({})

/** 每個品牌掛著幾件商品。刪除能不能按、以及提示文字都靠它 */
const useCount = computed(() => {
  const n = {}
  for (const p of props.products) {
    const k = String(p.house || '').trim()
    if (k) n[k] = (n[k] || 0) + 1
  }
  return n
})

const full = computed(() => props.houses.length >= MAX)

// 外面重新載入 houses 之後，正在編輯的那份要跟著換掉，
// 否則畫面上還是舊值，按第二次儲存會把剛存的蓋回去
watch(() => props.houses, () => { if (form.value && !creating.value) close() })

function openNew() {
  form.value = blank()
  creating.value = true
  errs.value = []
  bad.value = {}
}

function openEdit(h) {
  const base = blank()
  for (const k in base) if (k in h) base[k] = h[k]
  base.listed = truthy(h.listed)
  form.value = base
  creating.value = false
  errs.value = []
  bad.value = {}
}

function close() {
  form.value = null
  creating.value = false
  errs.value = []
  bad.value = {}
}

/**
 * 前端先驗一次，規則跟 worker/admin.js 的 saveHouse 對齊。
 * 真正的關卡在伺服器 —— 這一份只是讓錯誤不必等一趟來回。
 */
function validate() {
  const f = form.value
  const out = []
  const marks = {}
  const key = String(f.key || '').trim()

  if (!/^[a-z0-9-]{2,40}$/.test(key)) {
    out.push('品牌代碼要 2–40 個小寫英數或連字號' + (key ? `，收到「${key}」` : '（必填）'))
    marks.key = true
  }
  if (creating.value && props.houses.some((h) => String(h.key).trim() === key)) {
    out.push(`品牌代碼「${key}」已經存在`)
    marks.key = true
  }
  if (!String(f.name || '').trim()) {
    out.push('品牌名稱不能空白')
    marks.name = true
  }
  bad.value = marks
  return out
}

async function save() {
  errs.value = validate()
  if (errs.value.length) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }

  saving.value = true
  try {
    const r = await api.saveHouse(session.token.value, { ...form.value })
    close()
    emit('saved', (r.created ? '已新增品牌 ' : '已儲存品牌 ') + r.key + '。要讓網站更新，回商品清單按「發布」。')
  } catch (e) {
    if (e.code === 'invalid' && Array.isArray(e.detail)) errs.value = e.detail
    else emit('error', e.message + (e.detail ? '　' + e.detail : ''))
  } finally {
    saving.value = false
  }
}

async function remove(h) {
  const n = useCount.value[h.key] || 0
  if (n) {
    emit('error', `「${h.name}」還有 ${n} 件商品掛著，不能刪。要停掉它請把「顯示在前台」關掉 —— 商品會留在架上，只是不再掛品牌名。`)
    return
  }
  if (!confirm(`確定要刪除品牌「${h.name}」？\n\n這是硬刪除，houses 分頁上那一列會消失。`)) return
  if (!(await session.keepAlive())) { emit('error', '登入已失效，請重新登入。'); return }

  removing.value = h.key
  try {
    await api.deleteHouse(session.token.value, h.key)
    emit('saved', `已刪除品牌 ${h.name}。發布後前台才會消失。`)
  } catch (e) {
    emit('error', e.message + (e.detail ? '　' + e.detail : ''))
  } finally {
    removing.value = ''
  }
}
</script>

<template>
  <div>
    <div class="secline" style="padding-top: 42px">
      <b>品牌</b><hr />
      <button v-if="!form" class="ghost" :disabled="full" @click="openNew">
        {{ full ? `已達 ${MAX} 家上限` : '新增品牌' }}
      </button>
    </div>

    <p class="hint" style="padding-bottom: 20px">
      前台的品牌區最多排四格，所以上限是 {{ MAX }} 家。
      要暫停一個品牌請關掉「顯示在前台」—— 它的商品會留在架上，只是不再掛品牌名，
      這是可逆的；刪除則會把資料庫裡那個品牌真的移除。
    </p>

    <!-- ── 編輯／新增 ────────────────────────────────────────── -->
    <template v-if="form">
      <div v-if="errs.length" class="warn" style="margin-bottom: 22px">
        <b>沒有儲存，以下欄位要修：</b>
        <ul style="margin: 8px 0 0; padding-left: 18px">
          <li v-for="(e, i) in errs" :key="i">{{ e }}</li>
        </ul>
      </div>

      <div class="colL" style="width: 100%; max-width: 760px">
        <div class="tri" style="padding-bottom: 24px">
          <div>
            <label>品牌代碼 <em class="req">*</em></label>
            <input v-if="creating" v-model="form.key" type="text" placeholder="vuca" :class="{ bad: bad.key }" />
            <div v-else class="ro">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="4" y="9" width="12" height="8" /><path d="M7 9V6a3 3 0 0 1 6 0v3" />
              </svg>
              {{ form.key }}
            </div>
            <p class="hint">
              {{ creating
                ? '小寫英數與連字號。商品的品牌欄存的就是它，建立後不可更改。'
                : '建立後不可更改 —— 商品的品牌欄指向它' }}
            </p>
          </div>
          <div>
            <label>品牌名稱 <em class="req">*</em></label>
            <input v-model="form.name" type="text" placeholder="VUCA" :class="{ bad: bad.name }" />
            <p class="hint">前台用拉丁字體排版，通常是全大寫的原名</p>
          </div>
          <div />
        </div>

        <div class="fld">
          <label>國別（選填）</label>
          <input v-model="form.country_zh" type="text" placeholder="韓國" />
        </div>

        <div class="fld">
          <label>品牌標語（選填）</label>
          <input v-model="form.tagline" type="text" placeholder="Always be with you." />
          <p class="hint">品牌自己的那一句，通常是原文。首頁輪播的品牌形象照下方會顯示「品牌名稱 — 標語」。</p>
        </div>

        <div class="fld">
          <label>簡介（選填）</label>
          <textarea v-model="form.intro_zh" rows="3" />
          <p class="hint">前台品牌格裡的那段話。</p>
        </div>

        <div class="sw" style="padding-top: 4px">
          <span>顯示在前台</span>
          <span class="tog" :class="{ on: form.listed }">
            <em>{{ form.listed ? 'ON' : 'OFF' }}</em>
            <button type="button" :class="{ on: form.listed }" :aria-pressed="form.listed" @click="form.listed = !form.listed" />
          </span>
        </div>
        <p class="hint" style="padding-bottom: 20px">
          關掉之後，這個品牌的介紹不會出現在前台，商品卡上也不再顯示品牌名 ——
          但那些商品仍然在架上，只是變成「沒有掛品牌」。
        </p>

        <div style="display: flex; align-items: center; gap: 24px; padding-bottom: 30px">
          <button class="go" :disabled="saving" @click="save">{{ saving ? '儲存中…' : '儲存' }}</button>
          <button class="link quiet" @click="close">取消</button>
        </div>
      </div>
    </template>

    <!-- ── 一覽 ──────────────────────────────────────────────── -->
    <!-- 六欄：代碼 / 拼版金線 / 品牌 / 商品件數 / 狀態 / 操作。
         窄螢幕收掉「商品件數」，它在編輯頁與刪除提示裡都還說得出來 -->
    <div class="hrow hd">
      <span>代碼</span><i /><span>品牌</span>
      <span class="hideNarrow">商品</span><span>狀態</span><span />
    </div>

    <div v-for="h in houses" :key="h.key" class="hrow">
      <span class="n">{{ h.key }}</span>
      <span class="rule" />
      <span class="nm">
        <b style="font-family: var(--f-disp); letter-spacing: 0.16em">{{ h.name }}</b>
        <span class="alt">
          <span>{{ h.country_zh || '—' }}</span><i />
          <span :class="{ miss: !h.intro_zh }">{{ h.intro_zh || '簡介尚未填寫' }}</span>
        </span>
      </span>
      <span class="cell mono hideNarrow">{{ useCount[h.key] || 0 }} 件</span>
      <span class="st" :class="truthy(h.listed) ? 'live' : 'off'">
        <i />{{ truthy(h.listed) ? '顯示中' : '不顯示' }}
      </span>
      <span class="acts">
        <button class="link" @click="openEdit(h)">編輯</button>
        <button
          class="link quiet"
          :disabled="removing === h.key || !!useCount[h.key]"
          :title="useCount[h.key] ? `還有 ${useCount[h.key]} 件商品掛著這個品牌，不能刪` : ''"
          @click="remove(h)"
        >
          {{ removing === h.key ? '刪除中…' : '刪除' }}
        </button>
      </span>
    </div>

    <p v-if="!houses.length" class="empty">還沒有任何品牌。按右上角的「新增品牌」加一家。</p>
  </div>
</template>
