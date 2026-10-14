<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { categories, company } from '@/data/catalog.js'
import { pick as pickText, t } from '@/i18n.js'

const props = defineProps({
  active: { type: String, default: 'all' },
})
const emit = defineEmits(['select', 'line', 'search'])

const query = defineModel('query', { type: String, default: '' })

const scrolled = ref(false)
const menuOpen = ref(false)
const searchOpen = ref(false)
const searchInput = ref(null)

/*
 * 桌機的表頭是兩層（置中字標 + 下一列選單），捲動後收成一列 80px。
 *
 * 🔴 收合跟展開要用不同的門檻（遲滯）。sticky 表頭變矮的瞬間內容會往上移，
 *    同一個門檻的話會在臨界點來回切換、整頁抖動。過 120px 才收，回到 4px 以內才展開。
 */
function onScroll() {
  const y = window.scrollY
  if (!scrolled.value && y > 120) scrolled.value = true
  else if (scrolled.value && y < 4) scrolled.value = false
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
      <button :class="{ on: props.active === 'all' }" @click="pick('all')">{{ t('all') }}</button>
      <button
        v-for="c in categories"
        :key="c.key"
        :class="{ on: props.active === c.key }"
        @click="pick(c.key)"
      >
        {{ pickText(c.name) }}
      </button>
      <button :class="{ on: props.active === 'story' }" @click="pick('story')">{{ t('ftStory') }}</button>
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
  /* 置中精品式表頭（2026-10-14 業主選定），底色深粉（2026-10-15），跟表尾成對、
     跟較淡的中段拉開層次。底色與字色調整見 style.css 的 --band。
     上緣 2px 線、下緣雙線，跟主視覺的雙層金框呼應。 */
  background: var(--band);
  box-shadow: inset 0 2px 0 var(--band-rule);
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
  height: 4px;
  background:
    linear-gradient(var(--band-rule), var(--band-rule)) top / 100% 1px no-repeat,
    linear-gradient(var(--band-rule), var(--band-rule)) bottom / 100% 1px no-repeat;
}
/* box-shadow 只能整個換掉，上緣那道金線要一起寫，否則捲動後就消失 */
.hdr.is-scrolled {
  box-shadow: inset 0 2px 0 var(--band-rule), var(--sh-ambient);
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
  background: linear-gradient(var(--gold-deep), var(--gold-deep)) bottom / 100% 1px no-repeat;
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
  box-shadow: 0 0 0 4px rgba(201, 163, 125, 0.12);
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

/* ── 桌機、頁面頂端：置中精品式兩層表頭 ──────────────────
   字標置中、選單另起一列並以金線隔開。工具列（搜尋、LINE）移到右上角。
   只在 901px 以上、而且還沒往下捲的時候成立；其餘情況維持一列。 */
@media (min-width: 901px) {
  .hdr:not(.is-scrolled) {
    height: auto;
    flex-direction: column;
    padding: 22px 0 0;
  }
  .hdr:not(.is-scrolled) .logo {
    text-align: center;
  }
  .hdr:not(.is-scrolled) .logo b {
    font-size: 30px;
  }
  .hdr:not(.is-scrolled) .nav {
    width: 100%;
    justify-content: center;
    gap: clamp(28px, 3.4vw, 52px);
    margin: 16px 0 0;
    padding: 14px 0 15px;
    border-top: 1px solid rgba(185, 142, 120, 0.6);
  }
  .hdr:not(.is-scrolled) .tools {
    position: absolute;
    right: clamp(20px, 3vw, 40px);
    top: 32px;
  }
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
  /* 觸控目標至少 44px。實測原本漢堡鈕 20×23、搜尋 29×19、LINE 32×32 ——
     表頭這三顆是手機上最常按的，看得到的圖示不變，只撐大可點範圍 */
  .burger {
    display: flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    margin-right: -12px;
  }
  .ico {
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
  }
  .line-btn {
    width: 44px;
    height: 44px;
  }
  .tools {
    gap: 4px;
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
  /* 底線要貼在字下方靠左。只改 size 的話 position 沿用 bottom（= 置中），
     底線會跑到整列的正中間，看起來像畫錯位置 */
  .nav button.on {
    background-size: 40px 1px;
    background-position: left bottom 10px;
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
  .div {
    display: none;
  }
  .search.open input {
    width: 100px;
  }
}
</style>
