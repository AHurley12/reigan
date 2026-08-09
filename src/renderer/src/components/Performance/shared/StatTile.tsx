import type { PerfStatus } from '../../../../../shared/types'
import { Meter } from './Meter'
import { Sparkline } from './Sparkline'
import { STATUS_COLOR } from './perfStatus'

interface StatTileProps {
  label: string
  value: string
  sub?: string
  status: PerfStatus
  percent?: number
  history?: number[]
}

export function StatTile({ label, value, sub, status, percent, history }: StatTileProps) {
  return (
    <div
      className="rounded-md p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
        {sub && <span className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </div>

      <span className="text-2xl font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
        {value}
      </span>

      {percent !== undefined && <Meter percent={percent} status={status} />}
      {history && history.length > 1 && <Sparkline values={history} color={STATUS_COLOR[status]} />}
    </div>
  )
}
