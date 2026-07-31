import { describe, expect, it } from 'vitest'
import { clamp, denormalizePoint, normalizePoint, normalizeRect } from './geometry'

describe('geometry', () => {
  it('normalizes and denormalizes points independently of zoom', () => {
    const normalized = normalizePoint({ x: 300, y: 400 }, { width: 600, height: 800 })
    expect(normalized).toEqual({ x: 0.5, y: 0.5 })
    expect(denormalizePoint(normalized, { width: 900, height: 1200 })).toEqual({ x: 450, y: 600 })
  })

  it('clamps values and rectangles to page bounds', () => {
    expect(clamp(4, 0, 2)).toBe(2)
    expect(normalizeRect({ x: -10, y: 50, width: 120, height: 80 }, { width: 100, height: 100 }))
      .toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 })
  })
})
