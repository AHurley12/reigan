import { describe, expect, it } from 'vitest'
import { sanitizeCredential } from './credentials'

/**
 * Pinned against a real incident: a Google OAuth client ID was saved as
 * `"220819498258-….apps.googleusercontent.com"`, quotes and all. Every API call
 * kept working — they carry only the bearer token — and the failure surfaced an
 * hour later as an unexplained sign-out when the token refresh sent the
 * malformed id.
 */
describe('sanitizeCredential', () => {
  it('strips wrapping double quotes from a pasted client ID', () => {
    expect(sanitizeCredential('"220819498258-abc.apps.googleusercontent.com"')).toBe(
      '220819498258-abc.apps.googleusercontent.com'
    )
  })

  it('strips wrapping single quotes', () => {
    expect(sanitizeCredential("'GOCSPX-secret'")).toBe('GOCSPX-secret')
  })

  it('trims whitespace and trailing newlines', () => {
    expect(sanitizeCredential('  sk-ant-key\n')).toBe('sk-ant-key')
  })

  it('trims inside the quotes too', () => {
    expect(sanitizeCredential('" key "')).toBe('key')
  })

  it('leaves an unquoted credential untouched', () => {
    expect(sanitizeCredential('GOCSPX-plain_value')).toBe('GOCSPX-plain_value')
  })

  it('leaves interior quotes alone', () => {
    expect(sanitizeCredential('ab"cd')).toBe('ab"cd')
  })

  it('leaves unbalanced quotes alone rather than eating half of them', () => {
    expect(sanitizeCredential('"abc')).toBe('"abc')
    expect(sanitizeCredential('abc"')).toBe('abc"')
    expect(sanitizeCredential('\'abc"')).toBe('\'abc"')
  })

  it('strips only one layer', () => {
    expect(sanitizeCredential('""abc""')).toBe('"abc"')
  })

  it('handles empty and quote-only input without throwing', () => {
    expect(sanitizeCredential('')).toBe('')
    expect(sanitizeCredential('   ')).toBe('')
    expect(sanitizeCredential('""')).toBe('')
    expect(sanitizeCredential('"')).toBe('"')
  })
})
