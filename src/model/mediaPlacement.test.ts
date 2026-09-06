import { describe, expect, it } from 'vitest'
import {
  mediaAnnotationAtPoint,
  mediaPlacementBounds,
  replacementMediaBounds,
  type PendingMediaPlacement,
} from './mediaPlacement'
import type { ImageAnnotation } from './editor'

const image: PendingMediaPlacement = {
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
  width: 0.4,
  aspectRatio: 2,
}

const portrait = { width: 600, height: 800 }

const placedSquare: ImageAnnotation = {
  id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.2, y: 0.3,
  width: 0.4, height: 0.3, dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
}

function visualCenter(
  bounds: Pick<ImageAnnotation, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  surface = portrait,
) {
  const radians = (bounds.rotation ?? 0) * Math.PI / 180
  const halfWidth = bounds.width * surface.width / 2
  const halfHeight = bounds.height * surface.height / 2
  return {
    x: bounds.x * surface.width + Math.cos(radians) * halfWidth - Math.sin(radians) * halfHeight,
    y: bounds.y * surface.height + Math.sin(radians) * halfWidth + Math.cos(radians) * halfHeight,
  }
}

describe('pending image and signature placement', () => {
  it('centres the media footprint on the intended point', () => {
    const bounds = mediaPlacementBounds(image, { x: 0.5, y: 0.5 }, portrait)

    expect(bounds.width).toBe(0.4)
    expect(bounds.height).toBeCloseTo(0.15)
    expect(bounds.x).toBeCloseTo(0.3)
    expect(bounds.y).toBeCloseTo(0.425)
    expect((bounds.width * portrait.width) / (bounds.height * portrait.height)).toBeCloseTo(2)
  })

  it('makes a square source physically square on a portrait page', () => {
    const bounds = mediaPlacementBounds({ ...image, aspectRatio: 1 }, { x: 0.5, y: 0.5 }, portrait)

    expect(bounds).toMatchObject({ x: 0.3, y: 0.35, width: 0.4, height: 0.3 })
    expect(bounds.width * portrait.width).toBeCloseTo(bounds.height * portrait.height)
  })

  it('keeps the complete footprint inside every page edge', () => {
    expect(mediaPlacementBounds(image, { x: 0, y: 0 }, portrait)).toEqual({
      x: 0, y: 0, width: 0.4, height: 0.15,
    })
    expect(mediaPlacementBounds(image, { x: 1, y: 1 }, portrait)).toEqual({
      x: 0.6, y: 0.85, width: 0.4, height: 0.15,
    })
    expect(mediaPlacementBounds(image, { x: 0, y: 1 }, portrait)).toEqual({
      x: 0, y: 0.85, width: 0.4, height: 0.15,
    })
    expect(mediaPlacementBounds(image, { x: 1, y: 0 }, portrait)).toEqual({
      x: 0.6, y: 0, width: 0.4, height: 0.15,
    })
  })

  it('scales an extreme portrait source down as one proportional box', () => {
    const bounds = mediaPlacementBounds(
      { ...image, width: 0.8, aspectRatio: 0.1 },
      { x: 0.5, y: 0.5 },
      portrait,
    )

    expect(bounds.height).toBe(1)
    expect(bounds.width).toBeCloseTo(0.133333)
    expect((bounds.width * portrait.width) / (bounds.height * portrait.height)).toBeCloseTo(0.1)
  })

  it('normalizes invalid media and surface values before positioning', () => {
    const bounds = mediaPlacementBounds(
      { ...image, width: -2, aspectRatio: Number.NaN },
      { x: Number.NaN, y: Number.NaN },
      { width: Number.NaN, height: -4 },
    )
    expect(bounds.width).toBe(0.02)
    expect(bounds.height).toBe(0.02)
    expect(bounds.x).toBeCloseTo(0.49)
    expect(bounds.y).toBeCloseTo(0.49)
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true)
  })

  it('creates the final signature annotation without losing its identity or bytes', () => {
    const signature: PendingMediaPlacement = {
      ...image,
      mimeType: 'image/jpeg',
      role: 'signature',
      width: 0.32,
      aspectRatio: 1120 / 380,
    }

    const annotation = mediaAnnotationAtPoint(
      signature,
      'page-4',
      { x: 0.25, y: 0.8 },
      'signature-9',
      portrait,
    )

    expect(annotation).toMatchObject({
      id: 'signature-9',
      pageId: 'page-4',
      kind: 'image',
      x: 0.09,
      width: 0.32,
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/jpeg',
      role: 'signature',
    })
    expect(annotation.y).toBeCloseTo(0.759286)
    expect(annotation.height).toBeCloseTo(0.081429)
    expect((annotation.width * portrait.width) / (annotation.height * portrait.height)).toBeCloseTo(1120 / 380)
  })

  it('replaces a square with a wide image while preserving its visual centre', () => {
    const bounds = replacementMediaBounds(placedSquare, 2, portrait)

    expect(bounds).toEqual({ x: 0.2, y: 0.375, width: 0.4, height: 0.15 })
    expect(visualCenter(bounds)).toEqual(visualCenter(placedSquare))
    expect((bounds.width * portrait.width) / (bounds.height * portrait.height)).toBeCloseTo(2)
  })

  it('preserves the page-pixel centre of a rotated replacement', () => {
    const rotated = { ...placedSquare, rotation: 32 }
    const bounds = replacementMediaBounds(rotated, 2, portrait)
    const before = visualCenter(rotated)
    const after = visualCenter({ ...bounds, rotation: rotated.rotation })

    expect(after.x).toBeCloseTo(before.x, 3)
    expect(after.y).toBeCloseTo(before.y, 3)
    expect(bounds.width).toBe(0.4)
    expect(bounds.height).toBe(0.15)
  })

  it('clamps a replacement only when its new footprint reaches a page edge', () => {
    const nearEdge = { ...placedSquare, x: 0.65, y: 0.7, width: 0.3, height: 0.225 }
    const bounds = replacementMediaBounds(nearEdge, 0.5, portrait)

    expect(bounds).toEqual({ x: 0.65, y: 0.55, width: 0.3, height: 0.45 })
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1)
  })

  it('scales an oversized portrait replacement into the page', () => {
    const bounds = replacementMediaBounds({ ...placedSquare, width: 0.8 }, 0.1, portrait)

    expect(bounds.width).toBeCloseTo(0.133333)
    expect(bounds.height).toBe(1)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1)
  })

  it('normalizes invalid replacement ratios and surface dimensions', () => {
    const bounds = replacementMediaBounds(
      { ...placedSquare, x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN, rotation: Number.NaN },
      Number.NaN,
      { width: Number.NaN, height: -2 },
    )

    expect(bounds).toEqual({ x: 0.49, y: 0.49, width: 0.02, height: 0.02 })
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true)
  })
})
