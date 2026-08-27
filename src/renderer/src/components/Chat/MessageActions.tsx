import React from 'react'
import { Check, Copy } from 'lucide-react'
import { useCopy } from './useCopy'

interface Props {
  /** The raw markdown source, not the rendered text. */
  content: string
  align?: 'left' | 'right'
}

/**
 * The per-message action row.
 *
 * Revealed on hover *and* on focus-within, never hover alone — a control that
 * only exists for a pointer is a control a keyboard user cannot reach. It stays
 * in the layout at zero opacity rather than being unmounted, so revealing it
 * does not reflow the message above it.
 */
export function MessageActions({ content, align = 'left' }: Props) {
  const { copied, copy } = useCopy()

  return (
    <div
      className={`flex items-center gap-1 mt-1 opacity-0 transition-opacity duration-fast
        group-hover:opacity-100 group-focus-within:opacity-100
        ${align === 'right' ? 'justify-end' : ''}`}
    >
      <ActionButton
        label={copied ? 'Copied' : 'Copy message'}
        onClick={() => void copy(content)}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </ActionButton>
    </div>
  )
}

/**
 * 24px minimum touch target even though the glyph is 12px — the icon is the
 * affordance, the button is the hit area.
 */
function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative group/action">
      <button
        onClick={onClick}
        aria-label={label}
        className="w-6 h-6 rounded-sm flex items-center justify-center transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        {children}
      </button>
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/action:block
          px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none z-10"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      >
        {label}
      </div>
    </div>
  )
}
