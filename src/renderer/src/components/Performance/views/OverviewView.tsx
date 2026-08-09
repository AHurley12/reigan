import { SectionHeader } from '../../shared/SectionHeader'
import { StatTile } from '../shared/StatTile'
import { statusFor, STATUS_COLOR } from '../shared/perfStatus'
import { formatBytes } from '../shared/format'
import type { PerformanceViewProps } from '../types'

export function OverviewView({ sample, history, staticInfo }: PerformanceViewProps) {
  if (!sample) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Waiting for the performance monitor to start…
      </p>
    )
  }

  const cpuStatus = statusFor(sample.cpu.loadPercent, 70, 90)
  const memStatus = statusFor(sample.memory.usedPercent, 75, 90)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="CPU"
          value={`${sample.cpu.loadPercent.toFixed(0)}%`}
          sub={staticInfo ? `${staticInfo.cpuCores} cores` : undefined}
          status={cpuStatus}
          percent={sample.cpu.loadPercent}
          history={history.cpu}
        />
        <StatTile
          label="Memory"
          value={formatBytes(sample.memory.usedBytes)}
          sub={`of ${formatBytes(sample.memory.totalBytes)}`}
          status={memStatus}
          percent={sample.memory.usedPercent}
          history={history.memory}
        />
        {sample.gpu.map((gpu, i) => {
          const util = gpu.utilizationPercent
          const status = util !== null ? statusFor(util, 75, 92) : 'good'
          return (
            <StatTile
              key={`${gpu.model}-${i}`}
              label={gpu.model}
              value={util !== null ? `${util.toFixed(0)}%` : 'N/A'}
              sub={
                gpu.vramUsedBytes !== null && gpu.vramTotalBytes !== null
                  ? `${formatBytes(gpu.vramUsedBytes)} VRAM`
                  : gpu.temperatureC !== null
                    ? `${gpu.temperatureC.toFixed(0)}°C`
                    : undefined
              }
              status={status}
              percent={util ?? undefined}
              history={util !== null ? history.gpu[i] : undefined}
            />
          )
        })}
      </div>

      <div>
        <SectionHeader en="Per-core load" ja="コア別負荷" romaji="koabetsu fuka" className="mb-3" />
        <div className="flex items-end gap-1" style={{ height: 56 }}>
          {sample.cpu.perCore.map((load, i) => {
            const status = statusFor(load, 70, 90)
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`Core ${i}: ${load.toFixed(0)}%`}>
                <div
                  className="w-full rounded-sm transition-[height] duration-300"
                  style={{ height: `${Math.max(4, load)}%`, background: STATUS_COLOR[status] }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
