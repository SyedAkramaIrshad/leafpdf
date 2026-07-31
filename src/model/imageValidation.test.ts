import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_LIMITS, validatePlacedImage } from './imageValidation'

function fileOf(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(1)], name, { type })
  // Size is derived from content, so override it rather than allocate real bytes.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** Stand in for the browser decoder, which jsdom does not provide. */
function stubDecoder(result: { width: number; height: number } | Error) {
  const close = vi.fn()
  const createImageBitmap = vi.fn(async () => {
    if (result instanceof Error) throw result
    return { width: result.width, height: result.height, close } as unknown as ImageBitmap
  })
  vi.stubGlobal('createImageBitmap', createImageBitmap)
  return { createImageBitmap, close }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validatePlacedImage', () => {
  it('accepts a reasonable PNG and returns its decoded size', async () => {
    const { close } = stubDecoder({ width: 1200, height: 800 })
    await expect(validatePlacedImage(fileOf('sign.png', 'image/png', 400_000)))
      .resolves.toEqual({ width: 1200, height: 800 })
    // The bitmap must be released once its dimensions are known.
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('accepts a JPEG', async () => {
    stubDecoder({ width: 640, height: 480 })
    await expect(validatePlacedImage(fileOf('photo.jpg', 'image/jpeg', 90_000)))
      .resolves.toEqual({ width: 640, height: 480 })
  })

  it('rejects a type it cannot place', async () => {
    stubDecoder({ width: 10, height: 10 })
    await expect(validatePlacedImage(fileOf('notes.txt', 'text/plain', 200)))
      .rejects.toThrow(/PNG or JPEG/i)
  })

  it('rejects a text file that claims to be a PNG', async () => {
    // MIME type is caller-supplied metadata; only decoding proves it is an image.
    stubDecoder(new Error('The source image could not be decoded.'))
    await expect(validatePlacedImage(fileOf('fake.png', 'image/png', 200)))
      .rejects.toThrow(/not a valid PNG or JPEG image/i)
  })

  it('accepts a file exactly on the size boundary and rejects one past it', async () => {
    stubDecoder({ width: 100, height: 100 })
    await expect(validatePlacedImage(fileOf('edge.png', 'image/png', IMAGE_LIMITS.maxBytes)))
      .resolves.toEqual({ width: 100, height: 100 })

    stubDecoder({ width: 100, height: 100 })
    await expect(validatePlacedImage(fileOf('big.png', 'image/png', IMAGE_LIMITS.maxBytes + 1)))
      .rejects.toThrow(/20 MB/)
  })

  it('rejects an excessive single dimension', async () => {
    stubDecoder({ width: IMAGE_LIMITS.maxDimension + 1, height: 10 })
    await expect(validatePlacedImage(fileOf('wide.png', 'image/png', 1000)))
      .rejects.toThrow(/16,384 pixels/)
  })

  it('rejects an excessive total pixel count', async () => {
    // Each side is legal; the product is not.
    stubDecoder({ width: 9000, height: 9000 })
    await expect(validatePlacedImage(fileOf('huge.png', 'image/png', 1000)))
      .rejects.toThrow(/40 million pixels/)
  })

  it('rejects a zero-sized decode', async () => {
    stubDecoder({ width: 0, height: 0 })
    await expect(validatePlacedImage(fileOf('empty.png', 'image/png', 1000)))
      .rejects.toThrow(/no visible pixels/i)
  })

  it('explains itself when the browser cannot decode images at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(validatePlacedImage(fileOf('sign.png', 'image/png', 1000)))
      .rejects.toThrow(/cannot decode images/i)
  })
})
