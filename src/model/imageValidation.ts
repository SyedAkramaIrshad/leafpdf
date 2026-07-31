export const IMAGE_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxDimension: 16_384,
  maxPixels: 40_000_000,
} as const

export interface PlacedImageSize {
  width: number
  height: number
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg']

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Check a user-chosen image before it becomes an annotation. A file's MIME type is
 * only a claim, so the image is actually decoded: that both proves it is a real PNG
 * or JPEG and gives the true pixel dimensions, which the byte size does not imply.
 *
 * Throws with a message naming the specific reason, so the caller can show it
 * directly rather than reporting a generic failure.
 */
export async function validatePlacedImage(file: File): Promise<PlacedImageSize> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Choose a PNG or JPEG image.')
  }
  if (file.size > IMAGE_LIMITS.maxBytes) {
    throw new Error(`This image is larger than ${IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB. Choose a smaller file.`)
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode images for placement.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That file is not a valid PNG or JPEG image.')
  }

  // Read the dimensions, then release the decoded bitmap immediately: a large image
  // holds many megabytes of pixel data that is not needed past this point.
  const { width, height } = bitmap
  bitmap.close?.()

  if (width <= 0 || height <= 0) {
    throw new Error('That image has no visible pixels.')
  }
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension) {
    throw new Error(
      `That image is ${formatCount(width)}x${formatCount(height)}. `
      + `Neither side may exceed ${formatCount(IMAGE_LIMITS.maxDimension)} pixels.`,
    )
  }
  if (width * height > IMAGE_LIMITS.maxPixels) {
    throw new Error(
      `That image has ${formatCount(width * height)} pixels. `
      + `LeafPDF places images up to ${IMAGE_LIMITS.maxPixels / 1_000_000} million pixels.`,
    )
  }

  return { width, height }
}
