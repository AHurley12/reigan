import { randomUUID } from 'crypto'
import { getDatabase } from '../db/database'
import type {
  ContextFact,
  ContextFactKind,
  ContextFactSource,
  ContextFactStatus,
} from '../../shared/types'

/**
 * Write precedence. A producer may only overwrite a fact whose source ranks at
 * or below its own, which is the single rule that stops the layer arguing with
 * itself: a nightly stats run cannot bury a correction the user typed, and a
 * model paraphrase cannot bury either.
 */
export const SOURCE_RANK: Record<ContextFactSource, number> = {
  distilled: 0,
  stat: 1,
  user: 2,
}

const DEFAULT_CONFIDENCE: Record<ContextFactSource, number> = {
  distilled: 0.5,
  stat: 0.9,
  user: 1,
}

export interface FactInput {
  kind: ContextFactKind
  key: string
  body: string
  source: ContextFactSource
  confidence?: number
  evidence?: string | null
}

interface FactRow {
  id: string
  kind: string
  key: string
  body: string
  evidence: string | null
  confidence: number
  source: string
  status: string
  created_at: number
  updated_at: number
  last_seen_at: number
}

function toFact(row: FactRow): ContextFact {
  return {
    id: row.id,
    kind: row.kind as ContextFactKind,
    key: row.key,
    body: row.body,
    evidence: row.evidence,
    confidence: row.confidence,
    source: row.source as ContextFactSource,
    status: row.status as ContextFactStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function getFactById(id: string): ContextFact | null {
  const row = getDatabase()
    .prepare('SELECT * FROM context_facts WHERE id = ?')
    .get(id) as FactRow | undefined
  return row ? toFact(row) : null
}

/**
 * Insert or update one fact, keyed on (kind, key).
 *
 * Returns null when precedence refuses the write — the caller has not failed,
 * it has simply been outranked, so this is not an error path.
 */
export function upsertFact(input: FactInput, now = Date.now()): ContextFact | null {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT * FROM context_facts WHERE kind = ? AND key = ?')
    .get(input.kind, input.key) as FactRow | undefined

  if (existing && SOURCE_RANK[input.source] < SOURCE_RANK[existing.source as ContextFactSource]) {
    return null
  }

  const confidence = clamp(input.confidence ?? DEFAULT_CONFIDENCE[input.source])

  if (existing) {
    db.prepare(`
      UPDATE context_facts
         SET body = ?, evidence = ?, confidence = ?, source = ?,
             status = 'active', updated_at = ?, last_seen_at = ?
       WHERE id = ?
    `).run(input.body, input.evidence ?? null, confidence, input.source, now, now, existing.id)
    return getFactById(existing.id)
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO context_facts
      (id, kind, key, body, evidence, confidence, source, status, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, input.kind, input.key, input.body, input.evidence ?? null, confidence, input.source, now, now, now)

  return getFactById(id)
}

export function listFacts(
  opts: { status?: ContextFactStatus; minConfidence?: number } = {},
): ContextFact[] {
  const status = opts.status ?? 'active'
  const minConfidence = opts.minConfidence ?? 0

  const rows = getDatabase()
    .prepare(`
      SELECT * FROM context_facts
       WHERE status = ? AND confidence >= ?
       ORDER BY confidence DESC, last_seen_at DESC
    `)
    .all(status, minConfidence) as FactRow[]

  return rows.map(toFact)
}

/**
 * A hand-edit is the strongest signal the layer ever gets, so it both rewrites
 * the body and promotes the row to user-authored — which makes it immune to
 * every later distillation pass and to decay.
 */
export function editFactBody(id: string, body: string, now = Date.now()): ContextFact | null {
  getDatabase()
    .prepare(`
      UPDATE context_facts
         SET body = ?, source = 'user', confidence = 1, status = 'active', updated_at = ?
       WHERE id = ?
    `)
    .run(body, now, id)
  return getFactById(id)
}

export function dismissFact(id: string, now = Date.now()): void {
  getDatabase()
    .prepare("UPDATE context_facts SET status = 'dismissed', updated_at = ? WHERE id = ?")
    .run(now, id)
}

export function clearAllFacts(): void {
  getDatabase().exec('DELETE FROM context_facts')
}

/**
 * Fade facts nothing has re-observed lately. Nothing is deleted — a decayed
 * fact drops out of the digest but stays visible and restorable in Settings,
 * because "we stopped seeing evidence" is not the same as "this was false".
 */
export function decayFacts(now = Date.now(), staleDays = 90, factor = 0.7): number {
  const cutoff = now - staleDays * 86_400_000
  const result = getDatabase()
    .prepare(`
      UPDATE context_facts
         SET confidence = confidence * ?, updated_at = ?
       WHERE status = 'active' AND source != 'user' AND last_seen_at < ?
    `)
    .run(factor, now, cutoff)
  return result.changes
}

export function setStat(metric: string, value: unknown, now = Date.now()): void {
  getDatabase()
    .prepare(`
      INSERT INTO context_stats (metric, value_json, computed_at) VALUES (?, ?, ?)
      ON CONFLICT(metric) DO UPDATE SET value_json = excluded.value_json, computed_at = excluded.computed_at
    `)
    .run(metric, JSON.stringify(value), now)
}

export function getStat<T>(metric: string): T | null {
  const row = getDatabase()
    .prepare('SELECT value_json FROM context_stats WHERE metric = ?')
    .get(metric) as { value_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return null
  }
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
