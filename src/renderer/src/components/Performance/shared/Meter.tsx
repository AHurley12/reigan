import type { PerfStatus } from '../../../../../shared/types'
import { STATUS_COLOR } from './perfStatus'

interface MeterProps {
  percent: number
  status: PerfStatus
  height?: number
}

// Fill carries severity; the unfilled track is the same hue at low opacity so
// state reads across the whole bar, not just the filled portion.
export function Meter({ percent, status, height = 6 }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  const color = STATUS_COLOR[status]
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  )
}
