<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from '@/api/http'
import { useI18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'

// "ตั้งค่าบัญชี" — the customer's profile (editable), how they sign in, the
// renter details from their latest booking (masked) and a password change.
const auth = useAuthStore()
const { locale } = useI18n()

const T = {
  th: {
    title: 'ตั้งค่าบัญชี', profile: 'ข้อมูลส่วนตัว', name: 'ชื่อ-นามสกุล', email: 'อีเมล', phone: 'เบอร์โทรศัพท์',
    age: 'อายุ', gender: 'เพศ', lang: 'ภาษา', save: 'บันทึก', saving: 'กำลังบันทึก…', saved: 'บันทึกแล้ว',
    signin: 'การเข้าสู่ระบบ', member: 'สมาชิกตั้งแต่', lastLogin: 'เข้าสู่ระบบล่าสุด', username: 'ชื่อผู้ใช้ / รหัสผ่าน',
    renter: 'ข้อมูลผู้เช่า', renterHint: 'จากการจองล่าสุด · ข้อมูลจะอัปเดตเมื่อคุณกรอกเอกสารในการจองครั้งถัดไป',
    noRenter: 'ยังไม่มีข้อมูลผู้เช่า — จะบันทึกเมื่อคุณกรอกเอกสารตอนจองรถ', legalName: 'ชื่อตามบัตร', dob: 'วันเกิด',
    nationality: 'สัญชาติ', idDoc: 'เอกสารยืนยันตัวตน', license: 'ใบขับขี่', expires: 'หมดอายุ', address: 'ที่อยู่',
    status: 'สถานะเอกสาร', PENDING: 'รอตรวจสอบ', VERIFIED: 'ตรวจสอบแล้ว', REJECTED: 'ไม่ผ่าน',
    NATIONAL_ID: 'บัตรประชาชน', PASSPORT: 'พาสปอร์ต', bookings: 'การจองทั้งหมด', myBookings: 'ดูการจองของฉัน',
    password: 'เปลี่ยนรหัสผ่าน', current: 'รหัสผ่านปัจจุบัน', next: 'รหัสผ่านใหม่', confirm: 'ยืนยันรหัสผ่านใหม่',
    change: 'เปลี่ยนรหัสผ่าน', changed: 'เปลี่ยนรหัสผ่านแล้ว · อุปกรณ์อื่นถูกออกจากระบบ', mismatch: 'รหัสผ่านใหม่ไม่ตรงกัน',
    min8: 'อย่างน้อย 8 ตัวอักษร', noPassword: 'บัญชีนี้เข้าสู่ระบบผ่าน {p} จึงไม่มีรหัสผ่านให้เปลี่ยน',
    required: 'กรุณากรอก', badPhone: 'เบอร์โทรไม่ถูกต้อง', badAge: 'อายุต้อง 18–120 ปี', none: '—',
    genders: { male: 'ชาย', female: 'หญิง', non_binary: 'นอนไบนารี', other: 'อื่น ๆ', prefer_not_to_say: 'ไม่ระบุ' },
  },
  en: {
    title: 'Account settings', profile: 'Profile', name: 'Full name', email: 'Email', phone: 'Phone',
    age: 'Age', gender: 'Gender', lang: 'Language', save: 'Save', saving: 'Saving…', saved: 'Saved',
    signin: 'Sign-in', member: 'Member since', lastLogin: 'Last sign-in', username: 'Username / password',
    renter: 'Renter details', renterHint: 'From your latest booking · updated when you fill in documents on your next booking',
    noRenter: 'No renter details yet — they are saved when you fill in documents for a booking', legalName: 'Name on ID', dob: 'Date of birth',
    nationality: 'Nationality', idDoc: 'ID document', license: "Driver's licence", expires: 'expires', address: 'Address',
    status: 'Document status', PENDING: 'Pending review', VERIFIED: 'Verified', REJECTED: 'Rejected',
    NATIONAL_ID: 'National ID', PASSPORT: 'Passport', bookings: 'Bookings', myBookings: 'My bookings',
    password: 'Change password', current: 'Current password', next: 'New password', confirm: 'Confirm new password',
    change: 'Change password', changed: 'Password changed · other devices were signed out', mismatch: 'New passwords do not match',
    min8: 'At least 8 characters', noPassword: 'You sign in with {p}, so there is no password to change',
    required: 'Required', badPhone: 'Invalid phone number', badAge: 'Age must be 18–120', none: '—',
    genders: { male: 'Male', female: 'Female', non_binary: 'Non-binary', other: 'Other', prefer_not_to_say: 'Prefer not to say' },
  },
  zh: {
    title: '账户设置', profile: '个人资料', name: '姓名', email: '电子邮箱', phone: '电话',
    age: '年龄', gender: '性别', lang: '语言', save: '保存', saving: '保存中…', saved: '已保存',
    signin: '登录方式', member: '注册时间', lastLogin: '最近登录', username: '用户名 / 密码',
    renter: '租车人信息', renterHint: '来自您最近的预订 · 下次预订填写证件时会更新',
    noRenter: '暂无租车人信息 — 预订时填写证件后会保存', legalName: '证件姓名', dob: '出生日期',
    nationality: '国籍', idDoc: '身份证件', license: '驾照', expires: '到期', address: '地址',
    status: '证件状态', PENDING: '待审核', VERIFIED: '已审核', REJECTED: '未通过',
    NATIONAL_ID: '身份证', PASSPORT: '护照', bookings: '预订总数', myBookings: '我的预订',
    password: '修改密码', current: '当前密码', next: '新密码', confirm: '确认新密码',
    change: '修改密码', changed: '密码已修改 · 其他设备已退出登录', mismatch: '两次输入的新密码不一致',
    min8: '至少 8 个字符', noPassword: '您通过 {p} 登录，没有可修改的密码',
    required: '必填', badPhone: '电话号码无效', badAge: '年龄须为 18–120 岁', none: '—',
    genders: { male: '男', female: '女', non_binary: '非二元', other: '其他', prefer_not_to_say: '不愿透露' },
  },
}
const t = computed(() => T[locale.value] ?? T.th)
const PROVIDERS = { google: 'Google', line: 'LINE', facebook: 'Facebook' }
const LANGS = [['th', 'ไทย'], ['en', 'English'], ['zh', '中文']]

const account = ref(null)
const loadError = ref('')
const form = reactive({ fullName: '', phone: '', age: '', gender: '', locale: 'th' })
const errors = ref({})
const saving = ref(false)
const savedMsg = ref('')
const saveError = ref('')

const pw = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const pwErrors = ref({})
const pwBusy = ref(false)
const pwMsg = ref('')
const pwError = ref('')

function fill() {
  const me = auth.me ?? {}
  form.fullName = me.fullName ?? ''
  form.phone = me.phone ?? ''
  form.age = me.age ?? ''
  form.gender = me.gender ?? ''
  form.locale = ['th', 'en', 'zh'].includes(me.locale) ? me.locale : locale.value
}

onMounted(async () => {
  fill()
  try {
    account.value = (await api('/me/account')).data
  } catch (err) {
    loadError.value = err.message
  }
})

const dirty = computed(() => {
  const me = auth.me ?? {}
  return (
    form.fullName.trim() !== (me.fullName ?? '') ||
    form.phone.trim() !== (me.phone ?? '') ||
    String(form.age) !== String(me.age ?? '') ||
    form.gender !== (me.gender ?? '') ||
    form.locale !== me.locale
  )
})

function check() {
  const e = {}
  if (!form.fullName.trim()) e.fullName = t.value.required
  if (form.phone.trim() && !/^\+?[0-9 ()-]{6,20}$/.test(form.phone.trim())) e.phone = t.value.badPhone
  if (form.age !== '' && !(Number.isInteger(Number(form.age)) && form.age >= 18 && form.age <= 120)) e.age = t.value.badAge
  errors.value = e
  return !Object.keys(e).length
}

async function save() {
  savedMsg.value = ''
  saveError.value = ''
  if (!check()) return
  const me = auth.me ?? {}
  const patch = {}
  if (form.fullName.trim() !== (me.fullName ?? '')) patch.fullName = form.fullName.trim()
  if (form.phone.trim() && form.phone.trim() !== (me.phone ?? '')) patch.phone = form.phone.trim()
  if (form.age !== '' && Number(form.age) !== me.age) patch.age = Number(form.age)
  if (form.gender && form.gender !== me.gender) patch.gender = form.gender
  if (form.locale !== me.locale) patch.locale = form.locale
  if (!Object.keys(patch).length) return
  saving.value = true
  try {
    await auth.updateProfile(patch)
    if (patch.locale) locale.value = patch.locale // the site follows the saved language
    fill()
    savedMsg.value = t.value.saved
  } catch (err) {
    saveError.value = err.message
  } finally {
    saving.value = false
  }
}

async function changePassword() {
  pwMsg.value = ''
  pwError.value = ''
  const e = {}
  if (!pw.currentPassword) e.currentPassword = t.value.required
  if (pw.newPassword.length < 8) e.newPassword = t.value.min8
  if (pw.newPassword !== pw.confirm) e.confirm = t.value.mismatch
  pwErrors.value = e
  if (Object.keys(e).length) return
  pwBusy.value = true
  try {
    await api('/me/password', { method: 'PUT', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } })
    Object.assign(pw, { currentPassword: '', newPassword: '', confirm: '' })
    pwMsg.value = t.value.changed
  } catch (err) {
    const d = err.details ?? {}
    pwErrors.value = { currentPassword: d.currentPassword?.[0], newPassword: d.newPassword?.[0] }
    if (!d.currentPassword && !d.newPassword) pwError.value = err.message
  } finally {
    pwBusy.value = false
  }
}

