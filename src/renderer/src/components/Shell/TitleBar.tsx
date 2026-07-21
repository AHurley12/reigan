import React from 'react'
import { useAppStore } from '../../stores/appStore'
import type { ReiganState } from '../../../../shared/types'

const STATE_COLORS: Record<ReiganState, string> = {
  idle: '#4A5568',
  listening: '#10B981',
  processing: '#7C3AED',
  speaking: '#00D4FF',
  error: '#EF4444',
  success: '#10B981',
}

const STATE_LABELS: Record<ReiganState, string> = {
  idle: '待機',
  listening: '聴取中',
  processing: '処理中',
  speaking: '発話中',
  error: 'エラー',
  success: '成功',
}

export function TitleBar() {
  const { reiganState, setSettingsOpen } = useAppStore()
  const color = STATE_COLORS[reiganState]

  return (
    <div
      className="titlebar-drag flex items-center justify-between h-titlebar px-4 shrink-0"
      style={{ background: 'var(--bg-void)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="titlebar-no-drag flex items-center gap-2">
        <span
          className="text-base font-semibold tracking-wide"
          style={{
            background: 'var(--reigan-gradient)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontFamily: 'var(--font-display)',
          }}
        >
          ◉ REIGAN
        </span>
        <span className="text-xs font-kanji" style={{ color: 'var(--text-kanji)' }}>
          霊眼
        </span>
      </div>

      {/* State indicator */}
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {STATE_LABELS[reiganState]}
        </span>
      </div>

      {/* Window controls */}
      <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => window.reigan?.minimize?.()}
          className="w-8 h-6 rounded flex items-center justify-center text-xs hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Minimize"
        >
          ─
        </button>
        <button
          onClick={() => window.reigan?.maximize?.()}
          className="w-8 h-6 rounded flex items-center justify-center text-xs hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Maximize"
        >
          □
        </button>
        <button
          onClick={() => window.reigan?.close?.()}
          className="w-8 h-6 rounded flex items-center justify-center text-xs hover:bg-critical/20 hover:text-critical transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
