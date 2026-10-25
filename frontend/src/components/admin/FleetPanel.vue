<script setup>
import { computed, onMounted, ref } from 'vue'
import { archiveVehicle, createVehicle, listVehicles, updateVehicle, uploadImage, vehicleMeta } from '@/api/admin'
import { label, money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'

// Fleet editor: add a car, change price / details / photo, publish or hide it.
// Prices are typed in baht and sent in satang (minor units).
const cars = ref([])
const meta = ref({ categories: [], features: [] })
const editing = ref(null) // form object or null
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const q = ref('')

async function load() {
  ;[cars.value, meta.value] = await Promise.all([listVehicles(), vehicleMeta()])
}
onMounted(load)

const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? cars.value.filter((c) => `${c.brand} ${c.model} ${c.trim} ${c.licensePlate}`.toLowerCase().includes(s)) : cars.value
})

const EMPTY = {
  id: null, categorySlug: '', brand: '', model: '', trim: '', year: new Date().getFullYear(), licensePlate: '', color: '',
  description: '', transmission: 'AUTOMATIC', fuel: 'PETROL', drive: 'FWD', seats: 5, doors: 4, luggageLiters: null,
  engineCc: null, powerHp: null, torqueNm: null, fuelEconomy: null, daily: 1000, hourly: null, deposit: 5000,
  minRentalDays: 1, maxRentalDays: null, minDriverAge: 21, status: 'DRAFT', isFeatured: false, imageUrl: null, features: [],
  // Delivery fee for this car in baht; empty = shop default.
  deliveryFreeKm: null, deliveryPerKm: null, deliveryMinFee: null,
  fleetNo: null, // "#3" on the operations board and booking timeline; empty = next number
}
function edit(c) {
  error.value = ''
  editing.value = c
    ? { ...EMPTY, ...c, daily: c.dailyRateMinor / 100, hourly: c.hourlyRateMinor ? c.hourlyRateMinor / 100 : null, deposit: c.depositMinor / 100, features: [...c.features], originalImage: c.imageUrl,
        deliveryPerKm: c.deliveryPerKmMinor != null ? c.deliveryPerKmMinor / 100 : null, deliveryMinFee: c.deliveryMinFeeMinor != null ? c.deliveryMinFeeMinor / 100 : null }
    : { ...EMPTY, categorySlug: meta.value.categories[0]?.slug ?? '', features: [] }
}

