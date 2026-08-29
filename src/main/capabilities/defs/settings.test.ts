import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The settings row store, faked. The capability's job is validation, name
 * resolution and diffing — none of which needs SQLite to be real, and all of
 * which is obscured by a migration run in the output.
 */
const store = new Map<string, string>()

vi.mock('../../db/queries', () => ({
  getSetting: (key: string) => store.get(key) ?? null,
  setSetting: (key: string, value: string) => void store.set(key, value),
  getDecodedSetting: (key: string) => {
    const raw = store.get(key)
    if (raw === undefined) return null
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : raw
    } catch {
      return raw
    }
  },
}))

const broadcast = vi.fn()
vi.mock('../../settings/broadcast', () => ({
  broadcastSettingChange: (key: string, value: unknown) => broadcast(key, value),
}))

// No ElevenLabs account in a unit test: the capability must fall back to the
// built-in catalogue, which is also the offline path users will hit.
const listVoices = vi.fn(async (): Promise<null | Array<{ value: string; label: string }>> => null)
vi.mock('../../voice/voiceLibrary', () => ({
  listElevenLabsVoices: () => listVoices(),
}))

import { settingsCapabilities } from './settings'
import { CapabilityError } from '../types'

const cap = (id: string) => settingsCapabilities.find((c) => c.id === id)!
/**
 * Async so a handler that throws synchronously — the settings ones do, since
 * they need no I/O — still surfaces as a rejection the `.rejects` matchers can
 * see, rather than blowing up at the call site.
 */
const run = async (id: string, args: unknown = {}) => {
  const c = cap(id)
  return c.handler(c.schema.parse(args), { invokedBy: 'agent' })
}
const write = (key: string, value: unknown) => store.set(key, JSON.stringify(value))

beforeEach(() => {
  store.clear()
  broadcast.mockClear()
  listVoices.mockClear()
  listVoices.mockResolvedValue(null)
})

describe('the capability surface', () => {
  it('registers the five operations', () => {
    expect(settingsCapabilities.map((c) => c.id).sort()).toEqual([
      'settings.list',
      'settings.set',
      'settings.toggle',
      'voice.list',
      'voice.set',
    ])
  })

  it('gates every mutating operation behind an approval card with a diff', () => {
    for (const id of ['settings.set', 'settings.toggle', 'voice.set']) {
      expect(cap(id).risk, `${id} must be a write`).toBe('write')
      expect(cap(id).approval?.summary, `${id} needs a summary`).toBeTypeOf('function')
      expect(cap(id).approval?.diff, `${id} needs a diff`).toBeTypeOf('function')
    }
  })

  it('leaves the read operations unprompted', () => {
    expect(cap('settings.list').risk).toBe('read')
    expect(cap('voice.list').risk).toBe('network')
  })
})

describe('settings.set', () => {
  it('changes a setting and reports what it was before', async () => {
    write('theme', 'shingan')
    const result = await run('settings.set', { key: 'theme', value: 'sakura' })

    expect(store.get('theme')).toBe('"sakura"')
    expect(result).toContain('Sakura')
    expect(result).toContain('was Shingan')
  })

  it('tells the renderer, so the live UI moves rather than waiting for a restart', async () => {
    await run('settings.set', { key: 'theme', value: 'sakura' })
    expect(broadcast).toHaveBeenCalledWith('theme', 'sakura')
  })

  it('refuses a credential, with the reason the model can relay', async () => {
    await expect(run('settings.set', { key: 'anthropicApiKey', value: 'sk-leak' })).rejects.toThrow(
      /Settings, never through chat/
    )
    expect(store.has('anthropicApiKey')).toBe(false)
  })

  it('refuses to disable its own approval gate', async () => {
    await expect(
      run('settings.set', { key: 'requireApprovalForAllCapabilities', value: false })
    ).rejects.toThrow(/Only the user may change it/)
    expect(store.has('requireApprovalForAllCapabilities')).toBe(false)
  })

  it('refuses to grant itself unbridled personality', async () => {
    await expect(run('settings.set', { key: 'personalityMode', value: 'unbridled' })).rejects.toThrow(
      /user’s choice/
    )
  })

  it('rejects a value outside the setting’s range instead of storing it', async () => {
    await expect(run('settings.set', { key: 'ttsStability', value: 47 })).rejects.toThrow(/at most 1/)
    expect(store.has('ttsStability')).toBe(false)
  })

  it('rejects a nonsense enum value and lists the real ones', async () => {
    await expect(run('settings.set', { key: 'theme', value: 'neon' })).rejects.toThrow(/sakura/)
  })

  it('rejects an unknown setting and says what exists', async () => {
    await expect(run('settings.set', { key: 'nonsense', value: 1 })).rejects.toThrow(
      /no changeable setting called "nonsense"/
    )
  })

  it('accepts an enum given by its display label', async () => {
    await run('settings.set', { key: 'theme', value: 'Sakura' })
    expect(store.get('theme')).toBe('"sakura"')
  })

  it('throws a CapabilityError, so the registry reports it rather than crashing the turn', async () => {
    await expect(run('settings.set', { key: 'anthropicApiKey', value: 'x' })).rejects.toBeInstanceOf(
      CapabilityError
    )
  })
})

