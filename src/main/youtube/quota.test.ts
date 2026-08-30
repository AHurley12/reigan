import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-quota-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const {
  assertBudget,
  getQuotaStatus,
  quotaDate,
  recordUsage,
  wouldExceedBudget,
  QuotaExceededError,
  QUOTA_COSTS,
  DEFAULT_QUOTA_BUDGET,
} = await import('./quota')

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_quota_usage; DELETE FROM settings;')
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('quota day', () => {
  it('keys on the Pacific date, because that is when Google resets', () => {
    // 08:00 UTC on 15 June is still 01:00 on the 15th in Pacific.
    expect(quotaDate(new Date('2026-06-15T08:00:00Z'))).toBe('2026-06-15')
    // 03:00 UTC on the 15th is 20:00 on the *14th* Pacific — the previous
    // quota day. Keying on UTC or local time would disagree with Google here.
    expect(quotaDate(new Date('2026-06-15T03:00:00Z'))).toBe('2026-06-14')
  })
})

describe('cost model', () => {
  it('prices playlist enumeration far below search', () => {
    // The reason sync.ts walks the uploads playlist: enumerating a 200-video
    // channel is 4 units this way and 400+ via search.
    expect(QUOTA_COSTS['playlistItems.list']).toBe(1)
    expect(QUOTA_COSTS['search.list']).toBe(100)
    expect(QUOTA_COSTS['videos.list']).toBe(1)
    expect(QUOTA_COSTS['videos.update']).toBe(50)
  })
})

describe('recording usage', () => {
  it('accumulates units and keeps a per-endpoint breakdown', () => {
    recordUsage('playlistItems.list')
    recordUsage('playlistItems.list')
    recordUsage('videos.list')
    recordUsage('videos.update')

    const status = getQuotaStatus()
    expect(status.used).toBe(1 + 1 + 1 + 50)
    expect(status.calls['playlistItems.list']).toBe(2)
    expect(status.calls['videos.update']).toBe(1)
  })

  it('starts from zero on a day with no usage', () => {
    const status = getQuotaStatus()
    expect(status.used).toBe(0)
    expect(status.budget).toBe(DEFAULT_QUOTA_BUDGET)
    expect(status.remaining).toBe(DEFAULT_QUOTA_BUDGET)
  })
})

describe('budget enforcement', () => {
  it('allows an operation that fits', () => {
    expect(() => assertBudget(100)).not.toThrow()
    expect(wouldExceedBudget(100)).toBe(false)
  })

  it('refuses an operation that would exceed the budget, with a usable message', () => {
    for (let i = 0; i < 159; i++) recordUsage('videos.update') // 7,950 units

    expect(wouldExceedBudget(100)).toBe(true)
    expect(() => assertBudget(100)).toThrow(QuotaExceededError)

    try {
      assertBudget(100)
    } catch (err) {
      const message = (err as Error).message
      // The message has to be actionable: how much it wanted, how much is left,
      // when it resets, and where the ceiling actually is.
      expect(message).toMatch(/about 100 quota units/)
      expect(message).toMatch(/50 of today's 8000-unit budget remain/)
      expect(message).toMatch(/resets at midnight Pacific/)
      expect(message).toMatch(/10000/)
    }
  })

  it('refuses before starting rather than dying half-way', () => {
    for (let i = 0; i < 159; i++) recordUsage('videos.update')
    const before = getQuotaStatus().used
    try {
      assertBudget(500)
    } catch {
      // The check must not itself consume quota.
    }
    expect(getQuotaStatus().used).toBe(before)
  })

  it('honours a configured budget', () => {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('youtubeQuotaBudget', '"500"')

    expect(getQuotaStatus().budget).toBe(500)
    expect(() => assertBudget(600)).toThrow(QuotaExceededError)
  })

  it('never lets a configured budget exceed Google\'s hard limit', () => {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('youtubeQuotaBudget', '"999999"')

    expect(getQuotaStatus().budget).toBe(10000)
  })

  it('falls back to the default when the setting is nonsense', () => {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('youtubeQuotaBudget', '"not a number"')

    expect(getQuotaStatus().budget).toBe(DEFAULT_QUOTA_BUDGET)
  })
})
