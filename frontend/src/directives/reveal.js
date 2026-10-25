// v-reveal — scroll-triggered entrance animation.
//   <div v-reveal>…</div>             fade/slide up when 15% visible
//   <div v-reveal="{ delay: 120 }">   staggered
// One shared IntersectionObserver; elements are unobserved after revealing.
// Honours prefers-reduced-motion (elements are shown immediately).

let observer
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-revealed')
        observer.unobserve(e.target)
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  )
  return observer
}

export const reveal = {
  mounted(el, binding) {
    if (reduced() || !('IntersectionObserver' in window)) return
    el.classList.add('reveal')
    if (binding.value?.delay) el.style.transitionDelay = `${binding.value.delay}ms`
    if (binding.value?.from) el.dataset.revealFrom = binding.value.from
    getObserver().observe(el)
  },
  unmounted(el) {
    observer?.unobserve(el)
  },
}
