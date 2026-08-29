import React, { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { approvalIcon } from './approvalIcons'
import { Button } from '../shared/Button'
import { useIPC } from '../../hooks/useIPC'
import type { PendingApproval, RiskTier } from '../../../../shared/types'

/**
 * The approval prompt for write-tier actions.
 *
 * This surface did not exist before: the main process has always sent
 * `agent:permission-request`, but nothing in the preload or the renderer ever
 * listened for it, so every gated tool call sat unanswered for two minutes and
 * then auto-denied. REIGAN could not, in practice, complete a task it had been
 * asked to complete.
 */

const RISK_LABEL: Record<RiskTier, string> = {
  read: 'Read',
  network: 'Network',
  write: 'Modifies data',
  destructive: 'Irreversible',
}

/** Destructive actions read differently from ordinary writes, deliberately. */
const riskColor = (risk: RiskTier) =>
  risk === 'destructive' ? 'var(--status-error)' : 'var(--accent-primary)'

export function ApprovalDialog() {
  const ipc = useIPC()
  const [queue, setQueue] = useState<PendingApproval[]>([])

  useEffect(() => {
    if (!ipc?.approvals) return

    // Live prompts arrive here; a queued (job-sourced) request is picked up from
    // the pending list instead, since its original caller is long gone.
    const offRequest = ipc.approvals.onRequest((request) => {
      setQueue((q) => (q.some((a) => a.id === request.id) ? q : [...q, request]))
    })

    const refresh = () => {
      ipc.approvals
        .pending()
        .then((pending) => {
          setQueue((q) => {
            const seen = new Set(q.map((a) => a.id))
            return [...q, ...pending.filter((p) => !seen.has(p.id))]
          })
        })
        .catch(() => {})
    }

    refresh()
    const offChanged = ipc.approvals.onPendingChanged(refresh)

    return () => {
      offRequest()
      offChanged()
    }
  }, [ipc])

  const current = queue[0]
  if (!current) return null

  const respond = (approved: boolean) => {
    ipc.approvals.resolve(current.id, approved)
    setQueue((q) => q.slice(1))
  }

  const accent = riskColor(current.risk)
  const Icon = approvalIcon(current.capabilityId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'color-mix(in srgb, var(--bg-void) 72%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
    >
      <div
        className="ornate w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-surface)' }}
      >
        <div className="rule-b flex items-center gap-3 px-5 py-4">
          <Icon size={18} style={{ color: accent }} />
          <div className="flex flex-col">
            <span id="approval-title" className="font-display text-sm" style={{ color: 'var(--text-primary)' }}>
              {current.title ?? 'Approval required'}
            </span>
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {current.capabilityId} · {RISK_LABEL[current.risk]}
              {current.requestedBy === 'job' && ' · scheduled job'}
            </span>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {current.summary}
          </p>

          {current.diff && current.diff.changes.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {current.diff.subject}
              </span>
              <div className="flex flex-col rounded-md overflow-hidden border border-[var(--border)]">
                {current.diff.changes.map((change, i) => (
                  <div
                    key={change.field}
                    // `.rule` rather than a hand-written borderTop — the app has
                    // exactly one divider and the theme owns what it looks like.
                    className={`grid items-center gap-2 px-3 py-2 text-xs ${i === 0 ? '' : 'rule'}`}
                    style={{ gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)' }}
                  >
                    <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                      <span className="font-mono">{change.field}</span>
                      {': '}
                      {change.before ?? '—'}
                    </span>
                    <ArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                    <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                      {change.after ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {current.detail && (
            <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {current.detail}
            </p>
          )}
        </div>

        <div className="rule flex items-center justify-between px-5 py-3">
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {queue.length > 1 ? `${queue.length - 1} more waiting` : ''}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => respond(false)}>
              Deny
            </Button>
            <Button
              size="sm"
              variant={current.risk === 'destructive' ? 'danger' : 'primary'}
              onClick={() => respond(true)}
            >
              Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
