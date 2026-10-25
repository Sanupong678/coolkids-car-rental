<script setup>
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

// Night feature strip (rRw reference): four promises in a row, one lit.
const props = defineProps({ section: { type: Object, required: true } })
const { tc } = useI18n()
const items = computed(() => props.section.config?.items ?? [])
// CMS items are Thai; the dictionary has the other languages, keyed by icon
const title = (it) => tc(it.title, `why.${it.icon}.title`)
const body = (it) => tc(it.body, `why.${it.icon}.body`)
</script>

<template>
  <section class="strip" :aria-label="section.title">
    <ul class="row">
      <li v-for="(it, i) in items" :key="it.title" v-reveal="{ delay: i * 80 }" :class="{ lit: i === 2 }">
        <span class="ico"><Icon :name="it.icon" :size="26" :stroke="1.4" /></span>
        <div>
          <strong>{{ title(it) }}</strong>
          <p>{{ body(it) }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.strip {
  /* glass strip over the ambient light */
  border-block: 1px solid rgb(255 255 255 / 0.08);
  background: rgb(255 255 255 / 0.03);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  color: var(--night-text);
}
.row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  max-width: 1600px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  padding: clamp(1.75rem, 3vw, 2.6rem) clamp(1.25rem, 3vw, 2.5rem);
  border-right: 1px solid rgb(255 255 255 / 0.06);
  transition: background var(--dur-base) var(--ease-out);
}
li:hover,
li.lit {
  background: rgb(255 255 255 / 0.06);
}
.ico {
  flex: none;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.18);
  color: #fff;
}
li.lit .ico {
  background: var(--accent);
  border-color: var(--accent);
}
strong {
  display: block;
  font-size: var(--fs-md);
  font-weight: 600;
}
p {
  margin-top: 2px;
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.6);
}
@media (max-width: 1000px) {
  .row {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
  }
  li {
    border-right: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.06);
  }
}
</style>
