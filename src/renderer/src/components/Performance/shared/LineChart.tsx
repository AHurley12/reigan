import { useRef, useState } from 'react'

interface Series {
  name: string
  color: string
  values: number[]
}

interface LineChartProps {
  series: Series[]
  height?: number
  formatValue?: (v: number) => string
}

// Two-series throughput chart (Disk read/write, Network down/up). Legend is
// mandatory here since there's more than one series; the crosshair tracks X
// and one tooltip lists every series at that point — the pointer never has
// to land on a specific line.
export function LineChart({ series, height = 120, formatValue = (v) => v.toFixed(0) }: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pointCount = series[0]?.values.length ?? 0
  const width = 100

  if (pointCount < 2) {
    return (
      <div
        className="flex items-center justify-center text-[12px]"
        style={{ height, color: 'var(--text-muted)' }}
      >
        Gathering data…
      </div>
    )
  }

  const max = Math.max(...series.flatMap((s) => s.values), 1)
  const xAt = (i: number) => (i / (pointCount - 1)) * width
  const yAt = (v: number) => height - (v / max) * height

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = (e.clientX - rect.left) / rect.width
    const idx = Math.round(ratio * (pointCount - 1))
    setHoverIndex(Math.max(0, Math.min(pointCount - 1, idx)))
  }

  const hoverXPercent = hoverIndex !== null ? (xAt(hoverIndex) / width) * 100 : 0

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <span style={{ width: 10, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
            {s.name}
          </div>
        ))}
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{ height }}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
          {series.map((s) => (
            <polyline
              key={s.name}
              points={s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hoverIndex !== null && (
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={0}
              y2={height}
              stroke="var(--border-hover)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hoverIndex !== null && (
          <div
            className="absolute top-1 px-2.5 py-2 rounded-md text-[11px] pointer-events-none z-10 flex flex-col gap-1"
            style={{
              left: `${hoverXPercent}%`,
              transform: hoverXPercent > 60 ? 'translateX(-100%)' : 'none',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
          >
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span style={{ width: 8, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
                <span style={{ color: 'var(--text-muted)' }}>{s.name}</span>
                <strong
                  style={{ marginLeft: 'auto', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatValue(s.values[hoverIndex])}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
