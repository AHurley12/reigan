import { net, powerMonitor } from 'electron'
import { getCapability, invokeCapability } from '../capabilities/registry'
import {
  dueJobs,
  earliestNextRun,
  finishRun,
  getJob,
  listJobs,
  pruneOldRuns,
  recordInstantRun,
  recordJobOutcome,
  reconcileOrphanedRuns,
  setJobEnabled,
  setNextRun,
  startRun,
  type Job,
  type TriggeredBy,
} from './store'
import { missedOccurrences, nextOccurrence, MAX_CATCH_UP_OCCURRENCES } from './schedule'
import { randomUUID } from 'crypto'
import type { JobAlertKind, JobNotification } from '../../shared/types'

/**
 * The durable job engine.
 *
 * REIGAN is not a server. It is closed at night, asleep during meetings, and
 * offline on the train, so the scheduler is built around absence rather than
 * uptime: `next_run_at` is persisted, every boot reconciles what was missed
 * against each job's catch-up policy, and the timer is treated as a hint that
 * may have been wrong rather than as the source of truth.
 */

/** Ceiling on the timer, so a suspended or clock-shifted machine re-checks promptly on wake. */
const MAX_SLEEP_MS = 60_000
const MIN_SLEEP_MS = 250

/** Retry backoff: 30s, 1m, 2m, 4m… capped, then ±20% jitter. */
const RETRY_BASE_MS = 30_000
const RETRY_CAP_MS = 60 * 60_000
const RETRY_JITTER = 0.2

export type JobNotifier = (event: JobNotification) => void

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let suspended = false

/** Jobs with a run in flight. Backs the "one run per job at a time" rule. */
const running = new Map<string, AbortController>()

let notifier: JobNotifier | null = null
export function setJobNotifier(fn: JobNotifier): void {
  notifier = fn
}

/**
 * The single exit through which every non-success outcome leaves the scheduler.
 *
 * Funnelled through one function on purpose. When notification was open-coded at
 * two call sites, the other six outcomes — skipped, deferred, timed out, failed
 * with retries left, cancelled by a crash, degraded — were written to the run
 * table and never spoken about. A run row nobody opens is not transparency, so
 * the rule is now: if it is not a clean success, it is announced.
 */
function notify(params: {
  kind: JobAlertKind
  priority?: 'urgent' | 'normal'
  title: string
  body: string
  jobId?: string
  jobName?: string
}): void {
  const event: JobNotification = {
    id: randomUUID(),
    // Urgent breaks through to the OS. Anything that stops work happening for
    // good is urgent; anything self-correcting is not.
    priority: params.priority ?? 'normal',
    kind: params.kind,
    title: params.title,
    body: params.body,
    jobId: params.jobId ?? '',
    jobName: params.jobName ?? 'Automations',
    at: Date.now(),
  }
  console.warn(`[jobs] ${event.kind}: ${event.title} — ${event.body}`)
  notifier?.(event)
}

export function startScheduler(): void {
  if (started) return
  started = true

  // A hard kill leaves `running` rows behind. Left alone they would make the
  // overlap check believe those jobs are permanently in flight, and they would
  // never run again.
  const orphaned = reconcileOrphanedRuns()
  if (orphaned > 0) {
    // A run that died with the app produced no result and no error of its own.
    // Without this the only trace is a `cancelled` row nobody thinks to look at.
    notify({
      kind: 'cancelled',
      title: 'Interrupted automation runs',
      body: `${orphaned} automation run(s) were cut short when the app last closed. They did not complete, and will run again at their next scheduled time.`,
    })
  }

  pruneOldRuns()

  powerMonitor.on('suspend', onSuspend)
  powerMonitor.on('resume', onResume)

  runBootCatchUp()
  scheduleTick()
}

export function stopScheduler(): void {
  started = false
  if (timer) clearTimeout(timer)
  timer = null
  powerMonitor.off('suspend', onSuspend)
  powerMonitor.off('resume', onResume)
  for (const controller of running.values()) controller.abort()
  running.clear()
}

function onSuspend(): void {
  // Stop the loop outright rather than letting a timer fire against a clock that
  // jumped hours forward. Resume re-derives everything from persisted state.
  suspended = true
  if (timer) clearTimeout(timer)
  timer = null
}

