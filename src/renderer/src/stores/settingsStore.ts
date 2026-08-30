import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import { normalizeMotion } from '../hooks/motionPreference'

/** Credential metadata. Never the value — see main's getSecretPreviews(). */
export interface SecretPreview {
  hasValue: boolean
  last4: string
}

interface SettingsStore {
  settings: AppSettings
  /**
   * Keyed by setting key. Credential values arrive from main as empty strings,
   * so this is the only thing the UI has to show that a key is configured.
   */
  secretPreviews: Record<string, SecretPreview>
  loaded: boolean
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  /**
   * Applies a change main made, without writing it back.
   *
   * Distinct from `set` on purpose: `set` echoes to main, so reusing it here
   * would bounce the value straight back to the process that just sent it.
   */
  applyExternalChange: (key: string, value: unknown) => void
  setLoaded: (loaded: boolean) => void
  hydrate: () => Promise<void>
  refreshSecretPreviews: () => Promise<void>
  /** @deprecated use set() — kept only while any stragglers still call it */
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  secretPreviews: {},
  loaded: false,

  set: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
    window.reigan?.setSetting(key, JSON.stringify(value))
  },

  updateSetting: (key, value) => get().set(key, value),

  applyExternalChange: (key, value) => {
    // Credentials are never broadcast (see main/settings/broadcast.ts), but
    // ignoring them here too means a future change to that rule cannot put a
    // key into the renderer's heap by accident.
    if (key in DEFAULT_SETTINGS) {
      set((s) => ({ settings: { ...s.settings, [key]: value } }))
    }
  },

  setLoaded: (loaded) => set({ loaded }),

  hydrate: async () => {
    try {
      const all = await window.reigan?.getAllSettings()
      if (all && typeof all === 'object') {
        const parsed: Partial<AppSettings> = {}
        for (const [key, raw] of Object.entries(all)) {
          try {
            ;(parsed as any)[key] = JSON.parse(raw)
          } catch {
            // Pre-existing rows saved before this change were stored as raw strings.
            ;(parsed as any)[key] = raw
          }
        }
        // `reducedMotion: boolean` became `motion: MotionPreference`; rows
        // written by an older build still carry the boolean.
        const legacy = parsed as Partial<AppSettings> & { reducedMotion?: unknown }
        parsed.motion = normalizeMotion(legacy.motion, legacy.reducedMotion)
        delete legacy.reducedMotion
        set((s) => ({ settings: { ...s.settings, ...parsed } }))
      }
      await get().refreshSecretPreviews()
    } finally {
      set({ loaded: true })
    }
  },

  refreshSecretPreviews: async () => {
    try {
      const previews = await window.reigan?.getSecretPreviews()
      if (previews && typeof previews === 'object') set({ secretPreviews: previews })
    } catch {
      // A missing preview only costs the "•••• 4f2a" hint; the field still works.
    }
  },
}))
