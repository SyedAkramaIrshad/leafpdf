import { describe, expect, it } from 'vitest'
import type { Annotation, InkAnnotation, TextAnnotation } from './editor'
import { annotationsBounds, moveAnnotations } from './annotationMovement'
import { alignAnnotations } from './groupLayout'

const text = (
  id: string,
  x: number,
  y: number,
  width = 0.2,
  height = 0.08,
  pageId = 'page-1',
): TextAnnotation => ({
  id, pageId, kind: 'text', x, y, width, height,
  text: id, color: '#182026', fontSize: 18,
})

function expectAllClose(values: number[], expected: number) {
  for (const value of values) expect(value).toBeCloseTo(expected)
}

describe('group layout', () => {
  it('moves a group as one clamped translation', () => {
    const items = [text('name', 0.1, 0.2), text('date', 0.72, 0.45, 0.18)]

    expect(annotationsBounds(items)).toEqual({ x: 0.1, y: 0.2, width: 0.8, height: 0.33 })
    expect(moveAnnotations(items, 0.4, 0.6).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0.2, y: 0.67 },
      { x: 0.82, y: 0.92 },
    ])
  })

  it('uses ink point bounds in the group extent and translation', () => {
    const ink: InkAnnotation = {
      id: 'signature', pageId: 'page-1', kind: 'ink', x: 0, y: 0, width: 1, height: 1,
      points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }], color: '#3157d5', strokeWidth: 2,
    }
    const items: Annotation[] = [ink, text('date', 0.6, 0.7, 0.1, 0.05)]

    expect(annotationsBounds(items)).toEqual({ x: 0.2, y: 0.3, width: 0.5, height: 0.45 })
    const moved = moveAnnotations(items, -0.4, -0.4)
    expect(moved[0].kind).toBe('ink')
    if (moved[0].kind === 'ink') {
      expect(moved[0].points).toEqual([{ x: 0, y: 0 }, { x: 0.2, y: 0.2 }])
    }
    expect(moved[1]).toMatchObject({ x: 0.4, y: 0.4 })
  })

  it('aligns left, horizontal center, right, top, vertical middle, and bottom', () => {
    const items = [text('name', 0.1, 0.2), text('date', 0.5, 0.5, 0.1, 0.12)]

    expect(alignAnnotations(items, 'left').map(({ x }) => x)).toEqual([0.1, 0.1])
    expectAllClose(alignAnnotations(items, 'center-x').map(({ x, width }) => x + width / 2), 0.35)
    expectAllClose(alignAnnotations(items, 'right').map(({ x, width }) => x + width), 0.6)
    expect(alignAnnotations(items, 'top').map(({ y }) => y)).toEqual([0.2, 0.2])
    expectAllClose(alignAnnotations(items, 'center-y').map(({ y, height }) => y + height / 2), 0.41)
    expectAllClose(alignAnnotations(items, 'bottom').map(({ y, height }) => y + height), 0.62)
  })

  it('returns the original array for fewer than two items or mixed pages', () => {
    const one = [text('name', 0.1, 0.2)]
    expect(alignAnnotations(one, 'left')).toBe(one)
    const mixed: Annotation[] = [text('name', 0.1, 0.2), text('date', 0.5, 0.5, 0.2, 0.08, 'page-2')]
    expect(alignAnnotations(mixed, 'top')).toBe(mixed)
  })
})
