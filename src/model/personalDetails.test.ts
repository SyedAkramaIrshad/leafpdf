import { describe, expect, it } from 'vitest'
import {
  EMPTY_PERSONAL_DETAILS,
  PERSONAL_DETAIL_FIELDS,
  hasPersonalDetails,
  isPersonalDetails,
  normalizePersonalDetails,
  preparedDetailPlacement,
  type PersonalDetails,
} from './personalDetails'

const completeDetails: PersonalDetails = {
  fullName: 'Syed Akrama Irshad',
  email: 'syed@example.com',
  phone: '+91 98765 43210',
  company: 'LeafPDF',
  address: '42 Paper Street\nBengaluru',
}

describe('personal details', () => {
  it('publishes only the five intentional fields in task order', () => {
    expect(PERSONAL_DETAIL_FIELDS).toEqual([
      { id: 'fullName', label: 'Full name', maxLength: 160, inputMode: 'text' },
      { id: 'email', label: 'Email', maxLength: 254, inputMode: 'email' },
      { id: 'phone', label: 'Phone', maxLength: 80, inputMode: 'tel' },
      { id: 'company', label: 'Company', maxLength: 160, inputMode: 'text' },
      { id: 'address', label: 'Address', maxLength: 500, inputMode: 'text', multiline: true },
    ])
    expect(EMPTY_PERSONAL_DETAILS).toEqual({
      fullName: '', email: '', phone: '', company: '', address: '',
    })
  })

  it('accepts only exact string-valued fields inside their limits', () => {
    expect(isPersonalDetails(completeDetails)).toBe(true)
    expect(isPersonalDetails({ ...completeDetails, fullName: 'n'.repeat(160) })).toBe(true)
    expect(isPersonalDetails({ ...completeDetails, fullName: 'n'.repeat(161) })).toBe(false)
    expect(isPersonalDetails({ ...completeDetails, phone: 42 })).toBe(false)
    expect(isPersonalDetails({ ...completeDetails, nickname: 'Syed' })).toBe(false)
    const missingCompany: Partial<PersonalDetails> = { ...completeDetails }
    delete missingCompany.company
    expect(isPersonalDetails(missingCompany)).toBe(false)
    expect(isPersonalDetails(null)).toBe(false)
  })

  it('trims only outer whitespace and preserves literal interior content', () => {
    expect(normalizePersonalDetails({
      fullName: '  Syed  Akrama Irshad  ',
      email: '  syed@example.com ',
      phone: ' +91  98765 43210 ',
      company: '  Leaf PDF  ',
      address: '\n  42 Paper Street\n  Bengaluru  \n',
    })).toEqual({
      fullName: 'Syed  Akrama Irshad',
      email: 'syed@example.com',
      phone: '+91  98765 43210',
      company: 'Leaf PDF',
      address: '42 Paper Street\n  Bengaluru',
    })
  })

  it('distinguishes a real partial profile from an all-empty one', () => {
    expect(hasPersonalDetails(EMPTY_PERSONAL_DETAILS)).toBe(false)
    expect(hasPersonalDetails({ ...EMPTY_PERSONAL_DETAILS, email: '   ' })).toBe(false)
    expect(hasPersonalDetails({ ...EMPTY_PERSONAL_DETAILS, phone: '+91 123' })).toBe(true)
  })

  it.each([
    ['fullName', 'Full name', 0.32, 0.07],
    ['phone', 'Phone', 0.32, 0.07],
    ['email', 'Email', 0.38, 0.07],
    ['company', 'Company', 0.38, 0.07],
  ] as const)('prepares %s as exact one-line 14pt text', (id, label, width, height) => {
    expect(preparedDetailPlacement(id, '  Exact value  ')).toEqual({
      id,
      label,
      text: 'Exact value',
      width,
      height,
      fontSize: 14,
    })
  })

  it('gives a literal multiline address a wider, taller placement', () => {
    expect(preparedDetailPlacement('address', '  42 Paper Street\nBengaluru  ')).toEqual({
      id: 'address',
      label: 'Address',
      text: '42 Paper Street\nBengaluru',
      width: 0.42,
      height: 0.13,
      fontSize: 14,
    })
  })

  it('refuses blank and over-limit prepared values', () => {
    expect(preparedDetailPlacement('fullName', '   ')).toBeNull()
    expect(preparedDetailPlacement('phone', '1'.repeat(81))).toBeNull()
  })
})
