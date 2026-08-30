import { randomUUID, createHash } from 'crypto'
import { getDatabase } from '../db/database'
import { ERROR_SOURCES, type ErrorSource, type ErrorSeverity } from '../../shared/errors'

/**
 * The application's error log.
 *
 * Deliberately separate from `capability_audit`, which records dispatches: an
 * audit row is written when a capability returns, so it only ever sees a
 * failure that propagated all the way out of the handler. Real failures are
 * quieter than that. They come in two shapes, and neither reaches dispatch:
 *
 *  - **Partial failures.** A scan walks thousands of directories and is denied
 *    on a dozen, an organiser run executes 197 of its 200 ops, a port probe
 *    times out on one port. Every one of those is a *successful* capability
 *    call from dispatch's point of view.
 *  - **Failures that are announced once and then discarded.** A scheduled job
 *    fails four times and is auto-disabled; the user gets a notification and a
 *    `disabled_reason`, and the only durable record — `job_runs` — is pruned at
 *    90 days and cascade-deleted with the job itself. Delete the automation and
 *    the evidence goes with it. A Google token refresh, an LLM call and a TTS
 *    request all fail the same way.
 *
 * This table is where both shapes go, so that "it says it worked but it didn't"
 * and "what was that error last week?" both have an answer.
 *
 * Four properties matter for this to stay useful rather than becoming noise:
 *
 *  - **It never throws.** Logging a failure must not be able to cause one. A
 *    write that fails here is swallowed, exactly as `recordInvocation` does.
 *  - **Identical failures collapse.** A tree the user cannot read produces one
 *    row with `occurrences: 400`, not 400 rows that say the same thing and
 *    evict everything else.
 *  - **It is bounded.** Retention is enforced on write, so the table cannot
 *    grow without limit on a machine nobody ever opens the panel on.
 *  - **It outlives what it describes.** Nothing here is a foreign key. A row
 *    survives the deletion of the job, project or root it refers to, which is
 *    the whole reason it exists rather than a column on those tables.
 *
 * This module imports only the database and the shared source vocabulary. It is
 * a leaf, and must stay one — the features import the log, so any import back
 * into a feature would close a cycle. `architecture.test.ts` enforces that
 * repo-wide.
 */

/** Rows kept before the oldest are pruned. Roughly a season of real use. */
const RETENTION_ROWS = 500

const MAX_MESSAGE_CHARS = 1000
const MAX_STACK_CHARS = 4000
const MAX_CONTEXT_CHARS = 2000

/**
 * Context keys whose values never reach the log.
 *
 * This table is plaintext so it can be read and grepped, which means anything
 * sensitive has to be dropped before it arrives rather than encrypted after.
 * The vault is the case that matters: recording a failed `vault.create` with
 * its context verbatim would write the very value the vault exists to encrypt
 * into a second, unencrypted table. Shell commands are the other — they carry
 * tokens on the command line often enough to assume they do. Widening this log
 * to the whole app widened that exposure too: OAuth refresh failures and LLM
 * calls carry `refresh_token`, `access_token`, `authorization` and prompt text,
 * so those are matched here as well.
 */
const REDACT_KEYS =
  /^(body|value|secret|token|password|apiKey|api_key|content|fields|env|refresh_token|refreshToken|access_token|accessToken|authorization|id_token|idToken|client_secret|clientSecret|prompt|messages|transcript)$/i

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

