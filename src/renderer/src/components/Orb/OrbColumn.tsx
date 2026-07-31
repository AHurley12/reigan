import type { ReactNode } from 'react'
import { VoiceOrb } from './VoiceOrb'
import { AvatarPanel } from './AvatarPanel'
import { useAppStore } from '../../stores/appStore'
import { useVoiceStore } from '../../stores/voiceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { stateLabel } from '../../i18n/ja'
import type { ReiganState } from '../../../../shared/types'

const DEV_STATES: ReiganState[] = ['idle', 'listening', 'processing', 'speaking', 'error', 'success']

const CORNERS: Array<{ top?: number; bottom?: number; left?: number; right?: number; borders: string }> = [
  { top: -10, left: -10, borders: 'border-top border-left' },
  { top: -10, right: -10, borders: 'border-top border-right' },
  { bottom: -10, left: -10, borders: 'border-bottom border-left' },
  { bottom: -10, right: -10, borders: 'border-bottom border-right' },
]

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
    <div
      className="w-[320px] flex-shrink-0 flex flex-col items-center pt-6 pb-4 px-5 overflow-y-auto min-h-0"
      style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
    >
      {/* Voice Orb, framed like a viewfinder — the literal "eye" of Shingan */}
      <ViewfinderFrame active={isActive}>
        <VoiceOrb />
      </ViewfinderFrame>

      {/* Avatar — sits below the orb, always visible alongside it */}
      <div className="mt-4 w-full">
        <AvatarPanel />
      </div>

      {/* Status */}
      <div className="mt-4 w-full pt-4 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {stateLabel(reiganState, japaneseLevel)}
        </p>

        {import.meta.env.DEV && (
          <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
            {DEV_STATES.map((state) => (
              <button
                key={state}
                onClick={() => setReiganState(state)}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
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

      {/* Transcript */}
      <div className="mt-4 w-full pt-4 text-center flex-1" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: transcript ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
          {transcript || (reiganState === 'listening' ? 'Listening…' : 'Ctrl+Shift+Space to talk')}
        </p>
      </div>

      {/* Audio levels */}
      <div className="mt-auto w-full pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-end gap-1 h-6 justify-center">
          {[orbAudio.bass, orbAudio.mid, orbAudio.amplitude, orbAudio.high, orbAudio.bass].map((level, i) => (
            <div
              key={i}
              className="w-1 rounded-full transition-all duration-100"
              style={{
                height: `${Math.max(12, Math.min(1, level) * 100)}%`,
                background: reiganState === 'listening' || reiganState === 'speaking' ? 'var(--text-accent)' : 'var(--text-muted)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
