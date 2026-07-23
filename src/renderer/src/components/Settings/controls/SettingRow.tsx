import type { ReactNode } from 'react'

interface Props {
  label: string
  labelJa?: string
  description?: string
  children: ReactNode
  last?: boolean
}

export function SettingRow({ label, labelJa, description, children, last }: Props) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-3"
      style={{ borderBottom: last ? 'none' : '1px solid var(--border)' }}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
          {labelJa && (
            <span className="text-[11px] font-kanji" style={{ color: 'var(--text-kanji)' }}>{labelJa}</span>
          )}
        </div>
        {description && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
