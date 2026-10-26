<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { listMyBookings } from '@/api/bookings'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/utils/format'
import { t, intlLocale } from '@/i18n'
import CancelBookingDialog from '@/components/booking/CancelBookingDialog.vue'

// "การจองของฉัน" — the signed-in customer's bookings, newest first.
// Bookings not yet being prepared can be cancelled here (b.canCancel, decided by the server),
// e.g. to switch to another car.
const auth = useAuthStore()
const bookings = ref(null)
const asking = ref(null) // the booking whose cancel dialog is open
const done = ref('')

onMounted(async () => {
  bookings.value = await listMyBookings().catch(() => [])
})

function onCancelled(updated) {
  bookings.value = bookings.value.map((b) => (b.id === updated.id ? updated : b))
  done.value = t('acct.cancelled', { number: updated.number })
  asking.value = null
}

const TONE = { PENDING: 'warn', CONFIRMED: 'ok', PREPARING: 'ok', READY: 'ok', IN_DELIVERY: 'ok', ACTIVE: 'ok', COMPLETED: 'muted', CANCELLED: 'bad', REFUNDED: 'muted', EXPIRED: 'muted' }
const fmt = (iso) => new Date(iso).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: '2-digit' })
</script>

<template>
  <main class="account">
    <div class="wrap">
      <header>
        <h1>{{ t('acct.title') }}</h1>
        <p>{{ auth.me?.fullName }} · {{ auth.me?.email }}</p>
      </header>
      <div v-if="!bookings" class="skeleton" style="height: 200px" />
      <div v-else-if="!bookings.length" class="empty">
        <p>{{ t('acct.none') }}</p>
        <RouterLink to="/vehicles" class="btn btn-primary btn-pill">{{ t('acct.pick') }}</RouterLink>
      </div>
      <p v-if="done" class="done" role="status">
        {{ done }}
        <RouterLink to="/vehicles" class="btn btn-primary btn-pill">{{ t('acct.pickAnother') }}</RouterLink>
      </p>
      <ul v-if="bookings?.length" class="list">
        <li v-for="b in bookings" :key="b.id">
          <RouterLink :to="{ name: 'booking', params: { number: b.number } }">
            <img v-if="b.vehicle.image" :src="b.vehicle.image.variants?.w640 ?? b.vehicle.image.url" alt="" />
            <div class="info">
              <strong>{{ b.vehicle.brand }} {{ b.vehicle.model }}</strong>
              <small>{{ b.number }} · {{ fmt(b.pickupAt) }} – {{ fmt(b.returnAt) }}</small>
            </div>
            <span class="pill" :class="TONE[b.status]">{{ TONE[b.status] ? t(`acct.s.${b.status}`) : b.status }}</span>
            <b>{{ money(b.money.totalMinor, b.money.currency) }}</b>
          </RouterLink>
          <div v-if="b.canCancel" class="row-foot">
            <small>{{ t('acct.cancelHint') }}</small>
            <button type="button" class="cancel" @click="asking = b">{{ t('acct.cancel') }}</button>
          </div>
        </li>
      </ul>
    </div>

    <CancelBookingDialog v-if="asking" :booking="asking" @close="asking = null" @cancelled="onCancelled" />
  </main>
</template>

<style scoped>
.account {
  min-height: 100dvh;
  padding: 96px var(--gutter) var(--s-8);
}
.wrap {
  display: grid;
  gap: var(--s-5);
  max-width: 860px;
  margin-inline: auto;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-2xl);
  font-weight: 700;
}
header p {
  color: var(--text-muted);
}
.list {
  display: grid;
  gap: var(--s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
/* each booking is one card: the row links to its page, the footer holds the cancel button */
.list li {
  display: grid;
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.list a {
  display: grid;
  grid-template-columns: 96px 1fr auto auto;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-4);
}
.row-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2) var(--s-3);
  padding: var(--s-2) var(--s-4) var(--s-3);
  border-top: 1px solid #eeeef0;
}
.row-foot small {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.list img {
  width: 96px;
  aspect-ratio: 16 / 10;
  object-fit: contain;
}
.info {
  display: grid;
}
.info small {
  color: var(--text-muted);
}
.pill {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: var(--fs-xs);
  font-weight: 600;
  background: #ececee;
}
.pill.ok {
  background: #e6f6ee;
  color: #1f6b46;
}
.pill.warn {
  background: #fdf3e2;
  color: #8a5a00;
}
.pill.bad {
  background: #fdeceb;
  color: #a3221a;
}
.cancel {
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid #e8b4b0;
  border-radius: 999px;
  background: #fff;
  color: #a3221a;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}
.cancel:hover {
  background: #fdeceb;
}
.done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);
  border-radius: var(--r-md);
  background: #e6f6ee;
  color: #1f6b46;
}
.empty {
  display: grid;
  justify-items: center;
  gap: var(--s-3);
  padding: var(--s-7);
  color: var(--text-muted);
}
@media (max-width: 600px) {
  .list a {
    grid-template-columns: 72px 1fr;
  }
  .list img {
    width: 72px;
  }
}
</style>
