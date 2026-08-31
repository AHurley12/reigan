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
    const container = containerRef.current
    if (!container) return

    // The engine now arrives asynchronously, because its `three` dependency is
    // no longer in the startup chunk (see engine/orbRegistry.ts).
    let cancelled = false
    let orb: VoiceOrbEngine | null = null

    const styleDef = ORB_STYLES[orbStyle] ?? ORB_STYLES[DEFAULT_ORB_STYLE]
    void styleDef.load().then((create) => {
      // Switched style, changed particle count, or unmounted while the chunk
      // was in flight — building the engine now would leak a WebGL context
      // whose cleanup has already run.
      if (cancelled) return

      orb = create(container, particleCount)
      orbRef.current = orb

      // The state effects below fire on change, not on mount, so an engine that
      // finished loading after the last one has missed everything said so far.
      // Latch the current values onto it rather than waiting for the next
      // transition, which for an idle app may never come.
      orb.setState(useAppStore.getState().reiganState)
      orb.setThrottled(useAppStore.getState().reiganState === 'listening')
      orb.setAudioData(useVoiceStore.getState().orbAudio)
    })

    return () => {
      cancelled = true
      orb?.dispose()
      if (orbRef.current === orb) orbRef.current = null
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
