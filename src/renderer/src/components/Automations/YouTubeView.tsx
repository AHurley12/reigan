import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertTriangle, ExternalLink, ListPlus } from 'lucide-react'
import { Sparkline } from './Sparkline'
import { ChannelTrends } from './ChannelTrends'
import { Button } from '../shared/Button'
import { useIPC } from '../../hooks/useIPC'
import { useToastStore } from '../../stores/toastStore'
import type {
  YtAuditFinding,
  YtChannelStats,
  YtPerformanceTier,
  YtQuotaStatus,
  YtSeriesPoint,
  YtVideoSummary,
} from '../../../../shared/types'

type Range = 28 | 90 | 365 | 3650
const RANGES: Array<{ value: Range; label: string }> = [
  { value: 28, label: '28d' },
  { value: 90, label: '90d' },
  { value: 365, label: '365d' },
  { value: 3650, label: 'All' },
]

const TIER_COLOR: Record<YtPerformanceTier, string> = {
  top: 'var(--status-success)',
  solid: 'var(--accent-primary)',
  underperforming: 'var(--status-listening)',
  dormant: 'var(--text-muted)',
}

const FINDING_GROUPS: Array<{ kind: string; label: string }> = [
  { kind: 'still_earning', label: 'Still earning' },
  { kind: 'revival_thumbnail', label: 'Thumbnail / title problem' },
  { kind: 'revival_content', label: 'Content problem' },
  { kind: 'revival_remake', label: 'Remake candidates' },
  { kind: 'metadata_hygiene', label: 'Metadata hygiene' },
  { kind: 'cadence', label: 'Publishing cadence' },
  { kind: 'title_pattern', label: 'Title patterns' },
  { kind: 'ctr_unavailable', label: 'Analysis unavailable' },
]

/** The quota meter is deliberately at the top and always visible, not buried in settings. */
function QuotaMeter({ quota }: { quota: YtQuotaStatus }) {
  const pct = Math.min((quota.used / quota.budget) * 100, 100)
  const near = pct >= 80
  const color = near ? 'var(--status-error)' : 'var(--accent-primary)'

  return (
    <div className="flex flex-col gap-1 w-44">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          API quota
        </span>
        <span className="font-mono text-[10px]" style={{ color: near ? color : 'var(--text-secondary)' }}>
          {quota.used}/{quota.budget}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)' }}
        role="meter"
        aria-valuenow={quota.used}
        aria-valuemin={0}
        aria-valuemax={quota.budget}
        aria-label="YouTube Data API quota used today"
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        resets midnight Pacific
      </span>
    </div>
  )
}

function Stat({ label, value, series, color }: {
  label: string
  value: string
  series: number[]
  color?: string
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="font-display text-xl" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
      <Sparkline values={series} color={color} label={`${label} over the selected range`} />
    </div>
  )
}

