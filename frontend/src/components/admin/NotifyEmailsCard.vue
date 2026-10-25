<script setup>
import { onMounted, ref } from 'vue'
import { getNotifyEmails, saveNotifyEmails } from '@/api/admin'
import Icon from '@/components/ui/Icon.vue'

// Who gets the e-mail when a customer sends a booking for review (customer
// details + ID / licence photos). Listed: super admins and the accounts that may
// open "ตรวจเอกสาร"; each can be switched off. Extra addresses (e.g. the owner's
// personal Gmail) can be added. Super admin only, like the rest of this page.
const data = ref(null)
const on = ref({}) // account id → receives
const extra = ref([])
const add = ref('')
const busy = ref(false)
const error = ref('')
const note = ref('')

function fill(d) {
  data.value = d
  on.value = Object.fromEntries(d.accounts.map((a) => [a.id, a.on]))
  extra.value = [...d.extra]
}
onMounted(async () => {
  try {
    fill(await getNotifyEmails())
  } catch (err) {
    error.value = err.message
  }
})

function addEmail() {
  const e = add.value.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    error.value = 'อีเมลไม่ถูกต้อง'
    return
  }
  error.value = ''
  if (!extra.value.includes(e)) extra.value.push(e)
  add.value = ''
}

async function save() {
  busy.value = true
  error.value = ''
  note.value = ''
  try {
    fill(await saveNotifyEmails({ muted: data.value.accounts.filter((a) => !on.value[a.id]).map((a) => a.id), extra: extra.value }))
    note.value = 'บันทึกแล้ว'
  } catch (err) {
    error.value = err.details ? Object.values(err.details).flat().join(' · ') : err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="ne">
    <h3><Icon name="mail" :size="16" /> อีเมลแจ้งเตือนการจองใหม่</h3>
    <p class="hint">เมื่อลูกค้าส่งเอกสารรอตรวจ ระบบส่งอีเมลข้อมูลลูกค้าพร้อมรูปบัตร / ใบขับขี่ ไปยังรายชื่อที่เปิดไว้ · มีข้อมูลส่วนบุคคล เปิดเฉพาะคนที่ต้องตรวจเอกสาร</p>
    <div v-if="!data && !error" class="skeleton" style="height: 120px" />
    <template v-else-if="data">
      <ul class="rows">
        <li v-for="a in data.accounts" :key="a.id">
          <label class="chk">
            <input v-model="on[a.id]" type="checkbox" :disabled="!a.email" />
            <span>
              <strong>{{ a.fullName }}</strong>
              <small>{{ a.superAdmin ? 'Super Admin' : 'แอดมิน (ตรวจเอกสาร)' }} · {{ a.email ?? 'ไม่มี Gmail — ใส่ Gmail ในบัญชีก่อน' }}</small>
            </span>
          </label>
        </li>
        <li v-for="(e, i) in extra" :key="e">
          <span class="chk"><Icon name="mail" :size="14" /> <span><strong>{{ e }}</strong><small>อีเมลเพิ่มเติม</small></span></span>
          <button type="button" class="ghost sm" :aria-label="`เอา ${e} ออก`" @click="extra.splice(i, 1)"><Icon name="x" :size="14" /></button>
        </li>
        <li v-for="e in data.fixed" :key="`fixed-${e}`">
          <span class="chk"><Icon name="lock" :size="14" /> <span><strong>{{ e }}</strong><small>ตั้งไว้ในเซิร์ฟเวอร์ (ADMIN_NOTIFY_EMAILS) · ได้รับเสมอ</small></span></span>
        </li>
      </ul>
      <form class="add" @submit.prevent="addEmail">
        <input v-model="add" type="email" maxlength="254" placeholder="เพิ่มอีเมล เช่น owner@gmail.com" />
        <button type="submit" class="ghost">เพิ่ม</button>
      </form>
      <div class="btns">
        <button type="button" class="go" :disabled="busy" @click="save">บันทึก</button>
        <span v-if="note" class="ok" role="status">{{ note }}</span>
      </div>
    </template>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.ne {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 16px;
  background: var(--viz-surface);
  color: var(--viz-text);
}
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
}
.rows {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rows li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--viz-border);
  border-radius: 12px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  cursor: pointer;
}
.chk > span {
  display: grid;
}
.chk small {
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.add {
  display: flex;
  gap: 8px;
}
.add input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: transparent;
  color: var(--viz-text);
  font: inherit;
  font-size: 0.85rem;
}
.btns {
  display: flex;
  align-items: center;
  gap: 10px;
}
.go,
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.ghost.sm {
  min-height: 30px;
  padding: 0 8px;
}
.go {
  border: 0;
  background: #5fd39a;
  color: #0b2a1c;
}
.go:disabled {
  opacity: 0.5;
}
.ghost {
  border: 1px solid var(--viz-border);
  background: transparent;
  color: var(--viz-text);
}
.hint {
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.err {
  color: #ff8a82;
}
.ok {
  color: #8fe5b8;
  font-size: 0.85rem;
}
</style>
