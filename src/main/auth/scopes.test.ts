import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.REIGAN_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'reigan-scopes-'))

const { SCOPES, SCOPE_GROUPS } = await import('./googleAuth')

/**
 * The mail automation creates Gmail drafts and never sends. That guarantee is
 * only worth as much as its enforcement, so it is asserted here as well as
 * checked at module load — a future edit that adds a send scope in a hurry
 * fails the build rather than shipping.
 */
describe('Google OAuth scopes', () => {
  it('never requests permission to send mail', () => {
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/gmail.send')
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/gmail.compose')
    // The catch-all scope grants send implicitly, which is easy to miss.
    expect(SCOPES).not.toContain('https://mail.google.com/')
  })

  it('requests only gmail.modify, which covers labels and drafts', () => {
    const gmailScopes = SCOPES.filter((s) => s.includes('gmail') || s.includes('mail.google'))
    expect(gmailScopes).toEqual(['https://www.googleapis.com/auth/gmail.modify'])
  })

  it('does not hold upload rights before anything can upload', () => {
    // Added in Phase 3 alongside the publish step, not before.
    expect(SCOPES).not.toContain('https://www.googleapis.com/auth/youtube.upload')
  })

  it('requests the three YouTube scopes the channel manager needs', () => {
    expect(SCOPES).toContain('https://www.googleapis.com/auth/youtube.readonly')
    expect(SCOPES).toContain('https://www.googleapis.com/auth/yt-analytics.readonly')
    expect(SCOPES).toContain('https://www.googleapis.com/auth/youtube.force-ssl')
  })

  it('keeps every scope group inside the requested set', () => {
    for (const [group, scopes] of Object.entries(SCOPE_GROUPS)) {
      for (const scope of scopes) {
        expect(SCOPES, `${group} requires ${scope}`).toContain(scope)
      }
    }
  })
})
