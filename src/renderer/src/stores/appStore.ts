import { create } from 'zustand'
import type { AppModule, ReiganState } from '../../../shared/types'

interface AppStore {
  activeModule: AppModule
  reiganState: ReiganState
  settingsOpen: boolean
  setActiveModule: (module: AppModule) => void
  setReiganState: (state: ReiganState) => void
  setSettingsOpen: (open: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  activeModule: 'chat',
  reiganState: 'idle',
  settingsOpen: false,
  setActiveModule: (module) => set({ activeModule: module }),
  setReiganState: (state) => set({ reiganState: state }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}))
