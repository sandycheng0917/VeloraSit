<script setup>
/**
 * 後台外殼：登入、側欄、分頁切換。
 *
 * 資料只在這裡載入一次（op:list），下面的面板都吃同一份 —— 每個面板
 * 各自去打 API 的話，改完商品回到清單會看到舊資料，而那種不一致
 * 沒有錯誤訊息，只會讓人反覆重整。
 *
 * 後台維持中文，不做三語。內部工具的多語只增加維護面，
 * 而商品資料本身的三語是在編輯頁裡填的 —— 那是資料，不是介面。
 */
import { computed, onMounted, ref } from 'vue'

import * as api from './api.js'
import './admin.css'
import EditPane from './EditPane.vue'
import HousePane from './HousePane.vue'
import ListPane from './ListPane.vue'
import * as session from './session.js'

const PANES = [
  { key: 'list', label: '商品清單', icon: 'M3 5h14M3 10h14M3 15h9' },
  { key: 'new', label: '新增商品', icon: 'M10 4v12M4 10h12' },
  { key: 'cats', label: '品類與品牌', icon: 'M3 6l7-3 7 3-7 3zM3 11l7 3 7-3' },
  { key: 'audit', label: '操作紀錄', icon: 'M10 5v5l3 2M3 10a7 7 0 1 0 14 0 7 7 0 0 0-14 0' },
]

const ready = ref(false)
const pane = ref('list')
const editing = ref(null)

const pw = ref('')
const busy = ref(false)
const loginErr = ref('')

const products = ref([])
const categories = ref([])
const houses = ref([])
/**
 * 影像索引：鍵 → { sha256, mime, alpha, bytes }。
 * 有了它，清單與編輯頁就能直接指向前台那些烤好的圖檔，
 * 而不必為了縮圖把四萬字元的 base64 拉回來。
 */
const imgIndex = ref({})

/*
 * 頁尾的版權年份。
 *
 * 寫死的年份到了明年就是錯的，而且沒有人會記得回來改 ——
 * 前台主視覺那幾個件數數字就是這樣說謊了一整段時間。
 */
const year = new Date().getFullYear()

const toast = ref(null)
let toastTimer = null
function say(text, bad = false) {
  toast.value = { text, bad }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), bad ? 9000 : 4000)
}

const signedIn = computed(() => !!session.token.value)

async function doLogin() {
  loginErr.value = ''
  busy.value = true
  try {
    const r = await api.login(pw.value)
    session.set(r.token, r.exp)
    pw.value = ''
    await load()
  } catch (e) {
    // 刻意不顯示「還剩幾次」或「鎖多久」—— 那兩個數字等於把鎖定規則
    // 告訴打的人，讓他能算出剛好不觸發鎖定的節奏
    loginErr.value = e.message
  } finally {
    busy.value = false
  }
}

/**
 * 只重載影像索引。
 *
 * 回填縮圖之後要用 —— 整包 load() 會連商品、品類、發布狀態一起重抓，
 * 而那時畫面上可能正開著清單的某一頁，全部換掉會跳位。
 */
async function reloadIndex() {
  try {
    const ix = await api.imageIndex(session.token.value)
    imgIndex.value = Object.fromEntries((ix.images || []).map((m) => [m.key, m]))
  } catch {
    // 抓不到就維持舊的。縮圖那條會退回公開網址或逐張 API，不會破圖
  }
}

/** 品牌存完或刪完都要重讀 houses —— 上限與「掛著幾件」都靠那份清單算 */
async function afterHouseSave(msg) {
  say(msg)
  await load()
}

