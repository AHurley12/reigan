import React, { useEffect } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { SettingsPanel } from './components/Shell/SettingsPanel'
import { useIPC } from './hooks/useIPC'
import { useVoice } from './hooks/useVoice'
import { useSettingsStore } from './stores/settingsStore'
import { useChatStore } from './stores/chatStore'

export default function App() {
  const ipc = useIPC()
  const { updateSetting, setLoaded } = useSettingsStore()

  useVoice()

  useEffect(() => {
    // Load settings from DB on startup
    async function loadSettings() {
      if (!ipc) return
      try {
        const [apiKey, deepgramApiKey, elevenLabsApiKey, voiceId] = await Promise.all([
          ipc.getSetting('anthropicApiKey'),
          ipc.getSetting('deepgramApiKey'),
          ipc.getSetting('elevenLabsApiKey'),
          ipc.getSetting('voiceId'),
        ])
        if (apiKey) updateSetting('anthropicApiKey', apiKey)
        if (deepgramApiKey) updateSetting('deepgramApiKey', deepgramApiKey)
        if (elevenLabsApiKey) updateSetting('elevenLabsApiKey', elevenLabsApiKey)
        if (voiceId) updateSetting('voiceId', voiceId)
      } finally {
        setLoaded(true)
      }
    }
    loadSettings()
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
