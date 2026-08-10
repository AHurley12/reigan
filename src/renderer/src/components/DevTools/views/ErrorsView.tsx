import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2, ChevronRight } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { useToastStore } from '../../../stores/toastStore'

/**
 * The Dev Tools error log.
 *
 * Exists because most of what goes wrong in this tab does not announce itself:
 * an organiser run reports success having skipped three files it could not
 * move, a scan is denied on a folder and simply indexes fewer projects, ports
 * list without process names. Each of those looks like a working feature. This
 * is the one place where they are visible.
 *
 * Sorted by recency rather than severity on purpose — the question this view
 * answers is "what just went wrong", and a fortnight-old fatal outranking the
 * warning from thirty seconds ago would answer a different one.
 */

type Severity = 'warning' | 'error' | 'fatal'

interface ErrorRow {
  id: string
  feature: string
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
  byFeature: Record<string, { distinct: number; total: number }>
  newestAt: number | null
}

const FEATURES = ['scanner', 'localhost', 'shell', 'organizer', 'vault', 'github'] as const

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

  const [feature, setFeature] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    await list.run(feature ? { feature, limit: 200 } : { limit: 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleClear = useCallback(async () => {
    // Destructive tier, so this routes through the approval dialog rather than
    // a confirm() of its own.
    const result = await clear.run(feature ? { feature } : {})
    if (result) {
      toast(`Cleared ${result.cleared} error record(s).`, 'success')
      void refresh()
    }
  }, [clear, feature, refresh, toast])

  const errors = list.data?.errors ?? []
  const summary = list.data?.summary

  return (
    <div className="flex flex-col h-full">
      <div className="rule-b flex items-center justify-between px-4 py-2.5 shrink-0 gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setFeature(null)}
            className="px-2 py-1 rounded-sm text-xs whitespace-nowrap transition-colors"
            style={{
              color: feature === null ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${feature === null ? 'var(--border-accent)' : 'transparent'}`,
            }}
            aria-pressed={feature === null}
          >
            All
          </button>
          {FEATURES.map((f) => {
            const count = summary?.byFeature[f]?.distinct ?? 0
            return (
              <button
                key={f}
                onClick={() => setFeature(f)}
                className="px-2 py-1 rounded-sm text-xs whitespace-nowrap transition-colors"
                style={{
                  color: feature === f ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: `1px solid ${feature === f ? 'var(--border-accent)' : 'transparent'}`,
                }}
                aria-pressed={feature === f}
              >
                {f}
                {count > 0 && (
                  <span className="ml-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
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
            feature
              ? `No ${feature} failures recorded.`
              : 'Dev Tools failures are recorded here as they happen — including the partial ones a feature otherwise reports as success.'
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
                          {e.feature}/{e.operation}
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