function onResume(): void {
  suspended = false
  // Exactly the boot path: the machine was, from the scheduler's point of view,
  // absent. Assuming the timer survived is what produces double-runs and misses.
  runBootCatchUp()
  scheduleTick()
}

// ── Catch-up ──

/**
 * Reconciles every overdue job against its catch-up policy.
 *
 * Runs at boot and on wake from sleep. A job with no `next_run_at` yet (freshly
 * created, or previously manual) is simply scheduled forward.
 */
export function runBootCatchUp(now = Date.now()): void {
  for (const job of listJobs()) {
    if (!job.enabled) continue
    if (job.scheduleKind === 'manual') continue

    if (job.nextRunAt === null) {
      setNextRun(job.id, nextOccurrence(job.scheduleKind, job.scheduleExpr, now))
      continue
    }

    if (job.nextRunAt > now) continue

    const { occurrences, truncated } = missedOccurrences(
      job.scheduleKind,
      job.scheduleExpr,
      job.nextRunAt - 1,
      now
    )
    const missedCount = occurrences.length

    switch (job.catchUpPolicy) {
      case 'skip': {
        const body = `Missed ${missedCount} scheduled run(s) while the app was closed — skipped per its catch-up policy. Nothing was run to make up for them.`
        recordInstantRun({
          jobId: job.id,
          status: 'skipped',
          triggeredBy: 'catch_up',
          scheduledFor: job.nextRunAt,
          error: body,
        })
        notify({ kind: 'skipped', title: `Skipped: ${job.name}`, body, jobId: job.id, jobName: job.name })
        setNextRun(job.id, nextOccurrence(job.scheduleKind, job.scheduleExpr, now))
        break
      }

      case 'run_all': {
        console.log(
          `[jobs] ${job.name}: replaying ${missedCount} missed run(s)${truncated ? ` (capped at ${MAX_CATCH_UP_OCCURRENCES})` : ''}`
        )
        if (truncated) {
          const body =
            `More than ${MAX_CATCH_UP_OCCURRENCES} runs were missed; replaying the most recent ` +
            `${MAX_CATCH_UP_OCCURRENCES} and dropping the rest.`
          recordInstantRun({
            jobId: job.id,
            status: 'skipped',
            triggeredBy: 'catch_up',
            scheduledFor: job.nextRunAt,
            error: body,
          })
          notify({
            kind: 'skipped',
            title: `Dropped runs: ${job.name}`,
            body,
            jobId: job.id,
            jobName: job.name,
          })
        }
        // Sequential by design — `void` here would fire them all at once and
        // immediately violate the one-run-at-a-time rule.
        void replaySequentially(job.id, occurrences, now)
        break
      }

      case 'run_once':
      default: {
        console.log(`[jobs] ${job.name}: ${missedCount} missed run(s), running once`)
        setNextRun(job.id, nextOccurrence(job.scheduleKind, job.scheduleExpr, now))
        void executeJob(job, 'catch_up', job.nextRunAt)
        break
      }
    }
  }
}

async function replaySequentially(jobId: string, occurrences: number[], now: number): Promise<void> {
  for (const scheduledFor of occurrences) {
    const job = getJob(jobId)
    if (!job || !job.enabled) return
    await executeJob(job, 'catch_up', scheduledFor)
  }

  const job = getJob(jobId)
  if (job) setNextRun(job.id, nextOccurrence(job.scheduleKind, job.scheduleExpr, now))
}

// ── Tick loop ──

function scheduleTick(): void {
  if (!started || suspended) return
  if (timer) clearTimeout(timer)

  const now = Date.now()
  const next = earliestNextRun(now)
  // Clamped rather than slept to exactly: a long sleep is unreliable across
  // system suspend and wall-clock changes, and re-checking costs one indexed query.
  const delay = next === null ? MAX_SLEEP_MS : Math.min(Math.max(next - now, MIN_SLEEP_MS), MAX_SLEEP_MS)

  timer = setTimeout(tick, delay)
}

async function tick(): Promise<void> {
  if (!started || suspended) return

  const now = Date.now()
  for (const job of dueJobs(now)) {
    // Not awaited: a slow job must not hold up everything else that is due.
    // Overlap is prevented per-job inside executeJob, not by serialising here.
    void executeJob(job, job.consecutiveFailures > 0 ? 'retry' : 'schedule', job.nextRunAt)
  }

  scheduleTick()
}

