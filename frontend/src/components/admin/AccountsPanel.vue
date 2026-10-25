<script setup>
import { onMounted, ref } from 'vue'
import { createAccount, listAccounts, updateAccount } from '@/api/admin'
import Icon from '@/components/ui/Icon.vue'
import NotifyEmailsCard from './NotifyEmailsCard.vue'

// "ผู้ดูแลระบบ" (super admin only): sub-admins sign in with a username and
// password and/or their Gmail ("เข้าสู่ระบบด้วย Google"), and see only the
// back-office pages ticked here. The API enforces the
// same limits, so hiding a page also removes its buttons' permissions.
const data = ref(null)
const error = ref('')
const note = ref('')
const busy = ref(false)
const creating = ref(false)
const form = ref({ fullName: '', email: '', login: '', password: '', phone: '', pages: [] })
const editing = ref(null) // { id, pages, password, email }
const usernameRequired = () => !form.value.email.trim() || Boolean(form.value.login.trim() || form.value.password)

async function load() {
  try {
    data.value = await listAccounts()
  } catch (err) {
    error.value = err.message
  }
}
onMounted(load)

async function run(fn, done) {
  busy.value = true
  error.value = ''
  note.value = ''
  try {
    await fn()
    await load()
    note.value = done
  } catch (err) {
    error.value = err.details ? Object.values(err.details).flat().join(' · ') : err.message
  } finally {
    busy.value = false
  }
}

function startCreate() {
  creating.value = true
  form.value = { fullName: '', email: '', login: '', password: '', phone: '', pages: ['operations'] }
}
const create = () =>
  run(async () => {
    const f = form.value
    await createAccount({
      fullName: f.fullName.trim(),
      email: f.email.trim() || undefined,
      login: f.login.trim() || undefined,
      password: f.password || undefined,
      phone: f.phone.trim() || undefined,
      pages: f.pages,
    })
    creating.value = false
  }, form.value.login.trim()
    ? 'สร้างบัญชีแอดมินแล้ว · ส่งชื่อผู้ใช้และรหัสผ่านให้เจ้าของบัญชีทางช่องทางที่ปลอดภัย'
    : 'สร้างบัญชีแอดมินแล้ว · ให้เจ้าของบัญชีกด "ดำเนินการต่อด้วย Google" ด้วย Gmail นี้')

const startEdit = (a) => (editing.value = { id: a.id, pages: [...a.pages], password: '', email: a.gmail ?? '' })
const saveEdit = () =>
  run(async () => {
    const e = editing.value
    const a = data.value.accounts.find((x) => x.id === e.id)
    const email = e.email.trim().toLowerCase()
    await updateAccount(e.id, {
      pages: e.pages,
      ...(e.password ? { password: e.password } : {}),
      ...(email && email !== a?.gmail ? { email } : {}),
    })
    editing.value = null
  }, 'บันทึกสิทธิ์แล้ว')
const toggleActive = (a) =>
  window.confirm(a.status === 'ACTIVE' ? `ระงับบัญชี ${a.fullName}? จะถูกออกจากระบบทันที` : `เปิดใช้บัญชี ${a.fullName} อีกครั้ง?`) &&
  run(() => updateAccount(a.id, { active: a.status !== 'ACTIVE' }), a.status === 'ACTIVE' ? 'ระงับบัญชีแล้ว' : 'เปิดใช้บัญชีแล้ว')

const time = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ยังไม่เคย')
</script>

