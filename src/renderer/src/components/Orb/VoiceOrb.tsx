import { useRef, useEffect } from 'react'
import { ReiganOrb } from './engine/ReiganOrb'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'

export function VoiceOrb() {
  const containerRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<ReiganOrb | null>(null)
  const reiganState = useAppStore((s) => s.reiganState)
  const particleCount = useSettingsStore((s) => s.settings.particleCount)

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
  }, [reiganState])

  return (
    <div
      ref={containerRef}
      className="w-full aspect-square max-w-[240px] mx-auto rounded-full overflow-hidden"
      aria-label={`REIGAN voice orb — ${reiganState}`}
      role="img"
    />
  )
}
