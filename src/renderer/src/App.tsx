import React, { useEffect } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { LockGate } from './components/Lock/LockGate'
import { SettingsPanel } from './components/Shell/SettingsPanel'
import { EffectsLayer } from './components/Shell/EffectsLayer'
import { PerfHud } from './components/Shell/PerfHud'
import { useIPC } from './hooks/useIPC'
import { useVoice } from './hooks/useVoice'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useSettingsStore } from './stores/settingsStore'
import { useChatStore } from './stores/chatStore'
import { ThemeProvider } from './theme/ThemeProvider'

export default function App() {
  const ipc = useIPC()

  useVoice()
  useReducedMotion()

  useEffect(() => {
    useSettingsStore.getState().hydrate()
  }, [])

  // Settings the assistant changed, with the user's approval, are pushed from
  // main. Without this the store keeps the value it read at boot, so an
  // approved "switch to the Sakura theme" does nothing visible until restart.
  useEffect(() => {
    return window.reigan?.onSettingsChanged?.(({ key, value }) => {
      useSettingsStore.getState().applyExternalChange(key, value)
    })
  }, [])

  // App-level so streaming responses land even when Chat isn't the active module.
  useEffect(() => {
    if (!ipc) return
    return ipc.onStream((frame) => useChatStore.getState().handleStreamFrame(frame))
  }, [ipc])

  return (
    <ThemeProvider>
      <div className="h-full w-full overflow-hidden">
        <EffectsLayer />
        {/* Everything inside the gate is unmounted while the app is locked —
            including the panels that would otherwise fetch mail and files. */}
        <LockGate>
          <AppShell />
          <SettingsPanel />
          {import.meta.env.VITE_PERF_HUD === 'true' && <PerfHud />}
        </LockGate>
      </div>
    </ThemeProvider>
  )
}
