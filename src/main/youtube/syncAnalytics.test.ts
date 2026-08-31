import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-sync-analytics-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../db/database')
const { CapabilityError } = await import('../capabilities/types')
const { isSystemicAnalyticsFailure, syncAnalyticsWindow } = await import('./sync')

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

const ok = { stats: 1, traffic: 1 }

describe('syncAnalyticsWindow', () => {
  it('keeps going when one video fails, and reports which', async () => {
    // The bug this pins: the analytics loop had no try/catch, so a single video
    // Google would not answer for aborted the whole sync — every video after it
    // in the list kept yesterday's numbers with nothing to say why.
    const seen: string[] = []
    const result = await syncAnalyticsWindow(['a', 'bad', 'c', 'd'], async (id) => {
      seen.push(id)
      if (id === 'bad') throw new CapabilityError('YouTube Analytics failed: 500', 'handler_failed')
      return ok
    })

    expect(seen).toEqual(['a', 'bad', 'c', 'd'])
    expect(result.statsRows).toBe(3)
    expect(result.trafficRows).toBe(3)
    expect(result.failedVideoIds).toEqual(['bad'])
  })

  it('gives up immediately when the account is no longer connected', async () => {
    // A dead grant fails identically for every remaining video. Isolating it
    // would turn one honest "reconnect your Google account" into 200 swallowed
    // warnings and a sync that reports success having written nothing.
    const seen: string[] = []
    const err = await syncAnalyticsWindow(['a', 'b', 'c'], async (id) => {
      seen.push(id)
      throw new CapabilityError('Google sign-in expired. Reconnect.', 'not_connected')
    }).catch((e) => e)

    expect(seen).toEqual(['a'])
    expect((err as InstanceType<typeof CapabilityError>).code).toBe('not_connected')
  })

  it('gives up immediately when the Analytics API is disabled for the project', async () => {
    // The real failure from 2026-08-17: one video's fatal took the sync down.
    // It should still stop the run — but on the first video, not the 40th — and
    // keep Google's text, because the enablement link is in it.
    const seen: string[] = []
    const err = await syncAnalyticsWindow(['a', 'b'], async (id) => {
      seen.push(id)
      throw new CapabilityError(
        'YouTube Analytics daily stats for a failed: YouTube Analytics API has not been used in ' +
          'project 220819498258 before or it is disabled.',
        'handler_failed'
      )
    }).catch((e) => e)

    expect(seen).toEqual(['a'])
    expect((err as Error).message).toMatch(/has not been used in project 220819498258/)
  })

  it('gives up immediately when the Analytics quota is exhausted', async () => {
    const seen: string[] = []
    await syncAnalyticsWindow(['a', 'b'], async (id) => {
      seen.push(id)
      throw new CapabilityError('quotaExceeded: daily limit reached', 'handler_failed')
    }).catch(() => {})

    expect(seen).toEqual(['a'])
  })

  it('fails the run when every video failed, rather than reporting an empty success', async () => {
    // The catch-all for a systemic failure nobody thought to classify — a
    // renamed metric, say, which is exactly how the `impressions` regression
    // spent two days looking like a quiet, healthy sync.
    const err = await syncAnalyticsWindow(['a', 'b', 'c'], async () => {
      throw new CapabilityError('Unknown identifier (somethingNew)', 'handler_failed')
    }).catch((e) => e)

    expect(err).toBeInstanceOf(CapabilityError)
    expect((err as Error).message).toMatch(/all 3 videos/)
  })

  it('propagates cancellation instead of treating it as a bad video', async () => {
    const err = await syncAnalyticsWindow(
      ['a', 'b'],
      async () => ok,
      {
        throwIfCancelled: () => {
          throw new CapabilityError('Sync cancelled.', 'cancelled')
        },
      }
    ).catch((e) => e)

    expect((err as InstanceType<typeof CapabilityError>).code).toBe('cancelled')
  })

  it('reports no failures for a clean run', async () => {
    const result = await syncAnalyticsWindow(['a', 'b'], async () => ok)

    expect(result.failedVideoIds).toEqual([])
    expect(result.statsRows).toBe(2)
  })

  it('does not fail an empty channel', async () => {
    // No videos means nothing failed — the "everything failed" guard must not
    // fire on 0 of 0.
    const result = await syncAnalyticsWindow([], async () => ok)

    expect(result.failedVideoIds).toEqual([])
    expect(result.statsRows).toBe(0)
  })
})

describe('isSystemicAnalyticsFailure', () => {
  it.each([
    ['a dead grant', new CapabilityError('expired', 'not_connected')],
    ['cancellation', new CapabilityError('cancelled', 'cancelled')],
    ['a disabled API', new Error('YouTube Analytics API has not been used in project 1 before')],
    ['accessNotConfigured', new Error('accessNotConfigured: API not enabled')],
    ['SERVICE_DISABLED', new Error('failed with reason SERVICE_DISABLED')],
    ['exhausted quota', new Error('quotaExceeded')],
    ['a rate limit', new Error('rateLimitExceeded')],
    ['missing scopes', new Error('insufficientPermissions granted to this request')],
  ])('treats %s as systemic', (_label, err) => {
    expect(isSystemicAnalyticsFailure(err)).toBe(true)
  })

  it.each([
    ['a transient server error', new Error('Internal error encountered (500)')],
    ['a missing video', new CapabilityError('video not found', 'not_found')],
    ['a timeout', new Error('ETIMEDOUT')],
  ])('treats %s as this video only', (_label, err) => {
    expect(isSystemicAnalyticsFailure(err)).toBe(false)
  })
})
