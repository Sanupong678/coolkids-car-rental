<script setup>
import { onMounted, ref } from 'vue'
import { getPromptpay, uploadSlip } from '@/api/bookings'
import { shrinkImage } from '@/utils/image'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

// PromptPay: scan (or save) the QR for the exact total, transfer in any Thai
// banking app, then send the slip. The server reads the slip with the bank and
// confirms the booking on the spot; slips the bank cannot answer for wait for
// a staff member, and the car stays held meanwhile.
const props = defineProps({ number: { type: String, required: true } })
const emit = defineEmits(['done'])
const { t, errorText } = useI18n()

const info = ref(null)
const qrPng = ref('')
const busy = ref(false)
const error = ref('')
const result = ref(null) // { status, reason }

// Banking apps scan QR pictures from the photo gallery, which takes PNG/JPEG,
// not SVG: the QR is redrawn as a PNG so long-press → save works in LINE too.
function toPng(svgDataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const size = 720
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(svgDataUrl)
    img.src = svgDataUrl
  })
}

onMounted(async () => {
  try {
    info.value = await getPromptpay(props.number)
    qrPng.value = await toPng(info.value.qr)
  } catch (err) {
    error.value = errorText(err)
  }
})

async function pick(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || busy.value) return
  busy.value = true
  error.value = ''
  result.value = null
  try {
    // Keep the slip's QR sharp: only very large photos are scaled down.
    const blob = file.size > 4_000_000 || !/^image\/(jpeg|png|webp)$/.test(file.type) ? await shrinkImage(file, { max: 2400, quality: 0.92 }) : file
    const r = await uploadSlip(props.number, blob)
    result.value = r
    if (r.status !== 'REJECTED') emit('done', r.booking)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="pp">
    <div v-if="!info && !error" class="loading"><span class="spinner" /></div>

    <template v-if="info">
      <div class="qr-card">
        <div class="brand">Thai QR Payment · PromptPay</div>
        <img :src="qrPng || info.qr" width="220" height="220" :alt="t('pp.qrAlt')" />
        <strong class="amt">{{ money(info.amountMinor, info.currency) }}</strong>
        <small>{{ info.accountName ? `${info.accountName} · ` : '' }}{{ t('pp.promptpay', { id: info.accountId }) }}</small>
        <a :href="qrPng || info.qr" :download="`promptpay-${number}.png`" class="save">{{ t('pp.save') }}</a>
      </div>

      <ol class="how">
        <li>{{ t('pp.step1') }}</li>
        <li>{{ t('pp.step2', { amount: money(info.amountMinor, info.currency) }) }}</li>
        <li>{{ t(info.autoCheck ? 'pp.step3auto' : 'pp.step3staff') }}</li>
      </ol>

      <div v-if="result?.status === 'VERIFIED'" class="msg ok" role="status"><Icon name="check" :size="16" /> {{ t('pp.verified') }}</div>
      <div v-else-if="result?.status === 'NEEDS_REVIEW'" class="msg wait" role="status">
        <Icon name="clock" :size="16" /> {{ t('pp.review') }}
      </div>
      <template v-else>
        <div v-if="result?.status === 'REJECTED'" class="msg bad" role="alert">{{ t('pp.rejected', { reason: result.reason }) }}</div>
        <label class="upload" :class="{ busy }">
          <input type="file" accept="image/*" :disabled="busy" @change="pick" />
          <span v-if="busy" class="spinner" :aria-label="t('pp.checking')" />
          <template v-else><Icon name="camera" :size="18" /> {{ t(result ? 'pp.resend' : 'pp.attach') }}</template>
        </label>
      </template>
    </template>

    <p v-if="error" class="msg bad" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.pp {
  display: grid;
  gap: 14px;
}
.loading {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.qr-card {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 16px;
  border: 1px solid #e3e5ec;
  border-radius: 18px;
  background: #fff;
  text-align: center;
}
.brand {
  width: 100%;
  padding: 6px 0;
  border-radius: 10px;
  background: #0e3b6c;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.qr-card img {
  width: min(220px, 70vw);
  height: auto;
  aspect-ratio: 1;
  image-rendering: pixelated;
}
.amt {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.qr-card small {
  color: #5d6170;
}
.save {
  margin-top: 4px;
  color: #0e3b6c;
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
}
.how {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  color: #3a3d48;
  font-size: 14px;
  line-height: 1.5;
}
.upload {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  border-radius: 999px;
  background: #e2362c;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.upload.busy {
  opacity: 0.7;
  cursor: progress;
}
.upload input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: inherit;
}
.upload:focus-within {
  outline: 3px solid #f5a19b;
  outline-offset: 2px;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgb(255 255 255 / 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.loading .spinner {
  border-color: #ececee;
  border-top-color: #e2362c;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.msg {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
}
.ok {
  background: #e6f6ee;
  color: #17683f;
}
.wait {
  background: #fdf3e2;
  color: #8a5a12;
}
.bad {
  background: #fdecea;
  color: #a3241b;
}
</style>
