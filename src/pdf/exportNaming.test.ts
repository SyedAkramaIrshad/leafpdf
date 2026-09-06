import { describe, expect, it } from 'vitest'
import { exportedFileName } from './exportNaming'

describe('exportedFileName', () => {
  it('keeps the edited suffix for fillable output', () => {
    expect(exportedFileName('Offer Letter.PDF')).toBe('Offer Letter-edited.pdf')
    expect(exportedFileName('Offer Letter.PDF', 'fillable')).toBe('Offer Letter-edited.pdf')
  })

  it('makes flattened output unmistakable in the filename', () => {
    expect(exportedFileName('Offer Letter.PDF', 'flattened')).toBe('Offer Letter-flattened.pdf')
    expect(exportedFileName('.pdf', 'flattened')).toBe('document-flattened.pdf')
  })
})
