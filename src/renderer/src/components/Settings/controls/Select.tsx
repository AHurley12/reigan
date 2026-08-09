import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

interface Option {
  value: string
  label: string
  labelJa?: string
}

interface Props {
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function Select({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={current?.label ?? value}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors max-w-[200px]"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      >
        <span className="truncate min-w-0">{current?.label ?? value}</span>
        <ChevronDown size={12} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 z-50 rounded-lg overflow-hidden animate-fade-in py-1.5"
          style={{
            background: 'linear-gradient(var(--surface-glass-tint), var(--surface-glass-tint)), var(--bg-elevated)',
            backdropFilter: 'blur(var(--surface-glass-blur))',
            WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
            border: '1px solid var(--border-hover)',
            minWidth: 180,
            maxWidth: 280,
            maxHeight: 280,
            overflowY: 'auto',
            boxShadow: 'var(--bevel-outer)',
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              title={o.label}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs text-left transition-colors hover:bg-tint/5"
              style={{ color: o.value === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="flex flex-col min-w-0 gap-0.5">
                <span className="truncate">{o.label}</span>
                {o.labelJa && <span className="text-[11px] font-kanji" style={{ color: 'var(--text-kanji)' }}>{o.labelJa}</span>}
              </span>
              {o.value === value && <Check size={12} className="shrink-0" style={{ color: 'var(--reigan-primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
