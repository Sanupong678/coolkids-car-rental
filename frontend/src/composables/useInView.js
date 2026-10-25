import { onBeforeUnmount, onMounted, ref } from 'vue'

// True once `target` has been `threshold` in view (never flips back), so a
// section can run its entrance choreography exactly once.
// Reduced motion / no IntersectionObserver: true straight away.
export function useInView(target, threshold = 0.25) {
  const inView = ref(false)
  let io
  onMounted(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      inView.value = true
      return
    }
    io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        inView.value = true
        io.disconnect()
      },
      { threshold },
    )
    io.observe(target.value)
  })
  onBeforeUnmount(() => io?.disconnect())
  return inView
}
