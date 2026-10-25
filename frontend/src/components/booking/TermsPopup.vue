<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '@/i18n'
import { CONTRACT_TEXT } from '@/utils/contractI18n'
import Icon from '@/components/ui/Icon.vue'

// The rental agreement's terms (articles 1–9, same text as the printed
// contract), shown before the booking is created. It cannot be dismissed: the
// only way out is to scroll to the end, tick that they have read it and press
// "รับทราบ" (no back button; Esc does nothing). Follows the site language
// (ไทย / English / 中文) and can be switched right here.
const emit = defineEmits(['accept'])
const { locale, setLocale, LOCALES } = useI18n()

const UI = {
  th: {
    title: 'ข้อตกลงการเช่ารถ', hint: 'เลื่อนอ่านจนจบเพื่อกดรับทราบ',
    check: 'ข้าพเจ้าได้อ่านและเข้าใจสัญญาเช่าและข้อตกลงทั้งหมดแล้ว', ok: 'รับทราบและดำเนินการต่อ',
  },
  en: {
    title: 'Rental terms & conditions', hint: 'Scroll to the end to continue',
    check: 'I have read and understood the rental agreement and all its terms', ok: 'Acknowledge & continue',
  },
  zh: {
    title: '租车条款与条件', hint: '请滑动至底部后继续',
    check: '我已阅读并理解租赁合同及全部条款', ok: '确认并继续',
  },
}
const lang = computed(() => (CONTRACT_TEXT[locale.value] ? locale.value : 'th'))
const ui = computed(() => UI[lang.value])
const text = computed(() => CONTRACT_TEXT[lang.value])

const dialog = ref(null)
const scroller = ref(null)
const readToEnd = ref(false)
const agreed = ref(false)
function onScroll() {
  const el = scroller.value
  if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) readToEnd.value = true
}
function accept() {
  if (!agreed.value) return
  emit('accept', lang.value)
  dialog.value?.close()
}
onMounted(() => {
  dialog.value.showModal()
  onScroll() // short screens of text are "read" at once
})
</script>

<template>
  <dialog ref="dialog" class="tp" :aria-label="ui.title" @cancel.prevent>
    <div class="card">
      <header>
        <div>
          <strong>{{ ui.title }}</strong>
          <small>{{ text.termsTitle[0] }}</small>
        </div>
        <div class="langs" role="group" aria-label="ภาษา / Language">
          <button v-for="l in LOCALES" :key="l.code" type="button" :class="{ on: lang === l.code }" :aria-pressed="lang === l.code" @click="setLocale(l.code)">
            {{ l.short }}
          </button>
        </div>
      </header>

      <div ref="scroller" class="body" tabindex="0" @scroll.passive="onScroll">
        <section v-for="[heading, paras] in text.terms" :key="heading">
          <h3>{{ heading }}</h3>
          <p v-for="(p, i) in paras" :key="i" :class="{ sub: /^\(\d\)/.test(p) }">{{ p }}</p>
        </section>
      </div>

      <footer>
        <p v-if="!readToEnd" class="hint"><Icon name="chevron-down" :size="14" /> {{ ui.hint }}</p>
        <label class="check" :class="{ off: !readToEnd }">
          <input v-model="agreed" type="checkbox" :disabled="!readToEnd" />
          {{ ui.check }}
        </label>
        <button type="button" class="ok" :disabled="!agreed" @click="accept">{{ ui.ok }}</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.tp {
  width: min(720px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: #121319;
  color-scheme: light;
}
.tp::backdrop {
  background: rgb(8 9 12 / 0.6);
}
.card {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 16px);
  overflow: hidden;
  border-radius: 20px;
  background: #fff;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid #ececee;
}
header div:first-child {
  display: grid;
  gap: 2px;
}
header strong {
  font-size: 1.05rem;
}
header small {
  color: #6b6e7a;
  font-size: 0.78rem;
}
.langs {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: #f2f3f5;
}
.langs button {
  min-width: 36px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: none;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.langs .on {
  background: #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 18px;
  font-size: 0.85rem;
  line-height: 1.65;
}
.body:focus-visible {
  outline: 3px solid rgb(226 54 44 / 0.25);
  outline-offset: -3px;
}
.body h3 {
  margin: 14px 0 6px;
  font-size: 0.9rem;
  font-weight: 700;
}
.body section:first-child h3 {
  margin-top: 0;
}
.body p {
  margin: 0 0 6px;
  color: #33363f;
}
.body p.sub {
  padding-left: 16px;
}
footer {
  display: grid;
  gap: 10px;
  padding: 12px 18px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid #ececee;
  background: #fafaf9;
}
.hint {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #b7791f;
  font-size: 0.78rem;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}
.check.off {
  color: #a0a3ad;
  cursor: not-allowed;
}
.check input {
  width: 20px;
  height: 20px;
  flex: none;
  accent-color: #e2362c;
}
.ok {
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  border: 0;
  background: #e2362c;
  color: #fff;
}
.ok:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
