export type SignatureStyleId = 'script' | 'classic' | 'clean'

export type SignatureTextMode = 'full' | 'initials'

export interface SignatureStyle {
  id: SignatureStyleId
  label: string
  canvasFamily: string
  cssFamily: string
  size: number
}

export const SIGNATURE_STYLES = [
  {
    id: 'script',
    label: 'Script',
    canvasFamily:
      '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive',
    cssFamily:
      '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive',
    size: 136,
  },
  {
    id: 'classic',
    label: 'Classic',
    canvasFamily: 'Baskerville, Georgia, "Times New Roman", serif',
    cssFamily: 'Baskerville, Georgia, "Times New Roman", serif',
    size: 118,
  },
  {
    id: 'clean',
    label: 'Clean',
    canvasFamily: '"Avenir Next", "Segoe UI", Arial, sans-serif',
    cssFamily: '"Avenir Next", "Segoe UI", Arial, sans-serif',
    size: 106,
  },
] as const satisfies readonly SignatureStyle[]

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ')
}

function initialsFromName(name: string): string {
  const initials = normalizeName(name)
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase()

  return Array.from(initials).slice(0, 6).join('')
}

export function signatureTextForName(
  name: string,
  mode: SignatureTextMode,
): string {
  return mode === 'initials' ? initialsFromName(name) : normalizeName(name)
}

export function suggestedSignatureName(
  name: string,
  mode: SignatureTextMode,
): string {
  const signatureText = signatureTextForName(name, mode)
  if (!signatureText) return ''
  return mode === 'initials' ? `${signatureText} initials` : signatureText
}
