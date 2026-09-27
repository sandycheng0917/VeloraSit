<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { categories, company } from '@/data/catalog.js'
import { t } from '@/i18n.js'

const props = defineProps({
  active: { type: String, default: 'all' },
})
const emit = defineEmits(['select', 'line', 'search'])

const query = defineModel('query', { type: String, default: '' })

const scrolled = ref(false)
const menuOpen = ref(false)
const searchOpen = ref(false)
const searchInput = ref(null)

function onScroll() {
  scrolled.value = window.scrollY > 12
}
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

function pick(key) {
  menuOpen.value = false
  emit('select', key)
}

async function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    await nextTick()
    searchInput.value?.focus()
  } else if (query.value) {
    query.value = ''
    emit('search', '')
  }
}

function submit() {
  emit('search', query.value)
}
</script>

<template>
  <header class="hdr" :class="{ 'is-scrolled': scrolled }">
    <a class="logo" href="#top" @click.prevent="pick('all')">
      <b>{{ company.wordmark }}</b>
      <span>{{ company.wordmarkZh }}</span>
    </a>

    <nav class="nav" :class="{ open: menuOpen }" :aria-label="t('ftCategories')">
      <button :class="{ on: props.active === 'all' }" @click="pick('all')">ALL</button>
      <button
        v-for="c in categories"
        :key="c.key"
        :class="{ on: props.active === c.key }"
        @click="pick(c.key)"
      >
        {{ c.code }}
      </button>
      <button :class="{ on: props.active === 'story' }" @click="pick('story')">STORY</button>
    </nav>

    <div class="tools">
      <div class="search" :class="{ open: searchOpen }">
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          :placeholder="t('searchPlaceholder')"
          :aria-label="t('searchLabel')"
          :tabindex="searchOpen ? 0 : -1"
          @input="submit"
          @keydown.escape="toggleSearch"
        />
        <button class="ico" :aria-label="searchOpen ? t('clearSearch') : t('openSearch')" @click="toggleSearch">
          <svg v-if="!searchOpen" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.6-3.6" />
          </svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <span class="div" />

      <button class="line-btn" :aria-label="t('lineConsult')" @click="emit('line')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#06C755">
          <path
            d="M12 3C6.9 3 2.8 6.4 2.8 10.6c0 3.7 3.3 6.9 7.8 7.5.3.06.7.2.8.47.1.24.06.6.03.85l-.13.8c-.04.24-.19.93.82.51 1.01-.42 5.43-3.2 7.4-5.48 1.36-1.5 1.67-3.02 1.67-4.65C21.2 6.4 17.1 3 12 3z"
          />
        </svg>
      </button>

      <button class="burger" :aria-expanded="menuOpen" :aria-label="t('menu')" @click="menuOpen = !menuOpen">
        <i /><i /><i />
      </button>
    </div>
  </header>
</template>

<style scoped>
.hdr {
  position: sticky;
  top: 0;
  z-index: 60;
  height: 80px;
  display: flex;
  align-items: center;
  padding-left: var(--gutter);
  padding-right: clamp(20px, 3vw, 40px);
  background: rgba(253, 251, 247, 0.88);
  -webkit-backdrop-filter: saturate(140%) blur(14px);
  backdrop-filter: saturate(140%) blur(14px);
  transition: box-shadow 0.4s ease;
}
.hdr::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--gold-leaf);
  opacity: 0.55;
}
.hdr.is-scrolled {
  box-shadow: var(--sh-ambient);
}

.logo b {
  display: block;
  font-family: var(--f-disp);
  font-weight: 400;
  font-size: 25px;
  letter-spacing: 0.24em;
  line-height: 1;
}
/* 0.42em 的字距是識別的一部分，但 12px 配上這麼寬的字距，
   三個字會散得又小又淡。放大並加重，字距略收讓它重新聚成一個詞。 */
.logo span {
  display: block;
  margin-top: 5px;
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: 0.34em;
  color: var(--ink-soft);
}

