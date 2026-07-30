import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useIPC } from './useIPC'

// Forwards reiganState to the avatar overlay window whenever it changes.
export function useAvatarOverlaySync() {
  const ipc = useIPC()
  const reiganState = useAppStore((s) => s.reiganState)

  useEffect(() => {
    ipc?.avatar?.sendState(reiganState)
  }, [ipc, reiganState])
}
