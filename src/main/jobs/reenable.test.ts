import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Re-enabling a job that auto-disabled itself must be a genuinely fresh start.
 *
 * The bug this pins: `consecutive_failures` used to survive the re-enable, so
 * the next attempt was numbered streak+1. For a job disabled at 5 failures with
 * `max_retries: 3`, that made attempt 6 instantly terminal — one failure after
 * the user fixed the underlying cause and the job disabled itself again, having
 * spent no retries and reporting a streak that included failures from before
 * the fix.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-reenable-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../db/database')
const store = await import('./store')
const { jobCapabilities } = await import('../capabilities/defs/jobs')

const enableJob = jobCapabilities.find((c) => c.id === 'jobs.enable')!
const disableJob = jobCapabilities.find((c) => c.id === 'jobs.disable')!

/** These handlers are synchronous and ignore ctx; this is the UI's invocation. */
const ctx = { invokedBy: 'ui' } as const

function makeDisabledJob(consecutiveFailures: number) {
  const job = store.upsertJob({
    name: `sync-${Math.random()}`,
    capabilityId: 'test.sync',
    scheduleKind: 'daily_at',
    scheduleExpr: '05:00',
    maxRetries: 3,
  })
  // Exactly the state `disableJob()` in the scheduler leaves behind.
  store.recordJobOutcome(job.id, 'failure', Date.now(), consecutiveFailures)
  store.setJobEnabled(job.id, false, `Failed ${consecutiveFailures} time(s) in a row.`)
  store.setNextRun(job.id, null)
  return store.getJob(job.id)!
}

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('re-enabling an auto-disabled job', () => {
  let job: ReturnType<typeof makeDisabledJob>

  beforeEach(() => {
    job = makeDisabledJob(5)
  })

  it('starts the failure streak over', () => {
    expect(job.consecutiveFailures).toBe(5)

    enableJob.handler({ id: job.id }, ctx)

    // The next attempt must be numbered 1, not 6 — otherwise it exceeds
    // maxRetries on its first failure and re-disables immediately.
    const after = store.getJob(job.id)!
    expect(after.consecutiveFailures).toBe(0)
    expect(after.consecutiveFailures + 1).toBeLessThanOrEqual(after.maxRetries)
  })

  it('clears the disabled state and reschedules', () => {
    enableJob.handler({ id: job.id }, ctx)

    const after = store.getJob(job.id)!
    expect(after.enabled).toBe(true)
    expect(after.disabledReason).toBeNull()
    expect(after.nextRunAt).not.toBeNull()
  })

  it('leaves the streak alone when the user disables a job by hand', () => {
    // Manual disable is not a claim that anything was fixed, so the history
    // stays put — only re-enabling forgives it.
    const healthy = makeDisabledJob(2)
    store.setJobEnabled(healthy.id, true, null)

    disableJob.handler({ id: healthy.id }, ctx)

    expect(store.getJob(healthy.id)!.consecutiveFailures).toBe(2)
  })
})
