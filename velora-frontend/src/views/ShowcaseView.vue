<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import LineFab from '@/components/LineFab.vue'
import ProductModal from '@/components/ProductModal.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import SiteHeader from '@/components/SiteHeader.vue'
import {
  catalogState,
  categories,
  categoryCount,
  featured,
  findCategory,
  houses,
  isCutout,
  loadCatalog,
  mediaUrl,
  products,
} from '@/data/catalog.js'
import { num, pick, t } from '@/i18n.js'

/* ── 主視覺輪播 ────────────────────────────────────────── */
const SLIDES = [
  { img: mediaUrl('/media/vuca/editorial-bw.jpg'), cap: 'VL · FRG · 001 — VUCA Classic Diffuser' },
  { img: mediaUrl('/media/saintmari/scarf-camel-blazer.jpg'), cap: 'VL · SLK · 001 — Ivory Twilly Scarf' },
  { img: mediaUrl('/media/vuca/bedroom.jpg'), cap: 'VL · FRG · 004 — Flower Shop, 260ml' },
  { img: mediaUrl('/media/saintmari/scarf-mauve-pearl.jpg'), cap: 'VL · SLK · 003 — Mauve Twilly Scarf' },
]
const slide = ref(0)
let timer = null
function go(i) {
  slide.value = i
  restart()
}
function restart() {
  clearInterval(timer)
  timer = setInterval(() => (slide.value = (slide.value + 1) % SLIDES.length), 6000)
}
onMounted(restart)
onBeforeUnmount(() => clearInterval(timer))

/* ── 目錄資料 ──────────────────────────────────────────── */
/*
 * 商品在 Cloudflare D1，執行時才取回來（2026-09-28 之前是建置時烤進 bundle）。
 * 主視覺那一段的圖是寫死的靜態檔，不等資料 —— 所以首屏不會空白，
 * 只有品類與商品格會走載入狀態。
 */
onMounted(() => loadCatalog())

/* ── 品類篩選與搜尋 ────────────────────────────────────── */
const filter = ref('all')
const query = ref('')
const gridEl = ref(null)

