import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2, ChevronRight } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { useToastStore } from '../../../stores/toastStore'
import {
  ERROR_SOURCES,
  errorSourceLabel,
  isDevToolsSource,
} from '../../../../../shared/errors'

/**
 * The error log.
 *
 * Lives in Dev Tools but is no longer about Dev Tools. It exists because most
 * of what goes wrong does not announce itself, in two different ways:
 *
 *  - an organiser run reports success having skipped three files it could not
 *    move, a scan is denied on a folder and simply indexes fewer projects,
 *    ports list without process names — each looks like a working feature;
 *  - an automation is auto-disabled, a Google grant expires, a reply is shown
 *    but never spoken — announced once in a notification that then scrolls
 *    away, with `job_runs` pruned at 90 days and cascade-deleted with the job.
 *
 * This is the one place both are visible, and the only one that outlives the
 * thing that failed.
 *
 * Sorted by recency rather than severity on purpose — the question this view
 * answers is "what just went wrong", and a fortnight-old fatal outranking the
 * warning from thirty seconds ago would answer a different one.
 */

type Severity = 'warning' | 'error' | 'fatal'

interface ErrorRow {
  id: string
  source: string
  operation: string
  severity: Severity
  message: string
  code?: string
  subject?: string
  context: unknown
  stack?: string
  occurrences: number
  firstSeen: number
  lastSeen: number
}

interface ErrorSummary {
  distinct: number
  total: number
  bySource: Record<string, { distinct: number; total: number }>
  newestAt: number | null
}

/** Reuses the status ramp the rest of the app already maps to severity. */
const SEVERITY_TOKEN: Record<Severity, string> = {
  warning: 'var(--status-warning)',
  error: 'var(--status-critical)',
  fatal: 'var(--status-critical)',
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ErrorsView() {
  const list = useCapability<{ errors: ErrorRow[]; summary: ErrorSummary }>('devtools.listErrors')
  const clear = useCapability<{ cleared: number }>('devtools.clearErrors')
  const toast = useToastStore((s) => s.push)

  const [source, setSource] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    await list.run(source ? { source, limit: 200 } : { limit: 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleClear = useCallback(async () => {
    // Destructive tier, so this routes through the approval dialog rather than
    // a confirm() of its own.
    const result = await clear.run(source ? { source } : {})
    if (result) {
      toast(`Cleared ${result.cleared} error record(s).`, 'success')
      void refresh()
    }
  }, [clear, source, refresh, toast])

  const errors = list.data?.errors ?? []
  const summary = list.data?.summary

  // Only sources that have actually recorded something get a chip. Fourteen
  // permanent chips — most of them reading zero on a healthy machine — would
  // turn a filter bar into a wall and push the useful ones off the edge. The
  // summary is deliberately computed unfiltered by the handler, so these counts
  // and the bar's contents do not change as you click through it. The current
  // selection is always kept, or clearing a source would delete the chip you
  // are standing on and strand the view on an empty list.
  const present = ERROR_SOURCES.filter(
    (s) => (summary?.bySource[s]?.distinct ?? 0) > 0 || s === source
  )
  const devSources = present.filter((s) => isDevToolsSource(s))
  const appSources = present.filter((s) => !isDevToolsSource(s))

  const chip = (s: string) => {
    const count = summary?.bySource[s]?.distinct ?? 0
    return (
      <button
        key={s}
        onClick={() => setSource(s)}
        className="px-2 py-1 rounded-sm text-xs whitespace-nowrap transition-colors"
        style={{
          color: source === s ? 'var(--text-primary)' : 'var(--text-muted)',
          border: `1px solid ${source === s ? 'var(--border-accent)' : 'transparent'}`,
        }}
        aria-pressed={source === s}
      >
        {errorSourceLabel(s)}
        {count > 0 && (
          <span className="ml-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="rule-b flex items-center justify-between px-4 py-2.5 shrink-0 gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setSource(null)}
            className="px-2 py-1 rounded-sm text-xs whitespace-nowrap transition-colors"
            style={{
              color: source === null ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${source === null ? 'var(--border-accent)' : 'transparent'}`,
            }}
            aria-pressed={source === null}
          >
            All
          </button>
          {devSources.map(chip)}
          {devSources.length > 0 && appSources.length > 0 && (
            <span
              aria-hidden
              className="w-px self-stretch my-1 shrink-0"
              style={{ background: 'var(--border)' }}
            />
          )}
          {appSources.map(chip)}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={() => void handleClear()}
            disabled={errors.length === 0}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>

      {summary && summary.total > summary.distinct && (
        <div className="px-4 py-1.5 shrink-0 rule-b">
          <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {summary.distinct} distinct problem{summary.distinct === 1 ? '' : 's'} ·{' '}
            {summary.total} total occurrence{summary.total === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AsyncPane
          loading={list.loading}
          error={list.error}
          empty={errors.length === 0}
          emptyTitle="Nothing has gone wrong"
          emptyHint={
            source
              ? `No ${errorSourceLabel(source)} failures recorded.`
              : 'Failures from anywhere in the app are recorded here as they happen — including the partial ones a feature otherwise reports as success, and the ones that were only ever a notification.'
          }
          onRetry={() => void refresh()}
          skeletonRows={5}
        >
          <div className="flex flex-col gap-1.5">
            {errors.map((e) => {
              const isOpen = expanded === e.id
              return (
                <div
                  key={e.id}
                  className="rounded-sm"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronRight
                      size={13}
                      className="transition-transform shrink-0"
                      style={{
                        color: 'var(--text-muted)',
                        marginTop: 3,
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                      }}
                    />
                    <span
                      className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded-sm shrink-0"
                      style={{
                        color: SEVERITY_TOKEN[e.severity],
                        border: `1px solid color-mix(in srgb, ${SEVERITY_TOKEN[e.severity]} 40%, transparent)`,
                        background: `color-mix(in srgb, ${SEVERITY_TOKEN[e.severity]} 10%, transparent)`,
                      }}
                    >
                      {e.severity}
                    </span>

                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {e.source}/{e.operation}
                        </span>
                        {e.code && (
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {e.code}
                          </span>
                        )}
                        {e.occurrences > 1 && (
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            ×{e.occurrences}
                          </span>
                        )}
                      </div>
                      <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                        {e.message}
                      </span>
                    </div>

                    <span
                      className="font-mono text-[10px] shrink-0"
                      style={{ color: 'var(--text-muted)', marginTop: 2 }}
                    >
                      {relativeTime(e.lastSeen)}
                    </span>
                  </button>

                  {isOpen && (
                    <div
                      className="px-3 pb-2.5 pt-0.5 flex flex-col gap-1.5"
                      style={{ marginLeft: 21 }}
                    >
                      {e.subject && (
                        <Detail label="Subject" value={e.subject} />
                      )}
                      {e.occurrences > 1 && (
                        <Detail
                          label="Seen"
                          value={`${e.occurrences} times, first ${relativeTime(e.firstSeen)}`}
                        />
                      )}
                      {e.context != null && Object.keys(e.context as object).length > 0 && (
                        <Detail label="Context" value={JSON.stringify(e.context, null, 2)} mono />
                      )}
                      {e.stack && <Detail label="Stack" value={e.stack} mono />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </AsyncPane>
      </div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span
        className={`text-xs whitespace-pre-wrap break-all ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--text-secondary)' }}
      >
        {value}
      </span>
    </div>
  )
}
