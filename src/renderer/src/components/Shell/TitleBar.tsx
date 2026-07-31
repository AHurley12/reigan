import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { stateLabel } from '../../i18n/ja'
import { HankoMark } from '../shared/HankoMark'
import { STATE_COLORS } from '../../../../shared/constants'

function EnsoRing({ color, spinning }: { color: string; spinning: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={spinning ? 'animate-spin-slow' : ''}>
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="30 4.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function TitleBar() {
  const reiganState = useAppStore((s) => s.reiganState)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)
  const color = STATE_COLORS[reiganState]

  return (
    <div
      className="titlebar-drag flex items-center justify-between h-titlebar px-4 shrink-0"
      style={{ background: 'var(--bg-void)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="titlebar-no-drag flex items-center gap-2.5">
        <HankoMark size={22} />
        <span
          className="text-base font-semibold tracking-[0.08em]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
        >
          SHINGAN
        </span>
      </div>

      {/* State indicator */}
      <div className="flex items-center gap-2">
        <EnsoRing color={color} spinning={reiganState === 'processing'} />
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {stateLabel(reiganState, japaneseLevel)}
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
