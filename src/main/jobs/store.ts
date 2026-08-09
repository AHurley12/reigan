import { randomUUID } from 'crypto'
import { getDatabase } from '../db/database'
import { describeSchedule, type CatchUpPolicy, type ScheduleKind } from './schedule'

/** Retention for job_runs history, per the build spec. */
export const RUN_RETENTION_DAYS = 90

export type RunStatus =
  | 'running'
  | 'success'
  | 'failure'
  | 'skipped'
  | 'deferred'
  | 'awaiting_approval'
  | 'cancelled'
  | 'timeout'

export type TriggeredBy = 'schedule' | 'manual' | 'catch_up' | 'retry' | 'approval'

export interface Job {
  id: string
  name: string
  capabilityId: string
  args: unknown
  scheduleKind: ScheduleKind
  scheduleExpr: string
  scheduleDescription: string
  nextRunAt: number | null
  lastRunAt: number | null
  lastStatus: RunStatus | null
  enabled: boolean
  catchUpPolicy: CatchUpPolicy
  maxRetries: number
  timeoutMs: number
  consecutiveFailures: number
  disabledReason: string | null
  /** Seeded by the app rather than the user; not deletable from the UI. */
  system: boolean
  createdAt: number
}

export interface JobRun {
  id: string
  jobId: string
  startedAt: number
  finishedAt: number | null
  status: RunStatus
  result: unknown
  error: string | null
  attempt: number
  triggeredBy: TriggeredBy
  scheduledFor: number | null
  approvalId: string | null
}

// ── Jobs ──

export function listJobs(): Job[] {
  const rows = getDatabase().prepare('SELECT * FROM jobs ORDER BY name').all() as any[]
  return rows.map(rowToJob)
}

export function getJob(id: string): Job | null {
  const row = getDatabase().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
  return row ? rowToJob(row) : null
}

export function getJobByName(name: string): Job | null {
  const row = getDatabase().prepare('SELECT * FROM jobs WHERE name = ?').get(name) as any
  return row ? rowToJob(row) : null
}

/** Jobs due at or before `now`, in due order. The scheduler's tick query. */
export function dueJobs(now: number): Job[] {
  const rows = getDatabase()
    .prepare(
      'SELECT * FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at'
    )
    .all(now) as any[]
  return rows.map(rowToJob)
}

/** Earliest future `next_run_at`, so the loop can sleep until it rather than poll hard. */
export function earliestNextRun(after: number): number | null {
  const row = getDatabase()
    .prepare(
      'SELECT MIN(next_run_at) AS next FROM jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at > ?'
    )
    .get(after) as { next: number | null }
  return row?.next ?? null
}

export interface UpsertJobParams {
  id?: string
  name: string
  capabilityId: string
  args?: unknown
  scheduleKind: ScheduleKind
  scheduleExpr?: string
  nextRunAt?: number | null
  enabled?: boolean
  catchUpPolicy?: CatchUpPolicy
  maxRetries?: number
  timeoutMs?: number
  system?: boolean
}

