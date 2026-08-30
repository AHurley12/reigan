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
  /** Unresolved-item count. Omitted or 0 renders nothing. */
  badge?: number
  /** What the badge counts, for the tooltip and the accessible name. */
  badgeLabel?: string
}

export function NavItem({
  id: _id, icon, en, ja, romaji, isActive, onClick, shortcut, badge = 0, badgeLabel,
}: Props) {
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
        aria-label={badge > 0 && badgeLabel ? `${en} — ${badge} ${badgeLabel}` : en}
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

      {/* Count, not a bare dot: "3 automations broke" and "1 did" warrant
          different levels of alarm, and the rail is the only place the user sees
          either without opening the tab. Static by design — animation in this app
          is gated on `prefers-reduced-motion`, so a pip that relied on a pulse to
          be noticed would be invisible to exactly the users who set that. */}
      {badge > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 z-20 pointer-events-none
            min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full
            font-mono text-[9px] leading-none tabular-nums"
          style={{
            background: 'var(--status-error)',
            color: 'var(--bg-base)',
            // Reads as a pip sitting on the rail rather than a smudge inside the
            // button, which matters most when the active hanko is lit behind it.
            border: '1px solid var(--bg-surface)',
          }}
          aria-hidden
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}

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
          {badge > 0 && badgeLabel && (
            <span style={{ color: 'var(--status-error)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {badge} {badgeLabel}
            </span>
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
