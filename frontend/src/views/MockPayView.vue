<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { completeMockPayment, getMockPayment } from '@/api/bookings'
import { money } from '@/utils/format'

// Development-only stand-in for the payment gateway's hosted checkout. The API
// refuses this flow in production; with STRIPE_SECRET_KEY set, customers go to
// Stripe Checkout instead and never see this page.
const route = useRoute()
const router = useRouter()
const p = ref(null)
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    p.value = await getMockPayment(route.params.id)
  } catch (err) {
    error.value = err.message
  }
})

async function finish(outcome) {
  busy.value = true
  try {
    const { bookingNumber } = await completeMockPayment(route.params.id, outcome)
    router.replace({ name: 'booking', params: { number: bookingNumber }, query: outcome === 'success' ? { paid: '1' } : {} })
  } catch (err) {
    error.value = err.message
    busy.value = false
  }
}
</script>

<template>
  <main class="mock">
    <div class="card">
      <span class="tag">TEST MODE · ระบบชำระเงินทดสอบ</span>
      <template v-if="p">
        <h1>{{ money(p.amountMinor, p.currency) }}</h1>
        <p>{{ p.vehicle }} · {{ p.bookingNumber }}</p>
        <div class="cardnum">
          <span>4242 4242 4242 4242</span>
          <small>12/34 · 123</small>
        </div>
        <button type="button" class="pay" :disabled="busy || p.status === 'SUCCEEDED'" @click="finish('success')">ชำระเงินสำเร็จ (จำลอง)</button>
        <button type="button" class="decline" :disabled="busy" @click="finish('fail')">จำลองการชำระเงินไม่สำเร็จ</button>
        <small class="note">หน้านี้ใช้ทดสอบระหว่างพัฒนาเท่านั้น เมื่อใส่ STRIPE_SECRET_KEY ลูกค้าจะไปหน้าชำระเงินจริงของ Stripe</small>
      </template>
      <p v-else-if="error" class="err">{{ error }}</p>
    </div>
  </main>
</template>

<style scoped>
.mock {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 96px 16px 48px;
  background: #eef0f4;
}
.card {
  display: grid;
  gap: 14px;
  width: min(420px, 100%);
  padding: 28px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 60px -30px rgb(0 0 0 / 0.35);
  text-align: center;
}
.tag {
  justify-self: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #fff4d6;
  color: #8a5a00;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
h1 {
  font-family: var(--font-display);
  font-size: 2.2rem;
  font-weight: 500;
}
p {
  color: #6b6e7a;
}
.cardnum {
  display: grid;
  gap: 4px;
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1b1e29, #3a3d4c);
  color: #fff;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.1em;
}
.cardnum small {
  opacity: 0.7;
}
.pay,
.decline {
  height: 48px;
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
}
.pay {
  border: 0;
  background: #635bff;
  color: #fff;
}
.decline {
  border: 1px solid #dcdee3;
  background: #fff;
  color: #4b5060;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.note {
  color: #8d909b;
  font-size: 0.75rem;
}
.err {
  color: #c22a21;
}
</style>
