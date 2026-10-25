import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getCategories, getLocations, getSiteContent } from '@/api/catalogue'

// App-shell data shared by header, footer and several pages. Loaded once.
export const useSiteStore = defineStore('site', () => {
  const content = ref(null) // { company, navbar, footer, theme }
  const categories = ref([])
  const locations = ref([])
  let loading = null

  function applyTheme(theme) {
    // CMS colour overrides map onto design tokens (spec 2.3 "Colors").
    const c = theme?.colors
    if (!c) return
    const root = document.documentElement.style
    if (c.accent) root.setProperty('--accent', c.accent)
    if (c.background) root.setProperty('--bg', c.background)
    if (c.surface) root.setProperty('--surface', c.surface)
    if (c.text) root.setProperty('--text', c.text)
    if (c.muted) root.setProperty('--text-muted', c.muted)
  }

  function load() {
    loading ??= Promise.all([getSiteContent(), getCategories(), getLocations()])
      .then(([site, cats, locs]) => {
        content.value = site
        categories.value = cats
        locations.value = locs
        applyTheme(site.theme)
      })
      .catch((err) => {
        loading = null
        console.error('site content failed to load', err)
      })
    return loading
  }

  return { content, categories, locations, load }
})