// ── Execution ──

export async function runJobNow(jobId: string): Promise<{ ok: boolean; message: string }> {
  const job = getJob(jobId)
  if (!job) return { ok: false, message: `No job with id ${jobId}.` }
  if (running.has(jobId)) return { ok: false, message: `"${job.name}" is already running.` }

  const outcome = await executeJob(job, 'manual', null)
  return outcome
}

async function executeJob(
  job: Job,
  triggeredBy: TriggeredBy,
  scheduledFor: number | null
): Promise<{ ok: boolean; message: string }> {
  // ── Concurrency: one run per job, ever ──
  if (running.has(job.id)) {
    const body = 'Previous run still in progress — this occurrence was skipped and will not be made up.'
    recordInstantRun({
      jobId: job.id,
      status: 'skipped',
      triggeredBy,
      scheduledFor,
      error: body,
    })
    notify({ kind: 'skipped', title: `Skipped: ${job.name}`, body, jobId: job.id, jobName: job.name })
    // Deliberately not queued: a job slower than its own interval would build an
    // unbounded backlog it could never work through.
    advanceSchedule(job)
    return { ok: false, message: `"${job.name}" was already running; occurrence skipped.` }
  }

  const capability = getCapability(job.capabilityId)
  if (!capability) {
    const error = `Capability "${job.capabilityId}" is not registered.`
    recordInstantRun({ jobId: job.id, status: 'failure', triggeredBy, scheduledFor, error })
    disableJob(job, error)
    return { ok: false, message: error }
  }

  // ── Network awareness: defer, never fail ──
  if (capability.risk === 'network' && !isOnline()) {
    const body = 'Offline — deferred rather than failed. Will try again in about 5 minutes.'
    recordInstantRun({
      jobId: job.id,
      status: 'deferred',
      triggeredBy,
      scheduledFor,
      error: body,
    })
    notify({ kind: 'deferred', title: `Deferred: ${job.name}`, body, jobId: job.id, jobName: job.name })
    // Short retry rather than the next scheduled occurrence: a daily sync that
    // finds you offline at 3am should not wait another 24 hours.
    setNextRun(job.id, Date.now() + 5 * 60_000)
    return { ok: false, message: `"${job.name}" deferred — no network.` }
  }

  const attempt = job.consecutiveFailures + 1
  const controller = new AbortController()
  running.set(job.id, controller)

  const runId = startRun({ jobId: job.id, attempt, triggeredBy, scheduledFor })
  const timeoutTimer = setTimeout(() => controller.abort(), job.timeoutMs)

  try {
    const result = await invokeCapability(job.capabilityId, job.args, {
      invokedBy: 'job',
      jobRunId: runId,
      signal: controller.signal,
    })

    if (result.ok) {
      // A capability may report that it succeeded *badly* — a truncated index, a
      // sync that skipped half its items. That is not a failure, but it must not
      // hide behind a green check either.
      let warning: string | null = null
      try {
        warning = capability.resultWarning?.(result.result) ?? null
      } catch {
        // A broken warning hook must not turn a good run into a failed one.
        warning = null
      }

      finishRun({ runId, status: 'success', result: result.result, error: warning })
      recordJobOutcome(job.id, 'success', Date.now(), 0)
      advanceSchedule(job)

      if (warning) {
        notify({
          kind: 'degraded',
          title: `Completed with problems: ${job.name}`,
          body: warning,
          jobId: job.id,
          jobName: job.name,
        })
        return { ok: true, message: `"${job.name}" completed with problems: ${warning}` }
      }
      return { ok: true, message: `"${job.name}" completed.` }
    }

    // Parked awaiting the user's approval — neither a success nor a failure, and
    // explicitly not a retry: nothing is wrong, it is just waiting for a person.
    if (result.errorCode === 'awaiting_approval') {
      finishRun({
        runId,
        status: 'awaiting_approval',
        error: result.error,
        approvalId: result.awaitingApprovalId,
      })
      recordJobOutcome(job.id, 'awaiting_approval', Date.now(), 0)
      advanceSchedule(job)
      notify({
        kind: 'awaiting_approval',
        title: `Approval needed: ${job.name}`,
        body: result.error ?? `"${job.name}" is waiting for your approval.`,
        jobId: job.id,
        jobName: job.name,
      })
      return { ok: false, message: result.error ?? 'Awaiting approval.' }
    }

    return handleFailure(job, runId, result.error ?? 'Unknown failure', attempt, controller.signal)
  } catch (err) {
    return handleFailure(job, runId, (err as Error)?.message ?? String(err), attempt, controller.signal)
  } finally {
    clearTimeout(timeoutTimer)
    running.delete(job.id)
  }
}

