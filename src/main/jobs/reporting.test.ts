import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { JobNotification } from '../../shared/types'

/**
 * The reporting contract: a job row must never claim something that did not
 * happen, and nothing short of a clean success may pass without reaching the UI.
 *
 * These exist because both halves failed silently in the shipped build — a
 * capability that swallowed its own error was recorded as `success`, and six of
 * the eight non-success outcomes were written to the run table and never
 * announced. Both are the kind of regression that leaves no trace until someone
 * notices, months later, that an automation stopped working.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-report-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { clearRegistry, registerCapability } = await import('../capabilities/registry')
const { runBootCatchUp, setJobNotifier } = await import('./scheduler')
const store = await import('./store')
const { z } = await import('zod')

const notifications: JobNotification[] = []
const settle = () => new Promise((r) => setTimeout(r, 60))

function kinds(): string[] {
  return notifications.map((n) => n.kind)
}

function registerFakes(): void {
  clearRegistry()

  registerCapability({
    id: 'test.counts',
    title: 'Returns a count',
    description: 'A fake capability returning a structured result for run-record tests',
    risk: 'read',
    schema: z.object({}),
    handler: () => ({ filesIndexed: 1234, capped: false }),
  })

  registerCapability({
    id: 'test.throws',
    title: 'Always throws',
    description: 'A fake capability that throws, for failure-reporting tests',
    risk: 'read',
    schema: z.object({}),
    handler: () => {
      throw new Error('disk fell over')
    },
  })

  registerCapability({
    id: 'test.degraded',
    title: 'Succeeds badly',
    description: 'A fake capability that succeeds but reports a degraded outcome',
    risk: 'read',
    schema: z.object({}),
    handler: () => ({ filesIndexed: 0, capped: true }),
    resultWarning: (r: { capped: boolean }) =>
      r.capped ? 'Stopped at the entry ceiling; the index is incomplete.' : null,
  })

  registerCapability({
    id: 'test.offline',
    title: 'Network capability',
    description: 'A fake network capability used to exercise the offline defer path',
    risk: 'network',
    schema: z.object({}),
    handler: () => ({ ok: true }),
  })
}

function overdueJob(params: {
  name: string
  capabilityId: string
  catchUpPolicy?: 'run_once' | 'run_all' | 'skip'
  maxRetries?: number
}) {
  return store.upsertJob({
    name: params.name,
    capabilityId: params.capabilityId,
    scheduleKind: 'interval',
    scheduleExpr: '60',
    catchUpPolicy: params.catchUpPolicy ?? 'run_once',
    maxRetries: params.maxRetries ?? 3,
    enabled: true,
    nextRunAt: Date.now() - 2 * 3_600_000,
  })
}

beforeAll(() => {
  getDatabase()
  setJobNotifier((event) => notifications.push(event))
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDatabase().exec('DELETE FROM job_runs; DELETE FROM jobs;')
  notifications.length = 0
  registerFakes()
})

describe('run records carry the evidence', () => {
  it('stores the capability result on the run, not just its duration', async () => {
    const job = overdueJob({ name: 'counts', capabilityId: 'test.counts' })

    runBootCatchUp()
    await settle()

    const [run] = store.listRuns(job.id)
    expect(run.status).toBe('success')
    // The regression this guards: the result was spread from a `void` return,
    // so the record held a duration and nothing else.
    expect(run.result).toMatchObject({ filesIndexed: 1234 })
  })
})

describe('failures are recorded as failures', () => {
  it('records a throwing capability as a failure, never a success', async () => {
    const job = overdueJob({ name: 'boom', capabilityId: 'test.throws' })

    runBootCatchUp()
    await settle()

    const [run] = store.listRuns(job.id)
    expect(run.status).toBe('failure')
    expect(run.error).toContain('disk fell over')
    expect(store.getJob(job.id)!.lastStatus).toBe('failure')
  })

  it('announces a failure even while retries remain', async () => {
    overdueJob({ name: 'boom-retry', capabilityId: 'test.throws' })

    runBootCatchUp()
    await settle()

    // Previously silent: only the final, retry-exhausting failure ever notified.
    expect(kinds()).toContain('failure')
    expect(notifications[0].body).toContain('Retrying in')
  })

  it('escalates to an urgent alert when the retry budget is exhausted', async () => {
    overdueJob({ name: 'doomed', capabilityId: 'test.throws', maxRetries: 0 })

    runBootCatchUp()
    await settle()

    const disabled = notifications.find((n) => n.kind === 'disabled')
    expect(disabled).toBeTruthy()
    expect(disabled!.priority).toBe('urgent')
  })
})

describe('degraded successes are not silent', () => {
  it('keeps the run successful but annotates and announces the shortfall', async () => {
    const job = overdueJob({ name: 'degraded', capabilityId: 'test.degraded' })

    runBootCatchUp()
    await settle()

    const [run] = store.listRuns(job.id)
    // Still a success — it did complete — but the caveat rides along with it
    // instead of hiding behind an unqualified green check.
    expect(run.status).toBe('success')
    expect(run.error).toContain('entry ceiling')

    const degraded = notifications.find((n) => n.kind === 'degraded')
    expect(degraded).toBeTruthy()
    expect(degraded!.jobName).toBe('degraded')
  })

  it('does not announce a clean success', async () => {
    overdueJob({ name: 'clean', capabilityId: 'test.counts' })

    runBootCatchUp()
    await settle()

    expect(notifications).toHaveLength(0)
  })
})

describe('every non-success outcome reaches the UI', () => {
  it('announces a skipped catch-up', async () => {
    overdueJob({ name: 'skipper', capabilityId: 'test.counts', catchUpPolicy: 'skip' })

    runBootCatchUp()
    await settle()

    expect(kinds()).toContain('skipped')
  })

  it('records and announces an overlapping occurrence as skipped', async () => {
    // A handler that stays in flight long enough for a second occurrence to
    // collide with it — the Files-panel-refresh-during-the-nightly-job case.
    clearRegistry()
    registerCapability({
      id: 'test.slow',
      title: 'Slow capability',
      description: 'A fake capability that stays in flight, to exercise the overlap path',
      risk: 'read',
      schema: z.object({}),
      handler: () => new Promise((r) => setTimeout(() => r({ ok: true }), 200)),
    })
    const job = overdueJob({ name: 'overlap', capabilityId: 'test.slow' })

    runBootCatchUp() // starts the long run
    await new Promise((r) => setTimeout(r, 20))
    store.setNextRun(job.id, Date.now() - 1000)
    runBootCatchUp() // collides with it
    await new Promise((r) => setTimeout(r, 300))

    expect(kinds()).toContain('skipped')
    expect(store.listRuns(job.id).some((r) => r.status === 'skipped')).toBe(true)
  })

  it('gives every notification a job name and a timestamp', async () => {
    overdueJob({ name: 'named', capabilityId: 'test.throws' })

    runBootCatchUp()
    await settle()

    expect(notifications.length).toBeGreaterThan(0)
    for (const n of notifications) {
      expect(n.id).toBeTruthy()
      expect(n.jobName).toBe('named')
      expect(n.at).toBeGreaterThan(0)
      expect(n.body.length).toBeGreaterThan(0)
    }
  })
})
