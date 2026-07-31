import React, { useEffect } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { SettingsPanel } from './components/Shell/SettingsPanel'
import { useIPC } from './hooks/useIPC'
import { useVoice } from './hooks/useVoice'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useSettingsStore } from './stores/settingsStore'
import { useChatStore } from './stores/chatStore'

export default function App() {
  const ipc = useIPC()

  useVoice()
  useReducedMotion()

  useEffect(() => {
    useSettingsStore.getState().hydrate()
  }, [])

  // App-level so streaming responses land even when Chat isn't the active module.
  useEffect(() => {
    if (!ipc) return
    return ipc.onStream((data) => useChatStore.getState().handleStreamEvent(data))
  }, [ipc])

  return (
    <div className="h-full w-full overflow-hidden">
      <AppShell />
      <SettingsPanel />
    </div>
  )
}
