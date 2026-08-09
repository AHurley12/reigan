import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getStaticInfo, collectSample } from '../../perf/perfMonitor'

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`
}

export const getPerformanceSnapshotTool = new DynamicStructuredTool({
  name: 'get_performance_snapshot',
  description:
    "Read the user's current system performance — CPU/GPU load, memory, disk, and top processes. Use when asked how the machine is running, what's using resources, etc.",
  schema: z.object({}),
  func: async () => {
    const [info, sample] = await Promise.all([getStaticInfo(), collectSample()])

    const lines = [
      `CPU: ${info.cpuModel} (${info.cpuCores} cores) — ${sample.cpu.loadPercent.toFixed(0)}% load${sample.cpu.temperatureC ? `, ${sample.cpu.temperatureC.toFixed(0)}°C` : ''}`,
      `Memory: ${gb(sample.memory.usedBytes)} / ${gb(sample.memory.totalBytes)} (${sample.memory.usedPercent.toFixed(0)}%)`,
      ...sample.gpu.map((g) => `GPU: ${g.model}${g.utilizationPercent !== null ? ` — ${g.utilizationPercent.toFixed(0)}% util` : ''}${g.vramUsedBytes && g.vramTotalBytes ? `, ${gb(g.vramUsedBytes)}/${gb(g.vramTotalBytes)} VRAM` : ''}`),
      ...sample.disk.volumes.map((v) => `Disk ${v.mount}: ${gb(v.usedBytes)} / ${gb(v.totalBytes)} (${v.usedPercent.toFixed(0)}%)`),
      'Top processes by CPU:',
      ...sample.processes.slice(0, 5).map((p) => `  ${p.name} (pid ${p.pid}) — ${p.cpuPercent.toFixed(1)}% CPU, ${gb(p.memBytes)} RAM`),
    ]
    return lines.join('\n')
  },
})
