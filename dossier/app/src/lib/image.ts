/**
 * Client-side image processing for photos (§4.1): decode, downscale, and
 * re-encode to JPEG before encryption, so the vault never stores
 * multi-megabyte camera originals (or their EXIF metadata — re-encoding
 * strips location tags and timestamps, which matters in a privacy app).
 */

export const AVATAR_MAX_DIM = 512
export const GALLERY_MAX_DIM = 1280
export const MAX_INPUT_BYTES = 30 * 1024 * 1024

export interface ProcessedImage {
  bytes: Uint8Array
  mimeType: string
}

export async function downscaleImage(file: File, maxDim: number): Promise<ProcessedImage> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too large.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    )
    if (!blob) throw new Error('Could not encode image.')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}
