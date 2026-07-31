import { describe, expect, it } from 'vitest'
import { moveAnnotation, resizeAnnotation, resizeAnnotationFromCorner, rotateAnnotation } from './annotationMovement'
import type { ImageAnnotation, InkAnnotation, TextAnnotation } from './editor'

const textAnnotation: TextAnnotation = {
  id: 'annotation-1',
  pageId: 'page-1',
  kind: 'text',
  x: 0.1,
  y: 0.2,
  width: 0.32,
  height: 0.07,
  text: 'Draft',
  color: '#182026',
  fontSize: 18,
}

const inkAnnotation: InkAnnotation = {
  id: 'annotation-2',
  pageId: 'page-1',
  kind: 'ink',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.3 },
  ],
  color: '#3157d5',
  strokeWidth: 2.5,
}

describe('moveAnnotation', () => {
  it('keeps a normal annotation fully inside the page', () => {
    const moved = moveAnnotation(textAnnotation, 0.9, 0.9)
    expect(moved.x).toBeCloseTo(1 - textAnnotation.width)
    expect(moved.y).toBeCloseTo(1 - textAnnotation.height)
  })

  it('clamps a normal annotation at the top-left edge', () => {
    const moved = moveAnnotation(textAnnotation, -0.9, -0.9)
    expect(moved.x).toBeCloseTo(0)
    expect(moved.y).toBeCloseTo(0)
  })

  it('moves ink by translating its points', () => {
    const moved = moveAnnotation(inkAnnotation, 0.15, -0.05)
    expect(moved.kind).toBe('ink')
    if (moved.kind === 'ink') {
      expect(moved.points).toEqual([
        { x: 0.25, y: 0.15 },
        { x: 0.45, y: 0.25 },
      ])
    }
  })

  it('clamps an ink delta so every point stays on the page', () => {
    const moved = moveAnnotation(inkAnnotation, 0.9, 0.9)
    expect(moved.kind).toBe('ink')
    if (moved.kind === 'ink') {
      // The right-most point is at 0.3, so the delta caps at 0.7.
      expect(moved.points[0].x).toBeCloseTo(0.8)
      expect(moved.points[1].x).toBeCloseTo(1)
      // The lowest point is at 0.3, so the vertical delta caps at 0.7 as well.
      expect(moved.points[0].y).toBeCloseTo(0.9)
      expect(moved.points[1].y).toBeCloseTo(1)
    }
  })

  it('preserves identity and unrelated properties', () => {
    const image: ImageAnnotation = {
      id: 'annotation-3',
      pageId: 'page-2',
      kind: 'image',
      x: 0.2,
      y: 0.2,
      width: 0.4,
      height: 0.2,
      rotation: 12,
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
    }
    const moved = moveAnnotation(image, 0.05, 0.05)
    expect(moved).toMatchObject({
      id: 'annotation-3',
      pageId: 'page-2',
      kind: 'image',
      width: 0.4,
      height: 0.2,
      rotation: 12,
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
    })
    expect(moved.x).toBeCloseTo(0.25)
    expect(moved.y).toBeCloseTo(0.25)
  })

  it('returns the same annotation when the delta is zero', () => {
    expect(moveAnnotation(textAnnotation, 0, 0)).toEqual(textAnnotation)
  })
})

describe('resizeAnnotation', () => {
  const image: ImageAnnotation = {
    id: 'image-1',
    pageId: 'page-1',
    kind: 'image',
    x: 0.2,
    y: 0.25,
    width: 0.3,
    height: 0.2,
    dataUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
  }

  it('enlarges an image by normalized deltas', () => {
    const resized = resizeAnnotation(image, 0.1, 0.15)
    expect(resized.width).toBeCloseTo(0.4)
    expect(resized.height).toBeCloseTo(0.35)
  })

  it('enforces minimum dimensions', () => {
    const resized = resizeAnnotation(image, -1, -1)
    expect(resized.width).toBe(0.03)
    expect(resized.height).toBe(0.03)
  })

  it('keeps the resized item inside the page', () => {
    const resized = resizeAnnotation(image, 1, 1)
    expect(resized.x + resized.width).toBeCloseTo(1)
    expect(resized.y + resized.height).toBeCloseTo(1)
  })
})

describe('universal transforms', () => {
  const image: ImageAnnotation = {
    id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.2, y: 0.25,
    width: 0.3, height: 0.2, dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png',
  }

  it.each([
    ['nw', -0.1, -0.05, { x: 0.1, y: 0.2, width: 0.4, height: 0.25 }],
    ['ne', 0.1, -0.05, { x: 0.2, y: 0.2, width: 0.4, height: 0.25 }],
    ['sw', -0.1, 0.05, { x: 0.1, y: 0.25, width: 0.4, height: 0.25 }],
    ['se', 0.1, 0.05, { x: 0.2, y: 0.25, width: 0.4, height: 0.25 }],
  ] as const)('resizes from the %s corner', (corner, dx, dy, expected) => {
    expect(resizeAnnotationFromCorner(image, corner, dx, dy, false)).toMatchObject(expected)
  })

  it('preserves aspect ratio when requested and enforces page bounds', () => {
    const resized = resizeAnnotationFromCorner(image, 'se', 0.8, 0.2, true)
    expect(resized.x + resized.width).toBeLessThanOrEqual(1)
    expect(resized.height / resized.width).toBeCloseTo(image.height / image.width)
  })

  it('normalizes rotation to the signed visual range', () => {
    expect(rotateAnnotation(image, 450).rotation).toBe(90)
    expect(rotateAnnotation(image, -450).rotation).toBe(-90)
  })

  it('resizes and rotates ink points instead of treating ink as a full-page object', () => {
    const resized = resizeAnnotationFromCorner(inkAnnotation, 'se', 0.1, 0.1, false)
    expect(resized.kind).toBe('ink')
    if (resized.kind === 'ink') {
      expect(resized.points.at(-1)).toEqual({ x: 0.4, y: 0.4 })
    }
    const rotated = rotateAnnotation(inkAnnotation, 90)
    expect(rotated.kind).toBe('ink')
    if (rotated.kind === 'ink') {
      expect(rotated.points[0].x).toBeCloseTo(0.25)
      expect(rotated.points[0].y).toBeCloseTo(0.15)
    }
  })
})
