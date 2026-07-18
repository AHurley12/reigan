import React, { useEffect } from 'react'
import { AppShell } from './components/Shell/AppShell'
import { SettingsPanel } from './components/Shell/SettingsPanel'
import { useIPC } from './hooks/useIPC'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  const ipc = useIPC()
  const { updateSetting, setLoaded } = useSettingsStore()

  useEffect(() => {
    // Load settings from DB on startup
    async function loadSettings() {
      if (!ipc) return
      try {
        const [apiKey] = await Promise.all([
          ipc.getSetting('anthropicApiKey'),
        ])
        if (apiKey) updateSetting('anthropicApiKey', apiKey)
      } finally {
        setLoaded(true)
      }
    }
    loadSettings()
  }, [])

  return (
    <div className="h-full w-full overflow-hidden">
      <AppShell />
      <SettingsPanel />
    </div>
  )
}
