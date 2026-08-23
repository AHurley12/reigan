import type { ReactNode } from 'react'
import { VoiceOrb } from './VoiceOrb'
import { AvatarPanel } from './AvatarPanel'
import { meterHeight } from './meterScale'
import { useAppStore } from '../../stores/appStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { stateLabel } from '../../i18n/ja'
import type { ReiganState } from '../../../../shared/types'

const DEV_STATES: ReiganState[] = ['idle', 'listening', 'processing', 'speaking', 'error', 'success']

/**
 * `radius` names the one corner where the bracket's two borders meet, which
 * is rounded to the theme's own --radius-sm. A bracket mitred at a hard 90°
 * was the last square corner left in the column once the panels picked up
 * their mouldings, and it read as a different vocabulary bolted on.
 */
const CORNERS: Array<{
  top?: number
  bottom?: number
  left?: number
  right?: number
  borders: string
  radius: 'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomLeftRadius' | 'borderBottomRightRadius'
}> = [
  { top: -10, left: -10, borders: 'border-top border-left', radius: 'borderTopLeftRadius' },
  { top: -10, right: -10, borders: 'border-top border-right', radius: 'borderTopRightRadius' },
  { bottom: -10, left: -10, borders: 'border-bottom border-left', radius: 'borderBottomLeftRadius' },
  { bottom: -10, right: -10, borders: 'border-bottom border-right', radius: 'borderBottomRightRadius' },
]

/**
 * One rhythm for every divided section in this column. Each section is
 * separated from the one above it by the shared .rule and sits on identical
 * padding, so the dividers read as a set rather than as three unrelated
 * hairlines at whatever spacing their content happened to produce.
 */
const SECTION = 'rule-ornate w-full mt-5 pt-5'

function ViewfinderFrame({ active, children }: { active: boolean; children: ReactNode }) {
  const color = active ? 'var(--reigan-secondary)' : 'var(--text-muted)'
  return (
    <div className="relative w-full max-w-[240px] mx-auto">
      {children}
      {CORNERS.map((c, i) => (
        <span
          key={i}
          className="absolute w-3.5 h-3.5 pointer-events-none transition-colors duration-normal"
          style={{
            top: c.top,
            bottom: c.bottom,
            left: c.left,
            right: c.right,
            borderTop: c.borders.includes('border-top') ? `1.5px solid ${color}` : undefined,
            borderBottom: c.borders.includes('border-bottom') ? `1.5px solid ${color}` : undefined,
            borderLeft: c.borders.includes('border-left') ? `1.5px solid ${color}` : undefined,
            borderRight: c.borders.includes('border-right') ? `1.5px solid ${color}` : undefined,
            [c.radius]: 'var(--radius-sm)',
            opacity: active ? 0.9 : 0.4,
          }}
        />
      ))}
    </div>
  )
}

export function OrbColumn() {
  const reiganState = useAppStore((s) => s.reiganState)
  const setReiganState = useAppStore((s) => s.setReiganState)
  const transcript = useVoiceStore((s) => s.transcript)
  const orbAudio = useVoiceStore((s) => s.orbAudio)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)
  const isActive = reiganState === 'listening' || reiganState === 'speaking'

  return (
    /* pt-8, not pt-5: the viewfinder's brackets overhang its box by 10px, and
       at the smaller padding they landed 8px under the frame's top moulding —
       two parallel hairlines close enough to read as one confused edge. The
       larger padding drops them 18px clear, matching the divider rhythm below.
       The surrounding gutter belongs to AppShell, which mounts all three
       regions on it. */
    <div
      className="panel-surface ornate relative w-[320px] flex-shrink-0 flex flex-col items-center pt-8 pb-4 px-4 overflow-y-auto min-h-0"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      {/* Voice Orb, framed like a viewfinder — the literal "eye" of Shingan */}
      <ViewfinderFrame active={isActive}>
        <VoiceOrb />
      </ViewfinderFrame>

      {/* Avatar — sits below the orb, always visible alongside it. Clears the
          viewfinder's bottom brackets, which overhang by 10px. */}
      <div className="mt-5 w-full">
        <AvatarPanel />
      </div>

      {/* Status */}
      <div className={`${SECTION} text-center`}>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {stateLabel(reiganState, japaneseLevel)}
        </p>

        {import.meta.env.DEV && (
          <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
            {DEV_STATES.map((state) => (
              <button
                key={state}
                onClick={() => setReiganState(state)}
                className="text-[11px] px-2 py-0.5 rounded transition-colors"
                style={{
                  background: 'var(--bg-elevated)',
                  color: state === reiganState ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {state}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transcript. Deliberately not flex-1: stretching this block put the
          column's leftover height *inside* it, so its space below the rule
          ran far longer than above and the dividers read as unevenly spaced.
          The slack is collected in one neutral spacer below instead, which
          pins the level meter to the foot of the panel and leaves every
          section on the same 17.5px-above / 17.5px-below rhythm. */}
      <div className={`${SECTION} text-center`}>
        <p className="text-xs" style={{ color: transcript ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
          {transcript || (reiganState === 'listening' ? 'Listening…' : 'Ctrl+Shift+Space to talk')}
        </p>
      </div>

      <div className="flex-1 w-full" aria-hidden />

      {/* Audio levels */}
      <div className={SECTION}>
        <div className="flex items-end gap-1 h-6 justify-center">
          {[orbAudio.bass, orbAudio.mid, orbAudio.amplitude, orbAudio.high, orbAudio.bass].map((level, i) => (
            /* transition-colors, not transition-all: the heights are already
               driven frame by frame off an rAF loop, so a transition on height
               only re-targets a half-finished tween every 16ms — the bars cover
               a fraction of each step and transients never arrive. Colour still
               transitions, because that changes on state, not per frame. */
            <div
              key={i}
              className="w-1 rounded-full transition-colors duration-normal"
              style={{
                height: `${meterHeight(level)}%`,
                background: isActive ? 'var(--text-accent)' : 'var(--text-muted)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
