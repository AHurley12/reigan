import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-reach-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { recordIngestedReport, ingestedReportIds, pruneReachReports } = await import('./reachStore')

const report = (reportId: string) => ({
  reportId,
  jobId: 'job-1',
  windowStart: '2026-08-01',
  windowEnd: '2026-08-02',
  rowsIngested: 12,
})

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_reach_reports')
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('reach report ledger', () => {
  it('remembers a report so it is never ingested twice', () => {
    recordIngestedReport(report('r-1'))

    expect(ingestedReportIds().has('r-1')).toBe(true)
    expect(ingestedReportIds().has('r-2')).toBe(false)
  })

  it('treats a re-recorded report as the same row rather than a duplicate', () => {
    recordIngestedReport(report('r-1'))
    recordIngestedReport({ ...report('r-1'), rowsIngested: 30 })

    const rows = getDatabase().prepare('SELECT * FROM yt_reach_reports').all()
    expect(rows).toHaveLength(1)
    expect((rows[0] as { rows_ingested: number }).rows_ingested).toBe(30)
  })

  it('prunes ledger rows older than the retention window', () => {
    recordIngestedReport(report('old'))
    getDatabase()
      .prepare('UPDATE yt_reach_reports SET ingested_at = ? WHERE report_id = ?')
      .run(Date.now() - 100 * 86_400_000, 'old')
    recordIngestedReport(report('fresh'))

    expect(pruneReachReports(90 * 86_400_000)).toBe(1)
    expect(ingestedReportIds().has('old')).toBe(false)
    expect(ingestedReportIds().has('fresh')).toBe(true)
  })
})
