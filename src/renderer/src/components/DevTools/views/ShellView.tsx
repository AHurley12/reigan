import { useEffect, useState } from 'react'
import { Play, ShieldCheck, ShieldAlert, ShieldX, RotateCcw } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'

interface Classification {
  tier: 'allow' | 'approval' | 'block'
  reason: string
  segments: string[]
}

interface RunResult {
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  durationMs: number
  timedOut: boolean
}

interface HistoryRow {
  id: string
  command: string
  cwd: string
  classification: 'allow' | 'approval' | 'block'
  exitCode: number | null
  durationMs: number | null
  ranAt: number
}

const TIER_STYLE: Record<Classification['tier'], { color: string; icon: typeof ShieldCheck; label: string }> = {
  allow: { color: 'var(--status-good)', icon: ShieldCheck, label: 'runs immediately' },
  approval: { color: 'var(--status-warning)', icon: ShieldAlert, label: 'needs approval' },
  block: { color: 'var(--status-critical)', icon: ShieldX, label: 'refused' },
}

export function ShellView() {
  const classify = useCapability<Classification>('shell.classify')
  const run = useCapability<RunResult>('shell.run')
  const history = useCapability<{ history: HistoryRow[] }>('shell.history')

  const [command, setCommand] = useState('')
  const [cwd, setCwd] = useState('')

  useEffect(() => {
    void history.run({ limit: 50 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live classification as the user types, so the consequence of a command is
  // visible before it is submitted rather than discovered by a modal.
  useEffect(() => {
    if (!command.trim()) {
      classify.reset()
      return
    }
    const timer = setTimeout(() => void classify.run({ command }), 180)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  const verdict = classify.data
  const tier = verdict ? TIER_STYLE[verdict.tier] : null
  const TierIcon = tier?.icon

  const execute = async (): Promise<void> => {
    if (!command.trim() || verdict?.tier === 'block') return
    await run.run({ command, cwd: cwd || undefined })
    void history.run({ limit: 50 })
  }

  return (
    <div className="flex h-full gap-3">
      <div className="flex flex-col flex-1 min-w-0 gap-3">
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex gap-2">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void execute()
                }
              }}
              placeholder="git status"
              spellCheck={false}
              className="flex-1 rounded-sm px-2.5 py-2 text-sm font-mono focus:outline-none"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={() => void execute()}
              disabled={!command.trim() || verdict?.tier === 'block' || run.loading}
              className="flex items-center gap-1.5 px-3 rounded-sm text-xs"
              style={{
                border: '1px solid var(--border-accent)',
                color: 'var(--text-primary)',
                opacity: !command.trim() || verdict?.tier === 'block' || run.loading ? 0.5 : 1,
              }}
            >
              <Play size={12} /> {run.loading ? 'Running…' : 'Run'}
            </button>
          </div>

          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Working directory — a project name or absolute path (optional)"
            spellCheck={false}
            className="rounded-sm px-2.5 py-1.5 text-xs font-mono focus:outline-none"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          />

          {verdict && TierIcon && (
            <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-sm" style={{ border: `1px solid ${tier!.color}` }}>
              <TierIcon size={13} style={{ color: tier!.color, marginTop: 1, flexShrink: 0 }} />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs" style={{ color: tier!.color }}>
                  {tier!.label}
                </span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  {verdict.reason}
                </span>
                {verdict.segments.length > 1 && (
                  <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {verdict.segments.length} segments: {verdict.segments.join('  ⟶  ')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <AsyncPane
            loading={run.loading}
            error={run.error}
            empty={!run.loading && !run.data && !run.error}
            emptyTitle="No output yet"
            emptyHint="Read-only commands like git status or npm ls run without asking. Anything else prompts first."
            skeletonRows={4}
          >
            {run.data && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: run.data.exitCode === 0 ? 'var(--status-good)' : 'var(--status-critical)' }}>
                    exit {run.data.exitCode ?? (run.data.timedOut ? 'timeout' : '—')}
                  </span>
                  <span>{(run.data.durationMs / 1000).toFixed(2)}s</span>
                  <span className="truncate">{run.data.cwd}</span>
                </div>
                {run.data.stdout && <Output text={run.data.stdout} />}
                {run.data.stderr && <Output text={run.data.stderr} stderr />}
                {run.data.truncated && (
                  <span className="font-mono text-xs" style={{ color: 'var(--status-warning)' }}>
                    Output truncated at 100KB.
                  </span>
                )}
              </div>
            )}
          </AsyncPane>
        </div>
      </div>

      {/* History */}
      <div className="flex flex-col w-72 shrink-0 gap-2">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          History
        </span>
        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-1">
          {(history.data?.history ?? []).map((row) => {
            const style = TIER_STYLE[row.classification]
            return (
              <button
                key={row.id}
                onClick={() => setCommand(row.command)}
                className="flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-sm text-left transition-colors"
                style={{ border: '1px solid var(--border)' }}
                title="Click to re-run"
              >
                <div className="flex items-center gap-1.5 w-full">
                  <span
                    className="px-1 rounded-sm text-[10px] font-mono shrink-0"
                    style={{ color: style.color, border: `1px solid ${style.color}` }}
                  >
                    {row.classification}
                  </span>
                  <span className="font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    {row.command}
                  </span>
                  <RotateCcw size={10} className="ml-auto shrink-0" style={{ color: 'var(--text-muted)' }} />
                </div>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  exit {row.exitCode ?? '—'} · {new Date(row.ranAt).toLocaleTimeString()}
                </span>
              </button>
            )
          })}
          {history.data?.history.length === 0 && (
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              No commands run yet.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Output({ text, stderr }: { text: string; stderr?: boolean }) {
  return (
    <pre
      className="font-mono text-xs whitespace-pre-wrap break-all p-2 rounded-sm overflow-x-auto"
      style={{
        background: 'var(--bg-elevated)',
        color: stderr ? 'var(--status-critical)' : 'var(--text-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {text}
    </pre>
  )
}
