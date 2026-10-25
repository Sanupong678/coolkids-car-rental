<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { demoLogin, getInbox, sendChat, staffAction } from '@/api/lineDemo'
import FlexMessage from '@/components/line/FlexMessage.vue'
import RichMenu from '@/components/line/RichMenu.vue'

// LINE look-alike demo of the Coolkids Official Account, for trying the whole
// flow before a real OA is connected. Left: the customer's LINE chat (rich
// menu, the bot's real Flex replies, LIFF pages opened over the chat, and the
// pushes they would receive). Right: the buttons staff press in the back office.
// Everything runs against this machine's API; nothing is sent to LINE.

const log = ref([]) // { id, from: 'oa' | 'me' | 'note', text?, flex?, at }
const seen = new Set()
const booking = ref(null)
const me = ref(null)
const menuOpen = ref(true)
const draft = ref('')
const liff = ref(null) // { path, title }
const liffFrame = ref(null)
const busy = ref(false)
const panelOpen = ref(false)
const error = ref('')
const scroller = ref(null)
let poll
let tick
let seq = 0

const clock = (d) => new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
const now = ref(new Date())

function push(entry) {
  log.value.push({ id: `l${++seq}`, at: new Date(), ...entry })
  nextTick(() => scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' }))
}

// ---- links: LIFF URLs open as a LIFF page over the chat, like the LINE app does
function open(url) {
  const liffUrl = url.match(/^https:\/\/liff\.line\.me\/[^/]+(\/.*)?$/)
  if (liffUrl) return openLiff(liffUrl[1] || '/')
  if (url.startsWith(window.location.origin)) return openLiff(url.slice(window.location.origin.length) || '/')
  window.open(url, '_blank', 'noopener')
}
// The LIFF header shows the page's title, which the SPA sets after it loads (and on each navigation).
let titleTimer
function readTitle() {
  try {
    const t = liffFrame.value?.contentDocument?.title ?? ''
    if (liff.value) liff.value.title = t.includes(' — ') ? t.split(' — ')[0] : 'Coolkids Car Rental'
  } catch {
    /* cross-origin page: keep the last title */
  }
}
function openLiff(path) {
  liff.value = { path, title: 'Coolkids Car Rental' }
  clearInterval(titleTimer)
  titleTimer = setInterval(readTitle, 700)
}
function closeLiff() {
  clearInterval(titleTimer)
  liff.value = null
  refresh()
}
const onLiffLoad = readTitle
function onAction(action) {
  if (action?.type === 'uri') open(action.uri)
  else if (action?.type === 'message') send(action.text)
}

// Splits OA text into plain parts and tappable links.
const URL_RE = /(https?:\/\/[^\s]+)/g
const parts = (text) => text.split(URL_RE).map((p, i) => ({ link: i % 2 === 1, text: p }))

// ---- chat
async function send(text) {
  const t = text.trim()
  if (!t) return
  push({ from: 'me', text: t })
  try {
    const replies = await sendChat(t)
    if (!replies.length) push({ from: 'note', text: 'บอทไม่ตอบข้อความนี้ · แอดมินตอบเองจาก LINE OA Manager' })
    await new Promise((r) => setTimeout(r, 450)) // LINE shows the reply a beat later
    for (const m of replies) push(m.type === 'flex' ? { from: 'oa', flex: m.contents, alt: m.altText } : { from: 'oa', text: m.text })
  } catch (err) {
    push({ from: 'note', text: `ส่งไม่สำเร็จ: ${err.message}` })
  }
}
function onMenu(area) {
  if (area.action.type === 'message') send(area.action.text)
  else openLiff(area.action.path)
}
function submitDraft() {
  send(draft.value)
  draft.value = ''
}

// ---- pushes the customer would get on LINE + the staff panel's state
async function refresh() {
  try {
    const data = await getInbox()
    me.value = data.me
    booking.value = data.booking
    for (const m of data.messages) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      push({ from: 'oa', text: m.text, at: new Date(m.at), push: true })
    }
  } catch {
    /* API restarting: try again on the next tick */
  }
}

