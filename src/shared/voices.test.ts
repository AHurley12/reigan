import { describe, it, expect } from 'vitest'
import {
  VOICE_CATALOGUE,
  normalizeVoiceName,
  resolveVoice,
  voiceLabel,
  type VoiceOption,
} from './voices'

describe('normalizeVoiceName', () => {
  it('drops the accent parenthetical, so a spoken name matches the dropdown label', () => {
    expect(normalizeVoiceName('Arabella (AU)')).toBe('arabella')
    expect(normalizeVoiceName('Adam (US)')).toBe('adam')
  })

  it('casefolds and strips punctuation and spacing', () => {
    expect(normalizeVoiceName('  ZENYA  ')).toBe('zenya')
    expect(normalizeVoiceName('St. Clair-Smith')).toBe('stclairsmith')
  })
})

describe('resolveVoice', () => {
  it('resolves the two names the user actually asked for', () => {
    const zenya = resolveVoice('zenya')
    expect(zenya.status).toBe('ok')
    expect(zenya.status === 'ok' && zenya.voice.value).toBe('f5iYMGdlB5CJwK2vhzsS')

    const arabella = resolveVoice('arabella')
    expect(arabella.status).toBe('ok')
    expect(arabella.status === 'ok' && arabella.voice.value).toBe('aEO01A4wXwd1O8GPgGlF')
  })

  it('accepts a raw voice id unchanged', () => {
    const r = resolveVoice('JBFqnCBsd6RMkjVDRZzb')
    expect(r.status === 'ok' && r.voice.label).toBe('George (UK)')
  })

  it('accepts the full label including the accent tag', () => {
    const r = resolveVoice('Arabella (AU)')
    expect(r.status === 'ok' && r.voice.value).toBe('aEO01A4wXwd1O8GPgGlF')
  })

  it('is case- and whitespace-insensitive', () => {
    const r = resolveVoice('  ZeNyA ')
    expect(r.status === 'ok' && r.voice.label).toBe('Zenya')
  })

  it('matches on a prefix', () => {
    const r = resolveVoice('char')
    expect(r.status === 'ok' && r.voice.label).toBe('Charlotte')
  })

  it('honours an explicit alias', () => {
    const catalogue: VoiceOption[] = [{ value: 'v1', label: 'Zenya', aliases: ['zen', 'zenia'] }]
    expect(resolveVoice('zenia', catalogue).status).toBe('ok')
  })

  it('reports ambiguity rather than guessing between two matches', () => {
    const catalogue: VoiceOption[] = [
      { value: 'a', label: 'Aria' },
      { value: 'b', label: 'Arabella (AU)' },
    ]
    const r = resolveVoice('ar', catalogue)
    expect(r.status).toBe('ambiguous')
    expect(r.status === 'ambiguous' && r.matches).toHaveLength(2)
  })

  it('prefers an exact match over a longer voice that merely starts the same', () => {
    const catalogue: VoiceOption[] = [
      { value: 'a', label: 'Ara' },
      { value: 'b', label: 'Arabella' },
    ]
    const r = resolveVoice('ara', catalogue)
    expect(r.status === 'ok' && r.voice.value).toBe('a')
  })

  it('returns none for a voice that is not in the catalogue', () => {
    expect(resolveVoice('morgan freeman').status).toBe('none')
  })

  it('returns none for empty or punctuation-only input rather than matching everything', () => {
    expect(resolveVoice('').status).toBe('none')
    expect(resolveVoice('   ').status).toBe('none')
    expect(resolveVoice('!!!').status).toBe('none')
  })
})

describe('VOICE_CATALOGUE', () => {
  it('has unique ids and unique normalised names, so resolution is deterministic', () => {
    const ids = VOICE_CATALOGUE.map((v) => v.value)
    expect(new Set(ids).size).toBe(ids.length)

    const names = VOICE_CATALOGUE.map((v) => normalizeVoiceName(v.label))
    expect(new Set(names).size).toBe(names.length)
  })

  it('resolves every catalogue entry by its own label', () => {
    for (const voice of VOICE_CATALOGUE) {
      const r = resolveVoice(voice.label)
      expect(r.status === 'ok' && r.voice.value).toBe(voice.value)
    }
  })
})

describe('voiceLabel', () => {
  it('names a known voice and falls back to the id for an unknown one', () => {
    expect(voiceLabel('f5iYMGdlB5CJwK2vhzsS')).toBe('Zenya')
    expect(voiceLabel('unknown-id')).toBe('unknown-id')
  })
})
