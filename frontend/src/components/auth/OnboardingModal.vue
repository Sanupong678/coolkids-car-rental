<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

// First-login profile step (spec 1.1). Uses a native modal <dialog>, which
// gives focus trapping and an inert background for free. It cannot be
// dismissed: Esc is cancelled and there is no close button.
const auth = useAuthStore()
const dialog = ref(null)
const age = ref('')
const gender = ref('')
const submitting = ref(false)
const error = ref('')

const genders = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const ageNum = computed(() => Number(age.value))
const ageValid = computed(() => Number.isInteger(ageNum.value) && ageNum.value >= 18 && ageNum.value <= 120)
const canSubmit = computed(() => ageValid.value && gender.value && !submitting.value)
const firstName = computed(() => auth.me?.fullName?.split(' ')[0] ?? '')

onMounted(() => dialog.value?.showModal())

// Browsers may still close a dialog on Esc (close-watcher rules ignore
// preventDefault without recent user activation). Reopen until onboarding is done.
function keepOpen() {
  if (auth.needsOnboarding) dialog.value?.showModal()
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = ''
  try {
    await auth.completeOnboarding({ age: ageNum.value, gender: gender.value })
    dialog.value?.close()
  } catch (err) {
    error.value = err.details?.age?.[0] ?? err.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="onboarding"
    aria-labelledby="onb-title"
    closedby="none"
    @cancel.prevent
    @close="keepOpen"
  >
    <form class="panel" novalidate @submit.prevent="submit">
      <div class="identity">
        <img v-if="auth.me?.avatarUrl" :src="auth.me.avatarUrl" alt="" class="avatar" referrerpolicy="no-referrer" />
        <span class="eyebrow">One last step</span>
      </div>
      <h2 id="onb-title">Welcome{{ firstName ? `, ${firstName}` : '' }}.</h2>
      <p class="lede">Tell us a little about yourself so we can match you with the right vehicles and insurance.</p>

      <label class="field">
        <span class="label">Age</span>
        <input
          v-model="age"
          type="number"
          inputmode="numeric"
          min="18"
          max="120"
          required
          autocomplete="off"
          placeholder="e.g. 32"
          :aria-invalid="age !== '' && !ageValid"
          aria-describedby="age-hint"
        />
        <span id="age-hint" class="hint" :class="{ bad: age !== '' && !ageValid }">
          {{ age !== '' && !ageValid ? 'You must be 18 or older to rent with us.' : 'Drivers must be 18 or older.' }}
        </span>
      </label>

      <fieldset class="field">
        <legend class="label">Gender</legend>
        <div class="chips" role="radiogroup">
          <label v-for="g in genders" :key="g.value" class="chip" :class="{ active: gender === g.value }">
            <input v-model="gender" type="radio" name="gender" :value="g.value" class="sr-only" />
            {{ g.label }}
          </label>
        </div>
      </fieldset>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button type="submit" class="submit" :disabled="!canSubmit">
        <span v-if="!submitting">Continue</span>
        <span v-else class="spinner" aria-label="Saving" />
      </button>
      <p class="fine">Used for eligibility and anonymised analytics only. You can change it later in account settings.</p>
    </form>
  </dialog>
</template>

<style scoped>
.onboarding {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  max-width: min(480px, calc(100vw - 2rem));
  width: 100%;
}
.onboarding::backdrop {
  background: rgb(5 6 8 / 0.72);
  backdrop-filter: blur(8px);
  animation: fade var(--dur-slow) var(--ease-out);
}
.panel {
  display: grid;
  gap: var(--s-5);
  padding: clamp(1.5rem, 5vw, 2.5rem);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--surface-glass);
  backdrop-filter: blur(var(--blur-glass)) saturate(140%);
  box-shadow: var(--shadow-lg);
  animation: rise var(--dur-slow) var(--ease-out);
}
.identity {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
}
h2 {
  font-size: var(--fs-2xl);
}
.lede {
  color: var(--text-muted);
  margin-top: calc(var(--s-3) * -1);
}
.field {
  display: grid;
  gap: var(--s-2);
  border: 0;
  padding: 0;
  margin: 0;
}
.label {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  padding: 0;
}
input[type='number'] {
  width: 100%;
  padding: 0.8rem 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: rgb(0 0 0 / 0.25);
  font-size: var(--fs-lg);
  transition: border-color var(--dur-fast) var(--ease-out);
}
input[type='number']:focus-visible {
  border-color: var(--accent);
  box-shadow: none;
  outline: none;
}
input[aria-invalid='true'] {
  border-color: var(--danger);
}
.hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.hint.bad {
  color: var(--danger);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.chip {
  padding: 0.5rem 0.95rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  font-size: var(--fs-sm);
  cursor: pointer;
  user-select: none;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.chip:hover {
  border-color: var(--text-muted);
}
.chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}
.chip:has(input:focus-visible) {
  box-shadow: var(--focus-ring);
}
.error {
  color: var(--danger);
  font-size: var(--fs-sm);
}
.submit {
  height: 52px;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--text-inverse);
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}
.submit:hover:not(:disabled) {
  background: var(--accent-hover);
}
.submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgb(0 0 0 / 0.25);
  border-top-color: var(--text-inverse);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.fine {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
