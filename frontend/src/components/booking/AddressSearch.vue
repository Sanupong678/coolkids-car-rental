<script setup>
import { computed, ref } from 'vue'
import { quoteDelivery } from '@/api/bookings'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'
import { t } from '@/i18n'
import MapPicker from './MapPicker.vue'

// Where we deliver the car. The customer drops a pin on the map (search a
// place, use GPS, or drag the map), then the server returns distance, drive
// time and the delivery fee of this car (set by staff on the fleet form, else
// the shop default) — the browser never computes prices.
const emit = defineEmits(['quote'])
const props = defineProps({
  quote: { type: Object, default: null },
  vehicleSlug: { type: String, default: null },
  policy: { type: Object, default: null }, // { freeKm, perKmMinor, minFeeMinor } to explain the fee
})

const open = ref(false)
const busy = ref(false)
const error = ref('')
const pin = computed(() => (props.quote?.lat != null ? { lat: props.quote.lat, lng: props.quote.lng } : null))

async function onPick({ address, lat, lng }) {
  busy.value = true
  error.value = ''
  emit('quote', null)
  try {
    const q = await quoteDelivery({ lat, lng, address }, props.vehicleSlug)
    emit('quote', { ...q, address: address || q.address, lat, lng })
  } catch (err) {
    error.value = err.details?.address?.[0] ?? err.message
  } finally {
    busy.value = false
  }
}
const km = (m) => (m / 1000).toFixed(1)
</script>

<template>
  <div class="addr">
    <button type="button" class="pick" :class="{ ok: quote }" :disabled="busy" @click="open = true">
      <Icon name="pin" :size="18" />
      <span v-if="busy" class="txt muted">{{ t('addr.quoting') }}</span>
      <span v-else-if="quote" class="txt">{{ quote.address }}</span>
      <span v-else class="txt muted">{{ t('addr.pin') }}</span>
      <span class="act">{{ t(quote ? 'addr.change' : 'addr.open') }}</span>
    </button>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-if="quote" class="quote">
      <span><Icon name="road" :size="14" /> {{ t('addr.km', { n: km(quote.distanceMeters) }) }}</span>
      <span><Icon name="clock" :size="14" /> {{ t('addr.min', { n: Math.round(quote.durationSeconds / 60) }) }}</span>
      <span><Icon name="receipt" :size="14" /> {{ quote.feeMinor ? t('addr.fee', { fee: money(quote.feeMinor, 'THB') }) : t('addr.freeDelivery') }}</span>
      <small v-if="quote.source === 'estimate'">{{ t('addr.estimate') }}</small>
    </div>
    <p v-if="policy" class="note">
      {{ t('addr.policy', { km: policy.freeKm, price: money(policy.perKmMinor, 'THB') }) }}<template v-if="policy.minFeeMinor">{{ t('addr.minFee', { fee: money(policy.minFeeMinor, 'THB') }) }}</template>
    </p>
    <MapPicker v-if="open" :title="t('addr.mapTitle')" :start="pin" @pick="onPick" @close="open = false" />
  </div>
</template>

<style scoped>
.addr {
  display: grid;
  gap: 8px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 8px 12px;
  border: 1px solid #dcdee3;
  border-radius: 12px;
  background: #fff;
  color: #121319;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.pick.ok {
  border-color: #3fa877;
}
.pick :deep(svg) {
  flex: none;
  color: #e2362c;
}
.pick:focus-visible {
  outline: 3px solid rgb(226 54 44 / 0.25);
}
.txt {
  flex: 1;
  min-width: 0;
  font-size: 0.92rem;
}
.muted {
  color: #6b6e7a;
}
.act {
  flex: none;
  padding: 6px 12px;
  border-radius: 999px;
  background: #fff5f4;
  color: #c22a21;
  font-size: 0.8rem;
  font-weight: 700;
}
.quote {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #eef8f2;
  color: #1f6b46;
  font-size: 0.85rem;
}
.quote span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.quote small {
  color: #4b5060;
}
.note {
  font-size: 0.78rem;
  color: #6b6e7a;
}
.err {
  font-size: 0.82rem;
  color: #c22a21;
}
</style>
