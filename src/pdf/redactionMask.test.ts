import { describe, expect, it } from 'vitest'
import type { RedactionAnnotation } from '../model/editor'
import { paintRedactionMask, type RedactionMaskContext } from './redactionMask'

type RecordedCall = { name: string; args: number[] }

function recorder(throwWhileFilling = false): {
  context: RedactionMaskContext
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  return {
    calls,
    context: {
      save: () => calls.push({ name: 'save', args: [] }),
      restore: () => calls.push({ name: 'restore', args: [] }),
      translate: (...args) => calls.push({ name: 'translate', args }),
      rotate: (...args) => calls.push({ name: 'rotate', args }),
      fillRect: (...args) => {
        calls.push({ name: 'fillRect', args })
        if (throwWhileFilling) throw new Error('canvas failed')
      },
    },
  }
}

function redaction(rotation?: number): RedactionAnnotation {
  return {
    id: 'redaction-1',
    pageId: 'page-1',
    kind: 'redaction',
    x: 0.2,
    y: 0.25,
    width: 0.3,
    height: 0.1,
    rotation,
  }
}

describe('paintRedactionMask', () => {
  it('expands an unrotated mask beyond every intended edge', () => {
    const { context, calls } = recorder()

    paintRedactionMask(context, redaction(), 1000, 800)

    expect(calls).toEqual([
      { name: 'save', args: [] },
      { name: 'translate', args: [200, 200] },
      { name: 'rotate', args: [0] },
      { name: 'fillRect', args: [-2, -2, 304, 84] },
      { name: 'restore', args: [] },
    ])
  })

  it('rotates around the same top-left pivot as the editor preview', () => {
    const { context, calls } = recorder()

    paintRedactionMask(context, redaction(90), 1000, 800)

    expect(calls[1]).toEqual({ name: 'translate', args: [200, 200] })
    expect(calls[2].name).toBe('rotate')
    expect(calls[2].args[0]).toBeCloseTo(Math.PI / 2)
    expect(calls[3]).toEqual({ name: 'fillRect', args: [-2, -2, 304, 84] })
  })

  it('never allows a negative padding value to shrink the protected area', () => {
    const { context, calls } = recorder()

    paintRedactionMask(context, redaction(30), 1000, 800, -10)

    expect(calls[3]).toEqual({ name: 'fillRect', args: [0, 0, 300, 80] })
  })

  it('restores the canvas transform even when painting fails', () => {
    const { context, calls } = recorder(true)

    expect(() => paintRedactionMask(context, redaction(45), 1000, 800)).toThrow('canvas failed')
    expect(calls.at(-1)).toEqual({ name: 'restore', args: [] })
  })
})