function serialiseContext(context: unknown): string {
  if (context === undefined || context === null) return '{}'
  try {
    const json = JSON.stringify(redact(context))
    if (!json) return '{}'
    return json.length > MAX_CONTEXT_CHARS ? `${json.slice(0, MAX_CONTEXT_CHARS)}…[truncated]` : json
  } catch {
    return '{"_":"[unserialisable]"}'
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text
}

/** Pulls an errno-style code off whatever was thrown, when there is one. */
function errorCode(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/**
 * What makes two failures "the same".
 *
 * Source, operation, code and message — but deliberately **not** subject. Two
 * hundred files denied under one folder are one problem with one fix, and
 * including the path would defeat the collapsing entirely. The subject of the
 * most recent occurrence is kept as an example.
 *
 * Digits in the message are normalised out first, so "timed out after 5001ms"
 * and "timed out after 5002ms" do not read as different problems — and so that
 * a job failing nightly with "Failed 3 time(s) in a row" does not write a new
 * row every time the counter ticks up.
 */
function fingerprintOf(source: string, operation: string, code: string | null, message: string): string {
  const normalised = message.replace(/\d+/g, '#').slice(0, 200)
  return createHash('sha1').update(`${source} ${operation} ${code ?? ''} ${normalised}`).digest('hex')
}

export interface AppErrorEntry {
  source: ErrorSource
  /** The step that failed, e.g. 'executeOp'. Narrower than the source. */
  operation: string
  /** The thrown value, or a message when there was nothing to throw. */
  error: unknown
  /** What it was about — a path, a port, a command, a job name. */
  subject?: string
  context?: unknown
  severity?: ErrorSeverity
}

/**
 * Records one failure. Never throws.
 *
 * Safe to call from inside a catch that is about to rethrow, and from a loop
 * over per-item failures.
 */
export function recordAppError(entry: AppErrorEntry): void {
  try {
    const now = Date.now()
    const code = errorCode(entry.error)
    const message = truncate(errorMessage(entry.error), MAX_MESSAGE_CHARS)
    const stack = entry.error instanceof Error && entry.error.stack
      ? truncate(entry.error.stack, MAX_STACK_CHARS)
      : null
    const fingerprint = fingerprintOf(entry.source, entry.operation, code, message)

    // One statement so a repeat is a single write and cannot race with itself
    // between a SELECT and an INSERT. The stored message/subject/context are
    // refreshed to the newest occurrence — when reading a recurring error you
    // want the most recent example, not the first one from six weeks ago.
    getDatabase()
      .prepare(
        `INSERT INTO app_errors
           (id, source, operation, severity, message, code, subject,
            context_json, stack, fingerprint, occurrences, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           occurrences  = occurrences + 1,
           last_seen    = excluded.last_seen,
           severity     = excluded.severity,
           message      = excluded.message,
           subject      = excluded.subject,
           context_json = excluded.context_json,
           stack        = excluded.stack`
      )
      .run(
        randomUUID(),
        entry.source,
        entry.operation,
        entry.severity ?? 'error',
        message,
        code,
        entry.subject ?? null,
        serialiseContext(entry.context),
        stack,
        fingerprint,
        now,
        now
      )

    pruneIfNeeded()
  } catch {
    // Logging an error must never be the reason an operation fails. Losing a
    // log line is acceptable; losing the user's actual work to it is not.
  }
}

/**
 * Trims to the retention limit.
 *
 * Counts first and deletes only when over, so the steady state is one cheap
 * COUNT rather than a DELETE with a subquery on every single write.
 */
function pruneIfNeeded(): void {
  const db = getDatabase()
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM app_errors').get() as { n: number }
  if (n <= RETENTION_ROWS) return
  db.prepare(
    `DELETE FROM app_errors WHERE id IN (
       SELECT id FROM app_errors ORDER BY last_seen DESC LIMIT -1 OFFSET ?
     )`
  ).run(RETENTION_ROWS)
}

export interface AppErrorRow {
  id: string
  source: ErrorSource
  operation: string
  severity: ErrorSeverity
  message: string
  code?: string
  subject?: string
  context: unknown
  stack?: string
  occurrences: number
  firstSeen: number
  lastSeen: number
}

export interface ListAppErrorParams {
  source?: ErrorSource
  severity?: ErrorSeverity
  /** Only errors last seen at or after this epoch-ms timestamp. */
  since?: number
  limit?: number
}

export function listAppErrors(params: ListAppErrorParams = {}): AppErrorRow[] {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), RETENTION_ROWS)

  const where: string[] = []
  const args: unknown[] = []
  if (params.source) { where.push('source = ?'); args.push(params.source) }
  if (params.severity) { where.push('severity = ?'); args.push(params.severity) }
  if (params.since !== undefined) { where.push('last_seen >= ?'); args.push(params.since) }

  const rows = getDatabase()
    .prepare(
      `SELECT * FROM app_errors
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY last_seen DESC LIMIT ?`
    )
    .all(...args, limit) as Array<Record<string, any>>

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    operation: r.operation,
    severity: r.severity,
    message: r.message,
    code: r.code ?? undefined,
    subject: r.subject ?? undefined,
    context: safeParse(r.context_json),
    stack: r.stack ?? undefined,
    occurrences: r.occurrences,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }))
}

export interface AppErrorSummary {
  /** Distinct problems, i.e. rows. */
  distinct: number
  /** Total failures, counting every repeat. */
  total: number
  bySource: Record<string, { distinct: number; total: number }>
  newestAt: number | null
}

export function summariseAppErrors(since?: number): AppErrorSummary {
  const rows = getDatabase()
    .prepare(
      `SELECT source, COUNT(*) AS distinct_count, SUM(occurrences) AS total, MAX(last_seen) AS newest
       FROM app_errors
       ${since !== undefined ? 'WHERE last_seen >= ?' : ''}
       GROUP BY source`
    )
    .all(...(since !== undefined ? [since] : [])) as Array<{
      source: string
      distinct_count: number
      total: number
      newest: number
    }>

  const bySource: Record<string, { distinct: number; total: number }> = {}
  let distinct = 0
  let total = 0
  let newestAt: number | null = null
  for (const r of rows) {
    bySource[r.source] = { distinct: r.distinct_count, total: r.total ?? 0 }
    distinct += r.distinct_count
    total += r.total ?? 0
    if (newestAt === null || r.newest > newestAt) newestAt = r.newest
  }
  return { distinct, total, bySource, newestAt }
}

/** Clears the log, or one source's share of it. Returns rows removed. */
export function clearAppErrors(source?: ErrorSource): number {
  const db = getDatabase()
  const result = source
    ? db.prepare('DELETE FROM app_errors WHERE source = ?').run(source)
    : db.prepare('DELETE FROM app_errors').run()
  return result.changes
}

/**
 * The sources the live schema will actually accept.
 *
 * Read from the table's own CHECK constraint rather than from the constant, so
 * that a source added to `shared/errors.ts` without the migration to match is
 * caught by a test instead of by a silently swallowed INSERT at runtime.
 */
export function schemaAllowedSources(): string[] {
  const row = getDatabase()
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_errors'`)
    .get() as { sql: string } | undefined
  if (!row) return []
  const check = /CHECK\s*\(\s*source\s+IN\s*\(([^)]*)\)/i.exec(row.sql)
  if (!check?.[1]) return []
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string)
}

/** Re-exported so callers need only import the log. */
export { ERROR_SOURCES }
export type { ErrorSource, ErrorSeverity }

function safeParse(json: string | null): unknown {
  if (!json) return {}
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
