import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/constants'

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  setLoaded: (loaded: boolean) => void
  hydrate: () => Promise<void>
  /** @deprecated use set() — kept only while any stragglers still call it */
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,

  set: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
    window.reigan?.setSetting(key, JSON.stringify(value))
  },

  updateSetting: (key, value) => get().set(key, value),

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
        set((s) => ({ settings: { ...s.settings, ...parsed } }))
      }
    } finally {
      set({ loaded: true })
    }
  },
}))
