<script setup>
import { onBeforeUnmount, onMounted } from 'vue'

import LineQr from '@/components/LineQr.vue'
import { company } from '@/data/catalog.js'
import { t } from '@/i18n.js'

const open = defineModel('open', { type: Boolean, default: false })

function onKey(e) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fab-wrap">
    <Transition name="fade">
      <div v-if="open" class="pop" role="dialog" :aria-label="t('ftLine')">
        <button class="close" :aria-label="t('close')" @click="open = false">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div class="box"><LineQr :size="150" /></div>
        <h5>{{ t('lineTitle') }}</h5>
        <p class="id">{{ company.lineId }}</p>
        <p class="note">{{ t('lineNote') }}</p>
        <a class="join" :href="company.lineUrl" target="_blank" rel="noopener">
          {{ t('addFriend') }}
        </a>
      </div>
    </Transition>

    <button
      class="fab"
      :aria-expanded="open"
      :aria-label="t('lineConsult')"
      @click="open = !open"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="#06C755">
        <path
          d="M12 3C6.9 3 2.8 6.4 2.8 10.6c0 3.7 3.3 6.9 7.8 7.5.3.06.7.2.8.47.1.24.06.6.03.85l-.13.8c-.04.24-.19.93.82.51 1.01-.42 5.43-3.2 7.4-5.48 1.36-1.5 1.67-3.02 1.67-4.65C21.2 6.4 17.1 3 12 3z"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.fab-wrap {
  position: fixed;
  right: clamp(16px, 2.8vw, 40px);
  bottom: clamp(16px, 2.8vw, 40px);
  z-index: 70;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16px;
}

.fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(var(--bg), var(--bg)) padding-box, var(--gold-leaf) border-box;
  outline: 1px solid rgba(201, 163, 125, 0.3);
  outline-offset: 4px;
  box-shadow: var(--sh-ambient);
  transition: transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1), box-shadow 0.4s ease;
}
.fab:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh-raised);
}

.pop {
  position: relative;
  width: 254px;
  padding: 26px;
  text-align: center;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--sh-raised);
}
/* 觸控目標 44px（實測原本 25×15）。看得到的 × 不變，可點範圍往外撐 */
.close {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  display: flex;
}
.box {
  width: 150px;
  margin: 0 auto;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: linear-gradient(var(--bg), var(--bg)) padding-box, var(--gold-leaf) border-box;
  outline: 1px solid rgba(201, 163, 125, 0.32);
  outline-offset: 5px;
}
h5 {
  margin-top: 22px;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0.1em;
}
.id {
  margin-top: 4px;
  font-family: var(--f-mono);
  font-weight: 400;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--gold-deep);
}
.note {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.join {
  display: block;
  margin-top: 16px;
  height: 44px;
  line-height: 44px;
  border-radius: var(--r-sm);
  background: var(--green);
  color: #fff;
  font-size: 13px;
  letter-spacing: 0.16em;
  transition: filter 0.3s ease;
}
.join:hover {
  filter: brightness(0.94);
}
</style>
