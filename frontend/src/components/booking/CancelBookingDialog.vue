<script setup>
import { ref } from 'vue'
import { cancelBooking } from '@/api/bookings'
import { useI18n } from '@/i18n'

// "ยกเลิกการจอง" confirmation, shared by My bookings and the booking status page.
// Emits `cancelled` with the updated booking; the server decides what may be cancelled.
const props = defineProps({ booking: { type: Object, required: true } })
const emit = defineEmits(['close', 'cancelled'])
const { t, intlLocale, errorText } = useI18n()

const reason = ref('')
const busy = ref(false)
const error = ref('')
const fmt = (iso) => new Date(iso).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: '2-digit' })

async function confirm() {
  busy.value = true
  error.value = ''
  try {
    emit('cancelled', await cancelBooking(props.booking.number, reason.value.trim() || undefined))
  } catch (err) {
    error.value = errorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="scrim" @click.self="!busy && emit('close')">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title">
      <h2 id="cancel-title">{{ t('acct.cancelTitle', { number: booking.number }) }}</h2>
      <p>{{ t('acct.cancelBody', { car: `${booking.vehicle.brand} ${booking.vehicle.model}`, dates: `${fmt(booking.pickupAt)} – ${fmt(booking.returnAt)}` }) }}</p>
      <p class="muted">{{ t('acct.cancelPaid') }}</p>
      <label>
        <span>{{ t('acct.cancelReason') }}</span>
        <input v-model="reason" type="text" maxlength="300" :placeholder="t('acct.cancelReasonPh')" />
      </label>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost btn-pill" :disabled="busy" @click="emit('close')">{{ t('acct.keep') }}</button>
        <button type="button" class="btn btn-pill danger" :disabled="busy" @click="confirm">{{ t('acct.cancelConfirm') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: var(--gutter);
  background: rgb(0 0 0 / 0.45);
}
.dialog {
  display: grid;
  gap: var(--s-3);
  width: min(440px, 100%);
  padding: var(--s-5);
  border-radius: var(--r-lg, 20px);
  background: var(--surface);
  box-shadow: var(--shadow-lg, 0 20px 50px rgb(0 0 0 / 0.25));
}
h2 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
}
.muted {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
label {
  display: grid;
  gap: 4px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
input {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #dcdee3;
  border-radius: 12px;
  font: inherit;
  color: var(--text);
}
.err {
  color: #a3221a;
  font-size: var(--fs-sm);
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.danger {
  background: #c22a21;
  color: #fff;
}
</style>
