import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import type { AppModule } from '../../../shared/types'

const MODULE_KEYS: Record<string, AppModule> = {
  '1': 'chat',
  '2': 'tasks',
  '3': 'files',
  '4': 'mail',
  '5': 'calendar',
  '6': 'automations',
  '7': 'dev',
}

export function useKeyboard(onFocusChat?: () => void) {
  const { setActiveModule, setSettingsOpen } = useAppStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.key === '/') {
        e.preventDefault()
        onFocusChat?.()
      } else if (ctrl && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (ctrl && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault()
        const { settings, set } = useSettingsStore.getState()
        const push = useToastStore.getState().push

        if (settings.personalityMode === 'unbridled') {
          set('personalityMode', 'standard')
          push('Switched to Standard Mode', 'info')
        } else if (settings.unbridledModeAcknowledged) {
          set('personalityMode', 'unbridled')
          push('Switched to Unbridled Mode', 'info')
        } else {
          setSettingsOpen(true)
          push('Confirm Unbridled Mode in Settings → Personality first.', 'info')
        }
      } else if (ctrl && MODULE_KEYS[e.key]) {
        e.preventDefault()
        setActiveModule(MODULE_KEYS[e.key])
      } else if (e.key === 'Escape') {
        // Settings first: Escape has always closed the panel, and stopping a
        // generation the user cannot currently see would be a surprise.
        if (useAppStore.getState().settingsOpen) {
          setSettingsOpen(false)
        } else if (useChatStore.getState().isStreaming) {
          void useChatStore.getState().abort()
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onFocusChat, setActiveModule, setSettingsOpen])
}
