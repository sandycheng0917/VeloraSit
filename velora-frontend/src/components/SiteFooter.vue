<script setup>
import LineQr from '@/components/LineQr.vue'
import { categories, company } from '@/data/catalog.js'
import { pick, t } from '@/i18n.js'

defineEmits(['select'])
</script>

<template>
  <footer class="ft">
    <div class="grid">
      <div>
        <b class="ft-mark disp">{{ company.wordmark }}</b>
        <p class="co">{{ pick(company.name) }}</p>
        <p class="co-en">{{ company.nameEn }}</p>
        <dl>
          <div><dt>{{ t('ftEmail') }}</dt><dd><a :href="'mailto:' + company.email">{{ company.email }}</a></dd></div>
        </dl>
      </div>

      <div>
        <h5>{{ t('ftCategories') }}</h5>
        <ul>
          <li v-for="c in categories" :key="c.key">
            <button @click="$emit('select', c.key)">{{ c.code }}　{{ pick(c.name) }}</button>
          </li>
        </ul>
      </div>

      <div>
        <h5>{{ t('ftInformation') }}</h5>
        <ul>
          <li><a href="#story">{{ t('ftStory') }}</a></li>
          <li><a href="#story">{{ t('ftStandard') }}</a></li>
          <li><a href="#">{{ t('ftPrivacy') }}</a></li>
          <li><a href="#">{{ t('ftTerms') }}</a></li>
        </ul>
      </div>

      <div>
        <h5>{{ t('ftLine') }}</h5>
        <div class="qr-row">
          <div class="qr-box"><LineQr :size="112" /></div>
          <div>
            <p class="qr-note">{{ t('lineNote') }}</p>
            <p class="qr-id">{{ company.lineId }}</p>
            <a class="green" :href="company.lineUrl" target="_blank" rel="noopener">
              {{ t('addFriend') }}
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="btm">
      <span>© 2026 {{ company.nameEn }}.　{{ t('rights') }}</span>
      <span>{{ t('represents') }}</span>
    </div>
  </footer>
</template>

<style scoped>
.ft {
  position: relative;
  /* 深粉表尾，跟表頭成對。底色與字色調整見 style.css 的 --band */
  background: var(--band);
  padding: clamp(56px, 7vw, 88px) var(--gutter) 0;
  --green-deep: #02612a;
}
.ft::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--band-rule);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 190px 190px 300px;
  gap: 40px;
}

.ft-mark {
  display: block;
  font-size: 25px;
  letter-spacing: 0.24em;
}
.co {
  margin-top: 26px;
  font-size: 15px;
  letter-spacing: 0.1em;
}
.co-en {
  margin-top: 5px;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
}
dl {
  margin-top: 24px;
}
dl div {
  display: flex;
  gap: 14px;
  margin-top: 8px;
}
dt {
  width: 46px;
  flex: none;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
  padding-top: 2px;
}
dd {
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 0.06em;
}

h5 {
  margin-bottom: 22px;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--gold-deep);
}
ul li {
  margin-top: 11px;
}
ul a,
ul button {
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--ink-soft);
  transition: color 0.3s ease;
}
ul a:hover,
ul button:hover {
  color: var(--ink);
}

.qr-row {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.qr-box {
  flex: none;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: linear-gradient(var(--bg), var(--bg)) padding-box, var(--gold-leaf) border-box;
  outline: 1px solid rgba(185, 142, 120, 0.5);
  outline-offset: 4px;
}
.qr-note {
  font-size: 14px;
  line-height: 1.7;
  letter-spacing: 0.08em;
}
.qr-id {
  margin-top: 4px;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--gold-deep);
}
/* LINE 綠當文字只有 1.97:1 —— 文字用壓深版，外框維持品牌綠 */
.green {
  display: inline-flex;
  align-items: center;
  height: 36px;
  margin-top: 14px;
  padding: 0 20px;
  border: 1px solid var(--green);
  border-radius: var(--r-sm);
  /* LINE 綠當文字只有 1.97:1 —— 文字壓深，外框維持品牌綠 */
  color: var(--green-deep);
  font-size: 13px;
  letter-spacing: 0.14em;
  transition: background 0.35s ease;
}
.green:hover {
  background: rgba(6, 199, 85, 0.07);
}

.btm {
  margin-top: clamp(48px, 6vw, 76px);
  padding: 26px 0 34px;
  background: linear-gradient(var(--band-rule), var(--band-rule)) top / 100% 1px no-repeat;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.btm span {
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr 1fr;
    gap: 48px 32px;
  }
}
@media (max-width: 640px) {
  /* 頁尾整區在手機上字都偏小：欄標題 11px、連結 13px */
  h5 {
    font-size: 13px;
    letter-spacing: 0.18em;
  }
  dt {
    width: 56px;
    font-size: 13px;
  }
  ul a,
  ul button,
  dd,
  .qr-id,
  .green {
    font-size: 15px;
  }
  .co-en,
  .btm span {
    font-size: 13.5px;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  /* 觸控目標至少 44px（實測原本連結只有 21px 高、加入好友 36px）。
     字距與版面不變，只把可點的範圍撐大 */
  ul li {
    margin-top: 0;
  }
  ul a,
  ul button,
  dd a {
    display: inline-block;
    padding: 10px 0;
  }
  .green {
    height: 44px;
  }
}
</style>
