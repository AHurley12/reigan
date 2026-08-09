import { useState, type ReactNode } from 'react'
// `m`, not `motion`: LockGate wraps the whole app in <LazyMotion ... strict>,
// and strict mode throws on a `motion` component rather than warning — which
// unmounts the React tree and leaves a black window. See LockGate.tsx.
import { m } from 'framer-motion'
import { useSettingsStore } from '../../stores/settingsStore'
import { hasKanji } from '../../i18n/kanji'
import { FuriganaText } from '../shared/FuriganaText'
import type { AppModule } from '../../../../shared/types'

interface Props {
  id: AppModule
  icon: ReactNode
  en: string
  ja: string
  romaji: string
  isActive: boolean
  onClick: () => void
  shortcut?: string
}

export function NavItem({ id: _id, icon, en, ja, romaji, isActive, onClick, shortcut }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)
  const showFurigana = useSettingsStore((s) => s.settings.showFurigana)
  const showRomaji = useSettingsStore((s) => s.settings.showRomaji)
  const withFurigana = japaneseLevel >= 2 && showFurigana && hasKanji(ja)

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        // No mx-*: `w-full` plus a horizontal margin makes the button wider
        // than its container, and it overhung the rail's border by 7px — which
        // only became visible once the rail carried a moulding to overhang.
        // The breathing room is the rail's own px-2 instead.
        className="relative w-full flex items-center justify-center h-10 rounded-sm transition-colors duration-fast"
        style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
        aria-label={en}
        aria-current={isActive}
      >
        {isActive && (
          <m.span
            layoutId="nav-hanko"
            className="absolute inset-0 rounded-sm"
            style={{
              background: 'color-mix(in srgb, var(--accent-primary) 18%, transparent)',
              border: '1px solid var(--reigan-primary)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--accent-primary) 25%, transparent)',
            }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          />
        )}
        <span className="relative z-10">{icon}</span>
      </button>

      {showTooltip && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
            flex flex-col gap-0.5 px-3 py-2 rounded-md text-xs whitespace-nowrap
            animate-fade-in pointer-events-none"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-hover)',
            boxShadow: 'var(--bevel-outer)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{en}</span>
          {japaneseLevel >= 1 && (
            <span style={{ color: 'var(--text-kanji)', fontFamily: 'var(--font-kanji)' }}>
              {withFurigana ? <FuriganaText text={ja} reading={romaji} /> : ja}
            </span>
          )}
          {japaneseLevel >= 1 && showRomaji && !withFurigana && (
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{romaji}</span>
          )}
          {shortcut && (
            <span className="mt-1 px-1.5 py-0.5 rounded text-center"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {shortcut}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
