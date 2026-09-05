export type PersonalDetailId = 'fullName' | 'email' | 'phone' | 'company' | 'address'

export interface PersonalDetails {
  fullName: string
  email: string
  phone: string
  company: string
  address: string
}

export interface PersonalDetailField {
  id: PersonalDetailId
  label: string
  maxLength: number
  inputMode: 'text' | 'email' | 'tel'
  multiline?: true
}

export interface PreparedDetailPlacement {
  id: PersonalDetailId
  label: string
  text: string
  width: number
  height: number
  fontSize: number
}

export const PERSONAL_DETAIL_FIELDS: readonly PersonalDetailField[] = [
  { id: 'fullName', label: 'Full name', maxLength: 160, inputMode: 'text' },
  { id: 'email', label: 'Email', maxLength: 254, inputMode: 'email' },
  { id: 'phone', label: 'Phone', maxLength: 80, inputMode: 'tel' },
  { id: 'company', label: 'Company', maxLength: 160, inputMode: 'text' },
  { id: 'address', label: 'Address', maxLength: 500, inputMode: 'text', multiline: true },
]

export const EMPTY_PERSONAL_DETAILS: PersonalDetails = {
  fullName: '',
  email: '',
  phone: '',
  company: '',
  address: '',
}

const PERSONAL_DETAIL_IDS = new Set<PersonalDetailId>(PERSONAL_DETAIL_FIELDS.map(({ id }) => id))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizePersonalDetails(details: PersonalDetails): PersonalDetails {
  return {
    fullName: details.fullName.trim(),
    email: details.email.trim(),
    phone: details.phone.trim(),
    company: details.company.trim(),
    address: details.address.trim(),
  }
}

export function isPersonalDetails(value: unknown): value is PersonalDetails {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== PERSONAL_DETAIL_FIELDS.length || keys.some((key) => !PERSONAL_DETAIL_IDS.has(key as PersonalDetailId))) {
    return false
  }
  return PERSONAL_DETAIL_FIELDS.every(({ id, maxLength }) =>
    typeof value[id] === 'string' && value[id].length <= maxLength)
}

export function hasPersonalDetails(details: PersonalDetails): boolean {
  const normalized = normalizePersonalDetails(details)
  return PERSONAL_DETAIL_FIELDS.some(({ id }) => normalized[id].length > 0)
}

export function preparedDetailPlacement(
  id: PersonalDetailId,
  value: string,
): PreparedDetailPlacement | null {
  const field = PERSONAL_DETAIL_FIELDS.find((candidate) => candidate.id === id)
  if (!field) return null
  const text = value.trim()
  if (!text || text.length > field.maxLength) return null

  const dimensions = id === 'address'
    ? { width: 0.42, height: 0.13 }
    : id === 'email' || id === 'company'
      ? { width: 0.38, height: 0.07 }
      : { width: 0.32, height: 0.07 }

  return {
    id,
    label: field.label,
    text,
    ...dimensions,
    fontSize: 14,
  }
}
