import { MAX_PHOTO_CHARS } from './photo'

/** [side in px, JPEG quality]: the first that fits `MAX_PHOTO_CHARS` wins — a phone photo shrunk to a
 * 256 px square is ~15 KB, the smaller steps are only for very detailed pictures. */
const STEPS = [
  [256, 0.85],
  [256, 0.7],
  [192, 0.7],
  [160, 0.6],
] as const

/** A picked picture → a square JPEG data URL (centered crop, upright, flattened on white), small
 * enough to be kept inline in a row (src/shared/lib/photo.ts). Throws a message fit to show. */
export async function photoFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Elige una imagen (JPG, PNG o WebP)')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer esa imagen: prueba con otra (JPG, PNG o WebP)')
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    for (const [px, quality] of STEPS) {
      const canvas = document.createElement('canvas')
      canvas.width = px
      canvas.height = px
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.fillStyle = '#ffffff' // a transparent PNG would turn black as a JPEG
      ctx.fillRect(0, 0, px, px)
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px)
      const url = canvas.toDataURL('image/jpeg', quality)
      if (url.length <= MAX_PHOTO_CHARS) return url
    }
  } finally {
    bitmap.close()
  }
  throw new Error('La foto es muy pesada o compleja: prueba con otra')
}
