import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, FolderOpen, Terminal, Code2, GitBranch } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { VirtualList } from '../shared/VirtualList'
import { useToastStore } from '../../../stores/toastStore'

type Status = 'active' | 'warm' | 'dormant' | 'abandoned'

interface Project {
  id: string
  path: string
  name: string
  status: Status
  primaryLanguage: string | null
  languages: Record<string, number>
  frameworks: string[]
  packageManager: string | null
  lastModified: number | null
  lastCommitAt: number | null
  branch: string | null
  isDirty: boolean
  unpushedCount: number
  readmeStatus: string
  loc: number
  sizeBytes: number
  sizeBytesNoDeps: number
  hasTests: boolean
  remoteUrl: string | null
  flags: {
    neverCommitted: boolean
    noReadme: boolean
    uncommittedChanges: boolean
    unpushedCommits: boolean
  }
}

interface Summary {
  total: number
  byStatus: Record<Status, number>
  totalSizeBytes: number
  totalSizeBytesNoDeps: number
  withUncommittedChanges: number
  withUnpushedCommits: number
  missingReadme: number
  topLanguages: Array<{ language: string; count: number }>
}

interface ListResult {
  projects: Project[]
  summary: Summary
}

/**
 * Status colours come from the performance tokens rather than new ones: these
 * are the same "healthy → needs attention" ramp the perf views already use,
 * and inventing a parallel palette would drift from it under a skin change.
 */
const STATUS_TOKEN: Record<Status, string> = {
  active: 'var(--status-good)',
  warm: 'var(--status-good)',
  dormant: 'var(--status-warning)',
  abandoned: 'var(--status-critical)',
}

