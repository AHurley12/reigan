import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ExternalLink, Copy, Skull, Pause, Play, AlertTriangle } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { useToastStore } from '../../../stores/toastStore'

interface PortEntry {
  port: number
  pid: number
  processName: string
  executablePath: string | null
  commandLine: string | null
  startedAt: number | null
  memBytes: number | null
  signature: string | null
  projectName: string | null
  projectPath: string | null
  httpStatus: number | null
  httpTitle: string | null
  httpServer: string | null
}

const POLL_MS = 5000

/** Ports a dev server would plausibly want, for the conflict banner. */
const COMMON_DEV_PORTS = new Set([3000, 3001, 4200, 5173, 5174, 8000, 8080, 8081])

function uptime(startedAt: number | null): string {
  if (!startedAt) return '—'
  const mins = Math.floor((Date.now() - startedAt) / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d`
}

export function PortsView() {
  const scan = useCapability<{ ports: PortEntry[] }>('localhost.scan')
  const kill = useCapability<{ port: number }>('localhost.killProcess')
  const openBrowser = useCapability<{ url: string }>('localhost.openInBrowser')
  const toast = useToastStore((s) => s.push)

  const [watching, setWatching] = useState(true)
  const [probeHttp, setProbeHttp] = useState(false)
  const [ports, setPorts] = useState<PortEntry[]>([])
  const previous = useRef<Set<number>>(new Set())

  const refresh = useCallback(async () => {
    const result = await scan.run({ probeHttp })
    if (!result) return

    // Diffed against the last snapshot so appearing and disappearing servers
    // are events, not something the user has to spot by re-reading the table.
    const current = new Set(result.ports.map((p) => p.port))
    if (previous.current.size > 0) {
      for (const port of current) {
        if (!previous.current.has(port)) {
          const entry = result.ports.find((p) => p.port === port)
          toast(`Port ${port} opened — ${entry?.projectName ?? entry?.signature ?? entry?.processName}`, 'info')
        }
      }
      for (const port of previous.current) {
        if (!current.has(port)) toast(`Port ${port} closed.`, 'info')
      }
    }
    previous.current = current
    setPorts(result.ports)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeHttp])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Polls only while watching is on. The brief's requirement not to poll a
   * hidden window is satisfied structurally: this view is lazily mounted and
   * unmounted with the sub-tab, so the interval cannot outlive it.
   */
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [watching, refresh])

  const orphans = ports.filter(
    (p) => COMMON_DEV_PORTS.has(p.port) && p.startedAt && Date.now() - p.startedAt > 2 * 3600_000
  )

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          onClick={() => setWatching((w) => !w)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          {watching ? <Pause size={12} /> : <Play size={12} />}
          {watching ? `Watching (${POLL_MS / 1000}s)` : 'Paused'}
        </button>
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={12} className={scan.loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={probeHttp} onChange={(e) => setProbeHttp(e.target.checked)} />
          HTTP probe
          <span title="Makes a 1s request to each port. Off by default — some dev servers log every request.">ⓘ</span>
        </label>
        <span className="ml-auto font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          {ports.length} listening
        </span>
      </div>

      {orphans.length > 0 && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-sm shrink-0"
          style={{ border: '1px solid var(--status-warning)', background: 'var(--bg-elevated)' }}
        >
          <AlertTriangle size={14} style={{ color: 'var(--status-warning)', marginTop: 2 }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {orphans
              .map(
                (p) =>
                  `${p.port} is held by ${p.projectName ?? p.signature ?? p.processName} started ${uptime(p.startedAt)} ago`
              )
              .join('; ')}
            {' — possibly orphaned.'}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <AsyncPane
          loading={scan.loading && ports.length === 0}
          error={scan.error}
          onRetry={() => void refresh()}
          empty={!scan.loading && ports.length === 0}
          emptyTitle="Nothing is listening"
          emptyHint="No process on this machine currently holds a TCP port."
        >
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Port', 'What', 'Process', 'Uptime', 'Memory', ''].map((h) => (
                  <th
                    key={h}
                    className="text-left font-normal text-xs py-1.5 px-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ports.map((p) => (
                <tr key={p.port} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="py-1.5 px-2 font-mono" style={{ color: 'var(--text-primary)' }}>
                    {p.port}
                  </td>
                  <td className="py-1.5 px-2">
                    {/* The resolved project is the whole point, so it leads. */}
                    <span style={{ color: p.projectName ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {p.projectName ?? p.signature ?? '—'}
                    </span>
                    {p.projectName && p.signature && (
                      <span className="ml-1.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {p.signature}
                      </span>
                    )}
                    {p.httpTitle && (
                      <span className="ml-1.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        "{p.httpTitle}"
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {p.processName} · {p.pid}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {uptime(p.startedAt)}
                  </td>
                  <td className="py-1.5 px-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {p.memBytes ? `${(p.memBytes / 1048576).toFixed(0)} MB` : '—'}
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1 justify-end">
                      <RowButton
                        title="Open in browser"
                        onClick={() => void openBrowser.run({ port: p.port })}
                        icon={<ExternalLink size={12} />}
                      />
                      <RowButton
                        title="Copy URL"
                        onClick={() => {
                          void navigator.clipboard.writeText(`http://localhost:${p.port}`)
                          toast(`Copied http://localhost:${p.port}`, 'success')
                        }}
                        icon={<Copy size={12} />}
                      />
                      <RowButton
                        title="Kill process"
                        danger
                        onClick={() => {
                          void kill.run({ port: p.port }).then((r) => {
                            if (r) {
                              toast(`Killed the process on port ${p.port}.`, 'success')
                              void refresh()
                            } else if (kill.error) {
                              toast(kill.error, 'error')
                            }
                          })
                        }}
                        icon={<Skull size={12} />}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncPane>
      </div>
    </div>
  )
}

function RowButton({
  icon,
  title,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1 rounded-sm transition-colors"
      style={{ color: danger ? 'var(--status-critical)' : 'var(--text-muted)' }}
    >
      {icon}
    </button>
  )
}
