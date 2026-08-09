import { useRef, useEffect } from 'react'
import { ORB_STYLES, DEFAULT_ORB_STYLE, type VoiceOrbEngine } from './engine/orbRegistry'
import { applyOrbPalette } from './engine/colorPresets'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useTheme } from '../../theme/useTheme'

export function VoiceOrb() {
  const containerRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<VoiceOrbEngine | null>(null)
  const reiganState = useAppStore((s) => s.reiganState)
  const particleCount = useSettingsStore((s) => s.settings.particleCount)
  const orbStyle = useSettingsStore((s) => s.settings.voiceOrbStyle)
  const orbAudio = useVoiceStore((s) => s.orbAudio)
  const { theme } = useTheme()

  // Repalette on theme change, then re-latch the current state so the running
  // engine picks the new hues up. setState is idempotent and the engines lerp
  // toward their target, so the orb crossfades to the new skin instead of
  // being torn down and rebuilt — which at high particle counts would blow the
  // 100ms skin-switch budget on its own.
  useEffect(() => {
    applyOrbPalette(theme.tokens)
    orbRef.current?.setState(reiganState)
  }, [theme, reiganState])

  useEffect(() => {
    if (!containerRef.current) return
    const styleDef = ORB_STYLES[orbStyle] ?? ORB_STYLES[DEFAULT_ORB_STYLE]
    const orb = styleDef.create(containerRef.current, particleCount)
    orbRef.current = orb
    return () => {
      orb.dispose()
      orbRef.current = null
    }
  }, [particleCount, orbStyle])

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
