import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import type { CapabilityProgress } from '../useCapability'

/**
 * The three states every list in this tab has to handle honestly: loading,
 * error, and empty. Centralised so none of them can be quietly skipped —
 * "shows a spinner over a blank pane forever" is the default outcome
 * otherwise.
 */

interface Props {
  loading: boolean
  error: string | null
  progress?: CapabilityProgress | null
  /** True when there is genuinely nothing to show (as opposed to not loaded). */
  empty?: boolean
  emptyTitle?: string
  emptyHint?: string
  emptyAction?: ReactNode
  onRetry?: () => void
  onCancel?: () => void
  /** Skeleton rows shown while loading, rather than a spinner over nothing. */
  skeletonRows?: number
  children: ReactNode
}

export function AsyncPane({
  loading,
  error,
  progress,
  empty,
  emptyTitle = 'Nothing here yet',
  emptyHint,
  emptyAction,
  onRetry,
  onCancel,
  skeletonRows = 6,
  children,
}: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-1" aria-busy="true">
        {progress && (
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {progress.label ?? 'Working…'}
              {/* An unknown total renders as a count, not a bar that lies. */}
              {progress.total > 0
                ? ` ${progress.done}/${progress.total}`
                : progress.done > 0
                  ? ` ${progress.done.toLocaleString()}`
                  : ''}
            </span>
            {progress.total > 0 && (
              <div
                className="flex-1 h-1 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <div
                  className="h-full transition-all duration-fast"
                  style={{
                    width: `${Math.min(100, (progress.done / progress.total) * 100)}%`,
                    background: 'var(--accent-primary)',
                  }}
                />
              </div>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-sm"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                <X size={12} /> Cancel
              </button>
            )}
          </div>
        )}
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div
            key={i}
            className="h-9 rounded-sm animate-pulse"
            style={{ background: 'var(--bg-elevated)', opacity: 1 - i * 0.12 }}
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-start gap-3 p-4 rounded-sm"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}
        role="alert"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} style={{ color: 'var(--status-critical)', flexShrink: 0, marginTop: 2 }} />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              That didn't work
            </span>
            {/* The real message. Anything else makes the failure undebuggable. */}
            <span className="font-mono text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </span>
          </div>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-sm transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <RefreshCw size={12} /> Try again
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center select-none">
        <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          {emptyTitle}
        </span>
        {emptyHint && (
          <span className="font-mono text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
            {emptyHint}
          </span>
        )}
        {emptyAction && <div className="mt-2">{emptyAction}</div>}
      </div>
    )
  }

  return <>{children}</>
}
