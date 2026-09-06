import { describe, expect, it } from 'vitest'
import type { ImageAnnotation, InkAnnotation } from './editor'
import { snapDraggedAnnotation, snapDraggedAnnotations } from './alignmentSnapping'

const image: ImageAnnotation = {
  id: 'image-1',
  pageId: 'page-1',
  kind: 'image',
  x: 0.374,
  y: 0.23,
  width: 0.25,
  height: 0.15,
  dataUrl: 'data:image/png;base64,AAAA',
  mimeType: 'image/png',
}

const squarePage = { width: 1000, height: 1000 }

describe('snapDraggedAnnotation', () => {
  it('snaps an item center to the page center within six pixels', () => {
    const result = snapDraggedAnnotation(image, [], squarePage)

    expect(result.annotation).toMatchObject({ x: 0.375, y: 0.23 })
    expect(result.guides).toEqual({ x: 0.5, y: null })
  })

  it('snaps a selected group as one shape while preserving its internal spacing', () => {
    const first = { ...image, id: 'first', x: 0.248, y: 0.2, width: 0.1, height: 0.1 }
    const second = { ...image, id: 'second', x: 0.648, y: 0.41, width: 0.1, height: 0.1 }

    const result = snapDraggedAnnotations([first, second], [], squarePage)

    expect(result.annotations.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0.25, y: 0.2 },
      { x: 0.65, y: 0.41 },
    ])
    expect(result.annotations[1].x - result.annotations[0].x).toBe(0.4)
    expect(result.guides).toEqual({ x: 0.5, y: null })
  })

  it('snaps independently to page edges and the horizontal center', () => {
    const atLeft = snapDraggedAnnotation({ ...image, x: 0.004 }, [], squarePage)
    const atRight = snapDraggedAnnotation({ ...image, x: 0.746 }, [], squarePage)
    const atMiddle = snapDraggedAnnotation({ ...image, x: 0.2, y: 0.424 }, [], squarePage)

    expect(atLeft.annotation).toMatchObject({ x: 0 })
    expect(atLeft.guides).toEqual({ x: 0, y: null })
    expect(atRight.annotation).toMatchObject({ x: 0.75 })
    expect(atRight.guides).toEqual({ x: 1, y: null })
    expect(atMiddle.annotation).toMatchObject({ x: 0.2, y: 0.425 })
    expect(atMiddle.guides).toEqual({ x: null, y: 0.5 })
  })

  it('does not snap when the nearest anchor is more than six pixels away', () => {
    const result = snapDraggedAnnotation({ ...image, x: 0.368 }, [], squarePage)

    expect(result.annotation).toMatchObject({ x: 0.368, y: 0.23 })
    expect(result.guides).toEqual({ x: null, y: null })
  })

  it('converts the pixel threshold independently on a non-square page', () => {
    const result = snapDraggedAnnotation(
      { ...image, x: 0.365, y: 0.418 },
      [],
      { width: 500, height: 1000 },
    )

    expect(result.annotation).toMatchObject({ x: 0.375, y: 0.418 })
    expect(result.guides).toEqual({ x: 0.5, y: null })
  })

  it('aligns a moving edge with nearby peer edges on each axis', () => {
    const peer: ImageAnnotation = {
      ...image,
      id: 'image-2',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
    }
    const moving: ImageAnnotation = {
      ...image,
      x: 0.304,
      y: 0.204,
      width: 0.2,
      height: 0.1,
    }

    const result = snapDraggedAnnotation(moving, [peer], squarePage)

    expect(result.annotation).toMatchObject({ x: 0.3, y: 0.2 })
    expect(result.guides).toEqual({ x: 0.3, y: 0.2 })
  })

  it('excludes the moving item itself before choosing the nearest target', () => {
    const result = snapDraggedAnnotation(image, [image], squarePage)

    expect(result.annotation).toMatchObject({ x: 0.375 })
    expect(result.guides.x).toBe(0.5)
  })

  it('does not use rotated or cross-page geometry as a peer target', () => {
    const moving = { ...image, x: 0.754, y: 0.3, width: 0.1, height: 0.1 }
    const rotatedPeer = { ...image, id: 'rotated', x: 0.55, y: 0.1, width: 0.2, height: 0.1, rotation: 10 }
    const otherPagePeer = { ...rotatedPeer, id: 'other-page', pageId: 'page-2', rotation: 0 }

    const result = snapDraggedAnnotation(moving, [rotatedPeer, otherPagePeer], squarePage)

    expect(result.annotation).toBe(moving)
    expect(result.guides).toEqual({ x: null, y: null })
  })

  it('bypasses guides for a rotated moving item or an invalid page size', () => {
    const rotated = { ...image, rotation: 1 }

    expect(snapDraggedAnnotation(rotated, [], squarePage)).toEqual({
      annotation: rotated,
      guides: { x: null, y: null },
    })
    expect(snapDraggedAnnotation(image, [], { width: 0, height: 1000 })).toEqual({
      annotation: image,
      guides: { x: null, y: null },
    })
  })

  it('snaps ink through its point bounds instead of its full-page base box', () => {
    const ink: InkAnnotation = {
      id: 'ink-1',
      pageId: 'page-1',
      kind: 'ink',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      points: [{ x: 0.449, y: 0.2 }, { x: 0.549, y: 0.3 }],
      color: '#3157d5',
      strokeWidth: 2.5,
    }

    const result = snapDraggedAnnotation(ink, [], squarePage)

    expect(result.annotation.kind).toBe('ink')
    if (result.annotation.kind === 'ink') {
      expect(result.annotation.points).toEqual([{ x: 0.45, y: 0.2 }, { x: 0.55, y: 0.3 }])
    }
    expect(result.guides).toEqual({ x: 0.5, y: null })
  })
})