async function load() {
  busy.value = true
  try {
    /*
     * 🔴 三支端點的先後關係，決定了畫面要空白多久。
     *
     * Apps Script 的 /exec 一定會 302 轉到 script.googleusercontent.com，
     * 所以每一次呼叫實際上是兩個來回。串著等三次 = 六個來回的空白畫面，
     * 而這還在任何一張圖開始載之前 —— 這是後台「感覺很慢」的主因，
     * 不是縮圖。
     *
     * 現在的規矩：
     *   list + imageIndex   彼此不相依，同時發。
     *                       影像索引仍然「先於商品渲染」拿到 ——
     *                       Promise.all 一起完成，那個限制照樣成立。
     *                       （沒有它的話，清單一渲染就算 fast()，
     *                         索引還是空的，十幾張全部排進 API 佇列。）
     *   status              只餵標頭那行「上次發布」，不擋畫面。
     *                       發出去就不等了，回來再自己填上。
     */
    const [r, ix] = await Promise.all([
      api.list(session.token.value),
      // 索引抓不到不該擋住整個後台：縮圖會自動退回公開網址或逐張 API
      api.imageIndex(session.token.value).catch(() => ({ images: [] })),
    ])
    imgIndex.value = Object.fromEntries((ix.images || []).map((m) => [m.key, m]))

    products.value = (r.products || []).filter((p) => !truthy(p.deleted))
    categories.value = r.categories || []
    houses.value = r.houses || []
    ready.value = true
  } catch (e) {
    if (e.code === 'auth') {
      session.clear()
      say('登入已失效，請重新登入。', true)
    } else {
      say(e.message + (e.detail ? '　' + JSON.stringify(e.detail) : ''), true)
    }
  } finally {
    busy.value = false
  }
}

const truthy = (v) => v === true || String(v).toUpperCase() === 'TRUE'

function openNew() {
  editing.value = null
  pane.value = 'new'
}
function openEdit(p) {
  editing.value = p
  pane.value = 'edit'
}
async function afterSave(msg) {
  say(msg)
  pane.value = 'list'
  editing.value = null
  await load()
}

function signOut() {
  session.clear()
  products.value = []
  ready.value = false
}

onMounted(async () => {
  document.title = '商品管理 | 維羅拉'
  if (session.restore()) await load()
})
</script>

