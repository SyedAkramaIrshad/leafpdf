import { describe, expect, it, vi } from 'vitest'
import { createNativeTextDetector, normalizeDetectedText } from './nativeOcr'

describe('normalizeDetectedText', () => {
  it('normalizes browser OCR boxes and drops unusable detections', () => {
    const words = normalizeDetectedText([
      { rawValue: ' LeafPDF ', boundingBox: { x: 100, y: 50, width: 200, height: 40 } },
      { rawValue: '   ', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
      { rawValue: 'missing box' },
    ], 1000, 500)

    expect(words).toEqual([{
      text: 'LeafPDF', confidence: 0.5, x: 0.1, y: 0.1, width: 0.2, height: 0.08,
    }])
  })

  it('clamps boxes that extend outside the rendered page', () => {
    const [word] = normalizeDetectedText([
      { rawValue: 'edge', boundingBox: { x: 950, y: 490, width: 100, height: 30 } },
    ], 1000, 500)

    expect(word).toMatchObject({ x: 0.95, y: 0.98, width: 0.05, height: 0.02 })
  })
})

describe('createNativeTextDetector', () => {
  it('prefers the current asynchronous factory and passes a requested language', async () => {
    const detector = { detect: vi.fn(async () => []) }
    const create = vi.fn(async () => detector)
    class AsyncTextDetector {
      static create = create
      constructor() {
        throw new Error('The legacy constructor should not be used.')
      }
    }
    vi.stubGlobal('TextDetector', AsyncTextDetector)

    await expect(createNativeTextDetector('en')).resolves.toBe(detector)
    expect(create).toHaveBeenCalledWith({ languages: ['en'] })
  })
})