function scrollToGrid() {
  gridEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function select(key) {
  if (key === 'story') {
    document.getElementById('story')?.scrollIntoView({ behavior: 'smooth' })
    return
  }
  filter.value = key
  query.value = ''
  scrollToGrid()
}

function onSearch(q) {
  if (q.trim()) scrollToGrid()
}

const listed = computed(() => products.value.filter((p) => p.listed))
const activeCat = computed(() => findCategory(filter.value))

/** 搜尋比對三種語言的品名、品類與編號 —— 使用者用哪種語言輸入都找得到 */
const shown = computed(() => {
  const kw = query.value.trim().toLowerCase()
  return listed.value.filter((p) => {
    if (filter.value !== 'all' && p.category !== filter.value) return false
    if (!kw) return true
    const cat = findCategory(p.category)?.name || {}
    return [p.name.zh, p.name.en, p.name.ko, p.ref, cat.zh, cat.en, cat.ko]
      .join(' ')
      .toLowerCase()
      .includes(kw)
  })
})

const gridKicker = computed(() => {
  if (query.value.trim()) return t('searchResult')
  return activeCat.value ? pick(activeCat.value.name) : t('allSelections')
})

/* ── 細節彈窗與 LINE ───────────────────────────────────── */
const detail = ref(null)
const lineOpen = ref(false)
function askOnLine() {
  detail.value = null
  lineOpen.value = true
}
</script>

<template>
  <div id="top" class="page">
    <span class="spine" aria-hidden="true" />

    <SiteHeader
      v-model:query="query"
      :active="filter"
      @select="select"
      @line="lineOpen = true"
      @search="onSearch"
    />

    <!-- ═══ 品牌主視覺：雜誌跨頁，不是滿版橫幅 ═══ -->
    <section class="hero">
      <span class="mark" style="top: calc(50% - 24px)" aria-hidden="true"><i /><b>Index</b></span>

      <div class="hero-l">
        <span class="wm" aria-hidden="true">V</span>
        <p class="eyebrow rise" style="animation-delay: 0.1s">{{ t('heroEyebrow') }}</p>
        <h1 class="rise" style="animation-delay: 0.2s">
          <span>Refined</span><span>Elegance,</span>
          <span class="i">Everyday</span><span class="i">Luxury.</span>
        </h1>
        <p class="sub rise" style="animation-delay: 0.35s">
          {{ t('heroSub1') }}<br />{{ t('heroSub2') }}
        </p>
        <div class="cta rise" style="animation-delay: 0.5s">
          <button class="btn-line" @click="select('all')">{{ t('explore') }}</button>
          <button class="ask" @click="lineOpen = true">{{ t('askOnLine') }}</button>
        </div>
      </div>

      <div class="hero-r">
        <div
          v-for="(s, i) in SLIDES"
          :key="s.img"
          class="plate slide"
          :class="{ on: i === slide }"
          :aria-hidden="i !== slide"
        >
          <img :src="s.img" :alt="s.cap" />
          <span class="plate-cap">{{ s.cap }}</span>
        </div>
        <span class="veil" aria-hidden="true" />
        <span class="idx">
          {{ String(slide + 1).padStart(2, '0') }} / {{ String(SLIDES.length).padStart(2, '0') }}
        </span>
        <div class="dots" role="tablist" :aria-label="t('heroCarousel')">
          <button
            v-for="(s, i) in SLIDES"
            :key="s.img"
            :class="{ on: i === slide }"
            :aria-selected="i === slide"
            role="tab"
            :aria-label="t('slideN', i + 1)"
            @click="go(i)"
          />
        </div>
      </div>
    </section>

    <!-- ═══ 品類區：韓系不對稱格狀（標題與數量由 categories 長度決定） ═══ -->
    <section class="sec">
      <span class="mark" style="top: 150px" aria-hidden="true"><i /><b>Categories</b></span>
      <div class="wrap">
        <header class="sec-head">
          <p class="k">{{ t('catKicker', num(Object.keys(houses).length), num(categories.length)) }}</p>
          <h2>{{ t('catTitle', num(categories.length)) }}<em>{{ t('catTitleEm') }}</em></h2>
          <hr class="hair" />
        </header>
      </div>

      <div class="cat">
        <button
          v-for="(c, i) in categories"
          :key="c.key"
          class="cd"
          :class="'k-' + i"
          @click="select(c.key)"
        >
          <span class="plate" :class="{ 'is-cutout': isCutout(c.cover) }">
            <img :src="c.cover" :alt="pick(c.name)" />
          </span>
          <span class="meta">
            <span class="en disp">{{ c.code }}</span>
            <span class="zh">{{ pick(c.name) }}</span>
            <span class="n">{{ categoryCount(c.key) }} {{ t('selected') }}</span>
            <i class="glow" />
          </span>
        </button>
      </div>
    </section>

    <!-- ═══ 精選展示：純瀏覽，無下單 ═══ -->
    <section class="sec feat">
      <span class="mark" style="top: 150px" aria-hidden="true"><i /><b>Featured</b></span>
      <div class="wrap">
        <header class="sec-head row">
          <div>
            <p class="k">{{ t('featKicker') }}</p>
            <h2>{{ t('featTitle') }}<em>{{ t('featTitleEm') }}</em></h2>
            <hr class="hair" />
          </div>
          <button class="link-gold" @click="select('all')">
            {{ t('viewAll', listed.length) }} →
          </button>
        </header>

        <article v-for="p in featured" :key="p.id" class="wide">
          <span class="plate" :class="{ 'is-cutout': isCutout(p.image) }">
            <img :src="p.image" :alt="pick(p.name)" />
          </span>
          <div class="wide-body">
            <div class="top">
              <span v-if="houses[p.house]" class="pill">{{ houses[p.house].name }}</span>
              <span class="ref">{{ p.ref }}</span>
            </div>
            <h3 class="disp">{{ p.name.en }}</h3>
            <p class="zh">{{ pick(p.name) }}</p>
            <p class="desc">{{ pick(p.desc) }}</p>
            <div class="attrs">
              <span>{{ pick(p.material) }}</span><em />
              <span>{{ pick(p.origin) }}</span><em />
              <span>{{ pick(p.spec) }}</span>
            </div>
            <button class="link-gold view" @click="detail = p">{{ t('viewDetails') }} →</button>
          </div>
        </article>
      </div>
    </section>

    <!-- ═══ 全品項藝廊 ═══ -->
    <section ref="gridEl" class="sec">
      <span class="mark" style="top: 150px" aria-hidden="true"><i /><b>Catalogue</b></span>
      <div class="wrap">
        <header class="sec-head row">
          <div>
            <p class="k">{{ gridKicker }}</p>
            <h2>
              {{ query.trim() || (activeCat ? pick(activeCat.name) : t('allSelections')) }}
              <!-- 還在載入的時候不要印數字。印 0 是在還不知道有幾件的時候謊報一個
                   確定的答案，而那個 0 跟「真的一件都沒有」長得一模一樣 -->
              <em v-if="!catalogState.loading">{{ shown.length }}</em>
            </h2>
            <hr class="hair" />
          </div>
          <div class="chips">
            <button :class="{ on: filter === 'all' && !query }" @click="select('all')">
              {{ t('all') }}
            </button>
            <button
              v-for="c in categories"
              :key="c.key"
              :class="{ on: filter === c.key }"
              @click="select(c.key)"
            >
              {{ pick(c.name) }}
            </button>
          </div>
        </header>

        <!-- 載入中：骨架。不要用 spinner —— 骨架撐住版面高度，
             資料到了之後頁面不會整個往下跳 -->
        <div v-if="catalogState.loading" class="grid" aria-busy="true">
          <span v-for="i in 8" :key="i" class="tile skel" aria-hidden="true">
            <span class="plate" />
            <span class="t-meta"><i class="sk sk-s" /><i class="sk sk-l" /></span>
          </span>
        </div>

        <!-- 壞掉要講清楚是壞掉，並且給重試。原始訊息也印出來 ——
             這支 API 只回公開的商品資料，沒有什麼好藏的，
             而藏起來只會讓回報變成「就打不開啊」 -->
        <div v-else-if="catalogState.error" class="empty">
          <p>{{ t('loadFailed') }}</p>
          <p class="hint">{{ catalogState.error }}</p>
          <button class="link-gold" @click="loadCatalog({ force: true })">{{ t('retry') }} →</button>
        </div>

        <div v-else-if="shown.length" class="grid">
          <button v-for="p in shown" :key="p.id" class="tile" @click="detail = p">
            <span class="plate" :class="{ 'is-cutout': isCutout(p.image) }">
              <img :src="p.image" :alt="pick(p.name)" loading="lazy" />
            </span>
            <span class="t-meta">
              <span class="t-ref">{{ p.ref }}</span>
              <span class="t-name disp">{{ p.name.en }}</span>
              <span class="t-zh">{{ pick(p.name) }}</span>
            </span>
          </button>
        </div>

        <div v-else class="empty">
          <p>{{ t('noResult') }}</p>
          <p class="hint">{{ t('noResultHint') }}</p>
          <button class="link-gold" @click="select('all')">{{ t('resetFilter') }} →</button>
        </div>
      </div>
    </section>

    <!-- ═══ 品牌理念 ═══ -->
    <section id="story" class="sec">
      <span class="mark" style="top: 150px" aria-hidden="true"><i /><b>Philosophy</b></span>

      <div class="phil">
        <span class="wm" aria-hidden="true" style="left: 58%; top: -40px; font-size: 300px">V</span>
        <span class="plate ph-img"><img :src="mediaUrl('/media/vuca/bedroom.jpg')" alt="VUCA" /></span>
        <div class="txt">
          <p class="k">{{ t('philKicker1') }}</p>
          <h3 class="disp">We select,<br />so you don’t have to.</h3>
          <hr class="hair" />
          <p>{{ t('philBody1') }}</p>
        </div>
      </div>

      <div class="phil flip">
        <span class="wm" aria-hidden="true" style="left: 4%; top: 20px; font-size: 300px">V</span>
        <span class="plate ph-img">
          <img :src="mediaUrl('/media/saintmari/scarf-pink-bow.jpg')" alt="SAINTMARI" />
        </span>
        <div class="txt">
          <p class="k">{{ t('philKicker2') }}</p>
          <h3 class="disp">Quiet things<br />last longer.</h3>
          <hr class="hair" />
          <p>{{ t('philBody2') }}</p>
        </div>
      </div>
    </section>

    <SiteFooter @select="select" />

    <ProductModal :product="detail" @close="detail = null" @line="askOnLine" />
    <LineFab v-model:open="lineOpen" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  overflow-x: clip;
}