const STATUSES: Status[] = ['active', 'warm', 'dormant', 'abandoned']
const ROW_HEIGHT = 62

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function formatAge(timestamp: number | null): string {
  if (!timestamp) return 'never'
  const days = Math.floor((Date.now() - timestamp) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export function ProjectsView() {
  const list = useCapability<ListResult>('devtools.listProjects')
  const scan = useCapability<{ projectsFound: number; dirsWalked: number; durationMs: number }>(
    'devtools.scanProjects'
  )
  const open = useCapability<{ opened: string }>('devtools.openProject')
  const toast = useToastStore((s) => s.push)

  const [status, setStatus] = useState<Status | 'all'>('all')
  const [flag, setFlag] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = (): void => {
    void list.run({
      status: status === 'all' ? undefined : status,
      flag: flag === 'all' ? undefined : flag,
      search: search || undefined,
    })
  }

  useEffect(refresh, [status, flag])

  useEffect(() => {
    const timer = setTimeout(refresh, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const runScan = async (full: boolean): Promise<void> => {
    const result = await scan.run({ full })
    if (result) {
      toast(
        `Scanned ${result.dirsWalked} directories in ${(result.durationMs / 1000).toFixed(1)}s — ${result.projectsFound} projects.`,
        'success'
      )
      refresh()
    }
  }

  const summary = list.data?.summary
  const projects = useMemo(() => list.data?.projects ?? [], [list.data])

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Summary strip */}
      {summary && summary.total > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 rounded-sm shrink-0"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <Stat label="Projects" value={String(summary.total)} />
          {STATUSES.filter((s) => summary.byStatus[s] > 0).map((s) => (
            <Stat key={s} label={s} value={String(summary.byStatus[s])} color={STATUS_TOKEN[s]} />
          ))}
          <Stat label="On disk" value={formatBytes(summary.totalSizeBytes)} />
          <Stat label="Excl. deps" value={formatBytes(summary.totalSizeBytesNoDeps)} />
          <Stat
            label="Uncommitted"
            value={String(summary.withUncommittedChanges)}
            color={summary.withUncommittedChanges ? 'var(--status-warning)' : undefined}
          />
          <Stat
            label="Unpushed"
            value={String(summary.withUnpushedCommits)}
            color={summary.withUnpushedCommits ? 'var(--status-warning)' : undefined}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name or path…"
          className="flex-1 min-w-40 rounded-sm px-2.5 py-1.5 text-sm font-mono focus:outline-none"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <Segmented
          options={[{ key: 'all', label: 'All' }, ...STATUSES.map((s) => ({ key: s, label: s }))]}
          value={status}
          onChange={(v) => setStatus(v as Status | 'all')}
        />
        <Segmented
          options={[
            { key: 'all', label: 'Any' },
            { key: 'uncommitted-changes', label: 'Dirty' },
            { key: 'unpushed-commits', label: 'Unpushed' },
            { key: 'no-readme', label: 'No README' },
            { key: 'never-committed', label: 'No commits' },
          ]}
          value={flag}
          onChange={setFlag}
        />
        <button
          onClick={() => void runScan(false)}
          disabled={scan.loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs transition-colors"
          style={{
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            opacity: scan.loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={scan.loading ? 'animate-spin' : ''} />
          {scan.loading ? 'Scanning…' : 'Scan'}
        </button>
        <button
          onClick={() => void runScan(true)}
          disabled={scan.loading}
          className="px-2.5 py-1.5 rounded-sm text-xs transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Ignore the incremental skip and re-walk every root"
        >
          Full rescan
        </button>
      </div>

      {scan.loading && (
        <AsyncPane loading error={null} progress={scan.progress} onCancel={scan.cancel} skeletonRows={3}>
          <div />
        </AsyncPane>
      )}

      {scan.error && !scan.loading && (
        <AsyncPane loading={false} error={scan.error} onRetry={() => void runScan(false)}>
          <div />
        </AsyncPane>
      )}

      <div className="flex-1 min-h-0">
        <AsyncPane
          loading={list.loading}
          error={list.error}
          onRetry={refresh}
          empty={!list.loading && projects.length === 0}
          emptyTitle={summary?.total ? 'No projects match those filters' : 'No projects indexed yet'}
          emptyHint={
            summary?.total
              ? 'Try clearing the status or flag filter.'
              : 'Run a scan to index the code projects in your usual folders.'
          }
          emptyAction={
            !summary?.total ? (
              <button
                onClick={() => void runScan(true)}
                className="px-3 py-1.5 rounded-sm text-xs"
                style={{ border: '1px solid var(--border-accent)', color: 'var(--text-primary)' }}
              >
                Scan for projects
              </button>
            ) : undefined
          }
        >
          <VirtualList
            items={projects}
            rowHeight={ROW_HEIGHT}
            className="h-full"
            renderRow={(project) => (
              <ProjectRow
                project={project}
                expanded={expanded === project.id}
                onToggle={() => setExpanded(expanded === project.id ? null : project.id)}
                onOpen={(target) => {
                  void open.run({ project: project.path, target }).then((r) => {
                    if (r) toast(`Opened ${project.name} in ${target}.`, 'success')
                  })
                }}
              />
            )}
          />
        </AsyncPane>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-sm" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
      <span className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: string; label: string }>
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {options.map((option) => {
        const active = option.key === value
        return (
          <button
            key={option.key}
            onClick={() => onChange(option.key)}
            className="px-2 py-1.5 text-xs capitalize transition-colors"
            style={{
              background: active ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ProjectRow({
  project,
  expanded,
  onToggle,
  onOpen,
}: {
  project: Project
  expanded: boolean
  onToggle: () => void
  onOpen: (target: 'explorer' | 'editor' | 'terminal') => void
}) {
  const languages = Object.entries(project.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  return (
    <div
      className="flex flex-col justify-center px-3 h-full cursor-pointer transition-colors"
      style={{ borderBottom: '1px solid var(--border)' }}
      onClick={onToggle}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: STATUS_TOKEN[project.status] }}
          title={project.status}
        />
        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {project.name}
        </span>

        {project.branch && (
          <span className="flex items-center gap-1 font-mono text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
            <GitBranch size={11} /> {project.branch}
          </span>
        )}
        {project.flags.uncommittedChanges && (
          <Badge color="var(--status-warning)" title="Uncommitted changes">dirty</Badge>
        )}
        {project.flags.unpushedCommits && (
          <Badge color="var(--status-warning)" title="Commits not pushed">↑{project.unpushedCount}</Badge>
        )}
        {project.flags.noReadme && <Badge color="var(--text-muted)" title="No README">no readme</Badge>}

        <span className="ml-auto font-mono text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
          {formatAge(project.lastModified)}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-0.5">
        <span className="font-mono text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {project.path}
        </span>
        {languages.length > 0 && (
          <span className="font-mono text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {languages.map(([l, pct]) => `${l} ${pct}%`).join(' · ')}
          </span>
        )}
      </div>

      {expanded && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2"
          style={{ borderTop: '1px solid var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Detail label="Frameworks" value={project.frameworks.join(', ') || 'none'} />
          <Detail label="Manager" value={project.packageManager ?? 'none'} />
          <Detail label="Lines" value={project.loc.toLocaleString()} />
          <Detail label="Size" value={`${formatBytes(project.sizeBytes)} (${formatBytes(project.sizeBytesNoDeps)} excl.)`} />
          <Detail label="Tests" value={project.hasTests ? 'yes' : 'none'} />
          <Detail label="Last commit" value={formatAge(project.lastCommitAt)} />
          {project.remoteUrl && <Detail label="Remote" value={project.remoteUrl} />}

          <div className="flex items-center gap-1.5 ml-auto">
            <IconButton icon={<FolderOpen size={13} />} label="Explorer" onClick={() => onOpen('explorer')} />
            <IconButton icon={<Code2 size={13} />} label="Editor" onClick={() => onOpen('editor')} />
            <IconButton icon={<Terminal size={13} />} label="Terminal" onClick={() => onOpen('terminal')} />
          </div>
        </div>
      )}
    </div>
  )
}

function Badge({ children, color, title }: { children: React.ReactNode; color: string; title?: string }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] shrink-0"
      style={{ color, border: `1px solid ${color}`, opacity: 0.9 }}
      title={title}
    >
      {children}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
      {label}: <span style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </span>
  )
}

function IconButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs transition-colors"
      style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
    >
      {icon} {label}
    </button>
  )
}
