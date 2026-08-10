import { getDatabase } from '../db/database'
import { getDecodedSetting } from '../db/queries'

/**
 * YouTube Data API quota ledger.
 *
 * The Data API allows 10,000 units per day and it is genuinely easy to burn
 * through: a single `search.list` costs 100 units, so enumerating a 200-video
 * channel that way would cost 400+ units before reading a single statistic.
 * This app never calls `search.list` — see sync.ts.
 *
 * The ledger exists so a sync can be *refused before it starts* rather than
 * dying halfway through with a 403 and a half-populated database.
 *
 * Quota resets at midnight Pacific Time, not local midnight and not UTC. Keying
 * rows by the Pacific date is what makes "how much have I used today?" match
 * what Google thinks.
 */

/** Documented unit costs. `list` endpoints cost 1 regardless of how many parts are requested. */
export const QUOTA_COSTS = {
  'channels.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
  'videos.update': 50,
  'thumbnails.set': 50,
  /** Never used — listed so the cost is visible next to the alternative. */
  'search.list': 100,
} as const

export type QuotaEndpoint = keyof typeof QUOTA_COSTS

export const DEFAULT_QUOTA_BUDGET = 8000
export const DAILY_QUOTA_LIMIT = 10000

/**
 * The date Google bills against: quota resets at midnight US/Pacific.
 *
 * Using the local date would make the ledger disagree with Google's for part of
 * every day, which is worst precisely when the user is near the limit.
 */
export function quotaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function getBudget(): number {
  const raw = getDecodedSetting('youtubeQuotaBudget')
  const parsed = raw === null ? NaN : Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_QUOTA_BUDGET
  return Math.min(parsed, DAILY_QUOTA_LIMIT)
}

export interface QuotaStatus {
  date: string
  used: number
  budget: number
  limit: number
  remaining: number
  calls: Record<string, number>
}

export function getQuotaStatus(now = new Date()): QuotaStatus {
  const date = quotaDate(now)
  const row = getDatabase()
    .prepare('SELECT units_consumed, calls_json FROM yt_quota_usage WHERE date = ?')
    .get(date) as { units_consumed: number; calls_json: string } | undefined

  const budget = getBudget()
  const used = row?.units_consumed ?? 0

  return {
    date,
    used,
    budget,
    limit: DAILY_QUOTA_LIMIT,
    remaining: Math.max(budget - used, 0),
    calls: row ? safeParse(row.calls_json) : {},
  }
}

/** Records consumption. Called by every API wrapper, never by feature code directly. */
export function recordUsage(endpoint: QuotaEndpoint, calls = 1, now = new Date()): void {
  const date = quotaDate(now)
  const cost = QUOTA_COSTS[endpoint] * calls
  const db = getDatabase()

  const existing = db
    .prepare('SELECT units_consumed, calls_json FROM yt_quota_usage WHERE date = ?')
    .get(date) as { units_consumed: number; calls_json: string } | undefined

  const calls_json = safeParse(existing?.calls_json ?? '{}')
  calls_json[endpoint] = (calls_json[endpoint] ?? 0) + calls

  db.prepare(
    `INSERT INTO yt_quota_usage (date, units_consumed, calls_json) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET units_consumed = ?, calls_json = ?`
  ).run(
    date,
    (existing?.units_consumed ?? 0) + cost,
    JSON.stringify(calls_json),
    (existing?.units_consumed ?? 0) + cost,
    JSON.stringify(calls_json)
  )
}

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    readonly status: QuotaStatus
  ) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

/**
 * Refuses an operation that would take the day past budget.
 *
 * `estimatedUnits` is deliberately an over-estimate at the call site: it is far
 * better to decline a sync that would have just fit than to start one that
 * cannot finish.
 */
export function assertBudget(estimatedUnits: number, now = new Date()): QuotaStatus {
  const status = getQuotaStatus(now)
  if (status.used + estimatedUnits > status.budget) {
    throw new QuotaExceededError(
      `This would use about ${estimatedUnits} quota units, but only ${status.remaining} of ` +
        `today's ${status.budget}-unit budget remain (${status.used} already used). ` +
        `Quota resets at midnight Pacific. Raise the budget in Settings if you need to — ` +
        `Google's hard daily limit is ${DAILY_QUOTA_LIMIT}.`,
      status
    )
  }
  return status
}

/** True when `estimatedUnits` still fits — for UI that wants to warn, not throw. */
export function wouldExceedBudget(estimatedUnits: number, now = new Date()): boolean {
  const status = getQuotaStatus(now)
  return status.used + estimatedUnits > status.budget
}

function safeParse(json: string): Record<string, number> {
  try {
    return JSON.parse(json) as Record<string, number>
  } catch {
    return {}
  }
}
