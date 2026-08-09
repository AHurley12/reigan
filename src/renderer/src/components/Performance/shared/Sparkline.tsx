interface SparklineProps {
  values: number[]
  color?: string
  height?: number
}

// Compact single-series trend line for a stat tile — no axes, no interaction;
// the tile's own value + label already carry the context.
export function Sparkline({ values, color = 'var(--text-muted)', height = 28 }: SparklineProps) {
  if (values.length < 2) return <div style={{ height }} />

  const width = 100
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const step = width / (values.length - 1)
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
