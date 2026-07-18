import React from 'react'
import { useAppStore } from '../../stores/appStore'

export function StatusIndicator() {
  const { reiganState } = useAppStore()
  const isActive = reiganState !== 'idle' && reiganState !== 'error'

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-pill text-xs"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: isActive ? 'var(--active)' : 'var(--text-muted)' }}
      />
      {reiganState}
    </div>
  )
}
