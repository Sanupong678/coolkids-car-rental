<script setup>
import { computed, onMounted, ref } from 'vue'
import { completeService, getReminders, removeVehicleDocument, saveVehicleDocument, updatePlan } from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import Icon from '@/components/ui/Icon.vue'

// "ซ่อมบำรุง": cars that need attention, worst first — services due by
// odometer or date (from the odometer readings staff record on the board) and
// documents about to lapse (พ.ร.บ., road tax, insurance, lease contract …).
// Open a car to mark a service done, change its interval, renew or add a
// document, and see its last odometer readings.
const auth = useAuthStore()
const canWrite = computed(() => auth.can('maintenance:write'))
const data = ref(null)
const error = ref('')
const open = ref(new Set())
const showAll = ref(false)
const pick = ref('')
const q = ref('')
const busy = ref(false)

async function load() {
  try {
    data.value = await getReminders()
    error.value = ''
  } catch (err) {
    error.value = err.message
  }
}
onMounted(load)

const needs = computed(() => (data.value?.cars ?? []).filter((c) => c.overdue || c.near))
const itemCount = computed(() => needs.value.reduce((t, c) => t + c.overdue + c.near, 0))
const shown = computed(() => {
  let list = showAll.value || pick.value || q.value.trim() ? data.value?.cars ?? [] : needs.value
  if (pick.value) list = list.filter((c) => c.id === pick.value)
  const s = q.value.trim().toLowerCase()
  if (s) {
    list = list.filter((c) =>
      [c.plate, c.name, ...c.plans.map((p) => p.label), ...c.docs.map((d) => d.label)].some((v) => v?.toLowerCase().includes(s)),
    )
  }
  return list
})
const toggle = (id) => {
  const next = new Set(open.value)
  next.has(id) ? next.delete(id) : next.add(id)
  open.value = next
}
const expandAll = () => (open.value = new Set(shown.value.map((c) => c.id)))
const collapseAll = () => (open.value = new Set())

const km = (n) => (n == null ? '—' : `${n.toLocaleString('th-TH')} กม.`)
const date = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
function dueText(p) {
  const parts = []
  if (p.kmLeft != null) parts.push(p.kmLeft <= 0 ? `เกินมา ${(-p.kmLeft).toLocaleString('th-TH')} กม.` : `อีก ${p.kmLeft.toLocaleString('th-TH')} กม.`)
  if (p.daysLeft != null) parts.push(p.daysLeft <= 0 ? `เลยกำหนด ${-p.daysLeft} วัน` : `อีก ${p.daysLeft} วัน`)
  return parts.join(' · ')
}
const docText = (d) => (d.daysLeft < 0 ? `หมดอายุแล้ว ${-d.daysLeft} วัน` : d.daysLeft === 0 ? 'หมดอายุวันนี้' : `อีก ${d.daysLeft} วัน`)

async function run(fn) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

// ---- service done / interval
const doneFor = ref(null) // plan id with the "ทำแล้ว" form open
const doneKm = ref('')
const doneNote = ref('')
function startDone(c, p) {
  doneFor.value = p.id
  doneKm.value = String(c.currentKm)
  doneNote.value = ''
}
const saveDone = (p) =>
  run(async () => {
    await completeService(p.id, { km: Number(doneKm.value) || undefined, note: doneNote.value.trim() || undefined })
    doneFor.value = null
  })
const editFor = ref(null)
const editKm = ref('')
const editDays = ref('')
function startEdit(p) {
  editFor.value = p.id
  editKm.value = p.intervalKm ?? ''
  editDays.value = p.intervalDays ?? ''
}
const saveEdit = (p) =>
  run(async () => {
    await updatePlan(p.id, { intervalKm: editKm.value === '' ? null : Number(editKm.value), intervalDays: editDays.value === '' ? null : Number(editDays.value) })
    editFor.value = null
  })

