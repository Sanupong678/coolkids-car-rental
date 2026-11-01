<script setup>
import { computed, onMounted, ref } from 'vue'
import { customerDocUrl, getCustomer, listCustomers, updateCustomer } from '@/api/admin'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'
import OpsDialog from '@/components/admin/ops/OpsDialog.vue'

// "สมุดรายชื่อ": everyone who has booked, how often, their saved details (view / correct).
// The staff booking form picks from the same list to fill the renter's details in.
const rows = ref(null)
const error = ref('')
const q = ref('')
async function load() {
  try {
    rows.value = await listCustomers()
    error.value = ''
  } catch (err) {
    error.value = err.message
  }
}
onMounted(load)

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s-]/g, '')
const shown = computed(() => {
  const k = norm(q.value)
  return (rows.value ?? []).filter((r) => !k || norm(r.name).includes(k) || norm(r.phone).includes(k) || norm(r.email).includes(k))
})
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS = {
  PENDING: 'รอชำระ / รอตรวจ', CONFIRMED: 'ยืนยันแล้ว', PREPARING: 'เตรียมรถ', READY: 'รถพร้อม', IN_DELIVERY: 'กำลังส่ง',
  ACTIVE: 'กำลังเช่า', COMPLETED: 'คืนรถแล้ว', CANCELLED: 'ยกเลิก', EXPIRED: 'หมดเวลา', REFUNDED: 'คืนเงินแล้ว',
}

