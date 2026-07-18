import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS } from '../../../shared/constants'

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  setLoaded: (loaded: boolean) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  updateSetting: (key, value) =>
    set((s) => ({ settings: { ...s.settings, [key]: value } })),
  setLoaded: (loaded) => set({ loaded }),
}))