describe('settings.toggle', () => {
  it('flips a setting that is on', async () => {
    write('showFurigana', true)
    const result = await run('settings.toggle', { key: 'showFurigana' })

    expect(store.get('showFurigana')).toBe('false')
    expect(result).toContain('off')
  })

  it('flips a setting that is off', async () => {
    write('showFurigana', false)
    await run('settings.toggle', { key: 'showFurigana' })
    expect(store.get('showFurigana')).toBe('true')
  })

  it('honours an explicit value rather than flipping', async () => {
    write('showRomaji', true)
    await run('settings.toggle', { key: 'showRomaji', value: true })
    expect(store.get('showRomaji')).toBe('true')
  })

  it('turns an unset setting on, which is what "toggle it" means to the user', async () => {
    // thinkingEnabled ships false, so a flip must produce true.
    await run('settings.toggle', { key: 'thinkingEnabled' })
    expect(store.get('thinkingEnabled')).toBe('true')
  })

  it('refuses a setting that is not on/off, pointing at the right tool', async () => {
    await expect(run('settings.toggle', { key: 'theme' })).rejects.toThrow(/not an on\/off setting/)
  })

  it('will not toggle a locked setting', async () => {
    await expect(run('settings.toggle', { key: 'unbridledModeAcknowledged' })).rejects.toThrow(
      /cannot be self-granted/
    )
  })
})

describe('voice.set', () => {
  it('switches to Zenya by name — the case the raw id made impossible', async () => {
    write('voiceId', 'pNInz6obpgDQGcFmaJgB')
    const result = await run('voice.set', { voice: 'zenya' })

    expect(store.get('voiceId')).toBe('"f5iYMGdlB5CJwK2vhzsS"')
    expect(result).toContain('Zenya')
    expect(result).toContain('was Adam (US)')
  })

  it('switches to Arabella despite the accent tag in her label', async () => {
    await run('voice.set', { voice: 'Arabella' })
    expect(store.get('voiceId')).toBe('"aEO01A4wXwd1O8GPgGlF"')
  })

  it('accepts a raw voice id too', async () => {
    await run('voice.set', { voice: 'EST9Ui6982FZPSi7gCHi' })
    expect(store.get('voiceId')).toBe('"EST9Ui6982FZPSi7gCHi"')
  })

  it('pushes the change to the renderer', async () => {
    await run('voice.set', { voice: 'zenya' })
    expect(broadcast).toHaveBeenCalledWith('voiceId', 'f5iYMGdlB5CJwK2vhzsS')
  })

  it('names the real voices when asked for one that does not exist', async () => {
    await expect(run('voice.set', { voice: 'Morgan Freeman' })).rejects.toThrow(/Zenya/)
    expect(store.has('voiceId')).toBe(false)
  })

  it('asks rather than guessing when a name matches two voices', async () => {
    listVoices.mockResolvedValue([{ value: 'x1', label: 'Zenobia' }])
    await expect(run('voice.set', { voice: 'zen' })).rejects.toThrow(/more than one voice/)
    expect(store.has('voiceId')).toBe(false)
  })

  it('finds a voice that exists only on the user’s ElevenLabs account', async () => {
    listVoices.mockResolvedValue([{ value: 'custom-1', label: 'Kaguya' }])
    await run('voice.set', { voice: 'kaguya' })
    expect(store.get('voiceId')).toBe('"custom-1"')
  })

  it('still resolves built-in voices when ElevenLabs is unreachable', async () => {
    listVoices.mockResolvedValue(null)
    await run('voice.set', { voice: 'Charlotte' })
    expect(store.get('voiceId')).toBe('"6fZce9LFNG3iEITDfqZZ"')
  })

  it('shows the voice change as a before/after on the approval card', async () => {
    write('voiceId', 'pNInz6obpgDQGcFmaJgB')
    const diff = await cap('voice.set').approval!.diff!({ voice: 'zenya' })

    expect(diff).toEqual({
      subject: 'Voice',
      changes: [{ field: 'Voice', before: 'Adam (US)', after: 'Zenya' }],
    })
  })

  it('produces no diff for an unresolvable voice rather than throwing inside the card', async () => {
    await expect(cap('voice.set').approval!.diff!({ voice: 'nobody' })).resolves.toBeNull()
  })
})