/* ── HERO ───────────────────────────────────────────────── */
.hero {
  display: flex;
  height: 720px;
  position: relative;
}
.hero-l {
  width: 58.3%;
  flex: none;
  padding: 0 clamp(32px, 5vw, 80px) 0 var(--gutter);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
}
.hero-l > * {
  position: relative;
  z-index: 1;
}
.hero-l .wm {
  position: absolute;
  right: 8px;
  top: 96px;
  font-size: clamp(180px, 26vw, 380px);
  z-index: 0;
}
.hero-r {
  flex: 1;
  position: relative;
  border-left: 1px solid var(--gold);
}
.hero-r .slide {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 1.1s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.hero-r .slide.on {
  opacity: 1;
}
/* 疊在照片上的字需要一層極淡的遮光，否則遇到亮部就讀不到 */
.veil {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(20, 16, 10, 0.3) 0, rgba(20, 16, 10, 0) 130px),
    linear-gradient(0deg, rgba(20, 16, 10, 0.34) 0, rgba(20, 16, 10, 0) 140px);
}
.hero-r .plate-cap {
  color: rgba(255, 253, 248, 0.8);
  z-index: 4;
}

.eyebrow {
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.26em;
  color: var(--gold-deep);
  text-transform: uppercase;
  margin-bottom: 34px;
}
h1 {
  font-family: var(--f-disp);
  font-weight: 400;
  font-size: clamp(44px, 5.3vw, 76px);
  line-height: 1.16;
  letter-spacing: 0.08em;
}
h1 span {
  display: block;
}
h1 .i {
  padding-left: clamp(20px, 3.9vw, 56px);
}
.sub {
  margin-top: 34px;
  font-size: clamp(15px, 1.2vw, 17px);
  line-height: 1.9;
  color: var(--ink-soft);
  max-width: 470px;
}
.cta {
  margin-top: 48px;
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
}
.ask {
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
  border-bottom: 1px solid var(--line-strong);
  padding-bottom: 3px;
  transition: color 0.35s ease, border-color 0.35s ease;
}
.ask:hover {
  color: var(--ink);
  border-color: var(--gold);
}

