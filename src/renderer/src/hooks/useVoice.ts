import { useEffect } from 'react'
import { useVoiceStore } from '../stores/voiceStore'
import { initVoiceListeners, startVoice, stopVoice } from '../voice/voiceController'

/** Mount once at the app root — wires voice IPC events for the whole session. */
export function useVoice(): void {
  useEffect(() => initVoiceListeners(), [])
}

/** Safe to use from any component (e.g. the mic button) without re-registering listeners. */
export function useVoiceControls() {
  const isActive = useVoiceStore((s) => s.isActive)
  const transcript = useVoiceStore((s) => s.transcript)
  return { isActive, transcript, startVoice, stopVoice }
}