describe('the approval card', () => {
  it('describes a settings change in plain language, not raw JSON', () => {
    write('theme', 'shingan')
    expect(cap('settings.set').approval!.summary({ key: 'theme', value: 'sakura' })).toBe(
      'Change Theme to Sakura.'
    )
  })

  it('shows what the setting was before, which the old tool never did', async () => {
    write('theme', 'shingan')
    const diff = await cap('settings.set').approval!.diff!({ key: 'theme', value: 'sakura' })
    expect(diff).toEqual({
      subject: 'Theme',
      changes: [{ field: 'Theme', before: 'Shingan', after: 'Sakura' }],
    })
  })

  it('says which way a toggle will go', () => {
    write('showFurigana', true)
    expect(cap('settings.toggle').approval!.summary({ key: 'showFurigana' })).toBe('Turn Furigana off.')
  })

  /**
   * `registry.ts` wraps `spec.diff()` in a try/catch but calls `spec.summary()`
   * bare, so a summary that throws does not degrade — it escapes
   * `invokeCapability` and aborts the whole agent turn. The refusal for a
   * locked key has to arrive from the handler, as a message, which means the
   * summary must survive being asked about a key it will ultimately refuse.
   */
  it('never throws for a locked or unknown key, which would abort the agent turn', () => {
    for (const key of ['anthropicApiKey', 'requireApprovalForAllCapabilities', 'nonsense']) {
      expect(() => cap('settings.set').approval!.summary({ key, value: 'x' }), key).not.toThrow()
      expect(() => cap('settings.toggle').approval!.summary({ key }), key).not.toThrow()
    }
  })

  // These diffs are synchronous; the registry awaits either form.
  it('produces no diff for a locked or unknown key rather than throwing', () => {
    for (const key of ['anthropicApiKey', 'nonsense']) {
      expect(cap('settings.set').approval!.diff!({ key, value: 'x' }), key).toBeNull()
      expect(cap('settings.toggle').approval!.diff!({ key }), key).toBeNull()
    }
  })
})

describe('settings.list', () => {
  it('reports current values and never leaks a credential', async () => {
    write('theme', 'sakura')
    write('anthropicApiKey', 'sk-secret-value')

    const result = (await run('settings.list')) as {
      editable: Array<{ key: string; current: string }>
      locked: Record<string, string>
    }

    expect(result.editable.find((s) => s.key === 'theme')?.current).toBe('Sakura')
    expect(result.editable.some((s) => s.key === 'anthropicApiKey')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('sk-secret-value')
  })

  it('explains what it cannot change, so a refusal can be justified', async () => {
    const result = (await run('settings.list')) as { locked: Record<string, string> }
    expect(result.locked.requireApprovalForAllCapabilities).toBeTruthy()
  })

  it('falls back to the shipped default for a setting never saved', async () => {
    const result = (await run('settings.list')) as { editable: Array<{ key: string; current: string }> }
    // DEFAULT_SETTINGS.theme is 'shingan'.
    expect(result.editable.find((s) => s.key === 'theme')?.current).toBe('Shingan')
  })
})

describe('voice.list', () => {
  it('names the current voice and the ones available', async () => {
    write('voiceId', 'f5iYMGdlB5CJwK2vhzsS')
    const result = (await run('voice.list')) as { current: string; live: boolean; voices: string[] }

    expect(result.current).toBe('Zenya')
    expect(result.voices).toContain('Arabella (AU)')
    expect(result.live).toBe(false)
  })

  it('includes the account’s own voices when ElevenLabs answers', async () => {
    listVoices.mockResolvedValue([{ value: 'custom-1', label: 'Kaguya' }])
    const result = (await run('voice.list')) as { live: boolean; voices: string[] }

    expect(result.live).toBe(true)
    expect(result.voices).toContain('Kaguya')
  })
})
