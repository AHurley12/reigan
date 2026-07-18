import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
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
      } else if (ctrl && MODULE_KEYS[e.key]) {
        e.preventDefault()
        setActiveModule(MODULE_KEYS[e.key])
      } else if (e.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onFocusChat, setActiveModule, setSettingsOpen])
}
