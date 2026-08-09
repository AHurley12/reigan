import * as si from 'systeminformation'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import type { PerfSample, PerfStaticInfo } from '../../shared/types'

const SAMPLE_INTERVAL_MS = 2000
const TOP_PROCESS_COUNT = 15

let timer: ReturnType<typeof setInterval> | null = null

export async function getStaticInfo(): Promise<PerfStaticInfo> {
  const [cpu, mem, graphics, fsSize] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.graphics(),
    si.fsSize(),
  ])

  return {
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cpuCores: cpu.cores,
    totalMemBytes: mem.total,
    gpuModels: graphics.controllers.map((c) => c.model).filter((m): m is string => Boolean(m)),
    volumes: fsSize.map((v) => ({ mount: v.mount, totalBytes: v.size })),
  }
}

// networkStats() and networkInterfaces() name the same adapter slightly differently on
// Windows (e.g. "Wi-Fi 3" vs "Wi-Fi3") — compare with whitespace stripped.
const normalizeIfaceName = (name: string) => name.replace(/\s+/g, '').toLowerCase()

export async function collectSample(): Promise<PerfSample> {
  const [load, temp, mem, graphics, fsSize, disksIO, netStats, netIfaces, processes] = await Promise.all([
    si.currentLoad(),
    si.cpuTemperature().catch(() => ({ main: null as number | null })),
    si.mem(),
    si.graphics().catch(() => ({ controllers: [] as si.Systeminformation.GraphicsControllerData[] })),
    si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]),
    si.disksIO().catch(() => null),
    si.networkStats('*').catch(() => [] as si.Systeminformation.NetworkStatsData[]),
    si.networkInterfaces().catch(() => [] as si.Systeminformation.NetworkInterfacesData[]),
    si.processes().catch(() => ({ list: [] as si.Systeminformation.ProcessesProcessData[] })),
  ])

  // The interfaces worth always showing — the default route and anything else actually
  // up and non-internal — identified via networkInterfaces(), since networkStats()'s own
  // operstate field is unreliable on Windows (reports 'unknown' for everything).
  const relevantIfaceNames = new Set(
    netIfaces
      .filter((n) => n.default || (!n.internal && n.operstate === 'up'))
      .map((n) => normalizeIfaceName(n.iface))
  )

  // `active` tracks in-use memory the way Task Manager does; some platforms report it
  // as 0 when unsupported, so fall back to the raw `used` figure.
  const usedBytes = mem.active > 0 ? mem.active : mem.used

  return {
    timestamp: Date.now(),
    cpu: {
      loadPercent: load.currentLoad,
      perCore: load.cpus.map((c) => c.load),
      temperatureC: temp.main && temp.main > 0 ? temp.main : null,
    },
    memory: {
      usedBytes,
      totalBytes: mem.total,
      usedPercent: mem.total > 0 ? (usedBytes / mem.total) * 100 : 0,
    },
    gpu: graphics.controllers.map((c) => ({
      model: c.model || 'GPU',
      utilizationPercent: typeof c.utilizationGpu === 'number' ? c.utilizationGpu : null,
      vramUsedBytes: typeof c.memoryUsed === 'number' ? c.memoryUsed * 1024 * 1024 : null,
      vramTotalBytes: typeof c.memoryTotal === 'number' ? c.memoryTotal * 1024 * 1024 : null,
      temperatureC: typeof c.temperatureGpu === 'number' ? c.temperatureGpu : null,
    })),
    disk: {
      volumes: fsSize.map((v) => ({
        mount: v.mount,
        usedBytes: v.used,
        totalBytes: v.size,
        usedPercent: v.size > 0 ? (v.used / v.size) * 100 : 0,
      })),
      readBytesPerSec: disksIO?.rIO_sec ?? 0,
      writeBytesPerSec: disksIO?.wIO_sec ?? 0,
    },
    network: netStats
      .map((n) => ({ name: n.iface, rxBytesPerSec: n.rx_sec ?? 0, txBytesPerSec: n.tx_sec ?? 0 }))
      .filter((n) => relevantIfaceNames.has(normalizeIfaceName(n.name)) || n.rxBytesPerSec > 0 || n.txBytesPerSec > 0)
      .sort((a, b) => (b.rxBytesPerSec + b.txBytesPerSec) - (a.rxBytesPerSec + a.txBytesPerSec)),
    processes: processes.list
      .slice()
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, TOP_PROCESS_COUNT)
      .map((p) => ({ pid: p.pid, name: p.name, cpuPercent: p.cpu, memBytes: p.memRss * 1024 })),
  }
}

/** Starts the sampling loop, pushing PERF_SAMPLE ticks while the Performance panel is open. */
export function startMonitoring(window: BrowserWindow): void {
  if (timer) return

  let collecting = false
  const tick = () => {
    // Skip overlapping ticks — a slow WMI round trip shouldn't stack up more of them.
    if (collecting) return
    collecting = true
    collectSample()
      .then((sample) => {
        if (!window.isDestroyed()) window.webContents.send(IPC.PERF_SAMPLE, sample)
      })
      .catch(() => {})
      .finally(() => { collecting = false })
  }

  tick()
  timer = setInterval(tick, SAMPLE_INTERVAL_MS)
}

export function stopMonitoring(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
