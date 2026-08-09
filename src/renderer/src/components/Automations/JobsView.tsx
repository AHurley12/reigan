import React, { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Play, Pause, RotateCw, AlertTriangle } from 'lucide-react'
import { useIPC } from '../../hooks/useIPC'
import { useToastStore } from '../../stores/toastStore'
import type { JobRunRecord, JobRunStatus, ScheduledJob } from '../../../../shared/types'

/**
 * The health dashboard for every automation in the app, and the Automations
 * tab's landing section.
 *
 * Treated as a first-class feature rather than an admin afterthought: when a
 * sync silently stops happening, this view is where the answer lives, so it
 * shows *why* a job did not run (skipped, deferred, awaiting approval) as
 * prominently as it shows success.
 */

const STATUS_TOKEN: Record<JobRunStatus, string> = {
  success: 'var(--status-success)',
  running: 'var(--status-processing)',
  failure: 'var(--status-error)',
  timeout: 'var(--status-error)',
  cancelled: 'var(--text-muted)',
  skipped: 'var(--text-muted)',
  deferred: 'var(--status-listening)',
  awaiting_approval: 'var(--status-speaking)',
}

const STATUS_LABEL: Record<JobRunStatus, string> = {
  success: 'OK',
  running: 'Running',
  failure: 'Failed',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  deferred: 'Deferred',
  awaiting_approval: 'Needs approval',
}

function StatusBadge({ status }: { status: JobRunStatus | null }) {
  if (!status) {
    return (
      <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
        never run
      </span>
    )
  }
  const color = STATUS_TOKEN[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[10px] uppercase tracking-wide"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function RunHistory({ jobId }: { jobId: string }) {
  const ipc = useIPC()
  const [runs, setRuns] = useState<JobRunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ipc.capabilities
      .invoke<JobRunRecord[]>('jobs.history', { id: jobId, limit: 10 })
      .then((r) => {
        if (cancelled) return
        if (r.ok) setRuns(r.result ?? [])
        else setError(r.error ?? 'Could not load run history.')
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [ipc, jobId])

  if (error) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: 'var(--status-error)' }}>
        {error}
      </div>
    )
  }

  if (runs === null) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        Loading history…
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        No runs recorded yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {runs.map((run) => (
        <div key={run.id} className="rule px-4 py-2 flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {new Date(run.startedAt).toLocaleString()}
            </span>
            {run.finishedAt && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s
              </span>
            )}
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {run.triggeredBy}
              {run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}
            </span>
          </div>
          {run.error && (
            <p className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {run.error}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function JobRow({ job, onChanged }: { job: ScheduledJob; onChanged: () => void }) {
  const ipc = useIPC()
  const pushToast = useToastStore((s) => s.push)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (capabilityId: string, successMessage: string) => {
    setBusy(true)
    try {
      const r = await ipc.capabilities.invoke(capabilityId, { id: job.id })
      if (r.ok) pushToast(successMessage, 'success')
      // A job-triggered write parks for approval rather than failing; say so
      // plainly instead of reporting it as an error.
      else if (r.errorCode === 'awaiting_approval') pushToast(r.error ?? 'Waiting for approval.', 'info')
      else pushToast(r.error ?? 'That did not work.', 'error')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rule-b flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 p-0.5 rounded transition-transform duration-fast"
          style={{
            color: 'var(--text-muted)',
            transform: expanded ? 'rotate(90deg)' : 'none',
          }}
          aria-label={expanded ? 'Collapse run history' : 'Expand run history'}
          aria-expanded={expanded}
        >
          <ChevronRight size={14} />
        </button>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {job.name}
            </span>
            {!job.enabled && job.disabledReason && (
              <AlertTriangle size={13} style={{ color: 'var(--status-error)' }} />
            )}
          </div>
          <span className="font-mono text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {job.capabilityId}
          </span>
        </div>

        <div className="hidden md:flex flex-col w-40 shrink-0">
          <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {job.scheduleDescription}
          </span>
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {!job.enabled
              ? 'disabled'
              : job.running
                ? 'running now'
                : (job.nextRunRelative ?? 'manual')}
          </span>
        </div>

        <div className="w-28 shrink-0 flex justify-start">
          <StatusBadge status={job.running ? 'running' : job.lastStatus} />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => act('jobs.runNow', `Ran "${job.name}".`)}
            disabled={busy || job.running}
            className="p-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: 'var(--text-muted)' }}
            title="Run now"
            aria-label={`Run ${job.name} now`}
          >
            {job.running ? <RotateCw size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
          <button
            onClick={() =>
              job.enabled
                ? act('jobs.disable', `Disabled "${job.name}".`)
                : act('jobs.enable', `Enabled "${job.name}".`)
            }
            disabled={busy}
            className="p-1.5 rounded transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}
            title={job.enabled ? 'Disable' : 'Enable'}
            aria-label={`${job.enabled ? 'Disable' : 'Enable'} ${job.name}`}
          >
            {job.enabled ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>

      {/* An auto-disabled job must explain itself here, not only in the log. */}
      {!job.enabled && job.disabledReason && (
        <div className="px-4 pb-3 pl-11">
          <p className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--status-error)' }}>
            {job.disabledReason}
          </p>
        </div>
      )}

      {expanded && (
        <div className="pl-11 pb-2">
          <RunHistory jobId={job.id} />
        </div>
      )}
    </div>
  )
}

export function JobsView() {
  const ipc = useIPC()
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    ipc.capabilities
      .invoke<ScheduledJob[]>('jobs.list')
      .then((r) => {
        if (r.ok) {
          setJobs(r.result ?? [])
          setError(null)
        } else {
          setError(r.error ?? 'Could not load jobs.')
        }
      })
      .catch((e) => setError(String(e)))
  }, [ipc])

  useEffect(() => {
    load()
    // Cheap poll so "running now" and relative next-run times stay honest while
    // the view is open. The query is indexed and local.
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [load])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <AlertTriangle size={20} style={{ color: 'var(--status-error)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {error}
        </p>
      </div>
    )
  }

  if (jobs === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading jobs…
        </span>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          No scheduled jobs yet.
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Automations you create will appear here with their schedule and run history.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} onChanged={load} />
      ))}
    </div>
  )
}
