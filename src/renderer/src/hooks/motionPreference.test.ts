import { describe, it, expect } from 'vitest'
import { resolveReducedMotion, normalizeMotion, isMotionPreference } from './motionPreference'

describe('resolveReducedMotion', () => {
  it('follows the system when set to system', () => {
    expect(resolveReducedMotion('system', true)).toBe(true)
    expect(resolveReducedMotion('system', false)).toBe(false)
  })

  it('reduces on request even when the system does not ask for it', () => {
    expect(resolveReducedMotion('reduce', false)).toBe(true)
  })

  /**
   * The regression this whole change exists for. The previous implementation
   * was `settingOverride || systemPref`, which returns true here — leaving a
   * machine whose OS reduces motion with no way to see any animation at all.
   */
  it('allows full motion to override a system that asks for reduction', () => {
    expect(resolveReducedMotion('full', true)).toBe(false)
  })
})

describe('normalizeMotion', () => {
  it('keeps a valid stored preference', () => {
    expect(normalizeMotion('full')).toBe('full')
    expect(normalizeMotion('reduce')).toBe('reduce')
    expect(normalizeMotion('system')).toBe('system')
  })

  it('migrates the legacy boolean without losing an opt-in', () => {
    expect(normalizeMotion(undefined, true)).toBe('reduce')
  })

  it('treats a legacy false as following the system, not as forcing full', () => {
    // `false` never meant "override the OS" — it meant "add nothing".
    expect(normalizeMotion(undefined, false)).toBe('system')
  })

  it('falls back to the system for anything unrecognised', () => {
    expect(normalizeMotion(null)).toBe('system')
    expect(normalizeMotion('nonsense')).toBe('system')
    expect(normalizeMotion(1)).toBe('system')
  })
})

describe('isMotionPreference', () => {
  it('accepts only the three states', () => {
    expect(isMotionPreference('system')).toBe(true)
    expect(isMotionPreference('reduce')).toBe(true)
    expect(isMotionPreference('full')).toBe(true)
    expect(isMotionPreference(true)).toBe(false)
    expect(isMotionPreference('reduced')).toBe(false)
  })
})