<template>
  <!-- 登入 -->
  <div v-if="!signedIn" class="vadmin login">
    <form class="box" @submit.prevent="doLogin">
      <div class="brand">
        <b>VELORA</b>
        <span class="co">維羅拉國際有限公司</span>
        <span>商品管理</span>
      </div>
      <hr />
      <label for="pw">密碼</label>
      <input id="pw" v-model="pw" type="password" autocomplete="current-password" autofocus />
      <button class="submit" type="submit" :disabled="busy || !pw">
        {{ busy ? '驗證中…' : '登入' }}
      </button>
      <p v-if="loginErr" class="err">{{ loginErr }}</p>
    </form>
  </div>

  <!-- 後台 -->
  <div v-else class="vadmin">
    <aside class="side">
      <div class="brand">
        <b>VELORA</b>
        <span class="co">維羅拉國際有限公司</span>
        <span>商品管理</span>
      </div>
      <nav class="nav">
        <button
          v-for="p in PANES"
          :key="p.key"
          :class="{ on: pane === p.key || (p.key === 'list' && pane === 'edit') }"
          @click="p.key === 'new' ? openNew() : (pane = p.key)"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3">
            <path :d="p.icon" />
          </svg>
          {{ p.label }}
        </button>
      </nav>
      <div class="fill" />
      <div class="foot">
        <span class="legal">© {{ year }}　維羅拉國際有限公司</span>
        資料源　<span class="v">Cloudflare D1</span><br />
        儲存即生效<br />
        <button class="link quiet" style="font-family: inherit; font-size: 10.5px" @click="signOut">
          登出（票剩 {{ session.remaining() }}）
        </button>
      </div>
    </aside>

    <main class="main">
      <!--
        載入骨架。
        🔴 ready 這個狀態以前被宣告、被維護，但模板裡一次都沒有用到 ——
           所以取資料那幾秒，標頭寫著「共 0 件商品」、清單寫著「沒有符合
           的商品」。那不是空白，那是在說謊：使用者會以為東西被清光了。
           Apps Script 一次呼叫就要一兩秒，這段時間一定看得到。
      -->
      <div v-if="!ready" class="boot">
        <header class="head">
          <div>
            <h1>商品清單</h1>
            <p class="sub">正在向 Google Sheet 取資料…</p>
          </div>
        </header>
        <div class="row hd">
          <span>序</span><i /><span>圖片</span><span>品名</span>
          <span class="hideNarrow">品類</span><span class="hideNarrow">商品編號</span>
          <span class="hideNarrow">價格</span><span>狀態</span><span />
        </div>
        <!-- 五列骨架就夠了：目的是撐住版面、讓人知道清單要出現在這裡，
             不是模擬真實筆數（真實筆數這時候還不知道） -->
        <div v-for="i in 5" :key="i" class="row" style="cursor: default">
          <span class="n">{{ String(i).padStart(2, '0') }}</span>
          <span class="rule" />
          <span class="thumb loading">載入中</span>
          <span class="nm"><b class="sk sk-a" /><span class="sk sk-b" /></span>
          <span class="cell hideNarrow"><span class="sk sk-c" /></span>
          <span class="cell hideNarrow"><span class="sk sk-c" /></span>
          <span class="cell hideNarrow"><span class="sk sk-c" /></span>
          <span class="cell"><span class="sk sk-c" /></span>
          <span />
        </div>
      </div>

      <div v-else-if="pane === 'list'">
        <header class="head">
          <div>
            <h1>商品清單</h1>
            <p class="sub">共 {{ products.length }} 件商品。儲存後網站立即生效。</p>
          </div>
        </header>
        <ListPane
          :products="products"
          :categories="categories"
          :houses="houses"
          :img-index="imgIndex"
          @open="openEdit"
          @refresh-index="reloadIndex"
          @said="(m) => say(m)"
        />
      </div>

      <EditPane
        v-else-if="pane === 'edit' || pane === 'new'"
        :key="editing ? editing.id : 'new'"
        :product="editing"
        :categories="categories"
        :houses="houses"
        :products="products"
        :img-index="imgIndex"
        @back="pane = 'list'"
        @saved="afterSave"
        @error="(m) => say(m, true)"
      />

      <div v-else-if="pane === 'cats'">
        <header class="head">
          <div>
            <h1>品類與品牌</h1>
            <p class="sub">
              品類決定前台的分區與商品編號的前綴（VL_<strong>FRG</strong>_001），要新增或改名請直接編輯 Google Sheet 的 categories 分頁。
              品牌可以在這一頁直接維護。
            </p>
          </div>
        </header>
        <div style="padding-top: 30px">
          <div class="secline"><b>品類</b><hr /></div>
          <div class="row hd">
            <span>編號前綴</span><i /><span /><span>中文</span><span>件數</span><span class="hideNarrow" /><span class="hideNarrow" /><span class="hideNarrow" /><span />
          </div>
          <div v-for="c in categories" :key="c.key" class="row" style="cursor: default">
            <span class="n">{{ c.ref }}</span>
            <span class="rule" />
            <span />
            <span class="nm">
              <b>{{ c.name_zh }}</b>
              <span class="alt">
                <span class="en">{{ c.name_en }}</span><i /><span>{{ c.name_ko }}</span>
              </span>
            </span>
            <span class="cell mono">{{ products.filter((p) => p.category === c.key).length }} 件</span>
            <span class="hideNarrow" /><span class="hideNarrow" /><span class="hideNarrow" /><span />
          </div>
          <p class="hint" style="padding-top: 14px">
            沒有商品的品類前台不會顯示 —— 導覽列點進去是空的，比沒有那一項更糟。
          </p>

          <HousePane
            :houses="houses"
            :products="products"
            @saved="afterHouseSave"
            @error="(m) => say(m, true)"
          />
        </div>
      </div>

      <div v-else-if="pane === 'audit'">
        <header class="head">
          <div>
            <h1>操作紀錄</h1>
            <p class="sub">
              紀錄寫在 Google Sheet 的 audit 分頁，這裡不重複做一份。
              查看成本、發布、登入失敗都會留下紀錄。
            </p>
          </div>
        </header>
        <p class="hint" style="padding-top: 30px">
          直接開試算表的 <b>audit</b> 分頁看最完整 —— 它可以排序、篩選、匯出，
          而在這裡再做一次那些功能只是把 Google Sheets 重寫一遍。
        </p>
      </div>
    </main>

    <div v-if="toast" class="toast" :class="{ bad: toast.bad }">{{ toast.text }}</div>
  </div>
</template>