const num = (v) => (v === '' || v == null ? null : Number(v))
function payload(f) {
  return {
    categorySlug: f.categorySlug, brand: f.brand.trim(), model: f.model.trim(), trim: f.trim?.trim() || null, year: num(f.year),
    licensePlate: f.licensePlate.trim(), color: f.color?.trim() || null, description: f.description?.trim() || null,
    transmission: f.transmission, fuel: f.fuel, drive: f.drive, seats: num(f.seats), doors: num(f.doors),
    luggageLiters: num(f.luggageLiters), engineCc: num(f.engineCc), powerHp: num(f.powerHp), torqueNm: num(f.torqueNm),
    fuelEconomy: num(f.fuelEconomy), dailyRateMinor: Math.round(num(f.daily) * 100),
    hourlyRateMinor: f.hourly ? Math.round(num(f.hourly) * 100) : null, depositMinor: Math.round(num(f.deposit) * 100),
    minRentalDays: num(f.minRentalDays), maxRentalDays: num(f.maxRentalDays), minDriverAge: num(f.minDriverAge),
    status: f.status, isFeatured: f.isFeatured, features: f.features,
    fleetNo: num(f.fleetNo),
    deliveryFreeKm: num(f.deliveryFreeKm),
    deliveryPerKmMinor: num(f.deliveryPerKm) == null ? null : Math.round(num(f.deliveryPerKm) * 100),
    deliveryMinFeeMinor: num(f.deliveryMinFee) == null ? null : Math.round(num(f.deliveryMinFee) * 100), ...(f.imageUrl && f.imageUrl !== f.originalImage ? { imageUrl: f.imageUrl } : {}),
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const f = editing.value
    if (f.id) await updateVehicle(f.id, payload(f))
    else await createVehicle(payload(f))
    editing.value = null
    await load()
  } catch (err) {
    const details = err.details ? Object.entries(err.details).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`) : []
    error.value = details.length ? details.join(' · ') : err.message
  } finally {
    saving.value = false
  }
}

async function onFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    editing.value.imageUrl = (await uploadImage(file)).url
  } catch (err) {
    error.value = err.message
  } finally {
    uploading.value = false
    e.target.value = ''
  }
}

async function archive() {
  const f = editing.value
  if (!window.confirm(`ซ่อนรถ ${f.brand} ${f.model} (${f.licensePlate}) ออกจากระบบถาวร? ประวัติการจองจะยังอยู่`)) return
  try {
    await archiveVehicle(f.id)
    editing.value = null
    await load()
  } catch (err) {
    error.value = err.message
  }
}

const STATUSES = [
  ['ACTIVE', 'เปิดให้จอง'],
  ['DRAFT', 'ฉบับร่าง (ซ่อน)'],
  ['MAINTENANCE', 'ซ่อมบำรุง'],
  ['OUT_OF_SERVICE', 'งดให้บริการ'],
]
const STATUS_CLASS = { ACTIVE: 'ok', DRAFT: 'muted', MAINTENANCE: 'warn', OUT_OF_SERVICE: 'bad' }
</script>

<template>
  <div class="fleet">
    <div class="bar">
      <label class="search"><Icon name="search" :size="14" /><input v-model="q" type="search" placeholder="ค้นหารุ่น / ทะเบียน" /></label>
      <button type="button" class="add" @click="edit(null)"><Icon name="car" :size="16" /> เพิ่มรถ</button>
    </div>

    <div class="table">
      <table>
        <thead>
          <tr><th>รถ</th><th>ทะเบียน</th><th>ประเภท</th><th>ราคา/วัน</th><th>มัดจำ</th><th>สถานะ</th><th>งานค้าง</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="c in shown" :key="c.id">
            <td class="car">
              <img v-if="c.imageUrl" :src="c.imageUrl" alt="" loading="lazy" />
              <span><strong>{{ c.brand }} {{ c.model }}</strong><small>{{ c.trim }} · {{ c.year }} · {{ label(c.fuel) }}</small></span>
            </td>
            <td data-label="ทะเบียน"><span class="plate">{{ c.licensePlate }}</span></td>
            <td data-label="ประเภท">{{ c.categoryName }}</td>
            <td class="num" data-label="ราคา/วัน">{{ money(c.dailyRateMinor, c.currency) }}</td>
            <td class="num" data-label="มัดจำ">{{ money(c.depositMinor, c.currency) }}</td>
            <td data-label="สถานะ"><span class="pill" :class="STATUS_CLASS[c.status]">{{ STATUSES.find((s) => s[0] === c.status)?.[1] ?? c.status }}</span><span v-if="c.isFeatured" class="star" title="รถแนะนำ">★</span></td>
            <td class="num" data-label="งานค้าง">{{ c.openBookings }}</td>
            <td class="edit-cell"><button type="button" class="edit" @click="edit(c)">แก้ไข</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- editor drawer -->
    <div v-if="editing" class="scrim" @click.self="editing = null">
      <form class="drawer" novalidate @submit.prevent="save">
        <header>
          <h3>{{ editing.id ? `แก้ไข ${editing.brand} ${editing.model}` : 'เพิ่มรถใหม่' }}</h3>
          <button type="button" class="x" aria-label="ปิด" @click="editing = null"><Icon name="x" :size="18" /></button>
        </header>

        <div class="scroll">
          <section class="photo">
            <div class="preview">
              <img v-if="editing.imageUrl" :src="editing.imageUrl" alt="" />
              <Icon v-else name="camera" :size="32" />
            </div>
            <label class="upload">
              <input type="file" accept="image/jpeg,image/png,image/webp" @change="onFile" />
              <Icon name="camera" :size="14" /> {{ uploading ? 'กำลังอัปโหลด…' : editing.imageUrl ? 'เปลี่ยนรูป' : 'อัปโหลดรูปรถ' }}
            </label>
            <small>แนะนำ PNG/WebP พื้นหลังโปร่งใส ไม่เกิน 8 MB</small>
          </section>

          <section>
            <h4>ข้อมูลรถ</h4>
            <div class="g3">
              <label><span>ยี่ห้อ *</span><input v-model="editing.brand" required placeholder="Toyota" /></label>
              <label><span>รุ่น *</span><input v-model="editing.model" required placeholder="Yaris Ativ" /></label>
              <label><span>รุ่นย่อย</span><input v-model="editing.trim" placeholder="Premium" /></label>
              <label><span>ปี *</span><input v-model.number="editing.year" type="number" min="1990" max="2100" /></label>
              <label><span>ทะเบียน *</span><input v-model="editing.licensePlate" required placeholder="1กข 1234" /></label>
              <label><span>เลขรถ (#)</span><input v-model.number="editing.fleetNo" type="number" min="1" placeholder="อัตโนมัติ" /></label>
              <label><span>สี</span><input v-model="editing.color" /></label>
              <label>
                <span>ประเภท *</span>
                <select v-model="editing.categorySlug"><option v-for="c in meta.categories" :key="c.slug" :value="c.slug">{{ c.name }}</option></select>
              </label>
              <label>
                <span>สถานะ</span>
                <select v-model="editing.status"><option v-for="[v, l] in STATUSES" :key="v" :value="v">{{ l }}</option></select>
              </label>
              <label class="chk"><input v-model="editing.isFeatured" type="checkbox" /> แสดงเป็นรถแนะนำ</label>
            </div>
            <label class="full"><span>คำอธิบาย</span><textarea v-model="editing.description" rows="3" maxlength="2000" /></label>
          </section>

          <section>
            <h4>ราคาและเงื่อนไข</h4>
            <div class="g3">
              <label><span>ราคาต่อวัน (บาท) *</span><input v-model.number="editing.daily" type="number" min="1" step="10" /></label>
              <label><span>ราคาต่อชั่วโมง (บาท)</span><input v-model.number="editing.hourly" type="number" min="0" step="10" /></label>
              <label><span>เงินประกัน (บาท) *</span><input v-model.number="editing.deposit" type="number" min="0" step="100" /></label>
              <label><span>เช่าขั้นต่ำ (วัน)</span><input v-model.number="editing.minRentalDays" type="number" min="1" /></label>
              <label><span>เช่าสูงสุด (วัน)</span><input v-model.number="editing.maxRentalDays" type="number" min="1" /></label>
              <label><span>อายุผู้ขับขั้นต่ำ</span><input v-model.number="editing.minDriverAge" type="number" min="18" max="99" /></label>
            </div>
          </section>

          <section>
            <h4>การส่งรถถึงที่</h4>
            <p class="hint">เว้นว่างเพื่อใช้ค่าเริ่มต้นของร้าน · ลูกค้าปักหมุดจุดส่งบนแผนที่ ระบบคิดระยะจากสาขาของรถคันนี้</p>
            <div class="g3">
              <label><span>ส่งฟรี (กม. แรก)</span><input v-model.number="editing.deliveryFreeKm" type="number" min="0" step="0.5" :placeholder="meta?.deliveryDefaults ? String(meta.deliveryDefaults.freeKm) : ''" /></label>
              <label><span>ค่าส่งต่อ กม. (บาท)</span><input v-model.number="editing.deliveryPerKm" type="number" min="0" step="1" :placeholder="meta?.deliveryDefaults ? String(meta.deliveryDefaults.perKmMinor / 100) : ''" /></label>
              <label><span>ค่าส่งขั้นต่ำ (บาท)</span><input v-model.number="editing.deliveryMinFee" type="number" min="0" step="10" :placeholder="meta?.deliveryDefaults ? String(meta.deliveryDefaults.minFeeMinor / 100) : ''" /></label>
            </div>
          </section>

          <section>
            <h4>สเปก</h4>
            <div class="g3">
              <label><span>เกียร์</span><select v-model="editing.transmission"><option value="AUTOMATIC">ออโต้</option><option value="MANUAL">ธรรมดา</option></select></label>
              <label>
                <span>เชื้อเพลิง</span>
                <select v-model="editing.fuel"><option v-for="f in ['PETROL', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC']" :key="f" :value="f">{{ label(f) }}</option></select>
              </label>
              <label><span>ขับเคลื่อน</span><select v-model="editing.drive"><option v-for="d in ['FWD', 'RWD', 'AWD', '4WD']" :key="d">{{ d }}</option></select></label>
              <label><span>ที่นั่ง</span><input v-model.number="editing.seats" type="number" min="1" max="20" /></label>
              <label><span>ประตู</span><input v-model.number="editing.doors" type="number" min="1" max="6" /></label>
              <label><span>ท้ายรถ (ลิตร)</span><input v-model.number="editing.luggageLiters" type="number" min="0" /></label>
              <label><span>เครื่องยนต์ (cc)</span><input v-model.number="editing.engineCc" type="number" min="1" /></label>
              <label><span>แรงม้า</span><input v-model.number="editing.powerHp" type="number" min="1" /></label>
              <label><span>แรงบิด (Nm)</span><input v-model.number="editing.torqueNm" type="number" min="1" /></label>
              <label><span>สิ้นเปลือง (ล./100 กม.)</span><input v-model.number="editing.fuelEconomy" type="number" min="0.1" step="0.1" /></label>
            </div>
          </section>

          <section>
            <h4>อุปกรณ์</h4>
            <div class="feats">
              <label v-for="f in meta.features" :key="f.code" class="chk"><input v-model="editing.features" type="checkbox" :value="f.code" /> {{ f.name }}</label>
            </div>
          </section>
        </div>

        <footer>
          <p v-if="error" class="err" role="alert">{{ error }}</p>
          <button v-if="editing.id" type="button" class="danger" @click="archive">ซ่อนรถถาวร</button>
          <button type="submit" class="save" :disabled="saving || uploading">{{ saving ? 'กำลังบันทึก…' : 'บันทึก' }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.hint {
  margin: -4px 0 8px;
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.fleet {
  display: grid;
  gap: 14px;
}
.bar {
  display: flex;
  gap: 10px;
  justify-content: space-between;
}
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.search input {
  height: 38px;
  border: 0;
  background: none;
  outline: 0;
}
.add,
.save {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 18px;
  height: 40px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.5;
}
.table {
  overflow-x: auto;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}
th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--viz-muted);
  border-bottom: 1px solid var(--viz-border);
}
td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--viz-grid);
  vertical-align: middle;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.car {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
}
.car img {
  width: 64px;
  aspect-ratio: 16 / 10;
  object-fit: contain;
}
.car span {
  display: grid;
}
.car small {
  color: var(--viz-muted);
}
.plate {
  padding: 1px 8px;
  border: 1px solid var(--viz-border);
  border-radius: 6px;
  font-weight: 700;
  white-space: nowrap;
}
.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--viz-surface-strong);
}
.pill.ok {
  background: rgb(95 211 154 / 0.18);
  color: var(--ok);
}
.pill.warn {
  background: rgb(243 182 100 / 0.18);
  color: var(--warn);
}
.pill.bad {
  background: rgb(255 127 118 / 0.18);
  color: var(--bad);
}
.star {
  margin-left: 6px;
  color: var(--warn);
}
.edit {
  padding: 6px 12px;
  border: 1px solid var(--viz-border);
  border-radius: 8px;
  background: none;
  color: var(--viz-text);
  cursor: pointer;
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: rgb(4 6 14 / 0.55);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.drawer {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  height: 100%;
  border-left: 1px solid var(--viz-border);
  background: rgb(18 23 40 / 0.86);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
  backdrop-filter: blur(28px) saturate(140%);
  color: var(--viz-text);
  animation: slide var(--dur-slow) var(--ease-out);
}
.drawer header,
.drawer footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--viz-grid);
}
.drawer footer {
  flex-wrap: wrap;
  justify-content: flex-end;
  border-top: 1px solid var(--viz-grid);
  border-bottom: 0;
}
.drawer h3 {
  flex: 1;
  font-family: var(--font-body);
  font-size: 1.1rem;
  letter-spacing: 0;
}
.x {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--viz-border);
  border-radius: 50%;
  background: none;
  color: var(--viz-text);
  cursor: pointer;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: grid;
  align-content: start;
  gap: 20px;
}
section {
  display: grid;
  gap: 10px;
}
h4 {
  font-family: var(--font-body);
  font-size: 0.9rem;
  letter-spacing: 0;
}
.g3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
label {
  display: grid;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--viz-muted);
}
input,
select,
textarea {
  min-height: 40px;
  padding: 6px 10px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
  font-size: 0.9rem;
}
.chk {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--viz-text);
  font-size: 0.85rem;
}
.chk input {
  min-height: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.feats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px;
}
.photo {
  grid-template-columns: 200px 1fr;
  align-items: center;
}
.preview {
  grid-row: span 2;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.05);
  color: var(--viz-muted);
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  padding: 8px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  color: var(--viz-text);
  cursor: pointer;
}
.upload input {
  display: none;
}
.danger {
  margin-right: auto;
  padding: 0 14px;
  height: 40px;
  border: 1px solid rgb(255 127 118 / 0.4);
  border-radius: 12px;
  background: none;
  color: var(--bad);
  cursor: pointer;
}
.err {
  flex-basis: 100%;
  color: var(--bad);
  font-size: 0.85rem;
}
@keyframes slide {
  from {
    transform: translateX(40px);
    opacity: 0;
  }
}
@media (max-width: 640px) {
  /* car list becomes stacked cards */
  .table {
    overflow: visible;
    border: 0;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  thead {
    display: none;
  }
  tbody {
    display: grid;
    gap: 10px;
  }
  tbody tr {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    padding: 12px;
    border: 1px solid var(--viz-border);
    border-radius: 16px;
    background: var(--viz-surface);
    -webkit-backdrop-filter: var(--viz-glass);
    backdrop-filter: var(--viz-glass);
  }
  tbody td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--viz-grid);
  }
  tbody td[data-label]::before {
    content: attr(data-label);
    color: var(--viz-muted);
    font-size: 0.72rem;
  }
  tbody td.car,
  tbody td.edit-cell {
    grid-column: 1 / -1;
    border-bottom: 0;
  }
  tbody td.car {
    justify-content: flex-start;
    min-width: 0;
  }
  .edit {
    width: 100%;
    padding: 9px;
  }
  .bar {
    flex-wrap: wrap;
  }
  .search {
    flex: 1;
  }
  .search input {
    width: 100%;
    min-width: 0;
  }
  .g3 {
    grid-template-columns: 1fr 1fr;
  }
  .photo {
    grid-template-columns: 1fr;
  }
}
</style>
