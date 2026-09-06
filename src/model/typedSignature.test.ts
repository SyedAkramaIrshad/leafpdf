import { describe, expect, it } from 'vitest'
import {
  SIGNATURE_STYLES,
  signatureTextForName,
  suggestedSignatureName,
} from './typedSignature'

describe('typed signatures', () => {
  it('normalizes full-name whitespace', () => {
    expect(signatureTextForName('  Syed   Akrama Irshad  ', 'full')).toBe(
      'Syed Akrama Irshad',
    )
  })

  it('derives initials from whitespace and hyphen-separated name parts', () => {
    expect(signatureTextForName('Syed Akrama Irshad', 'initials')).toBe('SAI')
    expect(signatureTextForName('Mary-Jane Watson', 'initials')).toBe('MJW')
  })

  it('caps initials at six Unicode characters', () => {
    expect(signatureTextForName('a b c d e f g', 'initials')).toBe('ABCDEF')
    expect(signatureTextForName('émile zola', 'initials')).toBe('ÉZ')
  })

  it('suggests clear reusable-signature names', () => {
    expect(suggestedSignatureName('Syed Akrama Irshad', 'initials')).toBe(
      'SAI initials',
    )
    expect(suggestedSignatureName('  Syed   Akram ', 'full')).toBe('Syed Akram')
    expect(suggestedSignatureName('  ', 'initials')).toBe('')
  })

  it('offers exactly the three intentional styles in order', () => {
    expect(SIGNATURE_STYLES.map(({ id }) => id)).toEqual([
      'script',
      'classic',
      'clean',
    ])
  })
})