// ---- detail / edit
const open = ref(null) // { mode: 'view' | 'edit', data }
const busy = ref(false)
const formError = ref('')
const form = ref(null)
async function show(r, mode) {
  busy.value = true
  error.value = ''
  try {
    const data = await getCustomer(r.id)
    open.value = { mode, data }
    loadPhotos(data)
    form.value = { ...BLANK, ...(data.customer ?? { fullName: data.name, phone: data.phone ?? '' }) }
    formError.value = ''
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
const BLANK = {
  fullName: '', phone: '', countryCode: 'TH', idType: 'NATIONAL_ID', idNumber: '', dateOfBirth: '',
  address: '', licenseNumber: '', licenseCountry: 'TH', licenseExpiry: '',
}
async function save() {
  busy.value = true
  formError.value = ''
  try {
    const f = form.value
    const data = await updateCustomer(open.value.data.id, {
      ...f, fullName: f.fullName.trim(), phone: f.phone.trim(), idNumber: f.idNumber.trim(), licenseNumber: f.licenseNumber.trim(),
      address: f.address.trim(), countryCode: f.countryCode.trim().toUpperCase(), licenseCountry: f.licenseCountry.trim().toUpperCase(),
    })
    open.value = { mode: 'view', data }
    await load()
  } catch (err) {
    const details = err.details ? Object.values(err.details).flat().filter((m) => typeof m === 'string') : []
    formError.value = details.length ? details.join(' · ') : err.message
  } finally {
    busy.value = false
  }
}
// Photos are private: fetched with the staff session, shown from memory, dropped on close.
const photos = ref({})
function dropPhotos() {
  for (const u of Object.values(photos.value)) URL.revokeObjectURL(u)
  photos.value = {}
}
async function loadPhotos(data) {
  dropPhotos()
  for (const [k] of DOCS) {
    if (!data.documents?.[k]) continue
    try {
      const res = await fetch(customerDocUrl(data.id, k), { credentials: 'include' })
      if (res.ok) photos.value = { ...photos.value, [k]: URL.createObjectURL(await res.blob()) }
    } catch {
      /* the label still says it is on file */
    }
  }
}
function closeOpen() {
  dropPhotos()
  open.value = null
}
const DOCS = [['id_front', 'บัตรประชาชน / พาสปอร์ต'], ['license_front', 'ใบขับขี่'], ['id_back', 'บัตร (ด้านหลัง)']]
const idLabel = (c) => (c?.idType === 'PASSPORT' ? 'พาสปอร์ต' : 'เลขบัตรประชาชน')
</script>

<template>
  <section class="cust">
    <div class="head">
      <p class="lede">ลูกค้าทุกคนที่เคยจอง · กด "ดูรายละเอียด" เพื่อดูข้อมูลและประวัติการจอง · ตอนจองให้ลูกค้าเลือกจากรายชื่อนี้ได้เลย</p>
      <label class="search"><Icon name="search" :size="15" /><input v-model="q" type="search" placeholder="ค้นหาชื่อ เบอร์โทร หรืออีเมล" /></label>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div v-if="rows" class="table-wrap">
      <table>
        <thead>
          <tr><th>ชื่อลูกค้า</th><th>เบอร์โทร</th><th class="n">จองแล้ว (ครั้ง)</th><th>เอกสาร</th><th>จองล่าสุด</th><th class="acts-h" /></tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td>
              <strong>{{ r.name }}</strong>
              <small v-if="r.email" class="sub">{{ r.email }}</small>
              <span v-if="r.onLine" class="tag line">LINE</span>
            </td>
            <td>{{ r.phone || '—' }}</td>
            <td class="n">
              <b>{{ r.bookings }}</b>
              <small v-if="r.cancelled" class="sub">ยกเลิก {{ r.cancelled }}</small>
            </td>
            <td class="docs">
              <span :class="r.docs.id ? 'ok' : 'no'"><Icon :name="r.docs.id ? 'check' : 'x'" :size="12" /> บัตร</span>
              <span :class="r.docs.license ? 'ok' : 'no'"><Icon :name="r.docs.license ? 'check' : 'x'" :size="12" /> ใบขับขี่</span>
            </td>
            <td>{{ day(r.lastBookedAt) }}</td>
            <td class="acts">
              <button type="button" class="ghost" :disabled="busy" @click="show(r, 'view')"><Icon name="eye" :size="14" /> ดูรายละเอียด</button>
              <button type="button" class="ghost" :disabled="busy" @click="show(r, 'edit')"><Icon name="receipt" :size="14" /> แก้ไข</button>
            </td>
          </tr>
          <tr v-if="!shown.length"><td colspan="6" class="none">{{ rows.length ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีลูกค้า' }}</td></tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!error" class="skeleton" style="height: 240px" />

    <OpsDialog v-if="open" :title="open.mode === 'edit' ? `แก้ไขข้อมูล — ${open.data.name}` : open.data.name" icon="user" wide @close="closeOpen">
      <template v-if="open.mode === 'view'">
        <div class="facts">
          <div><small>เบอร์โทร</small><b>{{ open.data.phone || '—' }}</b></div>
          <div><small>อีเมล</small><b>{{ open.data.email || '—' }}</b></div>
          <div><small>{{ idLabel(open.data.customer) }}</small><b>{{ open.data.customer?.idNumber || '—' }}</b></div>
          <div><small>วันเกิด</small><b>{{ open.data.customer?.dateOfBirth || '—' }}</b></div>
          <div><small>เลขใบขับขี่</small><b>{{ open.data.customer?.licenseNumber || '—' }}</b></div>
          <div><small>ใบขับขี่หมดอายุ</small><b>{{ open.data.customer?.licenseExpiry || 'หมดอายุ / ไม่มีข้อมูล' }}</b></div>
          <div class="wide"><small>ที่อยู่</small><b>{{ open.data.customer?.address || '—' }}</b></div>
          <div v-if="open.data.rental?.socialUrl"><small>Facebook / IG / LINE</small><b>{{ open.data.rental.socialUrl }}</b></div>
          <div v-if="open.data.rental?.stayLocation" class="wide"><small>ที่พักล่าสุด</small><b>{{ open.data.rental.stayLocation }}</b></div>
        </div>
        <h4>เอกสาร</h4>
        <div class="photos">
          <template v-for="[k, label] in DOCS" :key="k">
            <a v-if="open.data.documents?.[k]" :href="photos[k]" target="_blank" rel="noopener" class="photo">
              <img v-if="photos[k]" :src="photos[k]" :alt="label" />
              <span v-else class="loading-img" />
              <span>{{ label }}</span>
            </a>
            <div v-else-if="k !== 'id_back'" class="photo none-doc"><Icon name="camera" :size="22" /><span>{{ label }} · ยังไม่มีรูป</span></div>
          </template>
        </div>
        <h4>ประวัติการจอง ({{ open.data.bookings.length }})</h4>
        <ul class="hist">
          <li v-for="b in open.data.bookings" :key="b.number">
            <RouterLink :to="{ query: { tab: 'operations', booking: b.number } }" class="num" @click="closeOpen">{{ b.number }}</RouterLink>
            <span>{{ b.car }}</span>
            <span class="muted">{{ dt(b.pickupAt) }} – {{ dt(b.returnAt) }}</span>
            <span class="st">{{ STATUS[b.status] ?? b.status }}</span>
            <b>{{ money(b.totalMinor, b.currency) }}</b>
          </li>
        </ul>
        <button type="button" class="primary" @click="open.mode = 'edit'">แก้ไขข้อมูลลูกค้า</button>
      </template>

      <form v-else class="edit" @submit.prevent="save">
        <div class="g">
          <label class="f">ชื่อ-นามสกุล<input v-model="form.fullName" required maxlength="120" /></label>
          <label class="f">เบอร์โทร<input v-model="form.phone" required inputmode="tel" maxlength="20" /></label>
          <label class="f">สัญชาติ (รหัส 2 ตัว)<input v-model="form.countryCode" required maxlength="2" placeholder="TH" /></label>
          <label class="f">ประเภทเอกสาร
            <select v-model="form.idType"><option value="NATIONAL_ID">บัตรประชาชน</option><option value="PASSPORT">พาสปอร์ต</option></select>
          </label>
          <label class="f">{{ idLabel(form) }}<input v-model="form.idNumber" required maxlength="30" /></label>
          <label class="f">วันเกิด<input v-model="form.dateOfBirth" type="date" required /></label>
          <label class="f">เลขใบขับขี่<input v-model="form.licenseNumber" required maxlength="30" /></label>
          <label class="f">ประเทศที่ออกใบขับขี่<input v-model="form.licenseCountry" required maxlength="2" placeholder="TH" /></label>
          <label class="f">ใบขับขี่หมดอายุ<input v-model="form.licenseExpiry" type="date" required /></label>
        </div>
        <label class="f">ที่อยู่<textarea v-model="form.address" rows="2" required maxlength="300" /></label>
        <p class="hint">การจองที่ทำไปแล้วยังใช้ข้อมูลเดิม ข้อมูลใหม่ใช้กับการจองครั้งถัดไป · รูปบัตรเดิมยังใช้ได้ถ้าเลขบัตรและเลขใบขับขี่ไม่เปลี่ยน</p>
        <p v-if="formError" class="err" role="alert">{{ formError }}</p>
        <button type="submit" class="primary" :disabled="busy">{{ busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูลลูกค้า' }}</button>
      </form>
    </OpsDialog>
  </section>
</template>

<style scoped>
.cust {
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
.muted {
  color: var(--viz-muted);
  font-size: 0.82rem;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: min(320px, 100%);
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 12px;
  color: var(--viz-muted);
}
.search input {
  flex: 1;
  min-height: 40px;
  border: 0;
  background: transparent;
  font: inherit;
  outline: none;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--viz-border);
  border-radius: 16px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
table {
  width: 100%;
  border-collapse: collapse;
  color: var(--viz-text);
  font-size: 0.9rem;
}
th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--viz-border);
  text-align: left;
  vertical-align: middle;
}
th {
  color: var(--viz-muted);
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}
tbody tr:last-child td {
  border-bottom: 0;
}
.n {
  text-align: center;
}
.sub {
  display: block;
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.tag.line {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgb(6 199 85 / 0.18);
  color: #5fe39a;
  font-size: 0.7rem;
  font-weight: 700;
}
.acts {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  white-space: nowrap;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: transparent;
  color: var(--viz-text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.none {
  color: var(--viz-muted);
  text-align: center;
}
.err {
  color: #ff8a82;
}
td.docs {
  white-space: nowrap;
}
td.docs span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 6px;
  padding: 2px 8px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  font-size: 0.75rem;
}
td.docs .ok {
  border-color: rgb(95 211 154 / 0.5);
  color: #8fe5b8;
}
td.docs .no {
  color: var(--viz-muted);
}
/* inside the white popup */
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}
.photo {
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid #e6e8ee;
  border-radius: 12px;
  color: #3a3d48;
  font-size: 0.8rem;
  text-align: center;
}
.photo img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: contain;
  border-radius: 8px;
  background: #f2f3f5;
}
.loading-img {
  aspect-ratio: 16 / 10;
  border-radius: 8px;
  background: #eceef2;
}
.none-doc {
  place-items: center;
  min-height: 140px;
  border-style: dashed;
  color: #8d909b;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: #f2f3f5;
}
.facts .wide {
  grid-column: 1 / -1;
}
.facts small {
  display: block;
  color: #6b6e7a;
  font-size: 0.75rem;
}
.facts b {
  font-weight: 600;
  word-break: break-word;
}
h4 {
  font-size: 0.95rem;
  font-weight: 700;
}
.hist {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}
.hist li {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 4px 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e6e8ee;
  border-radius: 12px;
}
.hist .muted {
  grid-column: 2 / 3;
  color: #6b6e7a;
}
.hist .num {
  color: #1d4ed8;
  font-weight: 700;
}
.hist .st {
  color: #6b6e7a;
}
.edit {
  display: grid;
  gap: 12px;
}
.g {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.edit select {
  min-height: 46px;
  padding: 0 12px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  background: #fafafa;
  font: inherit;
}
</style>
