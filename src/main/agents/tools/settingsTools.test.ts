import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-settings-tools-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../../db/database')
const { setSetting } = await import('../../db/queries')
const { SECRET_SETTING_KEYS } = await import('../../db/secrets')
const { getSettingsTool } = await import('./settingsTools')

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

const read = (): Promise<string> => getSettingsTool.func({} as never) as Promise<string>

describe('get_settings', () => {
  it('never discloses the Google OAuth token blob', async () => {
    // The bug this pins: `googleTokens` was missing from this tool's own copy of
    // the secret list, so every `get_settings` call handed the model — and the
    // transcript, and any log of it — a live refresh token in plaintext. The
    // token is the credential that matters most here: it outlives the access
    // token and re-mints it on demand.
    setSetting(
      'googleTokens',
      JSON.stringify({
        access_token: 'ya29.SECRET-ACCESS',
        refresh_token: '1//SECRET-REFRESH',
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
      })
    )

    const out = await read()

    expect(out).not.toContain('SECRET-ACCESS')
    expect(out).not.toContain('SECRET-REFRESH')
    expect(out).toContain('googleTokens: (set)')
  })

  it('masks every key the storage layer treats as a credential', async () => {
    // The root cause was two hand-maintained lists drifting apart, so the
    // invariant worth pinning is the agreement itself rather than any one key:
    // whatever db/secrets.ts encrypts at rest, this tool must not disclose.
    for (const key of SECRET_SETTING_KEYS) {
      setSetting(key, `VALUE-OF-${key}`)
    }

    const out = await read()

    for (const key of SECRET_SETTING_KEYS) {
      expect(out, `${key} leaked through get_settings`).not.toContain(`VALUE-OF-${key}`)
      expect(out).toContain(`${key}: (set)`)
    }
  })

  it('distinguishes a stored credential from an absent one', async () => {
    setSetting('deepgramApiKey', '')

    const out = await read()

    expect(out).toContain('deepgramApiKey: (not set)')
  })

  it('still reports ordinary preferences by value', async () => {
    // The masking must not turn the tool into a wall of "(set)" — reading the
    // user's actual preferences is the reason it exists.
    setSetting('japaneseLevel', JSON.stringify('N3'))

    const out = await read()

    expect(out).toContain('japaneseLevel: "N3"')
  })
})
