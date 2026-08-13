import { describe, it, expect } from 'vitest'
import { resolveModelChoice, NONE_OPTION, CUSTOM_OPTION } from './modelChoice'

const PRESETS = ['riruka', 'anime-girl', 'anime-girl-3d-model'] as const

function resolve(over: Partial<Parameters<typeof resolveModelChoice>[0]> = {}) {
  return resolveModelChoice({
    saved: NONE_OPTION,
    hasCustomOnDisk: false,
    presetIds: PRESETS,
    readFailed: false,
    ...over,
  })
}

describe('resolveModelChoice', () => {
  // The regression this module exists for: None was persisted, but startup
  // resolved to a default and put an avatar on a stage the user had emptied.
  it('keeps the empty stage empty when None was the saved choice', () => {
    expect(resolve({ saved: NONE_OPTION })).toEqual({ choice: NONE_OPTION, persist: false })
  })

  it('keeps None even when a custom model is sitting on disk', () => {
    // Bytes on disk make the entry selectable again; they must not make it active.
    expect(resolve({ saved: NONE_OPTION, hasCustomOnDisk: true })).toEqual({
      choice: NONE_OPTION,
      persist: false,
    })
  })

  it('restores a saved preset untouched', () => {
    expect(resolve({ saved: 'anime-girl' })).toEqual({ choice: 'anime-girl', persist: false })
  })

  it('restores the custom model when its bytes came back', () => {
    expect(resolve({ saved: CUSTOM_OPTION, hasCustomOnDisk: true })).toEqual({
      choice: CUSTOM_OPTION,
      persist: false,
    })
  })

  it('falls back to None — not to another avatar — when the custom bytes are gone', () => {
    expect(resolve({ saved: CUSTOM_OPTION, hasCustomOnDisk: false })).toEqual({
      choice: NONE_OPTION,
      persist: true,
    })
  })

  it('falls back to None when the saved preset no longer ships', () => {
    expect(resolve({ saved: 'preset-deleted-two-releases-ago' })).toEqual({
      choice: NONE_OPTION,
      persist: true,
    })
  })

  it('falls back to None when nothing was ever saved', () => {
    expect(resolve({ saved: undefined })).toEqual({ choice: NONE_OPTION, persist: true })
  })

  it('does not persist the fallback when the disk read threw', () => {
    // Transient IPC failure — the stored choice stays put so the next launch
    // can still honour it.
    expect(resolve({ saved: CUSTOM_OPTION, hasCustomOnDisk: false, readFailed: true })).toEqual({
      choice: NONE_OPTION,
      persist: false,
    })
  })

  it('never persists when the choice already agrees with what was stored', () => {
    for (const saved of [...PRESETS, NONE_OPTION]) {
      expect(resolve({ saved, hasCustomOnDisk: true }).persist).toBe(false)
    }
  })
})