// ---- documents
const docFor = ref(null) // vehicle id with the add / renew form open
const doc = ref({})
function startDoc(c, renew = null) {
  docFor.value = c.id
  doc.value = renew
    ? { replaces: renew.id, type: renew.type, title: renew.title ?? '', reference: renew.reference ?? '', expiresOn: '', notes: '' }
    : { replaces: null, type: 'COMPULSORY_INSURANCE', title: '', reference: '', expiresOn: '', notes: '' }
}
const saveDoc = (c) =>
  run(async () => {
    const d = doc.value
    await saveVehicleDocument(c.id, {
      type: d.type, expiresOn: d.expiresOn, replaces: d.replaces || undefined,
      title: d.title.trim() || undefined, reference: d.reference.trim() || undefined, notes: d.notes.trim() || undefined,
    })
    docFor.value = null
  })
const dropDoc = (d) => window.confirm(`ลบ ${d.label}?`) && run(() => removeVehicleDocument(d.id))
const MILEAGE = { PICKUP: 'ส่งรถ', RETURN: 'รับคืน', SERVICE: 'เข้าศูนย์', INSPECTION: 'ตรวจสภาพ', MANUAL: 'บันทึกเอง', CORRECTION: 'แก้ไข' }
</script>

<template>
  <div class="mt">
    <div class="head">
      <h3><Icon name="wrench" :size="18" /> รายการรถที่ต้องเข้ารับบริการ ({{ needs.length }} คัน · {{ itemCount }} รายการ)</h3>
      <div class="tools">
        <button type="button" class="link" @click="expandAll">ขยายทั้งหมด</button>
        <button type="button" class="ghost" @click="collapseAll">ซ่อนรายการ</button>
        <label class="all"><input v-model="showAll" type="checkbox" /> แสดงรถทุกคัน</label>
      </div>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-if="!data && !error" class="skeleton" style="height: 220px" />

    <ul v-else-if="data" class="cars">
      <li v-for="c in shown" :key="c.id" class="car" :class="c.overdue ? 'bad' : c.near ? 'warn' : 'fine'">
        <button type="button" class="sum" :aria-expanded="open.has(c.id)" @click="toggle(c.id)">
          <Icon :name="open.has(c.id) ? 'chevron-down' : 'chevron-right'" :size="16" />
          <span class="no">#{{ c.fleetNo ?? '–' }}</span>
          <span class="plate">{{ c.plate }}</span>
          <strong>{{ c.name }}</strong>
          <small>ไมล์ปัจจุบัน: {{ km(c.currentKm) }}</small>
          <span v-if="c.overdue" class="badge bad"><Icon name="clock" :size="12" /> เกิน {{ c.overdue }}</span>
          <span v-if="c.near" class="badge warn"><Icon name="clock" :size="12" /> ใกล้ {{ c.near }}</span>
          <span v-if="!c.overdue && !c.near" class="badge ok">ปกติ</span>
        </button>

        <div v-if="open.has(c.id)" class="detail">
          <section>
            <h4>ซ่อมบำรุงตามระยะ</h4>
            <ul class="items">
              <li v-for="p in c.plans" :key="p.id" :class="p.level">
                <div class="what">
                  <strong>{{ p.label }}</strong>
                  <small>
                    ทุก {{ [p.intervalKm && `${p.intervalKm.toLocaleString('th-TH')} กม.`, p.intervalDays && `${p.intervalDays} วัน`].filter(Boolean).join(' หรือ ') }}
                    · ครั้งล่าสุด {{ km(p.lastKm) }} ({{ date(p.lastAt) }})
                  </small>
                </div>
                <span class="due">{{ dueText(p) }}</span>
                <span v-if="canWrite" class="acts">
                  <button type="button" class="go" @click="startDone(c, p)">ทำแล้ว</button>
                  <button type="button" class="ghost" @click="startEdit(p)">ตั้งระยะ</button>
                </span>
                <form v-if="doneFor === p.id" class="inline" @submit.prevent="saveDone(p)">
                  <label>ไมล์ตอนเข้าศูนย์<input v-model="doneKm" type="number" min="0" /></label>
                  <label class="grow">หมายเหตุ<input v-model="doneNote" type="text" maxlength="500" placeholder="อู่ / อะไหล่ที่เปลี่ยน" /></label>
                  <button type="submit" class="go" :disabled="busy">บันทึก</button>
                  <button type="button" class="ghost" @click="doneFor = null">ยกเลิก</button>
                </form>
                <form v-if="editFor === p.id" class="inline" @submit.prevent="saveEdit(p)">
                  <label>ทุกกี่ กม.<input v-model="editKm" type="number" min="100" placeholder="ไม่ใช้" /></label>
                  <label>หรือทุกกี่วัน<input v-model="editDays" type="number" min="1" placeholder="ไม่ใช้" /></label>
                  <button type="submit" class="go" :disabled="busy">บันทึก</button>
                  <button type="button" class="ghost" @click="editFor = null">ยกเลิก</button>
                </form>
              </li>
            </ul>
          </section>

          <section>
            <h4>เอกสารรถ · พ.ร.บ. / ภาษี / ประกัน / ต่อสัญญา</h4>
            <ul class="items">
              <li v-for="d in c.docs" :key="d.id" :class="d.level">
                <div class="what">
                  <strong>{{ d.label }}</strong>
                  <small>หมดอายุ {{ date(d.expiresOn) }}<template v-if="d.reference"> · เลขที่ {{ d.reference }}</template><template v-if="d.notes"> · {{ d.notes }}</template></small>
                </div>
                <span class="due">{{ docText(d) }}</span>
                <span v-if="canWrite" class="acts">
                  <button type="button" class="go" @click="startDoc(c, d)">ต่ออายุ</button>
                  <button type="button" class="ghost" @click="dropDoc(d)">ลบ</button>
                </span>
              </li>
              <li v-if="!c.docs.length" class="none">ยังไม่มีเอกสาร · เพิ่ม พ.ร.บ. ภาษี ประกัน เพื่อให้ระบบเตือนก่อนหมดอายุ 30 วัน</li>
            </ul>
            <button v-if="canWrite && docFor !== c.id" type="button" class="add" @click="startDoc(c)"><Icon name="sparkles" :size="14" /> เพิ่มเอกสาร</button>
            <form v-if="docFor === c.id" class="inline doc" @submit.prevent="saveDoc(c)">
              <label>
                ประเภท
                <select v-model="doc.type">
                  <option v-for="(t, k) in data.docTypes" :key="k" :value="k">{{ t }}</option>
                </select>
              </label>
              <label>วันหมดอายุ<input v-model="doc.expiresOn" type="date" required /></label>
              <label>เลขที่กรมธรรม์ / สัญญา<input v-model="doc.reference" type="text" maxlength="120" /></label>
              <label v-if="doc.type === 'OTHER'">ชื่อเอกสาร<input v-model="doc.title" type="text" maxlength="120" /></label>
              <label class="grow">หมายเหตุ<input v-model="doc.notes" type="text" maxlength="1000" placeholder="บริษัทประกัน / ทุนประกัน" /></label>
              <button type="submit" class="go" :disabled="busy || !doc.expiresOn">{{ doc.replaces ? 'บันทึกการต่ออายุ' : 'เพิ่ม' }}</button>
              <button type="button" class="ghost" @click="docFor = null">ยกเลิก</button>
            </form>
          </section>

          <section>
            <h4>ประวัติเลขไมล์ล่าสุด</h4>
            <ul class="items mileage">
              <li v-for="(m, i) in c.mileage" :key="i">
                <span>{{ date(m.at) }}</span>
                <strong>{{ km(m.km) }}</strong>
                <small>{{ MILEAGE[m.type] ?? m.type }}<template v-if="m.booking"> · {{ m.booking }}</template></small>
              </li>
              <li v-if="!c.mileage.length" class="none">ยังไม่มีการบันทึกไมล์ · บันทึกได้จากปุ่ม "ไมล์" ในหน้างานส่งรถ</li>
            </ul>
          </section>
        </div>
      </li>
      <li v-if="!shown.length" class="empty">ไม่มีรถที่ต้องเข้ารับบริการตอนนี้</li>
    </ul>

    <div class="filter">
      <label>
        เลือกรถ:
        <select v-model="pick">
          <option value="">-- เลือกทะเบียนรถ --</option>
          <option v-for="c in data?.cars ?? []" :key="c.id" :value="c.id">#{{ c.fleetNo ?? '–' }} {{ c.plate }} · {{ c.name }}</option>
        </select>
      </label>
      <label class="search"><Icon name="search" :size="14" /><input v-model="q" type="search" placeholder="ค้นหา รายการซ่อม, อู่, ทะเบียน..." /></label>
    </div>
  </div>
