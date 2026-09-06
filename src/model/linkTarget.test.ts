import { describe, expect, it } from 'vitest'
import type { LinkAnnotation, LinkTargetType } from './editor'
import {
  LINK_TARGET_MAX_LENGTH,
  externalLinkDestination,
  linkTargetMessage,
} from './linkTarget'

function link(targetType: LinkTargetType, target: string): LinkAnnotation {
  return {
    id: 'link-1',
    pageId: 'page-1',
    kind: 'link',
    x: 0.1,
    y: 0.2,
    width: 0.4,
    height: 0.08,
    targetType,
    target,
  }
}

describe('externalLinkDestination', () => {
  it('normalizes bare and explicit web addresses without contacting them', () => {
    expect(externalLinkDestination(link('url', 'example.com/docs'))).toBe('https://example.com/docs')
    expect(externalLinkDestination(link('url', ' https://EXAMPLE.com/a b '))).toBe('https://example.com/a%20b')
    expect(externalLinkDestination(link('url', 'http://localhost:5173/help'))).toBe('http://localhost:5173/help')
  })

  it('rejects unsafe, malformed, controlled, and oversized web destinations', () => {
    for (const target of [
      'javascript:alert(1)',
      'data:text/html,bad',
      'file:///private/document.pdf',
      'ftp://example.com/file',
      'https://',
      'https://example.com/line\nbreak',
      `https://example.com/${'a'.repeat(LINK_TARGET_MAX_LENGTH)}`,
    ]) {
      expect(externalLinkDestination(link('url', target))).toBeNull()
    }
  })

  it('normalizes one complete ASCII email address', () => {
    expect(externalLinkDestination(link('email', 'hello+pdf@example.com'))).toBe('mailto:hello+pdf@example.com')
    expect(externalLinkDestination(link('email', ' MAILTO:hello@example.com '))).toBe('mailto:hello@example.com')
    expect(externalLinkDestination(link('email', 'hello@example'))).toBeNull()
    expect(externalLinkDestination(link('email', 'hello@example.com?subject=unsafe'))).toBeNull()
  })

  it('normalizes a phone link while keeping a leading international plus', () => {
    expect(externalLinkDestination(link('phone', '+91 (98765) 43210'))).toBe('tel:+919876543210')
    expect(externalLinkDestination(link('phone', 'tel:020-7123-4567'))).toBe('tel:02071234567')
    expect(externalLinkDestination(link('phone', '12'))).toBeNull()
    expect(externalLinkDestination(link('phone', '+1 call me'))).toBeNull()
  })

  it('returns concise type-specific editing guidance', () => {
    expect(linkTargetMessage(link('url', ''))).toMatch(/enter a web address/i)
    expect(linkTargetMessage(link('email', 'not-an-email'))).toMatch(/complete email address/i)
    expect(linkTargetMessage(link('phone', '+91 98765 43210'))).toBe('Ready: tel:+919876543210')
  })
})
