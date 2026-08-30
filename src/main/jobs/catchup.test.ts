import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Integration coverage for the behaviour that makes a desktop scheduler
 * trustworthy: what happens to work that fell due while the app was not running.
 *
 * These drive the real SQLite database and the real registry — only the
 * capability handlers are fakes — because the interesting failures live in the
 * seams between the schedule maths, the store, and the dispatcher, not inside
 * any one of them.
 *
 * "Killing the app" is modelled the way it actually presents to the next boot:
 * a job row whose `next_run_at` is in the past. That is precisely the state a
 * `kill -9` leaves behind, and it is what `runBootCatchUp()` reads.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-jobs-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { clearRegistry, registerCapability } = await import('../capabilities/registry')
const { runBootCatchUp, backoffDelay } = await import('./scheduler')
const store = await import('./store')
const { z } = await import('zod')

/** Records every invocation so tests can assert on run counts and ordering. */
const calls: Array<{ id: string; at: number }> = []

function registerFakes(): void {
  clearRegistry()
  registerCapability({
    id: 'test.sync',
    title: 'Test sync',
    description: 'A fake capability for scheduler tests',
    risk: 'read',
    schema: z.object({}),
    handler: () => {
      calls.push({ id: 'test.sync', at: Date.now() })
      return { ok: true }
    },
  })
  registerCapability({
    id: 'test.netSync',
    title: 'Test network sync',
    description: 'A fake network capability',
    risk: 'network',
    schema: z.object({}),
    handler: () => {
      calls.push({ id: 'test.netSync', at: Date.now() })
      return { ok: true }
    },
  })
  registerCapability({
    id: 'test.flaky',
    title: 'Always fails',
    description: 'A fake capability that always throws',
    risk: 'read',
    schema: z.object({}),
    handler: () => {
      calls.push({ id: 'test.flaky', at: Date.now() })
      throw new Error('upstream exploded')
    },
  })
}

const HOUR = 3_600_000

/** Creates a job already overdue by `overdueHours` — the post-kill state. */
function overdueJob(params: {
  name: string
  capabilityId?: string
  catchUpPolicy: 'run_once' | 'run_all' | 'skip'
  scheduleKind?: 'interval' | 'daily_at'
  scheduleExpr?: string
  overdueHours: number
  maxRetries?: number
}) {
  return store.upsertJob({
    name: params.name,
    capabilityId: params.capabilityId ?? 'test.sync',
    scheduleKind: params.scheduleKind ?? 'interval',
    scheduleExpr: params.scheduleExpr ?? '60',
    catchUpPolicy: params.catchUpPolicy,
    maxRetries: params.maxRetries ?? 3,
    enabled: true,
    nextRunAt: Date.now() - params.overdueHours * HOUR,
  })
}

const settle = () => new Promise((r) => setTimeout(r, 60))

beforeAll(() => {
  getDatabase()
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  const db = getDatabase()
  db.exec('DELETE FROM job_runs; DELETE FROM jobs;')
  calls.length = 0
  registerFakes()
})

describe('catch-up: run_once', () => {
  it('runs exactly once no matter how many occurrences were missed', async () => {
    // Six hours offline, hourly job → six missed occurrences.
    const job = overdueJob({ name: 'once', catchUpPolicy: 'run_once', overdueHours: 6 })

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(1)

    const runs = store.listRuns(job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].triggeredBy).toBe('catch_up')
  })

  it('reschedules forward rather than replaying the backlog', async () => {
    const job = overdueJob({ name: 'once-fwd', catchUpPolicy: 'run_once', overdueHours: 6 })

    runBootCatchUp()
    await settle()

    const after = store.getJob(job.id)!
    expect(after.nextRunAt).toBeGreaterThan(Date.now())
  })
})

