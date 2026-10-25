<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { documentUrl, uploadDocument } from '@/api/bookings'
import { shrinkImage } from '@/utils/image'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

// Photos of the renter's ID / passport and driving licence. On a phone the
// tiles open the camera; photos are shrunk in the browser, then stored in
// private storage. Thumbnails are fetched through the API (never a public URL).
const props = defineProps({
  number: { type: String, required: true },
  documents: { type: Object, required: true }, // { required, optional, uploaded, complete }
  editable: { type: Boolean, default: true },
})
const emit = defineEmits(['updated'])
const { t, errorText } = useI18n()

// [title, hint] per photo, in the chosen language.
const LABELS = computed(() => Object.fromEntries(['id_front', 'id_back', 'license_front', 'driver2_id', 'driver2_license', 'reference'].map((k) => [k, t(`docs.${k}`)])))
const groups = computed(() =>
  [
    { title: t('docs.driver1'), note: t('docs.required'), kinds: props.documents.required },
    { title: t('docs.driver2'), note: t('docs.ifAny'), kinds: props.documents.optional ?? [] },
  ].filter((g) => g.kinds.length && (props.editable || g.kinds.some((k) => props.documents.uploaded[k]))),
)
const previews = ref({})
const busy = ref(null)
const error = ref('')

async function loadPreview(kind) {
  const res = await fetch(documentUrl(props.number, kind), { credentials: 'include' })
  if (!res.ok) return
  if (previews.value[kind]) URL.revokeObjectURL(previews.value[kind])
  previews.value = { ...previews.value, [kind]: URL.createObjectURL(await res.blob()) }
}
watch(
  () => props.documents,
  (d) => [...d.required, ...(d.optional ?? [])].forEach((k) => d.uploaded[k] && !previews.value[k] && loadPreview(k)),
  { immediate: true },
)
onBeforeUnmount(() => Object.values(previews.value).forEach((u) => URL.revokeObjectURL(u)))

async function pick(kind, e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  busy.value = kind
  error.value = ''
  try {
    const result = await uploadDocument(props.number, kind, await shrinkImage(file))
    await loadPreview(kind)
    emit('updated', result)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section class="docs">
    <header>
      <h2>{{ t('docs.title') }}</h2>
      <span class="state" :class="{ ok: documents.complete }">
        <Icon :name="documents.complete ? 'check' : 'clock'" :size="13" />
        {{ documents.complete ? t('docs.complete') : t('docs.progress', { done: documents.required.filter((k) => documents.uploaded[k]).length, total: documents.required.length }) }}
      </span>
    </header>
    <p class="lede">{{ t('docs.lede') }}</p>

    <template v-for="g in groups" :key="g.title">
    <h3 v-if="groups.length > 1" class="group">{{ g.title }} <small>{{ g.note }}</small></h3>
    <div class="tiles">
      <label v-for="kind in g.kinds.filter((k) => editable || documents.uploaded[k])" :key="kind" class="tile" :class="{ done: documents.uploaded[kind], busy: busy === kind, locked: !editable }">
        <input
          v-if="editable"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :capture="kind === 'reference' ? undefined : 'environment'"
          :disabled="busy !== null"
          @change="pick(kind, $event)"
        />
        <img v-if="previews[kind]" :src="previews[kind]" :alt="LABELS[kind][0]" />
        <span v-else class="ph"><Icon name="camera" :size="26" /></span>
        <span class="cap">
          <strong>{{ LABELS[kind][0] }}</strong>
          <small>{{ LABELS[kind][1] }}</small>
        </span>
        <span v-if="editable" class="act">
          <span v-if="busy === kind" class="spinner" :aria-label="t('docs.uploading')" />
          <template v-else>{{ t(documents.uploaded[kind] ? 'docs.retake' : 'docs.take') }}</template>
        </span>
      </label>
    </div>
    </template>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.docs {
  display: grid;
  gap: var(--s-3);
  padding: var(--s-5);
  border-radius: var(--r-lg);
  background: var(--surface);
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.group {
  font-size: var(--fs-sm);
  font-weight: 600;
}
.group small {
  margin-left: 6px;
  color: var(--text-muted);
  font-weight: 400;
}
h2 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0;
}
.state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgb(243 182 100 / 0.16);
  color: #b7791f;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.state.ok {
  background: rgb(47 143 98 / 0.14);
  color: #1f7a4d;
}
.lede {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--s-3);
}
.tile {
  position: relative;
  display: grid;
  grid-template-rows: 120px auto auto;
  gap: 8px;
  padding: 10px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.tile:hover:not(.locked) {
  border-color: var(--accent);
}
.tile.done {
  border-style: solid;
}
.tile.locked {
  cursor: default;
}
.tile input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.tile:focus-within {
  box-shadow: 0 0 0 2px var(--accent);
}
.tile img,
.ph {
  width: 100%;
  height: 120px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--surface-raised);
}
.ph {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.cap {
  display: grid;
}
.cap strong {
  font-size: var(--fs-sm);
  font-weight: 600;
}
.cap small {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.act {
  display: grid;
  place-items: center;
  height: 34px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.tile.done .act {
  background: var(--surface-raised);
  color: var(--text);
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgb(255 255 255 / 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.err {
  color: var(--danger);
  font-size: var(--fs-sm);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
