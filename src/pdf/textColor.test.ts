import { describe, expect, it } from 'vitest'
import { dominantTextColor } from './textColor'

function pixels(colors: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat())
}

describe('dominantTextColor', () => {
  it('returns the source ink rather than the paper colour', () => {
    const white: [number, number, number, number] = [255, 255, 255, 255]
    const ink: [number, number, number, number] = [49, 87, 213, 255]
    const data = pixels([
      ...Array.from({ length: 40 }, () => white),
      ...Array.from({ length: 12 }, () => ink),
    ])

    expect(dominantTextColor(data, '#ffffff')).toBe('#3157d5')
  })

  it('works for light text on a dark background', () => {
    const paper: [number, number, number, number] = [24, 32, 38, 255]
    const ink: [number, number, number, number] = [248, 246, 240, 255]
    const data = pixels([
      ...Array.from({ length: 40 }, () => paper),
      ...Array.from({ length: 12 }, () => ink),
    ])

    expect(dominantTextColor(data, '#182026')).toBe('#f8f6f0')
  })

  it('uses the existing safe colour when no foreground pixels are available', () => {
    const paper: [number, number, number, number] = [255, 255, 255, 255]
    expect(dominantTextColor(pixels(Array.from({ length: 20 }, () => paper)), '#ffffff')).toBe('#182026')
  })
})