describe('catch-up: run_all', () => {
  it('replays every missed occurrence', async () => {
    // Three hours offline, hourly job → three missed occurrences.
    const job = overdueJob({ name: 'all', catchUpPolicy: 'run_all', overdueHours: 3 })

    runBootCatchUp()
    await settle()

    expect(calls.length).toBeGreaterThanOrEqual(3)

    const runs = store.listRuns(job.id)
    expect(runs.filter((r) => r.status === 'success').length).toBeGreaterThanOrEqual(3)
    // Each replayed run records the occurrence it stands in for, so the history
    // shows *which* windows were made up rather than just "ran three times".
    expect(runs.every((r) => r.triggeredBy === 'catch_up')).toBe(true)
    expect(runs.filter((r) => r.scheduledFor !== null).length).toBeGreaterThanOrEqual(3)
  })

  it('replays sequentially, never concurrently', async () => {
    const job = overdueJob({ name: 'all-seq', catchUpPolicy: 'run_all', overdueHours: 4 })

    runBootCatchUp()
    await settle()

    const runs = store.listRuns(job.id).filter((r) => r.status === 'success')
    // A concurrent replay would produce overlapping [startedAt, finishedAt]
    // windows and trip the one-run-at-a-time rule.
    const skipped = store.listRuns(job.id).filter((r) => r.status === 'skipped')
    expect(skipped).toHaveLength(0)
    expect(runs.length).toBeGreaterThanOrEqual(4)
  })

  it('caps a very long absence and records that it did', async () => {
    // 200 hours offline with an hourly job → far past MAX_CATCH_UP_OCCURRENCES.
    const job = overdueJob({ name: 'all-capped', catchUpPolicy: 'run_all', overdueHours: 200 })

    runBootCatchUp()
    await settle()

    const runs = store.listRuns(job.id, 200)
    const note = runs.find((r) => r.status === 'skipped')
    expect(note).toBeDefined()
    expect(note!.error).toMatch(/were missed/)
  })
})

