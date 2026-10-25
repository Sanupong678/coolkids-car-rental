<script setup>
import { computed } from 'vue'

// One LINE Flex Message component (box / text / image / button / separator /
// spacer), rendered with LINE's own size and spacing scales so the demo looks
// like the real chat. Only the parts the Coolkids bot uses are supported.
defineOptions({ name: 'FlexNode' })
const props = defineProps({
  node: { type: Object, required: true },
  parentLayout: { type: String, default: 'vertical' },
})
const emit = defineEmits(['action'])

const SPACE = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 }
const FONT = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35 }
const px = (v, scale = SPACE) => (v == null ? undefined : scale[v] != null ? `${scale[v]}px` : v)

const n = computed(() => props.node)
const inRow = computed(() => props.parentLayout !== 'vertical')
// Inside a horizontal box every component takes flex 1 unless told otherwise.
const flex = computed(() => {
  const f = n.value.flex ?? (inRow.value ? 1 : 0)
  return f === 0 ? '0 0 auto' : `${f} 1 0`
})

const style = computed(() => {
  const s = { flex: flex.value, marginTop: !inRow.value ? px(n.value.margin) : undefined, marginLeft: inRow.value ? px(n.value.margin) : undefined }
  if (n.value.type === 'box') {
    Object.assign(s, {
      display: 'flex',
      flexDirection: n.value.layout === 'vertical' ? 'column' : 'row',
      alignItems: n.value.layout === 'baseline' ? 'baseline' : undefined,
      justifyContent: n.value.justifyContent,
      gap: px(n.value.spacing),
      padding: px(n.value.paddingAll),
      backgroundColor: n.value.backgroundColor,
      minWidth: 0,
    })
  }
  if (n.value.type === 'text') {
    Object.assign(s, {
      fontSize: `${FONT[n.value.size ?? 'md'] ?? 16}px`,
      fontWeight: n.value.weight === 'bold' ? 700 : 400,
      color: n.value.color ?? '#111111',
      textAlign: n.value.align,
      textDecoration: n.value.decoration === 'line-through' ? 'line-through' : undefined,
      whiteSpace: n.value.wrap ? 'pre-wrap' : 'nowrap',
      overflow: 'hidden',
      textOverflow: n.value.wrap ? undefined : 'ellipsis',
      display: n.value.maxLines ? '-webkit-box' : undefined,
      WebkitLineClamp: n.value.maxLines,
      WebkitBoxOrient: n.value.maxLines ? 'vertical' : undefined,
      minWidth: 0,
    })
  }
  return s
})
const button = computed(() => {
  const st = n.value.style ?? 'link'
  return {
    flex: flex.value,
    marginTop: !inRow.value ? px(n.value.margin) : undefined,
    height: n.value.height === 'sm' ? '40px' : '52px',
    background: st === 'primary' ? (n.value.color ?? '#17C950') : st === 'secondary' ? (n.value.color ?? '#F0F0F0') : 'transparent',
    color: st === 'primary' ? '#fff' : st === 'secondary' ? '#111' : (n.value.color ?? '#42659A'),
  }
})
</script>

<template>
  <div v-if="n.type === 'box'" :style="style">
    <FlexNode v-for="(c, i) in n.contents" :key="i" :node="c" :parent-layout="n.layout" @action="emit('action', $event)" />
  </div>
  <span v-else-if="n.type === 'text'" class="t" :style="style">{{ n.text }}</span>
  <img
    v-else-if="n.type === 'image'"
    :src="n.url"
    alt=""
    :style="{ flex, width: '100%', aspectRatio: (n.aspectRatio ?? '1:1').replace(':', '/'), objectFit: n.aspectMode === 'cover' ? 'cover' : 'contain', display: 'block' }"
  />
  <button v-else-if="n.type === 'button'" type="button" class="b" :style="button" @click="emit('action', n.action)">{{ n.action?.label }}</button>
  <hr v-else-if="n.type === 'separator'" class="sep" :style="{ marginTop: px(n.margin) }" />
  <span v-else-if="n.type === 'spacer'" :style="{ height: px(n.size ?? 'md') }" />
</template>

<style scoped>
.t {
  line-height: 1.4;
}
.b {
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.b:focus-visible {
  outline: 3px solid #06c755;
  outline-offset: 2px;
}
.sep {
  width: 100%;
  border: 0;
  border-top: 1px solid #e5e5e5;
}
</style>
