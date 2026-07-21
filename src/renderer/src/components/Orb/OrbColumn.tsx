import { VoiceOrb } from './VoiceOrb'
import { useAppStore } from '../../stores/appStore'
import type { ReiganState } from '../../../../shared/types'

const DEV_STATES: ReiganState[] = ['idle', 'listening', 'processing', 'speaking', 'error', 'success']

const STATE_LABELS: Record<ReiganState, string> = {
  idle: '待機',
  listening: '聴取中',
  processing: '処理中',
  speaking: '発話中',
  error: 'エラー',
  success: '成功',
}

export function OrbColumn() {
  const reiganState = useAppStore((s) => s.reiganState)
  const setReiganState = useAppStore((s) => s.setReiganState)

  return (
    <div
      className="w-[280px] flex-shrink-0 flex flex-col items-center pt-6 pb-4 px-5"
      style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
    >
      {/* Voice Orb */}
      <VoiceOrb />

      {/* Status */}
      <div className="mt-4 w-full pt-4 text-center" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {STATE_LABELS[reiganState]}
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
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Voice not yet connected
        </p>
      </div>

      {/* Audio levels */}
      <div className="mt-auto w-full pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-end gap-1 h-6 justify-center">
          {[0.2, 0.4, 0.6, 0.4, 0.2].map((h, i) => (
            <div
              key={i}
              className="w-1 rounded-full"
              style={{ height: `${h * 100}%`, background: 'var(--text-muted)' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
