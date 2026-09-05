export type DatePresetFormat =
  | 'day-month'
  | 'month-day'
  | 'day-first'
  | 'iso'

export type DateStampFormat = DatePresetFormat | 'custom'

export const DATE_FORMATS = [
  { id: 'day-month', label: 'Day month' },
  { id: 'month-day', label: 'Month day' },
  { id: 'day-first', label: 'Day first' },
  { id: 'iso', label: 'ISO' },
] as const satisfies ReadonlyArray<{
  id: DatePresetFormat
  label: string
}>

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

interface DateParts {
  year: number
  month: number
  day: number
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function parseDateValue(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return null

  const probe = new Date(0)
  probe.setUTCHours(0, 0, 0, 0)
  probe.setUTCFullYear(year, month - 1, day)
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day
    ? { year, month, day }
    : null
}

export function isDateValue(value: unknown): value is string {
  return typeof value === 'string' && parseDateValue(value) !== null
}

export function localDateValue(date: Date): string | null {
  const time = date.getTime()
  if (!Number.isFinite(time)) return null
  const year = date.getFullYear()
  if (year < 1 || year > 9999) return null
  return `${pad(year, 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateValue(
  value: string,
  format: DatePresetFormat,
): string | null {
  const parts = parseDateValue(value)
  if (!parts) return null
  const month = SHORT_MONTHS[parts.month - 1]
  if (format === 'day-month') return `${parts.day} ${month} ${parts.year}`
  if (format === 'month-day') return `${month} ${parts.day}, ${parts.year}`
  if (format === 'day-first') {
    return `${pad(parts.day)}/${pad(parts.month)}/${pad(parts.year, 4)}`
  }
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
}

export function createDateStampValue(date: Date): {
  dateValue: string
  dateFormat: DatePresetFormat
  label: string
} | null {
  const dateValue = localDateValue(date)
  if (!dateValue) return null
  const label = formatDateValue(dateValue, 'day-month')
  return label ? { dateValue, dateFormat: 'day-month', label } : null
}
