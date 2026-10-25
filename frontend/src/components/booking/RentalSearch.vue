<script setup>
import { computed, reactive, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useSiteStore } from '@/stores/site'
import { rentalDays, toLocalInput } from '@/utils/format'
import { useI18n } from '@/i18n'

// Two presentations of the same rental search:
//  variant="hero"  — dark smoked-glass pill over the homepage hero video
//  variant="steps" — numbered booking progress bar above the fleet listing
const props = defineProps({
  modelValue: { type: Object, required: true }, // { pickup, dropoff, from, to }  (from/to: 'YYYY-MM-DDTHH:mm' local)
  variant: { type: String, default: 'hero' },
  vehicleName: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue', 'search'])

const site = useSiteStore()
const { t, tx } = useI18n()
const form = reactive({ ...props.modelValue })
watch(() => props.modelValue, (v) => Object.assign(form, v), { deep: true })

const locations = computed(() => site.locations)
const days = computed(() => rentalDays(form.from, form.to))
const minDate = computed(() => {
  const d = new Date(Date.now() + 2 * 3_600_000)
  d.setMinutes(0, 0, 0)
  return toLocalInput(d)
})
const invalid = computed(() => form.from && form.to && !(new Date(form.to) > new Date(form.from)))

function submit() {
  if (invalid.value) return
  if (!form.dropoff) form.dropoff = form.pickup
  emit('update:modelValue', { ...form })
  emit('search', { ...form })
}
</script>

<template>
  <!-- HERO: dark glass search pill -->
  <form v-if="variant === 'hero'" class="hero-search" @submit.prevent="submit">
    <label class="f">
      <span class="ico"><Icon name="pin" :size="16" /></span>
      <span class="fx">
        <small>{{ t('search.pickup') }}</small>
        <select v-model="form.pickup" :aria-label="t('search.pickup')">
          <option value="">{{ t('search.pickupDefault') }}</option>
          <option v-for="l in locations" :key="l.id" :value="l.code">{{ tx(l.name) }}</option>
        </select>
      </span>
    </label>
    <label class="f">
      <span class="ico"><Icon name="calendar" :size="16" /></span>
      <span class="fx">
        <small>{{ t('search.from') }}</small>
        <input v-model="form.from" type="datetime-local" :min="minDate" step="1800" :aria-label="t('search.from')" />
      </span>
    </label>
    <label class="f">
      <span class="ico"><Icon name="clock" :size="16" /></span>
      <span class="fx">
        <small>{{ t('search.to') }}</small>
        <input v-model="form.to" type="datetime-local" :min="form.from || minDate" step="1800" :aria-label="t('search.to')" />
      </span>
    </label>
    <button class="go" type="submit" :disabled="invalid">
      {{ t('search.go') }} <span class="go-ico"><Icon name="search" :size="14" /></span>
    </button>
    <p v-if="invalid" class="err" role="alert">{{ t('search.invalid') }}</p>
  </form>

  <!-- STEPS: booking progress bar -->
  <form v-else class="steps" @submit.prevent="submit">
    <div class="step wide">
      <i>1</i>
      <span class="k">{{ t('rs.period') }} <Icon v-if="days" name="check" :size="12" /></span>
      <div class="dates">
        <input v-model="form.from" type="datetime-local" :min="minDate" step="1800" :aria-label="t('rs.pickupAt')" @change="submit" />
        <Icon name="arrow-right" :size="14" />
        <input v-model="form.to" type="datetime-local" :min="form.from || minDate" step="1800" :aria-label="t('rs.returnAt')" @change="submit" />
      </div>
    </div>
    <div class="step">
      <i>2</i>
      <span class="k">{{ t('rs.pickup') }} <Icon v-if="form.pickup" name="check" :size="12" /></span>
      <select v-model="form.pickup" :aria-label="t('rs.pickupLoc')" @change="submit">
        <option value="">{{ t('rs.choose') }}</option>
        <option v-for="l in locations" :key="l.id" :value="l.code">{{ tx(l.name) }}</option>
      </select>
    </div>
    <div class="step">
      <i>3</i>
      <span class="k">{{ t('rs.return') }} <Icon v-if="form.dropoff" name="check" :size="12" /></span>
      <select v-model="form.dropoff" :aria-label="t('rs.returnLoc')" @change="submit">
        <option value="">{{ t('rs.same') }}</option>
        <option v-for="l in locations" :key="l.id" :value="l.code">{{ tx(l.name) }}</option>
      </select>
    </div>
    <div class="step" :class="{ active: !vehicleName }">
      <i>4</i>
      <span class="k">{{ t('rs.vehicle') }}</span>
      <strong>{{ vehicleName ?? t('rs.choose') }}</strong>
    </div>
    <p v-if="invalid" class="err" role="alert">{{ t('rs.invalid') }}</p>
  </form>
</template>

<style scoped>
select,
input {
  background: transparent;
  border: 0;
  color: var(--text);
  font-size: var(--fs-sm);
  padding: 0;
  min-width: 0;
  width: 100%;
  color-scheme: light;
}
select:focus-visible,
input:focus-visible {
  box-shadow: none;
  outline: 1px solid var(--accent);
  outline-offset: 4px;
}
option {
  background: var(--surface);
}
.err {
  grid-column: 1 / -1;
  color: var(--danger);
  font-size: var(--fs-xs);
}

/* ---- hero: dark smoked glass ---- */
.hero-search {
  display: grid;
  grid-template-columns: 1.15fr 1fr 1fr auto;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: var(--r-pill);
  background: linear-gradient(100deg, rgb(28 28 32 / 0.62), rgb(18 18 22 / 0.5));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.1),
    0 30px 60px -30px rgb(0 0 0 / 0.6);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  backdrop-filter: blur(20px) saturate(140%);
  color: #fff;
}
.hero-search select,
.hero-search input {
  color: #fff;
  color-scheme: dark;
  font-weight: 500;
}
.hero-search option {
  background: #1c1c20;
  color: #fff;
}
.f {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 6px 18px 6px 8px;
  border-radius: var(--r-pill);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.f + .f {
  position: relative;
}
.f + .f::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 22%;
  bottom: 22%;
  width: 1px;
  background: rgb(255 255 255 / 0.12);
}
.f:hover {
  background: rgb(255 255 255 / 0.07);
}
.ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.16);
  background: rgb(255 255 255 / 0.06);
  color: rgb(255 255 255 / 0.85);
}
.fx {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.fx small {
  font-size: 0.7rem;
  color: rgb(255 255 255 / 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.go {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 8px 0 22px;
  border: 0;
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 0.92);
  color: #111;
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.go:hover:not(:disabled) {
  background: #fff;
}
.go:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.go-ico {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
}
.hero-search .err {
  padding: 0 1.25rem 4px;
  color: #ff9a92;
}
@media (max-width: 860px) {
  .hero-search {
    grid-template-columns: 1fr 1fr;
    border-radius: 24px;
  }
  .f:first-child {
    grid-column: 1 / -1;
  }
  .f:nth-child(2)::before {
    display: none;
  }
  .go {
    grid-column: 1 / -1;
    justify-content: center;
  }
}
@media (max-width: 560px) {
  .hero-search {
    grid-template-columns: 1fr;
  }
  .f::before {
    display: none;
  }
  .f {
    padding-block: 4px;
  }
  .ico {
    width: 34px;
    height: 34px;
  }
}

/* ---- steps ---- */
.steps {
  display: grid;
  grid-template-columns: 1.7fr repeat(3, 1fr);
  border-block: 1px solid var(--glass-border);
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
}
.step {
  position: relative;
  display: grid;
  align-content: center;
  gap: 4px;
  min-height: 76px;
  padding: 0.75rem 1rem 0.75rem 2.6rem;
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.step:last-of-type {
  border-right: 0;
}
.step i {
  /* oversized faded step number, as in the reference */
  position: absolute;
  left: 0.35rem;
  top: 50%;
  transform: translateY(-50%);
  font-style: normal;
  font-family: var(--font-display);
  font-size: 3.2rem;
  line-height: 1;
  color: rgb(17 18 24 / 0.06);
  pointer-events: none;
}
.k {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.68rem;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-muted);
}
.k :deep(svg) {
  color: var(--success);
}
.step strong {
  font-weight: 500;
  font-size: var(--fs-sm);
}
.step.active {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.dates {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  color: var(--text-muted);
}
@media (max-width: 1100px) {
  .steps {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .step.wide {
    grid-column: 1 / -1;
  }
  .step {
    border-bottom: 1px solid var(--border);
  }
}
@media (max-width: 560px) {
  .steps {
    grid-template-columns: 1fr 1fr;
  }
  /* phones: keep the editable steps, drop the progress-only ones */
  .step:not(.wide):nth-of-type(n + 4) {
    display: none;
  }
  .step {
    min-height: 64px;
  }
  .dates {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