export function upsertJob(params: UpsertJobParams): Job {
  const db = getDatabase()
  const existing = params.id ? getJob(params.id) : null
  const id = params.id ?? randomUUID()

  if (existing) {
    db.prepare(
      `UPDATE jobs SET name = ?, capability_id = ?, args_json = ?, schedule_kind = ?,
         schedule_expr = ?, next_run_at = ?, enabled = ?, catch_up_policy = ?,
         max_retries = ?, timeout_ms = ?
       WHERE id = ?`
    ).run(
      params.name,
      params.capabilityId,
      JSON.stringify(params.args ?? {}),
      params.scheduleKind,
      params.scheduleExpr ?? '',
      params.nextRunAt ?? null,
      (params.enabled ?? existing.enabled) ? 1 : 0,
      params.catchUpPolicy ?? existing.catchUpPolicy,
      params.maxRetries ?? existing.maxRetries,
      params.timeoutMs ?? existing.timeoutMs,
      id
    )
  } else {
    db.prepare(
      `INSERT INTO jobs (id, name, capability_id, args_json, schedule_kind, schedule_expr,
         next_run_at, enabled, catch_up_policy, max_retries, timeout_ms, system, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.name,
      params.capabilityId,
      JSON.stringify(params.args ?? {}),
      params.scheduleKind,
      params.scheduleExpr ?? '',
      params.nextRunAt ?? null,
      (params.enabled ?? true) ? 1 : 0,
      params.catchUpPolicy ?? 'run_once',
      params.maxRetries ?? 3,
      params.timeoutMs ?? 300_000,
      params.system ? 1 : 0,
      Date.now()
    )
  }

  return getJob(id)!
}

export function setJobEnabled(id: string, enabled: boolean, reason: string | null = null): void {
  getDatabase()
    .prepare('UPDATE jobs SET enabled = ?, disabled_reason = ? WHERE id = ?')
    .run(enabled ? 1 : 0, reason, id)
}

export function setNextRun(id: string, nextRunAt: number | null): void {
  getDatabase().prepare('UPDATE jobs SET next_run_at = ? WHERE id = ?').run(nextRunAt, id)
}

export function recordJobOutcome(
  id: string,
  status: RunStatus,
  ranAt: number,
  consecutiveFailures: number
): void {
  getDatabase()
    .prepare(
      'UPDATE jobs SET last_run_at = ?, last_status = ?, consecutive_failures = ? WHERE id = ?'
    )
    .run(ranAt, status, consecutiveFailures, id)
}

export function deleteJob(id: string): void {
  getDatabase().prepare('DELETE FROM jobs WHERE id = ? AND system = 0').run(id)
}

// ── Runs ──

export function startRun(params: {
  jobId: string
  attempt: number
  triggeredBy: TriggeredBy
  scheduledFor?: number | null
  startedAt?: number
}): string {
  const id = randomUUID()
  getDatabase()
    .prepare(
      `INSERT INTO job_runs (id, job_id, started_at, status, attempt, triggered_by, scheduled_for)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`
    )
    .run(
      id,
      params.jobId,
      params.startedAt ?? Date.now(),
      params.attempt,
      params.triggeredBy,
      params.scheduledFor ?? null
    )
  return id
}

export function finishRun(params: {
  runId: string
  status: RunStatus
  result?: unknown
  error?: string | null
  approvalId?: string | null
}): void {
  getDatabase()
    .prepare(
      `UPDATE job_runs SET finished_at = ?, status = ?, result_json = ?, error = ?, approval_id = ?
       WHERE id = ?`
    )
    .run(
      Date.now(),
      params.status,
      params.result === undefined ? null : JSON.stringify(params.result),
      params.error ?? null,
      params.approvalId ?? null,
      params.runId
    )
}

/**
 * Writes a run that never actually executed — a skipped overlap, a deferred
 * offline attempt. These matter as much as successes: "why didn't this run?" is
 * the question the jobs view exists to answer.
 */
export function recordInstantRun(params: {
  jobId: string
  status: RunStatus
  error: string
  triggeredBy: TriggeredBy
  scheduledFor?: number | null
}): string {
  const runId = startRun({
    jobId: params.jobId,
    attempt: 1,
    triggeredBy: params.triggeredBy,
    scheduledFor: params.scheduledFor,
  })
  finishRun({ runId, status: params.status, error: params.error })
  return runId
}

export function listRuns(jobId: string, limit = 20): JobRun[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(jobId, limit) as any[]
  return rows.map(rowToRun)
}

export function getRun(runId: string): JobRun | null {
  const row = getDatabase().prepare('SELECT * FROM job_runs WHERE id = ?').get(runId) as any
  return row ? rowToRun(row) : null
}

export function findRunByApprovalId(approvalId: string): JobRun | null {
  const row = getDatabase()
    .prepare('SELECT * FROM job_runs WHERE approval_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(approvalId) as any
  return row ? rowToRun(row) : null
}

/**
 * Marks runs left mid-flight by a crash or a hard shutdown.
 *
 * Without this a killed app leaves `running` rows forever, and the concurrency
 * check — which asks "is a run already in flight?" — would refuse to ever start
 * that job again.
 */
export function reconcileOrphanedRuns(): number {
  const result = getDatabase()
    .prepare(
      `UPDATE job_runs SET status = 'cancelled', finished_at = ?, error = ?
       WHERE status = 'running'`
    )
    .run(Date.now(), 'Interrupted — the app closed while this run was in flight.')
  return result.changes
}

export function pruneOldRuns(retentionDays = RUN_RETENTION_DAYS): number {
  const cutoff = Date.now() - retentionDays * 86_400_000
  return getDatabase().prepare('DELETE FROM job_runs WHERE started_at < ?').run(cutoff).changes
}

// ── Row mapping ──

function rowToJob(row: any): Job {
  const scheduleKind = row.schedule_kind as ScheduleKind
  return {
    id: row.id,
    name: row.name,
    capabilityId: row.capability_id,
    args: safeParse(row.args_json, {}),
    scheduleKind,
    scheduleExpr: row.schedule_expr,
    scheduleDescription: describeSchedule(scheduleKind, row.schedule_expr),
    nextRunAt: row.next_run_at ?? null,
    lastRunAt: row.last_run_at ?? null,
    lastStatus: (row.last_status as RunStatus) ?? null,
    enabled: !!row.enabled,
    catchUpPolicy: row.catch_up_policy as CatchUpPolicy,
    maxRetries: row.max_retries,
    timeoutMs: row.timeout_ms,
    consecutiveFailures: row.consecutive_failures,
    disabledReason: row.disabled_reason ?? null,
    system: !!row.system,
    createdAt: row.created_at,
  }
}

function rowToRun(row: any): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    status: row.status as RunStatus,
    result: safeParse(row.result_json, null),
    error: row.error ?? null,
    attempt: row.attempt,
    triggeredBy: row.triggered_by as TriggeredBy,
    scheduledFor: row.scheduled_for ?? null,
    approvalId: row.approval_id ?? null,
  }
}

function safeParse(json: string | null, fallback: unknown): unknown {
  if (!json) return fallback
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
}