</template>

<style scoped>
.mt {
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
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 1.05rem;
  font-weight: 700;
}
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.82rem;
}
.tools .link {
  border: 0;
  background: none;
  color: var(--viz-text);
  font: inherit;
  cursor: pointer;
}
.all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--viz-muted);
}
.cars {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.car {
  border: 1px solid var(--viz-border);
  border-left-width: 4px;
  border-radius: 14px;
  background: var(--viz-surface);
}
.car.bad {
  border-left-color: #e5484d;
  background: rgb(229 72 77 / 0.08);
}
.car.warn {
  border-left-color: #e3b341;
  background: rgb(227 179 65 / 0.07);
}
.sum {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  background: none;
  color: var(--viz-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.sum small {
  flex-basis: 100%;
  padding-left: 26px;
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.no {
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.plate {
  padding: 1px 8px;
  border: 1px solid var(--viz-border);
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.8rem;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}
.badge + .badge {
  margin-left: 0;
}
.badge.bad {
  background: #e5484d;
  color: #fff;
}
.badge.warn {
  background: rgb(227 179 65 / 0.2);
  color: #ffd25e;
}
.badge.ok {
  background: rgb(95 211 154 / 0.15);
  color: #8fe5b8;
}
.detail {
  display: grid;
  gap: 14px;
  padding: 0 14px 14px 40px;
}
h4 {
  margin-bottom: 6px;
  color: var(--viz-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.items {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.items > li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
  font-size: 0.85rem;
}
.items > li.overdue {
  box-shadow: inset 3px 0 0 #e5484d;
}
.items > li.near {
  box-shadow: inset 3px 0 0 #e3b341;
}
.what {
  display: grid;
  flex: 1 1 260px;
  gap: 2px;
}
.what small,
.items small {
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.overdue .due {
  color: #ff8a82;
  font-weight: 700;
}
.near .due {
  color: #ffd25e;
  font-weight: 600;
}
.acts {
  display: flex;
  gap: 6px;
}
.go,
.ghost,
.add {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.go {
  border: 0;
  background: #5fd39a;
  color: #0b2a1c;
}
.ghost,
.add {
  border: 1px solid var(--viz-border);
  background: transparent;
  color: var(--viz-text);
}
.add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.inline {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
  padding-top: 6px;
}
.inline label {
  display: grid;
  gap: 4px;
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.inline .grow {
  flex: 1 1 200px;
}
.inline input,
.inline select,
.filter select,
.filter input {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
}
.inline select option,
.filter select option {
  color: #121319;
}
.mileage li {
  font-variant-numeric: tabular-nums;
}
.none,
.empty {
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.empty {
  padding: 24px;
  text-align: center;
}
.filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 14px;
  background: var(--viz-surface);
  font-size: 0.85rem;
}
.filter label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.search {
  flex: 1 1 240px;
  padding-left: 10px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
}
.search input {
  flex: 1;
  border: 0;
  background: none;
}
.err {
  color: #ff8a82;
}
@media (max-width: 640px) {
  .detail {
    padding-left: 14px;
  }
}
</style>
