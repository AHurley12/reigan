import { useEffect, useState } from 'react'
import { Play, Undo2, Copy, FolderSearch } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { VirtualList } from '../shared/VirtualList'
import { useToastStore } from '../../../stores/toastStore'

interface PlannedOp {
  type: string
  sourcePath: string
  destPath?: string
  sizeBytes: number
  note?: string
}

interface Plan {
  scopePath: string
  ops: PlannedOp[]
  skipped: Array<{ path: string; reason: string }>
  totalBytes: number
  filesConsidered: number
  destinations: string[]
  truncated: boolean
}

interface RunRow {
  id: string
  startedAt: number
  mode: string
  opsPlanned: number
  opsExecuted: number
  status: string
  reversible: boolean
}

interface DuplicateGroup {
  hash: string
  sizeBytes: number
  files: Array<{ path: string; modifiedAt: number }>
  suggestedKeeper: string
  wastedBytes: number
}

type Mode = 'organise' | 'duplicates'

const FAMILIES = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'code', 'other'] as const

export function OrganizerView() {
  const plan = useCapability<{ planId: string; plan: Plan }>('files.planOrganize')
  const execute = useCapability<{ executed: number; runId: string }>('files.executePlan')
  const undo = useCapability<{ reversed: number }>('files.undoRun')
  const runs = useCapability<{ runs: RunRow[] }>('files.listRuns')
  const dupes = useCapability<{ groups: DuplicateGroup[]; filesScanned: number; totalWastedBytes: number }>(
    'files.findDuplicates'
  )
  const toast = useToastStore((s) => s.push)

  const [mode, setMode] = useState<Mode>('organise')
  const [scopePath, setScopePath] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [families, setFamilies] = useState<string[]>(['image', 'document'])
  const [destination, setDestination] = useState('{family}s/{yyyy}/{MM}')
  const [olderThanDays, setOlderThanDays] = useState('')

  useEffect(() => {
    void runs.run({ limit: 20 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Preview is a live plan, not a separate code path. The pane shows exactly
   * what Execute would do because it *is* what Execute consumes — a preview
   * computed differently from the real thing is a preview that can lie.
   */
  useEffect(() => {
    if (mode !== 'organise' || !scopePath.trim() || families.length === 0) return
    const timer = setTimeout(() => {
      const conditions: unknown[] = [{ kind: 'mimeFamily', values: families }]
      if (olderThanDays.trim() && Number(olderThanDays) > 0) {
        conditions.push({ kind: 'olderThan', days: Number(olderThanDays), field: 'modified' })
      }
      void plan.run({
        scopePath,
        recursive,
        conditions,
        actions: [{ kind: 'moveTo', destination }],
        collisionPolicy: 'rename',
      })
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scopePath, recursive, families, destination, olderThanDays])

  const current = plan.data?.plan

  return (
    <div className="flex h-full gap-3">
      <div className="flex flex-col w-80 shrink-0 gap-2 overflow-auto">
        <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['organise', 'duplicates'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 px-2 py-1.5 text-xs capitalize"
              style={{
                background: mode === m ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)' : 'transparent',
                color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <Field label="Folder">
          <input
            value={scopePath}
            onChange={(e) => setScopePath(e.target.value)}
            placeholder="C:\Users\you\Downloads"
            spellCheck={false}
            className="w-full rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        </Field>

        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          Include subfolders
        </label>

        {mode === 'organise' ? (
          <>
            <Field label="File types">
              <div className="flex flex-wrap gap-1">
                {FAMILIES.map((f) => {
                  const on = families.includes(f)
                  return (
                    <button
                      key={f}
                      onClick={() => setFamilies(on ? families.filter((x) => x !== f) : [...families, f])}
                      className="px-1.5 py-0.5 rounded-sm text-[11px] capitalize"
                      style={{
                        border: `1px solid ${on ? 'var(--border-accent)' : 'var(--border)'}`,
                        color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                      }}
                    >
                      {f}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Older than (days, optional)">
              <input
                value={olderThanDays}
                onChange={(e) => setOlderThanDays(e.target.value.replace(/\D/g, ''))}
                placeholder="30"
                className="w-full rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
            </Field>

            <Field label="Move into">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                spellCheck={false}
                className="w-full rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Tokens: {'{family} {yyyy} {MM} {dd} {name} {ext}'}
              </span>
            </Field>

            <button
              onClick={() => {
                if (!plan.data) return
                void execute.run({ planId: plan.data.planId }).then((r) => {
                  if (r) {
                    toast(`Executed ${r.executed} operation(s).`, 'success')
                    void runs.run({ limit: 20 })
                    plan.reset()
                  } else if (execute.error) {
                    toast(execute.error, 'error')
                  }
                })
              }}
              disabled={!current || current.ops.length === 0 || execute.loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm text-xs"
              style={{
                border: '1px solid var(--border-accent)',
                color: 'var(--text-primary)',
                opacity: !current || current.ops.length === 0 || execute.loading ? 0.5 : 1,
              }}
            >
              <Play size={12} />
              {execute.loading ? 'Applying…' : `Execute ${current?.ops.length ?? 0} operation(s)`}
            </button>
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Nothing moves until you approve. Deletions go to the Recycle Bin and every run can be undone.
            </span>
          </>
        ) : (
          <button
            onClick={() => void dupes.run({ scopePath, recursive: true })}
            disabled={!scopePath.trim() || dupes.loading}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm text-xs"
            style={{ border: '1px solid var(--border-accent)', color: 'var(--text-primary)', opacity: scopePath ? 1 : 0.5 }}
          >
            <FolderSearch size={12} /> {dupes.loading ? 'Scanning…' : 'Find duplicates'}
          </button>
        )}

        {/* Run history */}
        <div className="flex flex-col gap-1 mt-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Recent runs
          </span>
          {(runs.data?.runs ?? []).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm"
              style={{ border: '1px solid var(--border)' }}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {r.opsExecuted}/{r.opsPlanned} ops · {r.status}
                </span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {new Date(r.startedAt).toLocaleString()}
                </span>
              </div>
              {r.reversible && (
                <button
                  onClick={() =>
                    void undo.run({ runId: r.id }).then((res) => {
                      if (res) {
                        toast(`Reversed ${res.reversed} operation(s).`, 'success')
                        void runs.run({ limit: 20 })
                      } else if (undo.error) toast(undo.error, 'error')
                    })
                  }
                  className="ml-auto flex items-center gap-1 px-1.5 py-1 rounded-sm text-[11px]"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Undo2 size={11} /> Undo
                </button>
              )}
            </div>
          ))}
          {runs.data?.runs.length === 0 && (
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              None yet.
            </span>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {mode === 'organise' ? (
          <>
            {current && (
              <div className="font-mono text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>
                {current.ops.length} operation(s) · {(current.totalBytes / 1048576).toFixed(1)} MB ·{' '}
                {current.filesConsidered} file(s) considered
                {current.skipped.length > 0 && ` · ${current.skipped.length} skipped`}
              </div>
            )}
            <div className="flex-1 min-h-0">
              <AsyncPane
                loading={plan.loading}
                error={plan.error}
                onRetry={() => void plan.run({})}
                empty={!plan.loading && (!current || current.ops.length === 0)}
                emptyTitle={scopePath ? 'Nothing matches yet' : 'Choose a folder'}
                emptyHint={
                  scopePath
                    ? 'No files in that folder match the current filters. The folder must also be an allowlisted managed root.'
                    : 'Type a folder path to see exactly what would be moved. Nothing happens until you execute.'
                }
              >
                {current && (
                  <VirtualList
                    items={current.ops}
                    rowHeight={44}
                    className="h-full"
                    renderRow={(op) => (
                      <div
                        className="flex flex-col justify-center px-2 h-full"
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="px-1 rounded-sm text-[10px] font-mono uppercase shrink-0"
                            style={{ color: 'var(--accent-primary)', border: '1px solid var(--border)' }}
                          >
                            {op.type}
                          </span>
                          <span className="font-mono text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                            {op.sourcePath}
                          </span>
                        </div>
                        {op.destPath && (
                          <span className="font-mono text-[11px] truncate pl-1" style={{ color: 'var(--text-muted)' }}>
                            → {op.destPath} {op.note ? `(${op.note})` : ''}
                          </span>
                        )}
                      </div>
                    )}
                  />
                )}
              </AsyncPane>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <AsyncPane
              loading={dupes.loading}
              error={dupes.error}
              progress={dupes.progress}
              onCancel={dupes.cancel}
              empty={!dupes.loading && !!dupes.data && dupes.data.groups.length === 0}
              emptyTitle="No duplicates found"
              emptyHint={dupes.data ? `${dupes.data.filesScanned} file(s) compared.` : undefined}
            >
              {dupes.data && (
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {dupes.data.groups.length} group(s) · {(dupes.data.totalWastedBytes / 1048576).toFixed(1)} MB
                    recoverable · report only, nothing is deleted
                  </span>
                  {dupes.data.groups.map((g) => (
                    <div key={g.hash} className="flex flex-col gap-0.5 p-2 rounded-sm" style={{ border: '1px solid var(--border)' }}>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {g.files.length} copies · {(g.sizeBytes / 1048576).toFixed(2)} MB each
                      </span>
                      {g.files.map((f) => (
                        <div key={f.path} className="flex items-center gap-2">
                          <span
                            className="font-mono text-[11px] truncate"
                            style={{
                              color: f.path === g.suggestedKeeper ? 'var(--status-good)' : 'var(--text-secondary)',
                            }}
                          >
                            {f.path === g.suggestedKeeper ? '✓ keep' : '  dup'} {f.path}
                          </span>
                          <button
                            onClick={() => void navigator.clipboard.writeText(f.path)}
                            className="ml-auto shrink-0"
                            style={{ color: 'var(--text-muted)' }}
                            title="Copy path"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </AsyncPane>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  )
}
