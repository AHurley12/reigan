import React, { useId } from 'react'

/**
 * A minimal inline sparkline.
 *
 * Inline SVG with token-driven colour rather than a charting library: the app
 * already carries 2.5 MB of renderer bundle, and this needs to restyle itself
 * under three skins, which a library's own palette would fight.
 */

interface Props {
  values: number[]
  /** CSS colour, normally a var() reference so the skin owns it. */
  color?: string
  height?: number
  label?: string
}

export function Sparkline({ values, color = 'var(--accent-primary)', height = 32, label }: Props) {
  const gradientId = useId()

  if (values.length < 2) {
    return (
      <div
        className="flex items-center font-mono text-[10px]"
        style={{ height, color: 'var(--text-muted)' }}
      >
        not enough data
      </div>
    )
  }

  const width = 100
  const max = Math.max(...values)
  const min = Math.min(...values)
  // A flat series would divide by zero; render it as a centred straight line.
  const range = max - min || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return [x, y] as const
  })

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={label ?? `Sparkline, ${values.length} points, latest ${values[values.length - 1]}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
