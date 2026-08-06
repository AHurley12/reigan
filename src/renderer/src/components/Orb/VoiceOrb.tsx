import { useRef, useEffect } from 'react'
import { ReiganOrb } from './engine/ReiganOrb'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVoiceStore } from '../../stores/voiceStore'

export function VoiceOrb() {
  const containerRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<ReiganOrb | null>(null)
  const reiganState = useAppStore((s) => s.reiganState)
  const particleCount = useSettingsStore((s) => s.settings.particleCount)
  const orbAudio = useVoiceStore((s) => s.orbAudio)

  useEffect(() => {
    if (!containerRef.current) return
    const orb = new ReiganOrb(containerRef.current, particleCount)
    orbRef.current = orb
    return () => {
      orb.dispose()
      orbRef.current = null
    }
  }, [particleCount])

  useEffect(() => {
    orbRef.current?.setState(reiganState)
    // Mic capture shares the main thread with this render loop while
    // listening — throttle so heavy frames can't starve audio chunks.
    orbRef.current?.setThrottled(reiganState === 'listening')
  }, [reiganState])

  useEffect(() => {
    orbRef.current?.setAudioData(orbAudio)
  }, [orbAudio])

  return (
    <div
      ref={containerRef}
      className="w-full aspect-square max-w-[240px] mx-auto rounded-full overflow-hidden"
      aria-label={`Shingan voice orb — ${reiganState}`}
      role="img"
    />
  )
}
