import { describe, expect, it } from 'vitest'
import {
  DATE_FORMATS,
  createDateStampValue,
  formatDateValue,
  isDateValue,
  localDateValue,
} from './dateStamp'

describe('date stamps', () => {
  it('formats one calendar value in the four supported printed styles', () => {
    expect(formatDateValue('2026-08-30', 'day-month')).toBe('30 Aug 2026')
    expect(formatDateValue('2026-08-30', 'month-day')).toBe('Aug 30, 2026')
    expect(formatDateValue('2026-08-30', 'day-first')).toBe('30/08/2026')
    expect(formatDateValue('2026-08-30', 'iso')).toBe('2026-08-30')
  })

  it('validates real Gregorian dates including leap years', () => {
    expect(isDateValue('2028-02-29')).toBe(true)
    expect(isDateValue('2027-02-29')).toBe(false)
    expect(isDateValue('2026-02-30')).toBe(false)
    expect(isDateValue('2026-13-01')).toBe(false)
    expect(isDateValue('30/08/2026')).toBe(false)
    expect(formatDateValue('2027-02-29', 'day-month')).toBeNull()
  })

  it('extracts the local calendar date without a UTC conversion', () => {
    expect(localDateValue(new Date(2026, 7, 30, 23, 59))).toBe('2026-08-30')
    expect(localDateValue(new Date(Number.NaN))).toBeNull()
  })

  it('creates an internationally readable default date stamp', () => {
    expect(createDateStampValue(new Date(2026, 7, 30))).toEqual({
      dateValue: '2026-08-30',
      dateFormat: 'day-month',
      label: '30 Aug 2026',
    })
    expect(createDateStampValue(new Date(Number.NaN))).toBeNull()
  })

  it('offers exactly the four intentional presets in order', () => {
    expect(DATE_FORMATS.map(({ id }) => id)).toEqual([
      'day-month',
      'month-day',
      'day-first',
      'iso',
    ])
  })
})
