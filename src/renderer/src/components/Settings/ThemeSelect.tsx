import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import { Check } from 'lucide-react'
import { THEMES, type ThemeId } from '../../theme/registry'
import { useTheme } from '../../theme/useTheme'

const THEME_IDS = Object.keys(THEMES) as ThemeId[]

/**
 * Card radiogroup for picking the active theme. Selection is instant — no
 * apply/confirm step — and the cards themselves render with the *current*
 * tokens, so switching visibly restyles the selector as you use it.
 */
export function ThemeSelect() {
  const { themeId, setTheme } = useTheme()
  const buttonRefs = useRef<Partial<Record<ThemeId, HTMLButtonElement | null>>>({})

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!forward && !backward) return
    e.preventDefault()
    const nextIndex = (index + (forward ? 1 : -1) + THEME_IDS.length) % THEME_IDS.length
    const nextId = THEME_IDS[nextIndex]
    setTheme(nextId)
    buttonRefs.current[nextId]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3">
      {THEME_IDS.map((id, index) => {
        const theme = THEMES[id]
        const selected = id === themeId
        return (
          <button
            key={id}
            ref={(el) => { buttonRefs.current[id] = el }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className="flex flex-col gap-2.5 rounded-lg p-3 text-left transition-colors"
            style={{
              background: 'var(--bg-elevated)',
              border: selected ? '1.5px solid var(--border-focus)' : '1px solid var(--border)',
            }}
          >
            <div className="h-14 w-full rounded-md" style={{ background: theme.previewGradient }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{theme.name}</p>
                <p className="text-[12px] leading-snug" style={{ color: 'var(--text-muted)' }}>{theme.description}</p>
              </div>
              {selected && <Check size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--border-focus)' }} />}
            </div>
          </button>
        )
      })}
    </div>
  )
}
