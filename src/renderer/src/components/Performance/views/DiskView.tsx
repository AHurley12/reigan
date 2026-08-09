import { SectionHeader } from '../../shared/SectionHeader'
import { Meter } from '../shared/Meter'
import { LineChart } from '../shared/LineChart'
import { statusFor } from '../shared/perfStatus'
import { formatBytes, formatRate } from '../shared/format'
import type { PerformanceViewProps } from '../types'

export function DiskView({ sample, history }: PerformanceViewProps) {
  if (!sample) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Waiting for the performance monitor to start…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {sample.disk.volumes.map((vol) => {
          const status = statusFor(vol.usedPercent, 80, 95)
          return (
            <div key={vol.mount} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span style={{ color: 'var(--text-primary)' }}>{vol.mount}</span>
                <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatBytes(vol.usedBytes)} of {formatBytes(vol.totalBytes)} ({vol.usedPercent.toFixed(0)}%)
                </span>
              </div>
              <Meter percent={vol.usedPercent} status={status} height={8} />
            </div>
          )
        })}
      </div>

      <div>
        <SectionHeader en="Throughput" ja="転送速度" romaji="tensou sokudo" className="mb-3" />
        <LineChart
          series={[
            { name: 'Read', color: 'var(--reigan-secondary)', values: history.diskRead },
            { name: 'Write', color: 'var(--reigan-primary)', values: history.diskWrite },
          ]}
          formatValue={formatRate}
        />
      </div>
    </div>
  )
}
