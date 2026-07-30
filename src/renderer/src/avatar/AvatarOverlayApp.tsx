import { useEffect, useState } from 'react'
import type { ReiganState } from '../../../shared/types'

// Duplicated from TitleBar's STATE_COLORS intentionally — this window is a
// separate renderer bundle with no access to the main window's React tree.
const STATE_COLORS: Record<ReiganState, string> = {
  idle: '#6B6455',
  listening: '#23A18C',
  processing: '#D8432A',
  speaking: '#C9A227',
  error: '#E5484D',
  success: '#23A18C',
}

export function AvatarOverlayApp() {
  const [state, setState] = useState<ReiganState>('idle')

  useEffect(() => {
    return window.reigan?.avatar?.onStateChange((next) => setState(next))
  }, [])

  const color = STATE_COLORS[state]

  return (
    <div className="h-screen w-screen flex flex-col select-none" style={{ background: 'transparent' }}>
      {/* Drag handle — the only region that moves the window, so the model area stays free for orbit-drag later */}
      <div
        className="h-6 shrink-0 flex items-center justify-end px-2 gap-1"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => window.reigan?.avatar?.toggle()}
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-white/10 transition-colors"
          style={{ WebkitAppRegion: 'no-drag', color: 'var(--text-muted)' } as React.CSSProperties}
          aria-label="Hide avatar overlay"
        >
          ✕
        </button>
      </div>

      {/* Placeholder — swap this block for <Avatar3D modelUrl={MODEL_URL} mood={...} /> once the model lands */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div
          className="rounded-full transition-colors duration-300"
          style={{
            width: 120,
            height: 120,
            border: `2px solid ${color}`,
            boxShadow: `0 0 24px ${color}55`,
          }}
        />
        <span className="text-xs font-mono tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {state}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
          awaiting avatar model
        </span>
      </div>
    </div>
  )
}
