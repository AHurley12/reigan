import { randomUUID } from 'crypto'
import { getDatabase } from '../db/database'
import type { InvocationSource } from './types'

/**
 * Records every capability dispatch, successful or not.
 *
 * Distinct from the `approvals` table, which records *decisions*. An approval
 * row only exists when something needed a prompt, so reads and pre-approved
 * writes leave no trace there — and "what did the assistant actually do on my
 * machine" is exactly the question you want answered about the calls that
 * didn't stop to ask.
 */

/**
 * Argument keys whose values never reach the log.
 *
 * The audit table is plaintext by design — it has to be greppable to be useful
 * — so anything sensitive must be dropped before it arrives rather than
 * encrypted afterwards. `vault.create` carrying a secret body is the case that
 * matters: logging its arguments verbatim would write the very value the vault
 * encrypts into a second, unencrypted table.
 */
const REDACT_KEYS = /^(body|value|secret|token|password|apiKey|api_key|content|fields)$/i

const MAX_ARGS_CHARS = 2000

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

function serialiseArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null
  try {
    const json = JSON.stringify(redact(args))
    if (!json) return null
    return json.length > MAX_ARGS_CHARS ? `${json.slice(0, MAX_ARGS_CHARS)}…[truncated]` : json
  } catch {
    return '[unserialisable]'
  }
}

export type AuditOutcome = 'ok' | 'error' | 'denied' | 'awaiting_approval'

export interface AuditEntry {
  capabilityId: string
  invokedBy: InvocationSource
  args: unknown
  outcome: AuditOutcome
  errorCode?: string
  error?: string
  durationMs: number
}

export function recordInvocation(entry: AuditEntry): void {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO capability_audit
           (id, capability_id, invoked_by, args_json, outcome, error_code, error, duration_ms, invoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        entry.capabilityId,
        entry.invokedBy,
        serialiseArgs(entry.args),
        entry.outcome,
        entry.errorCode ?? null,
        entry.error ?? null,
        Math.round(entry.durationMs),
        Date.now()
      )
  } catch {
    // Auditing must never be the reason a capability fails. A logging error is
    // worth swallowing; losing the user's actual operation to it is not.
  }
}

export interface AuditRow {
  id: string
  capabilityId: string
  invokedBy: InvocationSource
  args: unknown
  outcome: AuditOutcome
  errorCode?: string
  error?: string
  durationMs: number
  invokedAt: number
}

export function listAuditLog(params?: { limit?: number; capabilityId?: string }): AuditRow[] {
  const limit = Math.min(params?.limit ?? 100, 1000)
  const rows = params?.capabilityId
    ? (getDatabase()
        .prepare(
          `SELECT * FROM capability_audit WHERE capability_id = ?
           ORDER BY invoked_at DESC LIMIT ?`
        )
        .all(params.capabilityId, limit) as any[])
    : (getDatabase()
        .prepare('SELECT * FROM capability_audit ORDER BY invoked_at DESC LIMIT ?')
        .all(limit) as any[])

  return rows.map((r) => ({
    id: r.id,
    capabilityId: r.capability_id,
    invokedBy: r.invoked_by,
    args: r.args_json ? safeParse(r.args_json) : undefined,
    outcome: r.outcome,
    errorCode: r.error_code ?? undefined,
    error: r.error ?? undefined,
    durationMs: r.duration_ms,
    invokedAt: r.invoked_at,
  }))
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}
