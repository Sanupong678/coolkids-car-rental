// Shrinks a phone photo before upload: max 2000 px on the long side, JPEG 85%.
// Keeps documents readable while cutting a 6–10 MB camera file to a few hundred KB.
import { t } from '@/i18n'
export async function shrinkImage(file, { max = 2000, quality = 0.85 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/^image\//.test(file.type)) throw new Error(t('misc.notImage'))
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file
    throw new Error(t('misc.badImage'))
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('misc.convertFail')))), 'image/jpeg', quality))
}
