import { useEffect, useRef, useState } from 'react'
import { useIPC } from '../../hooks/useIPC'
import { useToastStore } from '../../stores/toastStore'
import { SectionHeader } from '../shared/SectionHeader'
import { PERFORMANCE_TABS } from './performanceRegistry'
import { statusFor } from './shared/perfStatus'
import type { PerfHistory } from './types'
import type { PerfSample, PerfStaticInfo } from '../../../../shared/types'

const HISTORY_LENGTH = 60 // ~2 minutes of trend at the monitor's 2s sample interval

const EMPTY_HISTORY: PerfHistory = {
  cpu: [],
  memory: [],
  gpu: [],
  diskRead: [],
  diskWrite: [],
  networkRx: [],
  networkTx: [],
}

function pushBounded(arr: number[], value: number): number[] {
  return [...arr, value].slice(-HISTORY_LENGTH)
}

export function PerformancePanel() {
  const ipc = useIPC()
  const push = useToastStore((s) => s.push)

  const [activeTab, setActiveTab] = useState(PERFORMANCE_TABS[0].id)
  const [staticInfo, setStaticInfo] = useState<PerfStaticInfo | null>(null)
  const [sample, setSample] = useState<PerfSample | null>(null)
  const [history, setHistory] = useState<PerfHistory>(EMPTY_HISTORY)

  // Edge-triggered alert state — fires a toast once on the transition into
  // critical, not on every sample tick.
  const alertedRef = useRef({ cpu: false, memory: false, disk: {} as Record<string, boolean> })

  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    ipc.perf.staticInfo().then((info) => { if (!cancelled) setStaticInfo(info) }).catch(() => {})
    return () => { cancelled = true }
  }, [ipc])

  // Sampling runs only while this panel is mounted — started on mount, stopped on unmount.
  useEffect(() => {
    if (!ipc) return

    ipc.perf.start().catch(() => push('Could not start the performance monitor.', 'error'))

    const unsubscribe = ipc.perf.onSample((next) => {
      setSample(next)
      setHistory((h) => ({
        cpu: pushBounded(h.cpu, next.cpu.loadPercent),
        memory: pushBounded(h.memory, next.memory.usedPercent),
        gpu: next.gpu.map((g, i) => pushBounded(h.gpu[i] ?? [], g.utilizationPercent ?? 0)),
        diskRead: pushBounded(h.diskRead, next.disk.readBytesPerSec),
        diskWrite: pushBounded(h.diskWrite, next.disk.writeBytesPerSec),
        networkRx: pushBounded(h.networkRx, next.network.reduce((sum, n) => sum + n.rxBytesPerSec, 0)),
        networkTx: pushBounded(h.networkTx, next.network.reduce((sum, n) => sum + n.txBytesPerSec, 0)),
      }))

      const cpuCritical = statusFor(next.cpu.loadPercent, 70, 90) === 'critical'
      if (cpuCritical && !alertedRef.current.cpu) push('CPU usage is critically high.', 'warning')
      alertedRef.current.cpu = cpuCritical

      const memCritical = statusFor(next.memory.usedPercent, 75, 90) === 'critical'
      if (memCritical && !alertedRef.current.memory) push('Memory usage is critically high.', 'warning')
      alertedRef.current.memory = memCritical

      for (const vol of next.disk.volumes) {
        const critical = statusFor(vol.usedPercent, 80, 95) === 'critical'
        if (critical && !alertedRef.current.disk[vol.mount]) push(`Disk ${vol.mount} is almost full.`, 'warning')
        alertedRef.current.disk[vol.mount] = critical
      }
    })

    return () => {
      unsubscribe()
      ipc.perf.stop().catch(() => {})
    }
  }, [ipc, push])

  const active = PERFORMANCE_TABS.find((t) => t.id === activeTab) ?? PERFORMANCE_TABS[0]
  const ActiveComponent = active.component

  return (
    <div className="flex h-full">
      {/* Tab rail */}
      <div className="rule-r w-[150px] shrink-0 flex flex-col py-4">
        <div className="px-4 pb-3">
          <SectionHeader en="Performance" ja="性能" romaji="seinou" />
        </div>
        {PERFORMANCE_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative text-left px-4 py-2.5 mx-1 rounded-[3px] transition-colors duration-fast"
              style={{
                background: isActive ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                  style={{ background: 'var(--reigan-primary)' }}
                />
              )}
              <div className="flex items-center gap-2">
                <Icon size={14} />
                <span className="text-[14px]" style={{ fontFamily: 'var(--font-display)' }}>{tab.labelEn}</span>
              </div>
              <span className="text-[11px] font-kanji ml-5 block mt-0.5" style={{ color: 'var(--text-kanji)' }}>{tab.labelJa}</span>
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <ActiveComponent sample={sample} history={history} staticInfo={staticInfo} />
      </div>
    </div>
  )
}