// ---- staff panel
const ACTIONS = {
  approve: ['อนุมัติเอกสาร', 'ลูกค้าได้ QR โอนค่าจองทาง LINE'],
  request_changes: ['ขอแก้ไขเอกสาร', 'แจ้งลูกค้าให้ถ่ายใบขับขี่ใหม่'],
  confirm_slip: ['ยืนยันสลิป · ได้รับเงินแล้ว', 'ลูกค้าได้ใบสรุปการจอง + ลิงก์ PDF'],
  'status:PREPARING': ['รับงาน · เตรียมเอกสาร', 'สถานะ: กำลังเตรียมเอกสาร'],
  'status:READY': ['รถพร้อมให้รับที่สาขา', 'สถานะ: รถพร้อมให้รับ'],
  'status:IN_DELIVERY': ['ออกส่งรถ', 'ลูกค้าเห็นรถบนแผนที่'],
  near: ['จำลอง: รถใกล้ถึง (~1 กม.)', 'แจ้งเตือนอัตโนมัติจาก GPS คนขับ'],
  arrived: ['จำลอง: รถถึงจุดส่ง', 'แจ้งเตือนอัตโนมัติจาก GPS คนขับ'],
  'status:ACTIVE': ['ส่งมอบรถแล้ว', 'เริ่มการเช่า'],
  'status:COMPLETED': ['ลูกค้าคืนรถแล้ว', 'ปิดงาน'],
}
const STATUS = {
  PENDING: 'รอดำเนินการ', CONFIRMED: 'ยืนยันแล้ว', PREPARING: 'กำลังเตรียมเอกสาร', READY: 'รถพร้อมให้รับ',
  IN_DELIVERY: 'กำลังส่งรถ', ACTIVE: 'กำลังเช่า', COMPLETED: 'คืนรถแล้ว',
}
const REVIEW = { DRAFT: 'ลูกค้ายังส่งเอกสารไม่ครบ', SUBMITTED: 'รอแอดมินตรวจเอกสาร', CHANGES_REQUESTED: 'รอลูกค้าแก้ไข', APPROVED: 'อนุมัติแล้ว · รอลูกค้าโอน' }
const STEPS = [
  'ลูกค้ากด "เลือกรถ" ในเมนู → กด "จองคันนี้" ที่การ์ดรถ',
  'เลือกวัน → ดำเนินการต่อ → กรอกข้อมูล → แนบเอกสาร → ส่งตรวจสอบ',
  'แอดมินอนุมัติเอกสาร (ปุ่มด้านล่าง)',
  'ลูกค้ากดลิงก์ในแชท → สแกน QR → แนบสลิป',
  'แอดมินยืนยันสลิป → ลูกค้าได้ใบสรุป + PDF',
  'แอดมินอัปเดตสถานะ → ลูกค้าได้แจ้งเตือนทุกขั้น',
]
const stepNow = computed(() => {
  const b = booking.value
  if (!b) return 0
  if (b.status === 'PENDING') {
    if (b.review === 'DRAFT' || b.review === 'CHANGES_REQUESTED') return 1
    if (b.review === 'SUBMITTED') return 2
    return b.actions.includes('confirm_slip') ? 4 : 3
  }
  return 5
})
const stateText = computed(() => {
  const b = booking.value
  if (!b) return 'ยังไม่มีการจอง'
  return b.status === 'PENDING' ? REVIEW[b.review] ?? 'รอดำเนินการ' : STATUS[b.status] ?? b.status
})

async function act(action) {
  busy.value = true
  error.value = ''
  try {
    await staffAction(action)
    await refresh()
    if (liff.value) liffFrame.value?.contentWindow?.location.reload()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  document.title = 'LINE demo — Coolkids'
  push({ from: 'oa', text: 'สวัสดีครับ ยินดีต้อนรับสู่ Coolkids Car Rental 🚗\nรถเช่าขับเอง ส่งรถถึงที่ทั่วกรุงเทพฯ\n\nกด "เลือกรถ" ที่เมนูด้านล่างเพื่อดูรถและจองได้เลยครับ' })
  try {
    await demoLogin() // what LIFF does on its own inside LINE
  } catch (err) {
    error.value = `เข้าสู่ระบบเดโมไม่สำเร็จ: ${err.message}`
  }
  await refresh()
  poll = setInterval(refresh, 3000)
  tick = setInterval(() => (now.value = new Date()), 30_000)
})
onBeforeUnmount(() => {
  clearInterval(poll)
  clearInterval(tick)
  clearInterval(titleTimer)
})
</script>

