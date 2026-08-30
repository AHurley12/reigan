import { describe, it, expect } from 'vitest'
import {
  AGENT_EDITABLE_SETTINGS,
  AGENT_LOCKED_SETTINGS,
  describeSettingValue,
  findEditableSetting,
  validateSettingValue,
  type EditableSetting,
} from './settingsCatalog'
import { SECRET_SETTING_KEYS } from './secretKeys'

const bool = (): EditableSetting => ({ key: 'k', label: 'Thing', kind: 'boolean', description: '' })
const num = (over: Partial<EditableSetting> = {}): EditableSetting => ({
  key: 'k',
  label: 'Thing',
  kind: 'number',
  description: '',
  min: 0,
  max: 1,
  ...over,
})
const enumSetting = (): EditableSetting => ({
  key: 'k',
  label: 'Thing',
  kind: 'enum',
  description: '',
  options: [
    { value: 'sakura', label: 'Sakura' },
    { value: 'shingan', label: 'Shingan' },
  ],
})

describe('the locked list is the security boundary', () => {
  it('locks every credential, so a prompt injection cannot rewrite a key', () => {
    for (const key of SECRET_SETTING_KEYS) {
      expect(AGENT_LOCKED_SETTINGS[key], `${key} must be locked`).toBeTruthy()
    }
  })

  it('locks the approval switch, so the assistant cannot stop itself being asked about', () => {
    expect(AGENT_LOCKED_SETTINGS.requireApprovalForAllCapabilities).toBeTruthy()
  })

  it('locks personality mode, so unbridled cannot be self-granted', () => {
    expect(AGENT_LOCKED_SETTINGS.personalityMode).toBeTruthy()
    expect(AGENT_LOCKED_SETTINGS.unbridledModeAcknowledged).toBeTruthy()
  })

  it('never lists a key as both editable and locked', () => {
    for (const setting of AGENT_EDITABLE_SETTINGS) {
      expect(AGENT_LOCKED_SETTINGS[setting.key], `${setting.key} is in both lists`).toBeUndefined()
    }
  })

  it('gives a reason for every lock, so the list stays auditable', () => {
    for (const [key, reason] of Object.entries(AGENT_LOCKED_SETTINGS)) {
      expect(reason.length, `${key} has an empty reason`).toBeGreaterThan(10)
    }
  })
})

describe('the editable list is well formed', () => {
  it('has unique keys', () => {
    const keys = AGENT_EDITABLE_SETTINGS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('describes every setting for the model', () => {
    for (const s of AGENT_EDITABLE_SETTINGS) {
      if (s.key === 'voiceId') continue // options filled in at runtime
      expect(s.description.length, `${s.key} needs a description`).toBeGreaterThan(10)
      if (s.kind === 'enum') expect(s.options?.length, `${s.key} needs options`).toBeGreaterThan(0)
    }
  })

  it('finds a setting by key', () => {
    expect(findEditableSetting('theme')?.label).toBe('Theme')
    expect(findEditableSetting('anthropicApiKey')).toBeUndefined()
  })
})

describe('validateSettingValue', () => {
  it('accepts a real boolean and the string forms a model tends to emit', () => {
    expect(validateSettingValue(bool(), true)).toEqual({ ok: true, value: true })
    expect(validateSettingValue(bool(), 'false')).toEqual({ ok: true, value: false })
  })

  it('rejects a non-boolean rather than coercing it to true', () => {
    const r = validateSettingValue(bool(), 'yes please')
    expect(r.ok).toBe(false)
  })

  it('accepts numbers in range and numeric strings', () => {
    expect(validateSettingValue(num(), 0.5)).toEqual({ ok: true, value: 0.5 })
    expect(validateSettingValue(num(), '0.25')).toEqual({ ok: true, value: 0.25 })
  })

  it('rejects out-of-range numbers, which the old union type let straight through', () => {
    expect(validateSettingValue(num(), 47).ok).toBe(false)
    expect(validateSettingValue(num(), -1).ok).toBe(false)
  })

  it('rejects a fractional value for an integer setting', () => {
    expect(validateSettingValue(num({ max: 100, integer: true }), 2.5).ok).toBe(false)
  })

  it('rejects text where a number belongs', () => {
    expect(validateSettingValue(num(), 'quite high').ok).toBe(false)
  })

  it('accepts an enum value exactly', () => {
    expect(validateSettingValue(enumSetting(), 'sakura')).toEqual({ ok: true, value: 'sakura' })
  })

  it('accepts an enum by its label or a differently-cased spelling', () => {
    expect(validateSettingValue(enumSetting(), 'Sakura')).toEqual({ ok: true, value: 'sakura' })
    expect(validateSettingValue(enumSetting(), 'SHINGAN')).toEqual({ ok: true, value: 'shingan' })
  })

  it('rejects an unknown enum value and says what is allowed', () => {
    const r = validateSettingValue(enumSetting(), 'neon')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('sakura')
  })

  it('handles a numeric enum given as a string', () => {
    const level = findEditableSetting('japaneseLevel')!
    expect(validateSettingValue(level, '2')).toEqual({ ok: true, value: 2 })
    expect(validateSettingValue(level, 1)).toEqual({ ok: true, value: 1 })
    expect(validateSettingValue(level, 9).ok).toBe(false)
  })

  it('validates the real japaneseLevel setting against a bad word value', () => {
    expect(validateSettingValue(findEditableSetting('japaneseLevel')!, 'high').ok).toBe(false)
  })
})

describe('describeSettingValue', () => {
  it('prefers the option label over the raw value', () => {
    expect(describeSettingValue(enumSetting(), 'sakura')).toBe('Sakura')
  })

  it('reads booleans as on/off', () => {
    expect(describeSettingValue(bool(), true)).toBe('on')
    expect(describeSettingValue(bool(), false)).toBe('off')
  })

  it('calls an unset value default rather than null', () => {
    expect(describeSettingValue(num(), null)).toBe('default')
  })
})