function handleFailure(
  job: Job,
  runId: string,
  error: string,
  attempt: number,
  signal: AbortSignal
): { ok: boolean; message: string } {
  const timedOut = signal.aborted
  const detail = timedOut
    ? `Timed out after ${Math.round(job.timeoutMs / 1000)}s. ${error}`
    : error
  finishRun({
    runId,
    status: timedOut ? 'timeout' : 'failure',
    error: detail,
  })
  recordJobOutcome(job.id, timedOut ? 'timeout' : 'failure', Date.now(), attempt)

  if (attempt > job.maxRetries) {
    // Disabling is the point. A job that fails forever in silence is the worst
    // outcome available — worse than one that stops and says so.
    const reason = `Failed ${attempt} time(s) in a row. Last error: ${detail}`
    disableJob(job, reason)
    return { ok: false, message: reason }
  }

  const delay = backoffDelay(attempt)
  setNextRun(job.id, Date.now() + delay)
  // Announced even though a retry is coming. A job that fails three times before
  // recovering was still broken for an hour, and the user is entitled to know
  // that happened rather than discovering it only if the last attempt also dies.
  notify({
    kind: timedOut ? 'timeout' : 'failure',
    title: `${timedOut ? 'Timed out' : 'Failed'}: ${job.name}`,
    body: `${detail} Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt} of ${job.maxRetries + 1}).`,
    jobId: job.id,
    jobName: job.name,
  })
  return {
    ok: false,
    message: `"${job.name}" failed (attempt ${attempt}/${job.maxRetries + 1}); retrying in ${Math.round(delay / 1000)}s.`,
  }
}

function disableJob(job: Job, reason: string): void {
  setJobEnabled(job.id, false, reason)
  setNextRun(job.id, null)
  // Urgent: this one has stopped for good and will not fix itself.
  notify({
    kind: 'disabled',
    priority: 'urgent',
    title: `Automation disabled: ${job.name}`,
    body: `${reason} It will not run again until you re-enable it in Automations → Jobs.`,
    jobId: job.id,
    jobName: job.name,
  })
}

/**
 * Exponential backoff with jitter.
 *
 * The jitter matters more than it looks: several jobs knocked out by the same
 * outage would otherwise retry in lockstep forever, hammering the service at the
 * exact moment it is trying to recover.
 */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS)
  const jitter = 1 + (random() * 2 - 1) * RETRY_JITTER
  return Math.round(base * jitter)
}

function advanceSchedule(job: Job): void {
  if (job.scheduleKind === 'manual') {
    setNextRun(job.id, null)
    return
  }
  setNextRun(job.id, nextOccurrence(job.scheduleKind, job.scheduleExpr, Date.now()))
}

/**
 * Resumes a run that was parked on approval. Wired to the approval framework in
 * main; the job's own schedule has already moved on, so this is a one-off
 * execution rather than a reschedule.
 */
export async function resumeApprovedRun(jobId: string): Promise<void> {
  const job = getJob(jobId)
  if (!job) return
  await executeJob(job, 'approval', null)
}

function isOnline(): boolean {
  try {
    return net.isOnline()
  } catch {
    // If we cannot tell, assume online: a false "offline" would defer every
    // network job indefinitely, which is a worse failure than one that errors.
    return true
  }
}

/** True while a run is in flight — the UI disables run-now for these. */
export function isJobRunning(jobId: string): boolean {
  return running.has(jobId)
}

export function cancelRunningJob(jobId: string): boolean {
  const controller = running.get(jobId)
  if (!controller) return false
  controller.abort()
  return true
}
