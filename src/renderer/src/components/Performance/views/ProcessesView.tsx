import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { formatBytes } from '../shared/format'
import type { PerformanceViewProps } from '../types'
import type { PerfProcess } from '../../../../../shared/types'

type SortKey = 'name' | 'cpuPercent' | 'memBytes'

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'name', label: 'Process', align: 'left' },
  { key: 'cpuPercent', label: 'CPU', align: 'right' },
  { key: 'memBytes', label: 'Memory', align: 'right' },
]

export function ProcessesView({ sample }: PerformanceViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('cpuPercent')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const processes: PerfProcess[] = sample?.processes ?? []

  const sorted = useMemo(() => {
    const list = [...processes]
    list.sort((a, b) => {
      const cmp = sortKey === 'name' ? a.name.localeCompare(b.name) : a[sortKey] - b[sortKey]
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [processes, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  if (!sample) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Waiting for the performance monitor to start…
      </p>
    )
  }

  return (
    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr className="rule-b">
          {COLUMNS.map((col) => {
            const active = sortKey === col.key
            return (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className="py-2 px-3 cursor-pointer select-none font-normal"
                style={{ color: active ? 'var(--text-secondary)' : 'var(--text-muted)', textAlign: col.align }}
              >
                <span className="inline-flex items-center gap-1" style={{ flexDirection: col.align === 'right' ? 'row-reverse' : 'row' }}>
                  {col.label}
                  {active && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                </span>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.pid} className="rule-b hover:bg-tint/5 transition-colors">
            <td className="py-2 px-3 truncate" style={{ color: 'var(--text-primary)', maxWidth: 240 }}>{p.name}</td>
            <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {p.cpuPercent.toFixed(1)}%
            </td>
            <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(p.memBytes)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