<template>
  <main class="demo">
    <section class="stage" aria-label="มุมมองลูกค้าในแอป LINE">
      <div class="phone">
        <div class="statusbar" aria-hidden="true">
          <b>{{ clock(now) }}</b>
          <span>●●●● 5G ▮</span>
        </div>

        <header class="chat-head">
          <span class="back" aria-hidden="true">‹</span>
          <span class="avatar">CK</span>
          <div class="who">
            <strong>Coolkids Car Rental</strong>
            <small>บัญชีทางการ · @coolkidscar</small>
          </div>
          <span class="icons" aria-hidden="true">☏ ☰</span>
        </header>

        <div ref="scroller" class="log" aria-live="polite">
          <p class="day">วันนี้</p>
          <template v-for="m in log" :key="m.id">
            <p v-if="m.from === 'note'" class="note">{{ m.text }}</p>
            <div v-else class="row" :class="m.from">
              <span v-if="m.from === 'oa'" class="avatar sm" aria-hidden="true">CK</span>
              <div class="msg">
                <FlexMessage v-if="m.flex" :contents="m.flex" @action="onAction" />
                <p v-else class="bubble">
                  <template v-for="(p, i) in parts(m.text)" :key="i">
                    <a v-if="p.link" href="#" @click.prevent="open(p.text)">{{ p.text }}</a>
                    <template v-else>{{ p.text }}</template>
                  </template>
                </p>
              </div>
              <small class="time">
                <template v-if="m.from === 'me'">อ่านแล้ว<br /></template>{{ clock(m.at) }}
              </small>
            </div>
          </template>
        </div>

        <footer class="bottom">
          <template v-if="menuOpen">
            <RichMenu @tap="onMenu" />
            <div class="menubar">
              <button type="button" class="kbd" aria-label="พิมพ์ข้อความ" @click="menuOpen = false">⌨</button>
              <button type="button" class="label" @click="menuOpen = false">เมนู Coolkids ▾</button>
            </div>
          </template>
          <form v-else class="input" @submit.prevent="submitDraft">
            <button type="button" class="kbd" aria-label="เปิดเมนู" @click="menuOpen = true">☰</button>
            <input v-model="draft" type="text" placeholder="Aa" aria-label="ข้อความ" />
            <button type="submit" class="send" :disabled="!draft.trim()">ส่ง</button>
          </form>
        </footer>

        <div v-if="liff" class="liff" role="dialog" aria-label="หน้า LIFF">
          <header>
            <button type="button" aria-label="ปิด" @click="closeLiff">✕</button>
            <div>
              <strong>{{ liff.title }}</strong>
              <small>coolkidscar.com</small>
            </div>
            <span aria-hidden="true">⋯</span>
          </header>
          <iframe ref="liffFrame" :src="liff.path" title="LIFF" allow="geolocation" @load="onLiffLoad" />
        </div>
      </div>
    </section>

    <button type="button" class="panel-toggle" @click="panelOpen = !panelOpen">{{ panelOpen ? 'ปิดแผงแอดมิน' : 'แผงแอดมิน (เดโม)' }}</button>

    <aside class="panel" :class="{ open: panelOpen }" aria-label="แผงควบคุมเดโม">
      <h1>เดโม LINE · Coolkids</h1>
      <p class="lede">ซ้ายคือหน้าจอลูกค้าในแอป LINE · ปุ่มด้านล่างคือสิ่งที่แอดมินกดในหลังบ้าน ทุกอย่างทำงานกับระบบจริงในเครื่องนี้ ยังไม่ส่งอะไรไป LINE</p>

      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="i" :class="{ now: i === stepNow, done: i < stepNow }">{{ s }}</li>
      </ol>

      <section class="state">
        <h2>การจองล่าสุดของลูกค้า{{ me ? ` (${me.name})` : '' }}</h2>
        <p v-if="booking"><b>{{ booking.number }}</b> · {{ stateText }}</p>
        <p v-else>ยังไม่มีการจอง · เริ่มที่ปุ่ม "เลือกรถ" ในเมนู LINE</p>
      </section>

      <section v-if="booking?.actions.length" class="actions">
        <h2>แอดมินกด</h2>
        <button v-for="a in booking.actions" :key="a" type="button" :disabled="busy" @click="act(a)">
          <strong>{{ ACTIONS[a]?.[0] ?? a }}</strong>
          <small>{{ ACTIONS[a]?.[1] }}</small>
        </button>
      </section>
      <p v-else-if="booking" class="wait">ตอนนี้รอฝั่งลูกค้า</p>
      <p v-if="error" class="err" role="alert">{{ error }}</p>

      <p class="foot">
        ข้อความที่เด้งเข้าแชท = ข้อความที่ลูกค้าจะได้รับจริงทาง LINE ·
        <a href="/line-demo/richmenu" target="_blank" rel="noopener">ดูรูป Rich menu ขนาดจริง</a>
      </p>
    </aside>
  </main>
</template>