.idx {
  position: absolute;
  right: 36px;
  top: 44px;
  z-index: 4;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.22em;
  color: rgba(255, 253, 248, 0.82);
}
.dots {
  position: absolute;
  left: 36px;
  bottom: 40px;
  z-index: 4;
  display: flex;
  gap: 9px;
}
.dots button {
  width: 26px;
  height: 1px;
  padding: 8px 0;
  background: none;
  position: relative;
}
.dots button::after {
  content: '';
  position: absolute;
  inset: 8px 0;
  background: rgba(255, 253, 248, 0.45);
  transition: background 0.4s ease;
}
.dots button.on::after {
  background: #fffdf8;
}

/* ── 品類不對稱格 ───────────────────────────────────────── */
.cat {
  position: relative;
  height: 680px;
  margin-inline: var(--gutter);
}
.cd {
  position: absolute;
  padding: 0;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color 0.5s ease, transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.cd:hover {
  border-color: var(--gold);
  transform: translateY(-3px);
}
.cd::after {
  content: '';
  position: absolute;
  inset: 7px;
  border: 1px solid rgba(197, 168, 128, 0.26);
  border-radius: 3px;
  pointer-events: none;
  z-index: 4;
  transition: border-color 0.5s ease;
}
.cd:hover::after {
  border-color: rgba(197, 168, 128, 0.55);
}
.cd .plate {
  flex: 1;
  min-height: 0;
}
.cd .meta {
  position: relative;
  display: block;
  flex: none;
  padding: 22px 26px 26px;
  border-top: 1px solid var(--line);
}
.cd .en {
  display: block;
  font-size: 25px;
  letter-spacing: 0.18em;
}
.cd .zh {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
}
.cd .n {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--gold-deep);
  text-transform: uppercase;
}
.cd .n::before {
  content: '';
  width: 4px;
  height: 4px;
  transform: rotate(45deg);
  background: var(--gold);
  flex: none;
}
.glow {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 1px;
  width: 0;
  background: var(--gold-leaf);
  transition: width 0.7s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.cd:hover .glow {
  width: 100%;
}

/* B 欄刻意超出 A 欄底線 60px，C 欄整根下沉 140px 打破基準線 */
.k-0 { left: 0; top: 0; width: 38%; height: 620px; }
.k-1 { left: 40%; top: 0; width: 28%; height: 356px; }
.k-2 { left: 70%; top: 140px; width: 30%; height: 500px; }
.k-3 { left: 40%; top: 380px; width: 28%; height: 300px; }

/* ── 精選寬幅卡 ─────────────────────────────────────────── */
.feat {
  background: var(--bg-alt);
  --ring: #f8f6f0;
}
.wide {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  box-shadow: var(--sh-ambient);
  margin-bottom: 32px;
  transition: border-color 0.5s ease, box-shadow 0.5s ease;
}
.wide:hover {
  border-color: var(--gold);
  box-shadow: var(--sh-raised);
}
.wide .plate {
  width: 40%;
  flex: none;
  align-self: stretch;
  min-height: 322px;
}
.wide-body {
  flex: 1;
  padding: clamp(28px, 3.5vw, 46px) clamp(24px, 4vw, 52px);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.top {
  display: flex;
  align-items: center;
  gap: 16px;
}
.wide h3 {
  margin-top: 22px;
  font-size: clamp(27px, 2.6vw, 31px);
  line-height: 1.25;
  letter-spacing: 0.07em;
}
.wide .zh {
  margin-top: 8px;
  font-size: 15px;
  letter-spacing: 0.12em;
  color: var(--ink-soft);
}
.wide .desc {
  margin-top: 20px;
  font-size: 15px;
  line-height: 1.85;
  color: var(--ink-soft);
  max-width: 560px;
}
.attrs {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 22px;
  flex-wrap: wrap;
}
.attrs span {
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 13px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
  text-transform: uppercase;
}
.attrs em {
  width: 1px;
  height: 10px;
  background: var(--line-strong);
}
.view {
  margin-top: 30px;
  align-self: flex-start;
}

/* ── 全品項藝廊 ─────────────────────────────────────────── */
.chips {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.chips button {
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
  transition: border-color 0.3s ease, color 0.3s ease;
}
.chips button:hover {
  border-color: var(--ink-faint);
  color: var(--ink);
}
.chips button.on {
  color: var(--ink);
  border-color: transparent;
  background: linear-gradient(var(--bg), var(--bg)) padding-box, var(--gold-leaf) border-box;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 28px;
}
.tile {
  padding: 0;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
  transition: border-color 0.4s ease, transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.tile:hover {
  border-color: var(--gold);
  transform: translateY(-2px);
}
.tile .plate {
  aspect-ratio: 4 / 5;
}
.t-meta {
  display: block;
  padding: 18px 20px 22px;
  border-top: 1px solid var(--line);
}
.t-ref {
  display: block;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--ink-faint);
}
/* 英文用襯線、中文用無襯線 —— 兩個語域刻意不配成同一張臉。
   先前為了可讀性把英文改成無襯線，結果中英文兩行變得無法區別
   （「Pearl Scarf Ring No.001」對上「珍珠絲巾扣 No.001」）。
   Marcellus 比原本的 Italiana 實得多，20px 在手機上撐得住，
   所以改回襯線並拉大，靠「字體 + 字級 + 顏色」三重對比拉開層次。 */
.t-name {
  display: block;
  margin-top: 7px;
  font-size: 17px;
  line-height: 1.4;
  letter-spacing: 0.03em;
  color: var(--ink);
}
.t-zh {
  display: block;
  margin-top: 3px;
  font-size: 13.5px;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
}

/* ── 載入骨架 ──────────────────────────────────────────
   .skel 沿用 .tile 的外框與比例，所以資料到了之後版面不會位移。
   顏色只用 --line 這一階，不做高對比的閃爍 —— 這是形象站，
   骨架應該像還沒印好的版，不像系統在跑。 */
.tile.skel {
  cursor: default;
  pointer-events: none;
}
.tile.skel:hover {
  border-color: var(--line);
  transform: none;
}
.tile.skel .plate {
  display: block;
  background: var(--line);
}
.sk {
  display: block;
  height: 10px;
  border-radius: 2px;
  background: var(--line);
}
.sk-s {
  width: 34%;
}
.sk-l {
  width: 72%;
  height: 13px;
  margin-top: 10px;
}
/* prefers-reduced-motion 的人不需要這個脈動，靜態的灰塊一樣傳達得了「還沒好」 */
@media (prefers-reduced-motion: no-preference) {
  .tile.skel .plate,
  .sk {
    animation: skel-pulse 1.6s ease-in-out infinite;
  }
}
@keyframes skel-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.empty {
  padding: clamp(48px, 7vw, 96px) 0;
  text-align: center;
}
.empty p {
  font-size: 15px;
  letter-spacing: 0.08em;
}
.empty .hint {
  margin-top: 8px;
  font-size: 14px;
  color: var(--ink-soft);
}
.empty .link-gold {
  margin-top: 24px;
}

/* ── 品牌理念 ───────────────────────────────────────────── */
.phil {
  position: relative;
  display: flex;
  align-items: center;
  gap: clamp(28px, 5vw, 60px);
  margin-inline: var(--gutter);
}
.phil + .phil {
  margin-top: clamp(56px, 8vw, 104px);
  flex-direction: row-reverse;
  padding-top: 64px;
}
.ph-img {
  width: 50%;
  flex: none;
  aspect-ratio: 15 / 11;
  border-radius: var(--r-md);
}
.txt {
  flex: 1;
  position: relative;
  z-index: 1;
}
.txt .k {
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.26em;
  color: var(--gold-deep);
  text-transform: uppercase;
}
.txt h3 {
  margin: 20px 0 26px;
  font-size: clamp(26px, 3.2vw, 37px);
  line-height: 1.35;
  letter-spacing: 0.07em;
}
.txt p {
  margin-top: 26px;
  font-size: 15px;
  line-height: 1.95;
  color: var(--ink-soft);
  max-width: 480px;
}

/* aspect-ratio 是 Safari 15+ / iOS 15+ 才支援。舊機型上這兩個元素會塌成 0 高，
   用經典的 padding-top 撐高當退路 —— .plate > img 本來就絕對定位，直接生效。 */
@supports not (aspect-ratio: 1 / 1) {
  .tile .plate {
    height: 0;
    padding-top: 125%; /* 4 : 5 */
  }
  .ph-img {
    height: 0;
    padding-top: 73.33%; /* 15 : 11 */
  }
}

/* ── 響應式 ─────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .hero {
    height: auto;
    flex-direction: column;
  }
  .hero-l {
    width: 100%;
    padding: clamp(48px, 9vw, 88px) var(--gutter);
  }
  .hero-r {
    /* flex: none 是必要的 —— 直向排列時 .hero-r 原本的 flex:1 會帶著
       flex-basis:0 蓋掉 height，而容器沒有固定高度，整欄會塌成 1px。 */
    flex: none;
    width: 100%;
    height: min(58vh, 440px);
    border-left: 0;
    border-top: 1px solid var(--gold);
  }
  .cat {
    height: auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .cd {
    position: static;
    width: auto;
    height: 400px;
  }
  .wide {
    flex-direction: column;
  }
  .wide .plate {
    width: 100%;
    height: 300px;
    min-height: 0;
  }
}

@media (max-width: 720px) {
  /* 區塊中文小標、品類篩選、輪播編號在手機上都偏小 */
  /* 基礎規則是 .txt .k（0,2,0），裸 .k 蓋不過去 */
  .txt .k,
  .k {
    font-size: 14px;
  }
  .idx {
    font-size: 13px;
  }
  .chips button {
    font-size: 15px;
  }
  .ask {
    font-size: 15px;
  }

  /* style.css 那批全域手機規則對這些沒用 —— scoped 會編成
     .t-ref[data-v-x]，specificity 高過全域的 .t-ref。凡是定義在本檔的
     class，手機放大就得寫在這裡。 */
  .attrs span,
  .t-ref,
  .cd .n,
  .eyebrow {
    font-size: 12.5px;
    font-weight: 500;
  }
  .attrs span {
    font-size: 13px;
  }

  /* 實測：手機上圖庫是**單欄**、磚寬 313px（不是原本以為的兩欄 167px）。
     有 313px 的版面卻只放 15px 的字，比例上就是小。照實際寬度放大。 */
  .t-name {
    font-size: 20px;
  }
  .t-zh {
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .cd .zh {
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.1em;
  }
  /* 精選卡在手機同樣是滿版，中文品名跟著放大 */
  .wide .zh {
    font-size: 16.5px;
    font-weight: 500;
  }
  /* flex-wrap 會把 1px 分隔線推到行尾吊著。手機上一項一行，分隔線收起。 */
  .attrs {
    flex-direction: column;
    align-items: flex-start;
    gap: 7px;
  }
  .attrs em {
    display: none;
  }

  /* 直排的品類代碼在窄螢幕會壓到標題與內文上，手機上收起來；
     書脊那條 1px 金線留著，它只佔一個像素且是版面的識別。 */
  .mark {
    display: none;
  }
  .cat {
    grid-template-columns: 1fr;
  }
  .phil,
  .phil + .phil {
    flex-direction: column;
    padding-top: 0;
  }
  .ph-img {
    width: 100%;
  }
  .txt p {
    max-width: none;
  }
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 18px;
  }
}
</style>
