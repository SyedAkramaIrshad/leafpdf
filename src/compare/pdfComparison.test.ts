import { describe, expect, it } from 'vitest'
import { compareLines } from './pdfComparison'

describe('compareLines', () => {
  it('reports ordered additions and removals with an LCS similarity', () => {
    const result = compareLines(
      ['Heading', 'Old sentence', 'Unchanged'],
      ['Heading', 'New sentence', 'Unchanged', 'Added footer'],
    )

    expect(result.removed).toEqual(['Old sentence'])
    expect(result.added).toEqual(['New sentence', 'Added footer'])
    expect(result.similarity).toBe(0.5)
  })

  it('treats two empty pages as identical', () => {
    expect(compareLines([], [])).toEqual({ added: [], removed: [], similarity: 1 })
  })

  it('uses the bounded fallback without losing unique lines', () => {
    const left = Array.from({ length: 600 }, (_, index) => `left-${index}`)
    const right = [...left.slice(0, 599), 'right-only']
    const result = compareLines(left, right)

    expect(result.removed).toEqual(['left-599'])
    expect(result.added).toEqual(['right-only'])
    expect(result.similarity).toBeCloseTo(599 / 600)
  })
})