const dateFmt = computed(() => ({ th: 'th-TH', en: 'en-GB', zh: 'zh-CN' })[locale.value] ?? 'th-TH')
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(dateFmt.value, { day: 'numeric', month: 'short', year: 'numeric' }) : t.value.none)
const country = (code) => {
  if (!code) return t.value.none
  try {
    return new Intl.DisplayNames([dateFmt.value], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}
const renter = computed(() => account.value?.renter)
const licenceExpired = computed(() => renter.value?.licenseExpiry && new Date(renter.value.licenseExpiry) < new Date())
const socialNames = computed(() => (account.value?.signIn.methods ?? []).map((m) => PROVIDERS[m.provider] ?? m.provider).join(', '))
const initial = computed(() => (auth.me?.fullName || auth.me?.email || '?').trim().charAt(0).toUpperCase())
</script>

<template>
  <main class="settings">
    <div class="wrap">
      <header class="head">
        <div class="avatar">
          <img v-if="auth.me?.avatarUrl" :src="auth.me.avatarUrl" alt="" referrerpolicy="no-referrer" />
          <span v-else>{{ initial }}</span>
        </div>
        <div>
          <h1>{{ t.title }}</h1>
          <p>{{ auth.me?.fullName }} · {{ auth.me?.email }}</p>
        </div>
        <RouterLink to="/account" class="btn btn-ghost btn-pill">{{ t.myBookings }}</RouterLink>
      </header>

      <!-- Profile (editable) -->
      <section class="card">
        <h2>{{ t.profile }}</h2>
        <form class="grid" novalidate @submit.prevent="save">
          <label class="full">
            <span>{{ t.name }}</span>
            <input v-model="form.fullName" type="text" autocomplete="name" maxlength="120" :aria-invalid="!!errors.fullName" />
            <small v-if="errors.fullName" class="err">{{ errors.fullName }}</small>
          </label>
          <label>
            <span>{{ t.email }}</span>
            <input :value="auth.me?.email" type="email" readonly class="ro" />
          </label>
          <label>
            <span>{{ t.phone }}</span>
            <input v-model="form.phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="08x-xxx-xxxx" :aria-invalid="!!errors.phone" />
            <small v-if="errors.phone" class="err">{{ errors.phone }}</small>
          </label>
          <label>
            <span>{{ t.age }}</span>
            <input v-model.number="form.age" type="number" min="18" max="120" inputmode="numeric" :aria-invalid="!!errors.age" />
            <small v-if="errors.age" class="err">{{ errors.age }}</small>
          </label>
          <label>
            <span>{{ t.gender }}</span>
            <select v-model="form.gender">
              <option value="" disabled>{{ t.none }}</option>
              <option v-for="(label, key) in t.genders" :key="key" :value="key">{{ label }}</option>
            </select>
          </label>
          <div class="full">
            <span class="lbl">{{ t.lang }}</span>
            <div class="seg" role="radiogroup" :aria-label="t.lang">
              <button v-for="[code, label] in LANGS" :key="code" type="button" role="radio" :aria-checked="form.locale === code" :class="{ on: form.locale === code }" @click="form.locale = code">
                {{ label }}
              </button>
            </div>
          </div>
          <div class="actions full">
            <span v-if="savedMsg" class="ok" role="status">✓ {{ savedMsg }}</span>
            <span v-if="saveError" class="err" role="alert">{{ saveError }}</span>
            <button type="submit" class="btn btn-primary btn-pill" :disabled="saving || !dirty">{{ saving ? t.saving : t.save }}</button>
          </div>
        </form>
      </section>

      <!-- Renter details from the latest booking (masked, read-only) -->
      <section class="card">
        <h2>{{ t.renter }}</h2>
        <div v-if="!account && !loadError" class="skeleton" style="height: 120px" />
        <p v-else-if="loadError" class="err">{{ loadError }}</p>
        <p v-else-if="!renter" class="muted">{{ t.noRenter }}</p>
        <template v-else>
          <p class="muted small">{{ t.renterHint }}</p>
          <dl class="facts">
            <div><dt>{{ t.legalName }}</dt><dd>{{ renter.legalName }}</dd></div>
            <div><dt>{{ t.dob }}</dt><dd>{{ fmtDate(renter.dateOfBirth) }}</dd></div>
            <div><dt>{{ t.nationality }}</dt><dd>{{ country(renter.countryCode) }}</dd></div>
            <div><dt>{{ t.phone }}</dt><dd>{{ renter.phone }}</dd></div>
            <div><dt>{{ t.idDoc }}</dt><dd>{{ t[renter.idType] ?? renter.idType }} ••••{{ renter.idLast4 }}</dd></div>
            <div>
              <dt>{{ t.license }}</dt>
              <dd>
                ••••{{ renter.licenseLast4 }} · {{ country(renter.licenseCountry) }}
                <small :class="licenceExpired ? 'err' : 'muted'">{{ t.expires }} {{ fmtDate(renter.licenseExpiry) }}</small>
              </dd>
            </div>
            <div class="full"><dt>{{ t.address }}</dt><dd>{{ renter.address || t.none }}</dd></div>
            <div>
              <dt>{{ t.status }}</dt>
              <dd><span class="pill" :class="renter.verification.toLowerCase()">{{ t[renter.verification] ?? renter.verification }}</span></dd>
            </div>
            <div><dt>{{ t.bookings }}</dt><dd>{{ account.stats.bookings }}</dd></div>
          </dl>
        </template>
      </section>

      <!-- Sign-in methods -->
      <section class="card">
        <h2>{{ t.signin }}</h2>
        <div v-if="!account && !loadError" class="skeleton" style="height: 60px" />
        <ul v-else-if="account" class="methods">
          <li v-for="m in account.signIn.methods" :key="m.provider">
            <span class="badge" :class="m.provider">{{ PROVIDERS[m.provider] ?? m.provider }}</span>
            <span class="muted">{{ m.email || auth.me?.email }}</span>
          </li>
          <li v-if="account.signIn.password">
            <span class="badge pass">{{ t.username }}</span>
            <span class="muted">{{ account.signIn.password.login }}</span>
          </li>
        </ul>
        <dl class="facts compact">
          <div><dt>{{ t.member }}</dt><dd>{{ fmtDate(auth.me?.createdAt) }}</dd></div>
          <div><dt>{{ t.lastLogin }}</dt><dd>{{ fmtDate(auth.me?.lastLoginAt) }}</dd></div>
        </dl>
      </section>

      <!-- Password -->
      <section v-if="account" class="card">
        <h2>{{ t.password }}</h2>
        <p v-if="!account.signIn.password" class="muted">{{ t.noPassword.replace('{p}', socialNames || 'Google / LINE') }}</p>
        <form v-else class="grid" novalidate @submit.prevent="changePassword">
          <input type="text" autocomplete="username" :value="account.signIn.password.login" hidden />
          <label class="full">
            <span>{{ t.current }}</span>
            <input v-model="pw.currentPassword" type="password" autocomplete="current-password" :aria-invalid="!!pwErrors.currentPassword" />
            <small v-if="pwErrors.currentPassword" class="err">{{ pwErrors.currentPassword }}</small>
          </label>
          <label>
            <span>{{ t.next }}</span>
            <input v-model="pw.newPassword" type="password" autocomplete="new-password" :aria-invalid="!!pwErrors.newPassword" />
            <small :class="pwErrors.newPassword ? 'err' : 'muted'">{{ pwErrors.newPassword || t.min8 }}</small>
          </label>
          <label>
            <span>{{ t.confirm }}</span>
            <input v-model="pw.confirm" type="password" autocomplete="new-password" :aria-invalid="!!pwErrors.confirm" />
            <small v-if="pwErrors.confirm" class="err">{{ pwErrors.confirm }}</small>
          </label>
          <div class="actions full">
            <span v-if="pwMsg" class="ok" role="status">✓ {{ pwMsg }}</span>
            <span v-if="pwError" class="err" role="alert">{{ pwError }}</span>
            <button type="submit" class="btn btn-primary btn-pill" :disabled="pwBusy">{{ pwBusy ? t.saving : t.change }}</button>
          </div>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.settings {
  min-height: 100dvh;
  padding: 96px var(--gutter) var(--s-8);
}
.wrap {
  display: grid;
  gap: var(--s-5);
  max-width: 860px;
  margin-inline: auto;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s-4);
}
.head > div:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.head p {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 50%;
  background: #0e2a52;
  color: #fff;
  font-size: 1.6rem;
  font-weight: 700;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-2xl);
  font-weight: 700;
}
h2 {
  margin-bottom: var(--s-4);
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
}
.card {
  padding: var(--s-5);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-4);
}
.full {
  grid-column: 1 / -1;
}
label,
.full {
  display: grid;
  gap: 6px;
  align-content: start;
}
label > span,
.lbl {
  font-size: var(--fs-sm);
  font-weight: 600;
}
input,
select {
  width: 100%;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  background: #fff;
  color: #121319;
  font: inherit;
}
input:focus-visible,
select:focus-visible {
  outline: 2px solid #0e2a52;
  outline-offset: 1px;
}
input[aria-invalid='true'] {
  border-color: #e2362c;
}
input.ro {
  background: #f2f3f5;
  color: #5b5f6b;
}
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.seg button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid #c9ccd4;
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.seg button.on {
  border-color: #0e2a52;
  background: #0e2a52;
  color: #fff;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-3);
}
.actions .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.err {
  color: #c0271e;
  font-size: var(--fs-sm);
}
.ok {
  color: #1f8a56;
  font-weight: 600;
}
.muted {
  color: var(--text-muted);
}
.small {
  margin-bottom: var(--s-3);
  font-size: var(--fs-sm);
}
.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-3) var(--s-5);
  margin: 0;
}
.facts.compact {
  margin-top: var(--s-4);
}
.facts > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}
dt {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
dd {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
dd small {
  display: block;
  font-weight: 400;
}
.pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: #fdf3e2;
  color: #8a5a00;
  font-size: var(--fs-xs);
}
.pill.verified {
  background: #e6f6ee;
  color: #1f6b46;
}
.pill.rejected {
  background: #fdeceb;
  color: #a3221a;
}
.methods {
  display: grid;
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.methods li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}
.badge {
  padding: 4px 12px;
  border-radius: 999px;
  background: #ececee;
  font-size: var(--fs-sm);
  font-weight: 700;
}
.badge.line {
  background: #06c755;
  color: #fff;
}
.badge.google {
  background: #e8f0fe;
  color: #1a56c4;
}
.badge.facebook {
  background: #1877f2;
  color: #fff;
}
.badge.pass {
  background: #0e2a52;
  color: #fff;
}
@media (max-width: 600px) {
  .grid,
  .facts {
    grid-template-columns: 1fr;
  }
  .head {
    flex-wrap: wrap;
  }
}
</style>