<template>
  <div class="acc">
    <div class="head">
      <p class="lede">สร้างบัญชีให้พนักงาน กำหนดว่าเข้าหน้าไหนได้บ้าง · Super Admin เข้าได้ทุกหน้า</p>
      <button v-if="!creating" type="button" class="go" @click="startCreate"><Icon name="users" :size="15" /> เพิ่มแอดมิน</button>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-if="note" class="ok" role="status">{{ note }}</p>

    <form v-if="creating && data" class="card form" @submit.prevent="create">
      <h3>บัญชีแอดมินใหม่</h3>
      <div class="g">
        <label>ชื่อ-นามสกุล<input v-model="form.fullName" required minlength="2" maxlength="120" /></label>
        <label>Gmail (เข้าสู่ระบบด้วย Google)<input v-model="form.email" type="email" maxlength="254" autocomplete="off" placeholder="เช่น mint@gmail.com" /></label>
        <label>ชื่อผู้ใช้ (ใช้ล็อกอิน){{ usernameRequired() ? '' : ' · ไม่บังคับ' }}<input v-model="form.login" :required="usernameRequired()" minlength="3" maxlength="60" pattern="[A-Za-z0-9._@\-]+" autocomplete="off" placeholder="เช่น mint.coolkids" /></label>
        <label>รหัสผ่าน (อย่างน้อย 8 ตัว){{ usernameRequired() ? '' : ' · ไม่บังคับ' }}<input v-model="form.password" type="password" :required="usernameRequired()" minlength="8" autocomplete="new-password" /></label>
        <label>เบอร์โทร (ไม่บังคับ)<input v-model="form.phone" type="tel" /></label>
      </div>
      <p class="hint">ใส่ Gmail อย่างเดียว ชื่อผู้ใช้ + รหัสผ่านอย่างเดียว หรือทั้งสองอย่างก็ได้ · ถ้าใส่ Gmail เจ้าของบัญชีกด "ดำเนินการต่อด้วย Google" ได้เลย ไม่ต้องจำรหัส</p>
      <fieldset>
        <legend>หน้าที่เข้าได้</legend>
        <label v-for="(t, k) in data.pages" :key="k" class="chk"><input v-model="form.pages" type="checkbox" :value="k" /> {{ t }}</label>
      </fieldset>
      <div class="btns">
        <button type="submit" class="go" :disabled="busy || !form.pages.length">สร้างบัญชี</button>
        <button type="button" class="ghost" @click="creating = false">ยกเลิก</button>
      </div>
    </form>

    <div v-if="!data && !error" class="skeleton" style="height: 200px" />
    <ul v-else-if="data" class="list">
      <li v-for="a in data.accounts" :key="a.id" class="card" :class="{ off: a.status !== 'ACTIVE' }">
        <div class="who">
          <strong>{{ a.fullName }}</strong>
          <small>
            <template v-if="a.login">ผู้ใช้: {{ a.login }}</template>
            <template v-if="a.gmail"><template v-if="a.login"> · </template>Gmail: {{ a.gmail }}<template v-if="!a.google"> (ยังไม่เคยเข้าด้วย Google)</template></template>
            · เข้าใช้ล่าสุด {{ time(a.lastLoginAt) }}
          </small>
        </div>
        <span v-if="a.superAdmin" class="role super">Super Admin · ทุกหน้า</span>
        <span v-else-if="a.status !== 'ACTIVE'" class="role off">ระงับอยู่</span>
        <div v-if="!a.superAdmin && editing?.id !== a.id" class="pages">
          <span v-for="p in a.pages" :key="p" class="chip">{{ data.pages[p] }}</span>
          <span v-if="!a.pages.length" class="muted">บทบาท: {{ a.roles.join(', ') }}</span>
        </div>
        <div v-if="!a.superAdmin && editing?.id !== a.id" class="acts">
          <button type="button" class="ghost" @click="startEdit(a)">แก้สิทธิ์ / Gmail / รหัสผ่าน</button>
          <button type="button" class="ghost" @click="toggleActive(a)">{{ a.status === 'ACTIVE' ? 'ระงับ' : 'เปิดใช้' }}</button>
        </div>
        <form v-if="editing?.id === a.id" class="edit" @submit.prevent="saveEdit">
          <fieldset>
            <legend>หน้าที่เข้าได้</legend>
            <label v-for="(t, k) in data.pages" :key="k" class="chk"><input v-model="editing.pages" type="checkbox" :value="k" /> {{ t }}</label>
          </fieldset>
          <label class="pw">Gmail (เข้าสู่ระบบด้วย Google)<input v-model="editing.email" type="email" maxlength="254" autocomplete="off" placeholder="เช่น mint@gmail.com" /></label>
          <label v-if="a.login" class="pw">ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)<input v-model="editing.password" type="password" minlength="8" autocomplete="new-password" /></label>
          <div class="btns">
            <button type="submit" class="go" :disabled="busy || !editing.pages.length">บันทึก</button>
            <button type="button" class="ghost" @click="editing = null">ยกเลิก</button>
          </div>
        </form>
      </li>
    </ul>

    <NotifyEmailsCard v-if="data" />
  </div>
</template>

<style scoped>
.acc {
  display: grid;
  gap: 12px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.lede,
.muted,
small {
  color: var(--viz-muted);
  font-size: 0.82rem;
}
.card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  padding: 14px 16px;
  border: 1px solid var(--viz-border);
  border-radius: 16px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.card.off {
  opacity: 0.6;
}
.list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.who {
  display: grid;
  flex: 1 1 260px;
  gap: 2px;
}
.role {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}
.role.super {
  background: rgb(226 54 44 / 0.2);
  color: #ff8a82;
}
.role.off {
  background: rgb(255 255 255 / 0.1);
}
.pages {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1 1 100%;
}
.chip {
  padding: 2px 10px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  font-size: 0.78rem;
}
.acts,
.btns {
  display: flex;
  gap: 8px;
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
  font-weight: 600;
  cursor: pointer;
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
.form,
.edit {
  display: grid;
  gap: 12px;
  width: 100%;
}
.form h3 {
  font-size: 1rem;
}
.g {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
label {
  display: grid;
  gap: 4px;
  color: var(--viz-muted);
  font-size: 0.8rem;
}
input:not([type='checkbox']) {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--viz-border);
  border-radius: 12px;
}
legend {
  padding: 0 6px;
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--viz-text);
  font-size: 0.88rem;
  cursor: pointer;
}
.pw {
  max-width: 340px;
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
}
</style>
