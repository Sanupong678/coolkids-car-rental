<script setup>
import { computed, reactive } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { label, money } from '@/utils/format'
import { t, catName } from '@/i18n'

// Left filter rail (reference: "Choose your vehicle" sidebar). Emits a new
// filter object on every change; the parent syncs it to the URL.
const props = defineProps({
  modelValue: { type: Object, required: true },
  facets: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'close'])

const open = reactive({ price: true, category: true, gear: true, fuel: true, seats: false, drive: false, brand: false })

// Price buckets in minor units. Each pick is sent as its own "min-max" range
// and the API ORs them, so non-adjacent buckets stack correctly.
const BUCKETS = [
  [0, 130000],
  [130000, 200000],
  [200000, 300000],
  [300000, null],
]
const bucketKey = ([a, b]) => `${a}-${b ?? ''}`
const currency = computed(() => props.facets?.ranges?.currency ?? 'USD')
const bucketLabel = ([a, b]) => (b == null ? `${money(a, currency.value)} +` : `${money(a, currency.value)} – ${money(b, currency.value)}`)

const has = (key, value) => (props.modelValue[key] ?? []).includes(value)
function toggle(key, value) {
  const list = new Set(props.modelValue[key] ?? [])
  list.has(value) ? list.delete(value) : list.add(value)
  update({ [key]: [...list] })
}
function update(patch) {
  // drop legacy single-range params so they can't silently narrow the stacked buckets
  emit('update:modelValue', { ...props.modelValue, priceMin: undefined, priceMax: undefined, ...patch, page: 1 })
}
function clearAll() {
  emit('update:modelValue', { sort: props.modelValue.sort, page: 1 })
}

const CATEGORY_ICON = { family: 'suv', 'fuel-efficient': 'leaf', sports: 'flag' }
const activeCount = computed(
  () =>
    ['price', 'category', 'brand', 'transmission', 'fuel', 'drive'].reduce((n, k) => n + (props.modelValue[k]?.length ?? 0), 0) +
    (props.modelValue.seats ? 1 : 0) +
    (props.modelValue.priceMin != null || props.modelValue.priceMax != null ? 1 : 0),
)
</script>

