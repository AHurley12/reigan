import { getDatabase } from '../db/database'

/**
 * The ledger of Reporting API reports this app has already consumed.
 *
 * Kept separate from the ingest itself so "what have we already read?" is
 * answerable without touching the network, and so the retention rule lives in
 * one place rather than being re-derived at each call site.
 */

export interface IngestedReport {
  reportId: string
  jobId: string
  windowStart: string
  windowEnd: string
  rowsIngested: number
}

export function recordIngestedReport(report: IngestedReport): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_reach_reports
         (report_id, job_id, window_start, window_end, rows_ingested, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id) DO UPDATE SET
         rows_ingested = excluded.rows_ingested,
         ingested_at = excluded.ingested_at`
    )
    .run(
      report.reportId,
      report.jobId,
      report.windowStart,
      report.windowEnd,
      report.rowsIngested,
      Date.now()
    )
}

/** Every report id already consumed, for filtering a fresh listing. */
export function ingestedReportIds(): Set<string> {
  const rows = getDatabase()
    .prepare('SELECT report_id FROM yt_reach_reports')
    .all() as Array<{ report_id: string }>
  return new Set(rows.map((r) => r.report_id))
}

/**
 * Drops ledger rows past the retention window, returning how many went.
 *
 * Google keeps reports for 60 days, so a ledger entry older than that can never
 * match a listed report again and is pure growth. This is a ledger of what has
 * been consumed, not an archive.
 */
export function pruneReachReports(olderThanMs: number): number {
  return getDatabase()
    .prepare('DELETE FROM yt_reach_reports WHERE ingested_at < ?')
    .run(Date.now() - olderThanMs).changes
}