<style scoped>
.demo {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 40px;
  min-height: 100dvh;
  padding: 32px 16px;
  background: #e9ecf1;
  color: #111;
  font-family: 'Inter', 'Noto Sans Thai', system-ui, sans-serif;
}
.phone {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 390px;
  height: min(844px, calc(100dvh - 64px));
  overflow: hidden;
  border: 10px solid #111;
  border-radius: 48px;
  background: #8cabd9;
  box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.5);
}
.statusbar {
  display: flex;
  justify-content: space-between;
  padding: 10px 26px 4px;
  background: #fff;
  font-size: 13px;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 10px;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
}
.back {
  font-size: 28px;
  line-height: 1;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #e2362c;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}
.avatar.sm {
  width: 32px;
  height: 32px;
  font-size: 11px;
}
.who {
  display: grid;
  flex: 1;
  min-width: 0;
}
.who strong {
  font-size: 15px;
}
.who small {
  color: #8c8c8c;
  font-size: 11px;
}
.icons {
  color: #555;
  letter-spacing: 8px;
}
.log {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px 16px;
}
.day {
  width: max-content;
  margin: 4px auto 12px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.18);
  color: #fff;
  font-size: 11px;
}
.note {
  max-width: 85%;
  margin: 8px auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.18);
  color: #fff;
  font-size: 11px;
  text-align: center;
}
.row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin: 8px 0;
}
.row.oa {
  align-items: flex-start;
}
.row.me {
  flex-direction: row-reverse;
}
.msg {
  min-width: 0;
  max-width: calc(100% - 80px);
}
/* a carousel takes the full chat width so the next card peeks in, as in LINE */
.row.oa .msg:has(.carousel) {
  flex: 1;
  max-width: none;
  margin-right: -10px;
}
.row.oa:has(.carousel) .time {
  display: none;
}
.bubble {
  margin: 0;
  padding: 9px 13px;
  border-radius: 18px;
  background: #fff;
  font-size: 15px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.row.me .bubble {
  background: #8de055;
}
.bubble a {
  color: #2a6fdb;
}
.time {
  flex: none;
  color: rgb(0 0 0 / 0.5);
  font-size: 10px;
  line-height: 1.2;
  align-self: flex-end;
}
.row.me .time {
  text-align: right;
}
.bottom {
  background: #fff;
}
.menubar,
.input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #e5e5e5;
}
.kbd {
  width: 36px;
  height: 36px;
  border: 0;
  background: none;
  font-size: 20px;
  cursor: pointer;
}
.menubar .label {
  flex: 1;
  height: 36px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.input input {
  flex: 1;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: #f2f3f5;
  font: inherit;
}
.send {
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: #06c755;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.send:disabled {
  background: #c9c9c9;
}
.liff {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: #fff;
  animation: up 0.25s ease-out;
}
@keyframes up {
  from {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .liff {
    animation: none;
  }
}
.liff header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 34px 14px 10px;
  border-bottom: 1px solid #eee;
}
.liff header button {
  width: 32px;
  height: 32px;
  border: 0;
  background: none;
  font-size: 18px;
  cursor: pointer;
}
.liff header div {
  display: grid;
  flex: 1;
  min-width: 0;
  text-align: center;
}
.liff header strong {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.liff header small {
  color: #8c8c8c;
  font-size: 11px;
}
.liff iframe {
  flex: 1;
  width: 100%;
  border: 0;
}
.panel {
  display: grid;
  gap: 16px;
  width: 360px;
  padding: 24px;
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 20px 50px -30px rgb(0 0 0 / 0.4);
}
.panel h1 {
  font-size: 20px;
}
.panel h2 {
  margin-bottom: 6px;
  color: #6b6e7a;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.lede,
.foot,
.wait {
  color: #5d6170;
  font-size: 13px;
}
.foot a {
  color: #e2362c;
}
.steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: #8c8f99;
}
.steps .done {
  color: #1f8a56;
}
.steps .now {
  color: #111;
  font-weight: 700;
}
.actions {
  display: grid;
  gap: 8px;
}
.actions button {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1.5px solid #e3e5ec;
  border-radius: 14px;
  background: #fff;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.actions button:hover {
  border-color: #e2362c;
}
.actions button:disabled {
  opacity: 0.6;
}
.actions small {
  color: #6b6e7a;
}
.err {
  color: #c0392b;
  font-size: 13px;
}
.panel-toggle {
  display: none;
}
@media (max-width: 820px) {
  .demo {
    padding: 0;
  }
  .phone {
    width: 100%;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .panel {
    position: fixed;
    inset: auto 0 0;
    z-index: 20;
    width: auto;
    max-height: 75dvh;
    overflow-y: auto;
    border-radius: 24px 24px 0 0;
    transform: translateY(100%);
    transition: transform 0.25s;
  }
  .panel.open {
    transform: none;
  }
  .panel-toggle {
    position: fixed;
    top: 90px;
    right: 10px;
    z-index: 30;
    display: block;
    padding: 8px 12px;
    border: 0;
    border-radius: 999px;
    background: #111;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
}
</style>
