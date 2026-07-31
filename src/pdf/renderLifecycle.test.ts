import { describe, expect, it } from 'vitest'
import { isRenderCancellation } from './renderLifecycle'

describe('isRenderCancellation', () => {
  it('recognizes PDF.js render cancellations only', () => {
    expect(isRenderCancellation({ name: 'RenderingCancelledException' })).toBe(true)
    expect(isRenderCancellation(new Error('broken page stream'))).toBe(false)
  })

  it('does not treat missing or primitive values as cancellations', () => {
    expect(isRenderCancellation(null)).toBe(false)
    expect(isRenderCancellation(undefined)).toBe(false)
    expect(isRenderCancellation('RenderingCancelledException')).toBe(false)
  })
})
