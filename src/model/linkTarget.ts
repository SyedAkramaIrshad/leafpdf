import type { LinkAnnotation } from './editor'

export const LINK_TARGET_MAX_LENGTH = 2048

const URI_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i
const HOST_WITH_PORT_PATTERN = /^[^/?#\s:]+:\d+(?:[/?#]|$)/
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizedWebUrl(target: string): string | null {
  const scheme = URI_SCHEME_PATTERN.exec(target)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https' && !HOST_WITH_PORT_PATTERN.test(target)) {
    return null
  }
  const candidate = scheme === 'http' || scheme === 'https'
    ? target
    : `https://${target}`
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.href
  } catch {
    return null
  }
}

function normalizedEmail(target: string): string | null {
  const address = target.replace(/^mailto:/i, '')
  return EMAIL_PATTERN.test(address) ? `mailto:${address}` : null
}

function normalizedPhone(target: string): string | null {
  const number = target.replace(/^tel:/i, '')
  if (!/^[+0-9().\-\s]+$/.test(number)) return null
  const compact = number.replace(/[().\-\s]/g, '')
  return /^\+?\d{3,15}$/.test(compact) ? `tel:${compact}` : null
}

/**
 * Normalize one external destination without opening or contacting it. Returning
 * null is the single safety boundary used by both the editor and PDF exporter.
 */
export function externalLinkDestination(
  annotation: Pick<LinkAnnotation, 'targetType' | 'target'>,
): string | null {
  const target = annotation.target.trim()
  if (!target || target.length > LINK_TARGET_MAX_LENGTH || containsControlCharacter(target)) {
    return null
  }
  if (annotation.targetType === 'url') return normalizedWebUrl(target)
  if (annotation.targetType === 'email') return normalizedEmail(target)
  return normalizedPhone(target)
}

export function linkTargetMessage(
  annotation: Pick<LinkAnnotation, 'targetType' | 'target'>,
): string {
  const destination = externalLinkDestination(annotation)
  if (destination) return `Ready: ${destination}`
  if (!annotation.target.trim()) {
    if (annotation.targetType === 'url') return 'Enter a web address, for example example.com.'
    if (annotation.targetType === 'email') return 'Enter an email address, for example name@example.com.'
    return 'Enter a phone number with 3 to 15 digits.'
  }
  if (annotation.targetType === 'url') return 'Use a valid http or https web address.'
  if (annotation.targetType === 'email') return 'Use one complete email address.'
  return 'Use 3 to 15 digits; spaces, +, -, and parentheses are allowed.'
}
