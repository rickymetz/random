/**
 * Client-side image processing for photos (§4.1): decode, downscale, and
 * re-encode to JPEG before encryption, so the vault never stores
 * multi-megabyte camera originals (or their EXIF metadata — re-encoding
 * strips location tags and timestamps, which matters in a privacy app).
 */

// One stored size serves both gallery and avatar uses: decoded bitmaps
// are cached per session, so the avatar circles don't pay a per-frame
// decode cost, and a second variant would double blob storage.
export const GALLERY_MAX_DIM = 1280
export const MAX_INPUT_BYTES = 30 * 1024 * 1024

export interface ProcessedImage {
  bytes: Uint8Array
  mimeType: string
}

export async function downscaleImage(file: File, maxDim: number): Promise<ProcessedImage> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too large.')
  let bitmap: ImageBitmap
  try {
    // 'from-image' bakes the EXIF rotation into the pixels BEFORE the
    // re-encode strips the tag — without it, portrait phone photos would
    // be stored permanently sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(
      'Could not read that image. iPhone HEIC photos need converting first — ' +
        'or set the camera to "Most Compatible".',
    )
  }
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
