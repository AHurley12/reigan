import { getReportingClient, reportingCall } from './api'
import { parseReachCsv } from './reachCsv'
import { ingestReachRows } from './reachIngest'
import { ingestedReportIds, pruneReachReports, recordIngestedReport } from './reachStore'
import { googleAuth } from '../auth/googleAuth'
import { CapabilityError } from '../capabilities/types'

/**
 * Reach-report ingest.
 *
 * Thumbnail impressions and CTR exist in exactly one place in Google's APIs:
 * the Reporting API's bulk reach reports. They are not available to the
 * targeted Analytics queries `sync.ts` makes, which is why `yt_daily_stats`
 * carried two empty columns for as long as it did.
 *
 * The shape is dictated by how the API works. Reports are generated
 * asynchronously: a job is created once, Google backfills 30 days, and each new
 * day appears as a downloadable CSV within 48 hours. So the first two runs have
 * nothing to fetch — and must say so as a *success*, because a failure here
 * spends the scheduler's retry budget and disables the job before any data can
 * arrive.
 */

const REPORT_TYPE_ID = 'channel_reach_basic_a1'
const JOB_NAME = 'REIGAN reach'
/** Google keeps reports 60 days; a ledger row older than that can never match again. */
const LEDGER_RETENTION_MS = 90 * 86_400_000

interface ReportRef {
  id?: string | null
  startTime?: string | null
  endTime?: string | null
  downloadUrl?: string | null
}

export interface ReachIngestResult {
  jobCreated: boolean
  reportsIngested: number
  rowsWritten: number
  rowsSkipped: number
  durationMs: number
}

export async function ingestReachReports(): Promise<ReachIngestResult> {
  const startedAt = Date.now()
  const client = getReportingClient()

  const { jobId, created } = await ensureReportingJob(client)
  if (created) {
    // Nothing exists to download yet, and will not for ~48 hours. Returning
    // early keeps that first run honest rather than reporting "0 reports" as
    // though the job had been running for weeks.
    return {
      jobCreated: true,
      reportsIngested: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      durationMs: Date.now() - startedAt,
    }
  }

  const auth = googleAuth.getClient()
  if (!auth) throw new CapabilityError('No Google account connected.', 'not_connected')

  const already = ingestedReportIds()
  let reportsIngested = 0
  let rowsWritten = 0
  let rowsSkipped = 0

  for (const report of await listReports(client, jobId)) {
    if (!report.id || already.has(report.id) || !report.downloadUrl) continue

    // The download URL is an authenticated endpoint, so it goes through the
    // OAuth client rather than a bare fetch — that also keeps the access token
    // refreshed by the same code path as every other Google call.
    const csv = await reportingCall(`report ${report.id}`, () =>
      auth.request<string>({ url: report.downloadUrl as string, responseType: 'text' })
    )

    const rows = parseReachCsv(csv.data)
    const { written, skipped } = ingestReachRows(rows)

    recordIngestedReport({
      reportId: report.id,
      jobId,
      windowStart: (report.startTime ?? '').slice(0, 10),
      windowEnd: (report.endTime ?? '').slice(0, 10),
      rowsIngested: written,
    })

    reportsIngested++
    rowsWritten += written
    rowsSkipped += skipped
  }

  pruneReachReports(LEDGER_RETENTION_MS)

  return {
    jobCreated: false,
    reportsIngested,
    rowsWritten,
    rowsSkipped,
    durationMs: Date.now() - startedAt,
  }
}

/** Finds this app's reporting job, creating it on first use. Idempotent by report type. */
async function ensureReportingJob(
  client: ReturnType<typeof getReportingClient>
): Promise<{ jobId: string; created: boolean }> {
  const listed = await reportingCall('jobs.list', () => client.jobs.list({}))
  const existing = (listed.data.jobs ?? []).find((j) => j.reportTypeId === REPORT_TYPE_ID)
  if (existing?.id) return { jobId: existing.id, created: false }

  const created = await reportingCall('jobs.create', () =>
    client.jobs.create({ requestBody: { reportTypeId: REPORT_TYPE_ID, name: JOB_NAME } })
  )
  if (!created.data.id) {
    throw new CapabilityError(
      'YouTube accepted the reporting job but returned no id.',
      'handler_failed'
    )
  }
  return { jobId: created.data.id, created: true }
}

/** Every report Google currently holds for the job, across pages. */
async function listReports(
  client: ReturnType<typeof getReportingClient>,
  jobId: string
): Promise<ReportRef[]> {
  const all: ReportRef[] = []
  let pageToken: string | undefined

  do {
    const res = await reportingCall('jobs.reports.list', () =>
      client.jobs.reports.list({ jobId, pageToken })
    )
    all.push(...(res.data.reports ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return all
}
