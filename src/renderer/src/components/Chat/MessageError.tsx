import React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { describeChatError } from './errorCopy'

interface Props {
  error: string
  onRetry: () => void
}

/**
 * A failed turn, rendered as a distinct block rather than as assistant text.
 *
 * Failures used to be pushed down the stream as tokens, which made them
 * indistinguishable from something the model had said, persisted them into the
 * transcript as if it had, and left no way to recover the turn.
 */
export function MessageError({ error, onRetry }: Props) {
  const { title, guidance, retryable } = describeChatError(error)

  return (
    <div
      role="alert"
      className="mt-2 flex items-start gap-2.5 px-3 py-2.5 rounded-md"
      style={{
        background: 'color-mix(in srgb, var(--critical) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--critical) 30%, transparent)',
      }}
    >
      {/* Redundant with the text below by design — colour alone must never be
          the thing that says "this failed". */}
      <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--critical)' }} aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--text-secondary)' }}>
          {guidance}
        </p>
      </div>

      {retryable && (
        <button
          onClick={onRetry}
          className="shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-sm transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RotateCcw size={11} />
          Retry
        </button>
      )}
    </div>
  )
}