function FindingCard({ finding, onCreateTask }: {
  finding: YtAuditFinding
  onCreateTask: (f: YtAuditFinding) => void
}) {
  const severityColor =
    finding.severity === 'important'
      ? 'var(--status-error)'
      : finding.severity === 'suggestion'
        ? 'var(--status-listening)'
        : 'var(--text-muted)'

  return (
    <div className="rule-b px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: severityColor }}
          aria-hidden
        />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {finding.title}
            </span>
            {/* Small samples are labelled rather than quietly presented as fact. */}
            {finding.lowConfidence && (
              <span
                className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
                title="Based on a small sample — treat as a hint, not a conclusion"
              >
                low confidence
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {finding.detail}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            → {finding.recommendation}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {finding.videoId && (
            <a
              href={`https://www.youtube.com/watch?v=${finding.videoId}`}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded"
              style={{ color: 'var(--text-muted)' }}
              title="Open on YouTube"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            onClick={() => onCreateTask(finding)}
            className="p-1.5 rounded"
            style={{ color: 'var(--text-muted)' }}
            title="Create a task from this finding"
            aria-label={`Create a task from: ${finding.title}`}
          >
            <ListPlus size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function YouTubeView() {
  const ipc = useIPC()
  const pushToast = useToastStore((s) => s.push)

  const [range, setRange] = useState<Range>(28)
  const [channel, setChannel] = useState<YtChannelStats | null>(null)
  const [series, setSeries] = useState<YtSeriesPoint[]>([])
  const [videos, setVideos] = useState<YtVideoSummary[]>([])
  const [findings, setFindings] = useState<YtAuditFinding[]>([])
  const [quota, setQuota] = useState<YtQuotaStatus | null>(null)
  const [tab, setTab] = useState<'overview' | 'videos' | 'audit'>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    const [stats, vids, audit, q] = await Promise.all([
      ipc.capabilities.invoke<{ channel: YtChannelStats; series: YtSeriesPoint[] }>(
        'youtube.getChannelStats',
        { days: range }
      ),
      ipc.capabilities.invoke<YtVideoSummary[]>('youtube.listVideos', { sortBy: 'published' }),
      ipc.capabilities.invoke<YtAuditFinding[]>('youtube.auditCatalog', { refresh: false }),
      ipc.capabilities.invoke<YtQuotaStatus>('youtube.getQuota'),
    ])

    if (q.ok && q.result) setQuota(q.result)

    if (stats.ok && stats.result) {
      setChannel(stats.result.channel)
      setSeries(stats.result.series)
      setError(null)
    } else {
      // "No channel data yet" is the expected first-run state, not a failure.
      setError(stats.error ?? 'Could not load channel data.')
    }

    if (vids.ok && vids.result) setVideos(vids.result)
    if (audit.ok && audit.result) setFindings(audit.result)
    setLoading(false)
  }, [ipc, range])

  useEffect(() => {
    load().catch((e) => {
      setError(String(e))
      setLoading(false)
    })
  }, [load])

  /**
   * `full` re-fetches a year of history rather than the last few days. Needed
   * after daily likes and comments were added to the sync: the incremental pass
   * only revisits the overlap window, so without this the two engagement panels
   * stay empty for every day the channel had already synced.
   */
  const sync = async (full = false) => {
    setSyncing(true)
    try {
      const r = await ipc.capabilities.invoke('youtube.sync', full ? { full: true } : {})
      if (r.ok) {
        pushToast(full ? 'Full history synced.' : 'Channel synced.', 'success')
        await load()
      } else {
        pushToast(r.error ?? 'Sync failed.', 'error')
      }
    } finally {
      setSyncing(false)
    }
  }

  const runAudit = async () => {
    const r = await ipc.capabilities.invoke<YtAuditFinding[]>('youtube.auditCatalog', { refresh: true })
    if (r.ok && r.result) {
      setFindings(r.result)
      pushToast(`Audit complete — ${r.result.length} findings.`, 'success')
    } else {
      pushToast(r.error ?? 'Audit failed.', 'error')
    }
  }

  const createTaskFromFinding = async (finding: YtAuditFinding) => {
    const r = await ipc.capabilities.invoke('tasks.create', {
      title: finding.title,
      description: `${finding.detail}\n\nRecommendation: ${finding.recommendation}`,
      priority: finding.severity === 'important' ? 'high' : 'medium',
    })
    if (r.ok) pushToast('Task created.', 'success')
    else if (r.errorCode === 'awaiting_approval') pushToast(r.error ?? 'Waiting for approval.', 'info')
    else pushToast(r.error ?? 'Could not create the task.', 'error')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading channel…
        </span>
      </div>
    )
  }

  if (!channel) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
        <AlertTriangle size={20} style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {error ?? 'No channel data yet.'}
        </p>
        <p className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Connect a Google account with YouTube access in Settings, then run the first sync. It reads
          your uploads playlist rather than searching, so a full sync costs roughly 10 of your 10,000
          daily API units.
        </p>
        <Button size="sm" variant="primary" onClick={() => void sync()} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
    )
  }

  const watchSeries = series.map((p) => p.watchTimeMinutes)
  const subsSeries = series.map((p) => p.netSubs)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="rule-b flex items-start justify-between gap-4 px-6 py-4 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="font-display text-base truncate" style={{ color: 'var(--text-primary)' }}>
            {channel.title}
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {channel.subscriberCount.toLocaleString()} subscribers ·{' '}
            {channel.videoCount} videos · synced{' '}
            {channel.syncedAt ? new Date(channel.syncedAt).toLocaleString() : 'never'}
          </span>
        </div>
        <div className="flex items-start gap-4 shrink-0">
          {quota && <QuotaMeter quota={quota} />}
          <Button size="sm" variant="ghost" onClick={() => void sync()} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing' : 'Sync'}
          </Button>
        </div>
      </div>

      <div className="rule-b px-6 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex gap-1">
          {(['overview', 'videos', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded text-xs capitalize transition-colors ${
                tab === t ? 'bg-tint/10 text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
              }`}
            >
              {t}
              {t === 'audit' && findings.length > 0 ? ` (${findings.length})` : ''}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                  range === r.value ? 'bg-tint/10 text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {tab === 'audit' && (
          <Button size="sm" variant="ghost" onClick={runAudit}>
            Re-run audit
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="flex flex-col">
            {/* Views, likes and comments get real panels — they are the three
                numbers the channel is actually judged on. */}
            <ChannelTrends
              points={series}
              rangeDays={range}
              onBackfill={() => void sync(true)}
              backfilling={syncing}
            />

            {/* Watch time and subscribers stay as sparkline tiles: still worth
                a glance, but they are not what this view is for. */}
            <div className="px-6 py-5 flex flex-col gap-5">
              <div className="flex gap-8">
                <Stat
                  label="Watch time (min)"
                  value={Math.round(watchSeries.reduce((a, b) => a + b, 0)).toLocaleString()}
                  series={watchSeries}
                />
                <Stat
                  label="Net subscribers"
                  value={subsSeries.reduce((a, b) => a + b, 0).toLocaleString()}
                  series={subsSeries}
                  color="var(--accent-secondary)"
                />
              </div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Lifetime: {channel.viewCount.toLocaleString()} views across {channel.videoCount} videos.
              </p>
            </div>
          </div>
        )}

        {tab === 'videos' && (
          <div className="flex flex-col">
            {videos.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No videos cached. Run a sync.
              </div>
            ) : (
              videos.map((v) => (
                <div key={v.id} className="rule-b px-4 py-2.5 flex items-center gap-3">
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] uppercase"
                    style={{
                      color: TIER_COLOR[v.tier],
                      background: `color-mix(in srgb, ${TIER_COLOR[v.tier]} 14%, transparent)`,
                    }}
                  >
                    {v.tier}
                  </span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {v.title}
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'unpublished'}
                      {v.tags.length === 0 && ' · no tags'}
                      {v.descriptionLength < 100 && ' · thin description'}
                      {!v.hasCustomThumbnail && ' · default thumbnail'}
                    </span>
                  </div>
                  <div className="hidden sm:flex flex-col items-end shrink-0 w-24">
                    <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {v.viewCount.toLocaleString()}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {v.views28.toLocaleString()} in 28d
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div className="flex flex-col">
            {findings.length === 0 ? (
              <div className="px-6 py-8 text-center flex flex-col gap-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  No findings yet.
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Sync the channel, then run the audit.
                </span>
              </div>
            ) : (
              FINDING_GROUPS.map((group) => {
                const groupFindings = findings.filter((f) => f.kind === group.kind)
                if (groupFindings.length === 0) return null
                return (
                  <div key={group.kind} className="flex flex-col">
                    <div className="rule-b px-4 py-2 sticky top-0" style={{ background: 'var(--bg-surface)' }}>
                      <span
                        className="font-mono text-[10px] uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {group.label} ({groupFindings.length})
                      </span>
                    </div>
                    {groupFindings.map((f) => (
                      <FindingCard key={f.id} finding={f} onCreateTask={createTaskFromFinding} />
                    ))}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
