import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Reconnecting a Google account must bring back the jobs the dead grant killed.
 *
 * The gap this pins: while the OAuth client sits in "Testing", Google expires
 * the refresh token every 7 days. Each Google job then failed its way through
 * its retry budget and auto-disabled itself — correctly, in isolation. But
 * reconnecting in Settings did not undo any of it, so the daily YouTube sync
 * stayed off until someone noticed the data was stale and re-enabled it by
 * hand, job by job. The weekly expiry was survivable; the silent permanent
 * stop after it was not.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-google-resume-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../db/database')
const store = await import('./store')
const { resumeGoogleJobsAfterReconnect } = await import('./scheduler')

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

/** The exact state `disableJob()` leaves behind, for a given disable reason. */
function makeDisabledJob(reason: string, scheduleKind: 'daily_at' | 'manual' = 'daily_at') {
  const job = store.upsertJob({
    name: `job-${Math.random()}`,
    capabilityId: 'youtube.sync',
    scheduleKind,
    scheduleExpr: scheduleKind === 'manual' ? '' : '05:00',
    maxRetries: 3,
  })
  store.recordJobOutcome(job.id, 'failure', Date.now(), 4)
  store.setJobEnabled(job.id, false, reason)
  store.setNextRun(job.id, null)
  return store.getJob(job.id)!
}

const DEAD_GRANT =
  'Failed 4 time(s) in a row. Last error: Google sign-in expired (YouTube channels.list). ' +
  'Reconnect your Google account in Settings.'

describe('resumeGoogleJobsAfterReconnect', () => {
  it('brings back a job the dead grant disabled, with a clean slate', async () => {
    const job = makeDisabledJob(DEAD_GRANT)

    const resumed = resumeGoogleJobsAfterReconnect()

    const after = store.getJob(job.id)!
    expect(resumed).toContain(after.name)
    expect(after.enabled).toBe(true)
    expect(after.disabledReason).toBeNull()
    // The streak is what disabled it; carrying it over would make the next
    // single failure instantly terminal.
    expect(after.consecutiveFailures).toBe(0)
    expect(after.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('leaves a job the user disabled on purpose alone', async () => {
    // Reconnecting an account is not consent to restart something switched off
    // deliberately, and "Disabled manually." is the only record of that intent.
    const job = makeDisabledJob('Disabled manually.')

    resumeGoogleJobsAfterReconnect()

    expect(store.getJob(job.id)!.enabled).toBe(false)
  })

  it('leaves a job disabled for an unrelated failure alone', async () => {
    // A job that broke on a bad path or a missing capability is not fixed by a
    // new token, and restarting it would just burn its retry budget again.
    const job = makeDisabledJob('Failed 4 time(s) in a row. Last error: ENOENT: no such file')

    resumeGoogleJobsAfterReconnect()

    expect(store.getJob(job.id)!.enabled).toBe(false)
  })

  it('does not touch a job that is already running normally', async () => {
    const job = store.upsertJob({
      name: `healthy-${Math.random()}`,
      capabilityId: 'youtube.sync',
      scheduleKind: 'daily_at',
      scheduleExpr: '05:00',
      maxRetries: 3,
    })
    store.setNextRun(job.id, 4_102_444_800_000)

    const resumed = resumeGoogleJobsAfterReconnect()

    expect(resumed).not.toContain(job.name)
    // Rescheduling a healthy job would silently move its next run.
    expect(store.getJob(job.id)!.nextRunAt).toBe(4_102_444_800_000)
  })

  it('enables a manual job without inventing a schedule for it', async () => {
    const job = makeDisabledJob(DEAD_GRANT, 'manual')

    resumeGoogleJobsAfterReconnect()

    const after = store.getJob(job.id)!
    expect(after.enabled).toBe(true)
    expect(after.nextRunAt).toBeNull()
  })

  it('reports nothing when there is nothing to resume', async () => {
    // Every reconnect calls this, including the very first one.
    expect(resumeGoogleJobsAfterReconnect()).toEqual([])
  })
})