describe('catch-up: skip', () => {
  it('does not run, but logs the miss', async () => {
    const job = overdueJob({ name: 'skip', catchUpPolicy: 'skip', overdueHours: 6 })

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(0)

    const runs = store.listRuns(job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('skipped')
    expect(runs[0].error).toMatch(/Missed 6 scheduled run\(s\)/)
  })

  it('reschedules to the next future occurrence', async () => {
    const job = overdueJob({ name: 'skip-fwd', catchUpPolicy: 'skip', overdueHours: 6 })

    runBootCatchUp()
    await settle()

    expect(store.getJob(job.id)!.nextRunAt).toBeGreaterThan(Date.now())
  })
})

describe('catch-up leaves well-behaved jobs alone', () => {
  it('ignores a job that is not yet due', async () => {
    const job = store.upsertJob({
      name: 'future',
      capabilityId: 'test.sync',
      scheduleKind: 'interval',
      scheduleExpr: '60',
      catchUpPolicy: 'run_all',
      enabled: true,
      nextRunAt: Date.now() + HOUR,
    })

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(0)
    expect(store.listRuns(job.id)).toHaveLength(0)
  })

  it('ignores a disabled job', async () => {
    const job = overdueJob({ name: 'off', catchUpPolicy: 'run_once', overdueHours: 5 })
    store.setJobEnabled(job.id, false, 'test')

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(0)
  })

  it('schedules a job that has no next_run_at yet', async () => {
    const job = store.upsertJob({
      name: 'unscheduled',
      capabilityId: 'test.sync',
      scheduleKind: 'daily_at',
      scheduleExpr: '09:00',
      catchUpPolicy: 'run_once',
      enabled: true,
      nextRunAt: null,
    })

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(0)
    expect(store.getJob(job.id)!.nextRunAt).toBeGreaterThan(Date.now())
  })
})

describe('network awareness', () => {
  it('defers a network job when offline instead of failing it', async () => {
    process.env.REIGAN_TEST_OFFLINE = '1'
    try {
      const job = overdueJob({
        name: 'net',
        capabilityId: 'test.netSync',
        catchUpPolicy: 'run_once',
        overdueHours: 2,
      })

      runBootCatchUp()
      await settle()

      expect(calls).toHaveLength(0)

      const runs = store.listRuns(job.id)
      expect(runs[0].status).toBe('deferred')
      expect(runs[0].error).toMatch(/Offline/)
      // Deferred, not failed — so it must not count toward the retry budget.
      expect(store.getJob(job.id)!.consecutiveFailures).toBe(0)
      // …and it retries soon rather than waiting for the next daily slot.
      expect(store.getJob(job.id)!.nextRunAt).toBeLessThan(Date.now() + 10 * 60_000)
    } finally {
      delete process.env.REIGAN_TEST_OFFLINE
    }
  })

  it('runs the same job once back online', async () => {
    const job = overdueJob({
      name: 'net-back',
      capabilityId: 'test.netSync',
      catchUpPolicy: 'run_once',
      overdueHours: 2,
    })

    runBootCatchUp()
    await settle()

    expect(calls).toHaveLength(1)
    expect(store.listRuns(job.id)[0].status).toBe('success')
  })
})

describe('failure handling', () => {
  it('records the failure and schedules a retry rather than giving up', async () => {
    const job = overdueJob({
      name: 'flaky',
      capabilityId: 'test.flaky',
      catchUpPolicy: 'run_once',
      overdueHours: 1,
      maxRetries: 3,
    })

    runBootCatchUp()
    await settle()

    const runs = store.listRuns(job.id)
    expect(runs[0].status).toBe('failure')
    expect(runs[0].error).toMatch(/upstream exploded/)

    const after = store.getJob(job.id)!
    expect(after.consecutiveFailures).toBe(1)
    expect(after.enabled).toBe(true)
    expect(after.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('disables itself once the retry budget is exhausted', async () => {
    const job = overdueJob({
      name: 'doomed',
      capabilityId: 'test.flaky',
      catchUpPolicy: 'run_once',
      overdueHours: 1,
      maxRetries: 0,
    })

    runBootCatchUp()
    await settle()

    const after = store.getJob(job.id)!
    expect(after.enabled).toBe(false)
    expect(after.disabledReason).toMatch(/Failed 1 time/)
    expect(after.nextRunAt).toBeNull()
  })
})

describe('crash recovery', () => {
  it('reconciles runs left in flight by a hard kill', () => {
    const job = overdueJob({ name: 'orphan', catchUpPolicy: 'skip', overdueHours: 1 })
    // Exactly what a kill -9 leaves behind: a started run that never finished.
    store.startRun({ jobId: job.id, attempt: 1, triggeredBy: 'schedule' })

    const reconciled = store.reconcileOrphanedRuns()

    expect(reconciled).toBe(1)
    const runs = store.listRuns(job.id)
    expect(runs[0].status).toBe('cancelled')
    expect(runs[0].error).toMatch(/app closed/)
    // Without this the overlap check would believe the job is permanently in
    // flight and it would never run again.
    expect(runs[0].finishedAt).not.toBeNull()
  })
})

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    const noJitter = () => 0.5
    expect(backoffDelay(1, noJitter)).toBe(30_000)
    expect(backoffDelay(2, noJitter)).toBe(60_000)
    expect(backoffDelay(3, noJitter)).toBe(120_000)
    expect(backoffDelay(20, noJitter)).toBe(60 * 60_000)
  })

  it('applies jitter so simultaneous failures do not retry in lockstep', () => {
    const low = backoffDelay(3, () => 0)
    const high = backoffDelay(3, () => 1)
    expect(low).toBeLessThan(120_000)
    expect(high).toBeGreaterThan(120_000)
    expect(low).toBeGreaterThanOrEqual(120_000 * 0.8)
    expect(high).toBeLessThanOrEqual(120_000 * 1.2)
  })
})

describe('run retention', () => {
  it('prunes runs older than the retention window and keeps recent ones', () => {
    const job = overdueJob({ name: 'retention', catchUpPolicy: 'skip', overdueHours: 1 })
    const db = getDatabase()

    const oldRun = store.startRun({ jobId: job.id, attempt: 1, triggeredBy: 'schedule' })
    db.prepare('UPDATE job_runs SET started_at = ? WHERE id = ?').run(
      Date.now() - 91 * 86_400_000,
      oldRun
    )
    store.startRun({ jobId: job.id, attempt: 1, triggeredBy: 'schedule' })

    const pruned = store.pruneOldRuns()

    expect(pruned).toBe(1)
    expect(store.listRuns(job.id, 100)).toHaveLength(1)
  })
})
