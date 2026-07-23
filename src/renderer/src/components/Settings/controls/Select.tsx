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
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-50 rounded-lg overflow-hidden animate-fade-in"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', minWidth: 160, maxHeight: 200, overflowY: 'auto' }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-white/5"
              style={{ color: o.value === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="flex flex-col">
                <span>{o.label}</span>
                {o.labelJa && <span className="text-[10px] font-kanji" style={{ color: 'var(--text-kanji)' }}>{o.labelJa}</span>}
              </span>
              {o.value === value && <Check size={12} style={{ color: 'var(--reigan-primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