.nav {
  display: flex;
  gap: clamp(14px, 2.2vw, 32px);
  margin-left: clamp(28px, 5vw, 80px);
}
.nav button {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
  padding-bottom: 5px;
  border-bottom: 1px solid transparent;
  transition: color 0.35s ease;
  white-space: nowrap;
}
.nav button:hover {
  color: var(--ink);
}
.nav button.on {
  color: var(--ink);
  background: var(--gold-leaf) bottom / 100% 1px no-repeat;
}

.tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  color: var(--ink-soft);
}

/* 搜尋：預設只露圖示，點開才展開輸入框，不佔用導覽列的呼吸感 */
.search {
  display: flex;
  align-items: center;
  border-bottom: 1px solid transparent;
  transition: border-color 0.4s ease;
}
.search.open {
  border-bottom-color: var(--ink-faint);
}
.search input {
  width: 0;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--f-body);
  font-size: 13.5px;
  font-weight: 400;
  letter-spacing: 0.06em;
  color: var(--ink);
  transition: width 0.4s cubic-bezier(0.22, 0.61, 0.36, 1), padding 0.4s ease;
}
.search.open input {
  width: clamp(140px, 16vw, 230px);
  padding: 4px 8px 5px 0;
}
.search input:focus {
  outline: none;
}
.search input::placeholder {
  color: var(--ink-faint);
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.ico {
  display: flex;
  color: inherit;
  flex: none;
}
.ico:hover {
  color: var(--ink);
}

.div {
  width: 1px;
  height: 12px;
  background: var(--line-strong);
  flex: none;
}

/* 三個語言只有一兩個字寬，本來就是全站最小的可點目標 ——
   字級、字重、顏色都不能再退讓，未選中的也要看得清楚。 */
.lang {
  display: flex;
  align-items: center;
  font-family: var(--f-mono);
  font-size: 13px;
  letter-spacing: 0.06em;
}
.lang button {
  color: var(--ink-soft);
  font-weight: 500;
  padding: 6px 2px;
  transition: color 0.3s ease;
}
.lang button:hover {
  color: var(--ink);
}
.lang button.on {
  color: var(--ink);
  font-weight: 700;
  background: var(--gold-leaf) bottom / 100% 1px no-repeat;
}
.lang i {
  font-style: normal;
  font-weight: 400;
  /* --line-strong 是線條色，當文字只有 1.43:1 —— 分隔線幾乎看不見 */
  color: var(--ink-faint);
  margin: 0 6px;
}

.line-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: linear-gradient(var(--bg), var(--bg)) padding-box, var(--gold-leaf) border-box;
  transition: box-shadow 0.35s ease;
}
.line-btn:hover {
  box-shadow: 0 0 0 4px rgba(197, 168, 128, 0.12);
}

.burger {
  display: none;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}
.burger i {
  width: 20px;
  height: 1px;
  background: var(--ink);
}

@media (max-width: 1180px) {
  .nav {
    margin-left: clamp(16px, 3vw, 40px);
    gap: 14px;
  }
  .nav button {
    font-size: 13px;
    letter-spacing: 0.08em;
  }
  .search.open input {
    width: 130px;
  }
}

@media (max-width: 900px) {
  .burger {
    display: flex;
  }
  .nav {
    position: absolute;
    top: 80px;
    left: 0;
    right: 0;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 8px var(--gutter) 20px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    display: none;
  }
  .nav.open {
    display: flex;
  }
  /* 手機是下拉全寬選單，不是擠在一列的導覽 —— 沒有理由還用 13px 的淡字。
     這裡是唯一的分類入口，字級與顏色都拉到內文等級。 */
  .nav button {
    text-align: left;
    padding: 15px 0;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.14em;
    color: var(--ink);
    border-bottom: 1px solid var(--line-soft);
  }
  .nav button.on {
    background-size: 40px 1px;
  }
}

@media (max-width: 560px) {
  .tools {
    gap: 10px;
  }
  .logo b {
    font-size: 26px;
  }
  .logo span {
    font-size: 14.5px;
    letter-spacing: 0.3em;
  }
  /* 手機上這是最小的可點目標，字再放大一階，並撐出 40px 的觸控高度 */
  .lang {
    font-size: 14.5px;
  }
  .lang button {
    padding: 10px 3px;
  }
  .lang i {
    margin: 0 5px;
  }
  .div {
    display: none;
  }
  .search.open input {
    width: 100px;
  }
}
</style>
