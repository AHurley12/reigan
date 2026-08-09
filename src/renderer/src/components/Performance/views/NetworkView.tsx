import { SectionHeader } from '../../shared/SectionHeader'
import { LineChart } from '../shared/LineChart'
import { formatRate } from '../shared/format'
import type { PerformanceViewProps } from '../types'

export function NetworkView({ sample, history }: PerformanceViewProps) {
  if (!sample) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Waiting for the performance monitor to start…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeader en="Throughput" ja="通信速度" romaji="tsuushin sokudo" className="mb-3" />
        <LineChart
          series={[
            { name: 'Download', color: 'var(--reigan-secondary)', values: history.networkRx },
            { name: 'Upload', color: 'var(--reigan-primary)', values: history.networkTx },
          ]}
          formatValue={formatRate}
        />
      </div>

      <div>
        <SectionHeader en="Interfaces" ja="インターフェース" romaji="intaafeesu" className="mb-3" />
        <div className="flex flex-col gap-2">
          {sample.network.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No active interfaces detected.</p>
          )}
          {sample.network.map((iface) => (
            <div
              key={iface.name}
              className="flex items-center justify-between px-3 py-2 rounded-md text-xs"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <span style={{ color: 'var(--text-primary)' }}>{iface.name}</span>
              <span className="flex items-center gap-3" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: 'var(--reigan-secondary)' }}>↓ {formatRate(iface.rxBytesPerSec)}</span>
                <span style={{ color: 'var(--reigan-primary)' }}>↑ {formatRate(iface.txBytesPerSec)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