<template>
  <aside class="rail" :aria-label="t('filter.title')">
    <header>
      <h2>{{ t('filter.title') }}</h2>
      <button v-if="activeCount" type="button" class="clear" @click="clearAll">{{ t('filter.clearAll', { n: activeCount }) }}</button>
      <button type="button" class="close" :aria-label="t('filter.close')" @click="emit('close')"><Icon name="x" /></button>
    </header>

    <section>
      <button type="button" class="h" :aria-expanded="open.price" @click="open.price = !open.price">
        {{ t('filter.price') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.price }" />
      </button>
      <div v-show="open.price" class="opts">
        <label v-for="(b, i) in BUCKETS" :key="i" class="opt">
          <input type="checkbox" :checked="has('price', bucketKey(b))" @change="toggle('price', bucketKey(b))" />
          <span class="box"><Icon name="check" :size="12" :stroke="2.5" /></span>
          {{ bucketLabel(b) }}
        </label>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.category" @click="open.category = !open.category">
        {{ t('filter.category') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.category }" />
      </button>
      <div v-show="open.category" class="opts list">
        <button
          v-for="c in facets?.categories ?? []"
          :key="c.slug"
          type="button"
          class="row"
          :class="{ on: has('category', c.slug) }"
          :aria-pressed="has('category', c.slug)"
          @click="toggle('category', c.slug)"
        >
          <Icon :name="CATEGORY_ICON[c.slug] ?? 'car'" :size="16" />
          <span>{{ catName(c) }}</span>
          <small>{{ c.count }}</small>
          <Icon v-if="has('category', c.slug)" name="check" :size="14" class="tick" />
        </button>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.gear" @click="open.gear = !open.gear">
        {{ t('filter.gear') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.gear }" />
      </button>
      <div v-show="open.gear" class="opts seg">
        <button
          v-for="g in ['AUTOMATIC', 'MANUAL']"
          :key="g"
          type="button"
          :class="{ on: has('transmission', g) }"
          :aria-pressed="has('transmission', g)"
          @click="toggle('transmission', g)"
        >
          {{ label(g) }}
        </button>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.fuel" @click="open.fuel = !open.fuel">
        {{ t('filter.fuel') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.fuel }" />
      </button>
      <div v-show="open.fuel" class="opts">
        <label v-for="f in ['PETROL', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC']" :key="f" class="opt">
          <input type="checkbox" :checked="has('fuel', f)" @change="toggle('fuel', f)" />
          <span class="box"><Icon name="check" :size="12" :stroke="2.5" /></span>
          {{ label(f) }}
        </label>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.seats" @click="open.seats = !open.seats">
        {{ t('filter.seats') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.seats }" />
      </button>
      <div v-show="open.seats" class="opts seg">
        <button
          v-for="n in [2, 4, 5, 7]"
          :key="n"
          type="button"
          :class="{ on: modelValue.seats === n }"
          :aria-pressed="modelValue.seats === n"
          @click="update({ seats: modelValue.seats === n ? undefined : n })"
        >
          {{ n }}+
        </button>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.drive" @click="open.drive = !open.drive">
        {{ t('filter.drive') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.drive }" />
      </button>
      <div v-show="open.drive" class="opts seg">
        <button
          v-for="d in ['FWD', 'RWD', 'AWD', '4WD']"
          :key="d"
          type="button"
          :class="{ on: has('drive', d) }"
          :aria-pressed="has('drive', d)"
          @click="toggle('drive', d)"
        >
          {{ d }}
        </button>
      </div>
    </section>

    <section>
      <button type="button" class="h" :aria-expanded="open.brand" @click="open.brand = !open.brand">
        {{ t('filter.brand') }} <Icon name="chevron-down" :size="16" :class="{ flip: open.brand }" />
      </button>
      <div v-show="open.brand" class="opts">
        <label v-for="b in facets?.brands ?? []" :key="b.name" class="opt">
          <input type="checkbox" :checked="has('brand', b.name)" @change="toggle('brand', b.name)" />
          <span class="box"><Icon name="check" :size="12" :stroke="2.5" /></span>
          {{ b.name }} <small>{{ b.count }}</small>
        </label>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.rail {
  background: var(--surface);
  border-right: 1px solid var(--border);
}
header {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-5);
  border-bottom: 1px solid var(--border);
}
h2 {
  font-family: var(--font-body);
  font-size: var(--fs-xl);
  font-weight: 600;
  letter-spacing: 0;
  margin-right: auto;
}
.clear {
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.clear:hover {
  color: var(--accent);
}
.close {
  display: none;
  border: 0;
  background: none;
  cursor: pointer;
}
section {
  border-bottom: 1px solid var(--border);
}
.h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: var(--s-4) var(--s-5);
  border: 0;
  background: none;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
}
.h svg {
  transition: transform var(--dur-base) var(--ease-out);
}
.h svg.flip {
  transform: rotate(180deg);
}
.opts {
  display: grid;
  gap: 2px;
  padding: 0 var(--s-5) var(--s-4);
}
.opt {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 6px 0;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.opt small {
  margin-left: auto;
  color: var(--text-muted);
}
.opt input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.box {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: transparent;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.opt input:checked + .box {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}
.opt input:focus-visible + .box {
  box-shadow: var(--focus-ring);
}
.list {
  padding-inline: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  padding: 10px var(--s-5);
  border: 0;
  background: none;
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
  color: var(--text-muted);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.row span {
  flex: 1;
}
.row:hover {
  color: var(--text);
  background: rgb(255 255 255 / 0.03);
}
.row.on {
  color: var(--text);
  background: rgb(255 255 255 / 0.06);
}
.row small {
  color: var(--text-muted);
}
.tick {
  color: var(--accent);
}
.seg {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.seg button {
  padding: 6px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: none;
  font-size: var(--fs-xs);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.seg button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}
@media (max-width: 960px) {
  .close {
    display: block;
  }
}
</style>
