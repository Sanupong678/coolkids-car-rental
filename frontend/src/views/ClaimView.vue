<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { claimBooking } from '@/api/bookings'
import { useI18n } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'

// "/claim/<code>": the "follow in LINE" link staff send for a booking they made.
// Opened in LINE the visitor is already signed in with LINE (router guard + LIFF),
// so the booking moves to this account at once and its updates arrive in LINE.
const route = useRoute()
const { t, fmtDate, errorText } = useI18n()
const booking = ref(null)
const error = ref('')

onMounted(async () => {
  try {
    booking.value = await claimBooking(String(route.params.token))
  } catch (err) {
    error.value = errorText(err)
  }
})
</script>

<template>
  <main class="claim">
    <section class="card">
      <template v-if="booking">
        <span class="badge ok"><Icon name="check" :size="26" /></span>
        <h1>{{ t('claim.done') }}</h1>
        <p>{{ t('claim.doneBody') }}</p>
        <dl>
          <div><dt>{{ t('bk.number') }}</dt><dd>{{ booking.number }}</dd></div>
          <div><dt>{{ t('bk.car') }}</dt><dd>{{ booking.vehicle.brand }} {{ booking.vehicle.model }} {{ booking.vehicle.trim }}</dd></div>
          <div><dt>{{ t('bk.pickup') }}</dt><dd>{{ fmtDate(booking.pickupAt) }}</dd></div>
          <div><dt>{{ t('bk.return') }}</dt><dd>{{ fmtDate(booking.returnAt) }}</dd></div>
        </dl>
        <RouterLink :to="{ name: 'booking', params: { number: booking.number } }" class="btn btn-primary btn-pill">{{ t('claim.open') }}</RouterLink>
      </template>
      <template v-else-if="error">
        <span class="badge bad"><Icon name="x" :size="26" /></span>
        <h1>{{ t('claim.failed') }}</h1>
        <p>{{ error }}</p>
        <RouterLink to="/account" class="btn btn-ghost btn-pill">{{ t('acct.title') }}</RouterLink>
      </template>
      <div v-else class="skeleton" style="height: 220px" />
    </section>
  </main>
</template>

<style scoped>
.claim {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 96px var(--gutter) var(--s-8);
}
.card {
  display: grid;
  justify-items: center;
  gap: var(--s-3);
  width: min(460px, 100%);
  padding: var(--s-6) var(--s-5);
  border-radius: var(--r-lg, 20px);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  text-align: center;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-xl);
  font-weight: 700;
}
p {
  color: var(--text-muted);
}
.badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
}
.badge.ok {
  background: #e6f6ee;
  color: #1f6b46;
}
.badge.bad {
  background: #fdeceb;
  color: #a3221a;
}
dl {
  display: grid;
  gap: 6px;
  width: 100%;
  margin: var(--s-2) 0;
  text-align: left;
}
dl div {
  display: flex;
  justify-content: space-between;
  gap: var(--s-3);
  font-size: var(--fs-sm);
}
dt {
  color: var(--text-muted);
}
dd {
  font-weight: 600;
  text-align: right;
}
</style>
