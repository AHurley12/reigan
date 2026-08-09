import { useEffect, useRef, useState } from 'react'

interface Props {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  formatLabel?: (v: number) => string
}

const DEBOUNCE_MS = 60

export function Slider({ min, max, step, value, onChange, formatLabel }: Props) {
  const [local, setLocal] = useState(value)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => setLocal(value), [value])

  const handleInput = (v: number) => {
    setLocal(v)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => onChange(v), DEBOUNCE_MS)
  }

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  const pct = ((local - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-3" style={{ width: 140 }}>
      <div className="relative flex-1 h-1 rounded-full" style={{ background: 'var(--bg-subtle)' }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--reigan-primary)' }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={local}
          onChange={(e) => handleInput(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          style={{ height: 16, top: -6 }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            left: `calc(${pct}% - 6px)`,
            width: 12,
            height: 12,
            background: 'var(--reigan-primary)',
            border: '2px solid var(--text-primary)',
          }}
        />
      </div>
      <span className="font-mono text-[12px] text-right shrink-0" style={{ color: 'var(--text-muted)', width: 36 }}>
        {formatLabel ? formatLabel(local) : local}
      </span>
    </div>
  )
}
