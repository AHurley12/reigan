import React, { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Loader2 } from 'lucide-react'
import { formatDuration, summariseToolCalls } from './toolCallSummary'
import type { ToolCallEvent, ToolCallStatus } from '../../../../shared/types'

const STATUS_COLOR: Record<ToolCallStatus, string> = {
  running: 'var(--text-muted)',
  ok: 'var(--active)',
  error: 'var(--critical)',
}

/**
 * What the agent did to produce a reply.
 *
 * Reigan runs up to five tool iterations across dozens of privileged
 * capabilities, and the transcript showed none of it — the only signal was the
 * approval dialog, and only for write-tier work. For an assistant whose whole
 * premise is that the model can touch your machine, invisible tool use is the
 * trust problem.
 *
 * Rendered as one collapsed region above the reply rather than interleaved
 * between paragraphs. The agent's actual shape is think → tool → answer, so
 * call order is honest here, and interleaving would mean restructuring a
 * message into segments for a presentational gain.
 *
 * Collapsed by default: transparency means available, not insistent.
 */
export function ToolCallList({ calls }: { calls: ToolCallEvent[] }) {
  const [open, setOpen] = useState(false)
  if (calls.length === 0) return null

  const summary = summariseToolCalls(calls)

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-sm transition-colors"
        style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
      >
        <ChevronRight
          size={11}
          aria-hidden="true"
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transitionProperty: 'transform',
            transitionDuration: 'var(--duration-fast)',
          }}
        />
        {summary.label}
      </button>

      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 list-none">
          {calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolCallRow({ call }: { call: ToolCallEvent }) {
  const [open, setOpen] = useState(false)
  const duration = formatDuration(call.durationMs)
  const hasDetail = Boolean(call.argsPreview || call.resultPreview)

  return (
    <li
      className="rounded-sm px-2 py-1.5"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
    >
      <button
        onClick={() => hasDetail && setOpen(!open)}
        aria-expanded={hasDetail ? open : undefined}
        className="w-full flex items-center gap-2 text-left"
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <StatusIcon status={call.status} />
        <span className="font-mono text-[11px] flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
          {call.name}
        </span>
        {/* Status in words as well as in colour. */}
        {call.status === 'error' && (
          <span className="text-[10px]" style={{ color: 'var(--critical)' }}>
            failed
          </span>
        )}
        {duration && (
          <span
            className="font-mono text-[10px]"
            style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}
          >
            {duration}
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="mt-1.5 flex flex-col gap-1">
          {call.argsPreview && <Detail label="Arguments" value={call.argsPreview} />}
          {call.resultPreview && <Detail label="Result" value={call.resultPreview} />}
        </div>
      )}
    </li>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {/* Its own scroller: a wide argument must not widen the transcript. */}
      <pre
        className="mt-0.5 text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto rounded-sm px-2 py-1"
        style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', maxHeight: 200 }}
      >
        {value}
      </pre>
    </div>
  )
}

function StatusIcon({ status }: { status: ToolCallStatus }) {
  const color = STATUS_COLOR[status]
  if (status === 'running') {
    // animate-spin-slow is a CSS animation, so the global reduced-motion gates
    // still it without this component needing to branch.
    return <Loader2 size={11} className="animate-spin-slow shrink-0" style={{ color }} aria-hidden="true" />
  }
  if (status === 'error') {
    return <AlertTriangle size={11} className="shrink-0" style={{ color }} aria-hidden="true" />
  }
  return <Check size={11} className="shrink-0" style={{ color }} aria-hidden="true" />
}
