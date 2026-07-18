import React, { useState } from 'react'
import type { AppModule } from '../../../../shared/types'

interface Props {
  id: AppModule
  icon: React.ReactNode
  en: string
  ja: string
  romaji: string
  isActive: boolean
  onClick: () => void
  shortcut?: string
}

export function NavItem({ id, icon, en, ja, romaji, isActive, onClick, shortcut }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          w-full flex items-center justify-center
          h-10 rounded-md mx-1 transition-all duration-fast
          ${isActive
            ? 'text-txt-primary bg-reigan-primary/20'
            : 'text-txt-muted hover:text-txt-secondary hover:bg-white/5'
          }
        `}
        style={{
          borderLeft: isActive ? '2px solid var(--reigan-primary)' : '2px solid transparent',
        }}
        aria-label={en}
      >
        {icon}
      </button>

      {showTooltip && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
            flex flex-col gap-0.5 px-3 py-2 rounded-md text-xs whitespace-nowrap
            animate-fade-in pointer-events-none"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hover)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{en}</span>
          <span style={{ color: 'var(--text-kanji)', fontFamily: 'var(--font-kanji)' }}>{ja}</span>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{romaji}</span>
          {shortcut && (
            <span className="mt-1 px-1.5 py-0.5 rounded text-center"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
              {shortcut}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
