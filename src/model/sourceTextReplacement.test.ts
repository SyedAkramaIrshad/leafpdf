import { describe, expect, it } from 'vitest'
import {
  buildSourceTextSelection,
  fitSourceReplacementWidth,
  sourceReplacementAnnotations,
  type SourceTextSelectionInput,
} from './sourceTextReplacement'

function input(overrides: Partial<SourceTextSelectionInput> = {}): SourceTextSelectionInput {
  return {
    pageId: 'page-1',
    text: 'Syed Akrama',
    clientRects: [
      { left: 110, top: 220, right: 154, bottom: 240 },
      { left: 158, top: 220, right: 214, bottom: 240 },
    ],
    surface: { left: 10, top: 20, width: 600, height: 800 },
    fontSize: 12,
    color: '#182026',
    fontFamily: 'sans',
    fontWeight: 400,
    fontStyle: 'normal',
    direction: 'ltr',
    ...overrides,
  }
}

describe('buildSourceTextSelection', () => {
  it('merges adjacent rectangles on one line and adds one pixel of cover padding', () => {
    const selection = buildSourceTextSelection(input())

    expect(selection?.rects).toHaveLength(1)
    expect(selection?.rects[0]).toMatchObject({
      x: expect.closeTo(99 / 600, 8),
      y: expect.closeTo(199 / 800, 8),
      width: expect.closeTo(106 / 600, 8),
      height: expect.closeTo(22 / 800, 8),
    })
    expect(selection?.text).toBe('Syed Akrama')
  })

  it('keeps separate source lines while using their union for replacement text', () => {
    const selection = buildSourceTextSelection(input({
      text: 'First line\nSecond line',
      clientRects: [
        { left: 100, top: 100, right: 260, bottom: 120 },
        { left: 100, top: 136, right: 245, bottom: 156 },
      ],
    }))

    expect(selection?.rects).toHaveLength(2)
    expect(selection?.bounds.height).toBeGreaterThan(selection?.rects[0].height ?? 1)
    expect(selection?.text).toBe('First line\nSecond line')
  })

  it('clips rectangles to the page and rejects unusable selections', () => {
    const selection = buildSourceTextSelection(input({
      surface: { left: 100, top: 100, width: 200, height: 300 },
      clientRects: [{ left: 90, top: 90, right: 180, bottom: 125 }],
    }))
    expect(selection?.rects[0]).toMatchObject({ x: 0, y: 0 })

    expect(buildSourceTextSelection(input({ text: '   ' }))).toBeNull()
    expect(buildSourceTextSelection(input({ clientRects: [] }))).toBeNull()
    expect(buildSourceTextSelection(input({ surface: { left: 0, top: 0, width: 0, height: 800 } }))).toBeNull()
    expect(buildSourceTextSelection(input({ clientRects: [{ left: -40, top: -40, right: -10, bottom: -10 }] }))).toBeNull()
  })
})

describe('sourceReplacementAnnotations', () => {
  it('fits measured replacement text inside the source run without crossing the page', () => {
    const selection = buildSourceTextSelection(input({
      surface: { left: 0, top: 0, width: 600, height: 800 },
      clientRects: [{ left: 100, top: 100, right: 180, bottom: 120 }],
      text: 'page',
    }))
    if (!selection) throw new Error('Expected a valid source selection.')

    const fitted = fitSourceReplacementWidth(selection, 'sheet', 600, 100)
    expect(fitted.text).toBe('sheet')
    expect(fitted.fontSize).toBeCloseTo(12 * (82 / 100))
    expect(fitted.bounds.width).toBeCloseTo(90 / 600)

    const clamped = fitSourceReplacementWidth(
      { ...selection, bounds: { ...selection.bounds, x: 0.9, width: 0.08 } },
      'a much longer correction',
      600,
      300,
    )
    expect(clamped.bounds.width).toBeCloseTo(0.1)
    expect(clamped.fontSize).toBe(6)
    const short = fitSourceReplacementWidth(selection, 'x', 600, 4)
    expect(short.bounds.width).toBe(selection.bounds.width)
    expect(short.fontSize).toBe(selection.fontSize)
  })

  it('creates exact white covers first and one editable source-styled text item last', () => {
    const selection = buildSourceTextSelection(input({
      surface: { left: 0, top: 0, width: 1000, height: 1000 },
      clientRects: [{ left: 100, top: 200, right: 110, bottom: 210 }],
      fontSize: 14,
      color: '#3157d5',
      fontFamily: 'serif',
      fontWeight: 700,
      fontStyle: 'italic',
      direction: 'rtl',
    }))
    if (!selection) throw new Error('Expected a valid source selection.')
    let counter = 0
    const annotations = sourceReplacementAnnotations(selection, () => `annotation-${++counter}`)

    expect(annotations.map(({ kind }) => kind)).toEqual(['whiteout', 'text'])
    expect(annotations[0]).toMatchObject({
      id: 'annotation-1', pageId: 'page-1', kind: 'whiteout',
      x: 0.099, y: 0.199, width: 0.012, height: 0.012,
    })
    expect(annotations[1]).toMatchObject({
      id: 'annotation-2', pageId: 'page-1', kind: 'text',
      width: 0.07, height: 0.022, text: 'Syed Akrama', color: '#3157d5', fontSize: 14,
      fontFamily: 'serif', fontWeight: 700, fontStyle: 'italic', direction: 'rtl',
      sourceReplacement: true,
    })
  })

  it('falls back to safe finite text styling', () => {
    const selection = buildSourceTextSelection(input({ fontSize: Number.NaN, color: 'not-a-colour' }))
    if (!selection) throw new Error('Expected a valid source selection.')
    const text = sourceReplacementAnnotations(selection, () => crypto.randomUUID()).at(-1)
    expect(text).toMatchObject({ kind: 'text', fontSize: 18, color: '#182026' })
  })
})
