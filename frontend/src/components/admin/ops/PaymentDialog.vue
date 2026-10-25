<script setup>
import { computed, onMounted, ref } from 'vue'
import { collectPayment, getLedger, returnDeposit } from '@/api/admin'
import { money } from '@/utils/format'
import OpsDialog from './OpsDialog.vue'

// "ชำระเงิน" and "รายได้" on the operations board.
//   collect  → rent balance + security deposit received at hand-over
//   ledger   → every payment on this booking, and the deposit going back
//   (the deposit is returned here too, minus deductions with a reason)
const props = defineProps({ booking: { type: Object, required: true }, mode: { type: String, default: 'collect' } })
const emit = defineEmits(['close', 'saved'])

const l = ref(null)
const busy = ref(false)
const error = ref('')
const method = ref('cash')
const rent = ref(0)
const deposit = ref(0)
const refund = ref(0)
const note = ref('')
const c = computed(() => l.value?.currency ?? 'THB')
const METHOD = { cash: 'เงินสด', transfer: 'โอน', card: 'บัตร' }
const PURPOSE = { RENTAL: 'ค่าเช่า', DEPOSIT: 'เงินมัดจำ', ADDITIONAL_CHARGE: 'ค่าใช้จ่ายเพิ่ม' }
const time = (iso) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

async function load() {
  l.value = await getLedger(props.booking.id)
  rent.value = l.value.rentDueMinor / 100
  deposit.value = l.value.depositCollected ? 0 : l.value.depositMinor / 100
  refund.value = l.value.depositHeldMinor / 100
}
onMounted(() => load().catch((err) => (error.value = err.message)))

const collected = computed(() => l.value && (l.value.paidCounterMinor > 0 || l.value.depositCollected))
const deduction = computed(() => (l.value ? l.value.depositHeldMinor / 100 - Number(refund.value || 0) : 0))

async function run(fn) {
  busy.value = true
  error.value = ''
  try {
    l.value = await fn()
    emit('saved', l.value)
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
const collect = () =>
  run(() => collectPayment(props.booking.id, { method: method.value, rentMinor: Math.round(Number(rent.value) * 100), depositMinor: Math.round(Number(deposit.value) * 100) }))
const giveBack = () =>
  run(() => returnDeposit(props.booking.id, { refundMinor: Math.round(Number(refund.value) * 100), note: note.value.trim() || undefined }))
</script>

<template>
  <OpsDialog :title="`${mode === 'ledger' ? 'รายได้' : 'ชำระเงิน'} — ${booking.number}`" :icon="mode === 'ledger' ? 'chart' : 'receipt'" @close="emit('close')">
    <div v-if="!l && !error" class="hint">กำลังโหลด…</div>
    <template v-if="l">
      <dl class="sum">
        <div><dt>ค่าเช่า + ค่าส่ง</dt><dd>{{ money(l.totalMinor, c) }}</dd></div>
        <div><dt>จ่ายออนไลน์ (ค่าจอง)</dt><dd class="paid">−{{ money(l.paidOnlineMinor, c) }}</dd></div>
        <div v-if="l.paidCounterMinor"><dt>รับที่หน้าร้าน</dt><dd class="paid">−{{ money(l.paidCounterMinor, c) }}</dd></div>
        <div class="due"><dt>ค่าเช่าคงเหลือ</dt><dd>{{ money(l.rentDueMinor, c) }}</dd></div>
        <div><dt>เงินมัดจำ</dt><dd>{{ money(l.depositMinor, c) }} <small v-if="l.depositCollected">รับแล้ว</small></dd></div>
      </dl>

      <!-- collect at hand-over -->
      <form v-if="mode === 'collect' && !collected" class="grid" @submit.prevent="collect">
        <div class="seg" role="radiogroup" aria-label="วิธีรับเงิน">
          <button v-for="(t, k) in METHOD" :key="k" type="button" :class="{ on: method === k }" @click="method = k">{{ t }}</button>
        </div>
        <div class="two">
          <label class="f">ค่าเช่าที่รับ (บาท)<input v-model.number="rent" type="number" min="0" step="1" /></label>
          <label class="f">เงินมัดจำที่รับ (บาท)<input v-model.number="deposit" type="number" min="0" step="1" /></label>
        </div>
        <p class="total">รวมรับวันนี้ <b>{{ money(Math.round((Number(rent) + Number(deposit)) * 100), c) }}</b></p>
        <button type="submit" class="primary" :disabled="busy">{{ busy ? 'กำลังบันทึก…' : 'รับเงินค่าเช่าและมัดจำแล้ว' }}</button>
      </form>

      <!-- deposit back (after the car is returned) -->
      <form v-if="l.depositCollected && !l.depositReturnedAt && (mode === 'ledger' || collected)" class="grid box" @submit.prevent="giveBack">
        <h4>คืนเงินมัดจำ</h4>
        <label class="f">ยอดที่คืนลูกค้า (บาท)<input v-model.number="refund" type="number" min="0" :max="l.depositHeldMinor / 100" step="1" /></label>
        <label v-if="deduction > 0" class="f">เหตุผลที่หัก {{ money(Math.round(deduction * 100), c) }}<input v-model="note" type="text" maxlength="500" placeholder="เช่น เติมน้ำมันไม่เต็มถัง, ค่าทำความสะอาด" /></label>
        <button type="submit" class="primary" :disabled="busy || (deduction > 0 && !note.trim())">คืนมัดจำแล้ว</button>
      </form>
      <p v-if="l.depositReturnedAt" class="ok">
        คืนมัดจำเมื่อ {{ time(l.depositReturnedAt) }}<template v-if="l.depositDeductionMinor"> · หัก {{ money(l.depositDeductionMinor, c) }} ({{ l.depositNote }})</template>
      </p>

      <!-- every payment -->
      <table v-if="mode === 'ledger' || collected" class="tx">
        <tr v-for="p in l.payments" :key="p.id">
          <td>{{ time(p.at) }}</td>
          <td>{{ PURPOSE[p.purpose] ?? p.purpose }} · {{ p.channel === 'online' ? 'ออนไลน์' : METHOD[p.method] ?? 'หน้าร้าน' }}</td>
          <td class="num">{{ money(p.amountMinor, c) }}<small v-if="p.refundedMinor"> (คืน {{ money(p.refundedMinor, c) }})</small></td>
        </tr>
        <tr v-if="!l.payments.length"><td colspan="3" class="hint">ยังไม่มีการรับเงิน</td></tr>
      </table>
    </template>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </OpsDialog>
</template>

<style scoped>
.sum {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 14px;
  border-radius: 14px;
  background: #f2f3f5;
  font-size: 0.9rem;
}
.sum div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.sum dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.sum .paid {
  color: #1f8a56;
}
.sum .due {
  padding-top: 6px;
  border-top: 1px dashed #c9ccd4;
  font-weight: 700;
}
.sum small {
  color: #1f8a56;
  font-weight: 600;
}
.grid {
  display: grid;
  gap: 12px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.total {
  text-align: right;
}
.box {
  padding: 14px;
  border: 1px solid #e3e5ec;
  border-radius: 14px;
}
h4 {
  font-size: 0.95rem;
}
.tx {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.tx td {
  padding: 8px 4px;
  border-bottom: 1px solid #ececee;
}
.tx .num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 420px) {
  .two {
    grid-template-columns: 1fr;
  }
}
</style>
