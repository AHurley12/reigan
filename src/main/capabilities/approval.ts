import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { getDatabase } from '../db/database'
import type { CapabilityDiff, InvocationSource, RiskTier } from './types'

/**
 * Approval framework.
 *
 * Two things distinguish it from the permission gate it replaces:
 *
 *  1. It is driven by the capability's declared risk tier at dispatch, not by
 *     the call site remembering to wrap itself. A new write capability is gated
 *     because it says `risk: 'write'`, and registration rejects it if it has no
 *     approval spec.
 *
 *  2. It has a defined answer for unattended execution. The old gate auto-denied
 *     when no window was present, which is right for an interactive agent turn
 *     and wrong for a scheduled job — a 3am YouTube metadata update would simply
 *     evaporate, logged as denied by a user who was asleep. Job-sourced requests
 *     are instead persisted as `pending` and raised as a notification; the job
 *     run parks in `awaiting_approval` and executes when the user approves.
 */

export const APPROVAL_REQUEST_CHANNEL = 'approval:request'
export const APPROVAL_RESOLVE_CHANNEL = 'approval:resolve'
export const APPROVAL_PENDING_CHANGED_CHANNEL = 'approval:pending-changed'

/** How long a live, interactive prompt waits before auto-denying. */
const INTERACTIVE_TIMEOUT_MS = 2 * 60 * 1000

/** How long a queued (job-sourced) approval stays actionable before expiring. */
const QUEUED_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ApprovalRequest {
  id: string
  capabilityId: string
  title: string
  risk: RiskTier
  summary: string
  detail?: string
  diff: CapabilityDiff | null
  requestedBy: InvocationSource
  requestedAt: number
}

export type ApprovalOutcome =
  | { status: 'approved' }
  | { status: 'denied'; reason: string }
  /**
   * Nobody answered in time. Distinct from `denied` on purpose: reporting a
   * timeout as the user's decision is what let a dead IPC channel masquerade as
   * "you denied that" through an entire migration. Only `approved` may proceed —
   * every consumer must fail closed on anything else.
   */
  | { status: 'expired'; reason: string }
  /** Persisted for later; the caller must not proceed now. */
  | { status: 'queued'; approvalId: string }

let mainWindow: BrowserWindow | null = null
const livePending = new Map<string, (approved: boolean) => void>()

/** Filled in by Phase 6. Until then, a queued approval is persisted and visible in the UI. */
let notifier: ((request: ApprovalRequest) => void) | null = null

export function initApprovals(win: BrowserWindow): void {
  mainWindow = win
  expireStaleApprovals()
}

export function setApprovalNotifier(fn: (request: ApprovalRequest) => void): void {
  notifier = fn
}

/**
 * Per-conversation approval grants, for `approvalPolicy: 'session'`.
 *
 * Keyed to the conversation rather than to a timer or the process lifetime: a
 * grant the user gave while asking about one topic should not still be in force
 * when they open a new chat tomorrow, and "the conversation" is the unit they
 * actually reason about when they click Approve. `src/main/ipc/llm.ts` already
 * tracks the active conversation, so this rides on a boundary that exists
 * rather than inventing a session concept to sit beside it.
 *
 * In memory only, deliberately. A grant that survives a restart is one the user
 * cannot remember giving.
 */
let grantedConversationId: string | null = null
const sessionGrants = new Set<string>()

/**
 * Points the grant store at the conversation now in progress, clearing grants
 * if it changed. Idempotent, so the LLM handler can call it on every message.
 */
export function setApprovalConversation(conversationId: string): void {
  if (conversationId === grantedConversationId) return
  grantedConversationId = conversationId
  sessionGrants.clear()
}

export function hasSessionGrant(capabilityId: string): boolean {
  return sessionGrants.has(capabilityId)
}

export function recordSessionGrant(capabilityId: string): void {
  sessionGrants.add(capabilityId)
}

/** Test-only, and for a full sign-out where nothing prior should carry over. */
export function clearSessionGrants(): void {
  grantedConversationId = null
  sessionGrants.clear()
}

interface RequestParams {
  capabilityId: string
  title: string
  risk: RiskTier
  summary: string
  detail?: string
  diff?: CapabilityDiff | null
  args?: unknown
  requestedBy: InvocationSource
  jobRunId?: string
}

export async function requestApproval(params: RequestParams): Promise<ApprovalOutcome> {
  const id = randomUUID()
  const now = Date.now()

  const request: ApprovalRequest = {
    id,
    capabilityId: params.capabilityId,
    title: params.title,
    risk: params.risk,
    summary: params.summary,
    detail: params.detail,
    diff: params.diff ?? null,
    requestedBy: params.requestedBy,
    requestedAt: now,
  }

  // Scheduled work never blocks on a live prompt — nobody is necessarily there.
  const isHeadless = params.requestedBy === 'job'
  const windowAvailable = !!mainWindow && !mainWindow.isDestroyed()

  persistApproval({
    id,
    capabilityId: params.capabilityId,
    risk: params.risk,
    summary: params.summary,
    detail: params.detail,
    diff: request.diff,
    args: params.args,
    requestedBy: params.requestedBy,
    requestedAt: now,
    expiresAt: isHeadless ? now + QUEUED_TTL_MS : now + INTERACTIVE_TIMEOUT_MS,
  })

  if (isHeadless || !windowAvailable) {
    notifier?.(request)
    mainWindow?.webContents.send(APPROVAL_PENDING_CHANGED_CHANNEL)
    return { status: 'queued', approvalId: id }
  }

  const result = await promptLive(request)
  resolveApprovalRow(id, result === 'timeout' ? 'expired' : result)

  if (result === 'approved') return { status: 'approved' }
  if (result === 'denied') {
    return { status: 'denied', reason: `The user denied permission for: ${params.summary}` }
  }
  return { status: 'expired', reason: `No response to the approval prompt for: ${params.summary}` }
}

/** What a live prompt came back with. `timeout` is not a decision. */
type LiveResult = 'approved' | 'denied' | 'timeout'

function promptLive(request: ApprovalRequest): Promise<LiveResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      livePending.delete(request.id)
      resolve('timeout')
    }, INTERACTIVE_TIMEOUT_MS)

    livePending.set(request.id, (approved) => {
      clearTimeout(timer)
      resolve(approved ? 'approved' : 'denied')
    })

    mainWindow!.webContents.send(APPROVAL_REQUEST_CHANNEL, request)
  })
}

/**
 * Resolves an approval from the UI.
 *
 * Handles both shapes: a live prompt whose promise is still awaited, and a
 * queued request whose original caller is long gone. The latter returns the
 * stored row so the scheduler can pick the job back up.
 */
export function resolveApproval(id: string, approved: boolean): { wasLive: boolean; row: StoredApproval | null } {
  const live = livePending.get(id)
  if (live) {
    livePending.delete(id)
    live(approved)
    return { wasLive: true, row: null }
  }

  const row = getApproval(id)
  if (!row || row.state !== 'pending') return { wasLive: false, row: null }

  resolveApprovalRow(id, approved ? 'approved' : 'denied')
  mainWindow?.webContents.send(APPROVAL_PENDING_CHANGED_CHANNEL)
  return { wasLive: false, row: { ...row, state: approved ? 'approved' : 'denied' } }
}

// ── Persistence ──

export interface StoredApproval {
  id: string
  capabilityId: string
  risk: RiskTier
  summary: string
  detail?: string
  diff: CapabilityDiff | null
  args: unknown
  requestedBy: InvocationSource
  state: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled'
  requestedAt: number
  resolvedAt?: number
  expiresAt?: number
}

function persistApproval(a: {
  id: string
  capabilityId: string
  risk: RiskTier
  summary: string
  detail?: string
  diff: CapabilityDiff | null
  args: unknown
  requestedBy: InvocationSource
  requestedAt: number
  expiresAt: number
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO approvals
         (id, capability_id, risk, summary, detail, diff_json, args_json,
          requested_by, state, requested_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      a.id,
      a.capabilityId,
      a.risk,
      a.summary,
      a.detail ?? null,
      a.diff ? JSON.stringify(a.diff) : null,
      a.args === undefined ? null : JSON.stringify(a.args),
      a.requestedBy,
      a.requestedAt,
      a.expiresAt
    )
}

function resolveApprovalRow(id: string, state: 'approved' | 'denied' | 'expired' | 'cancelled'): void {
  getDatabase()
    .prepare(`UPDATE approvals SET state = ?, resolved_at = ? WHERE id = ? AND state = 'pending'`)
    .run(state, Date.now(), id)
}

export function getApproval(id: string): StoredApproval | null {
  const row = getDatabase().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as any
  return row ? rowToApproval(row) : null
}

export function listPendingApprovals(): StoredApproval[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM approvals WHERE state = 'pending' ORDER BY requested_at DESC`)
    .all() as any[]
  return rows.map(rowToApproval)
}

export function listApprovalHistory(limit = 100): StoredApproval[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM approvals ORDER BY requested_at DESC LIMIT ?`)
    .all(limit) as any[]
  return rows.map(rowToApproval)
}

/**
 * Expires anything that timed out while the app was closed. Without this, a
 * queued approval from three weeks ago would still be sitting there offering to
 * run a job whose moment has long passed.
 */
export function expireStaleApprovals(): number {
  const result = getDatabase()
    .prepare(
      `UPDATE approvals SET state = 'expired', resolved_at = ?
       WHERE state = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`
    )
    .run(Date.now(), Date.now())
  return result.changes
}

function rowToApproval(row: any): StoredApproval {
  return {
    id: row.id,
    capabilityId: row.capability_id,
    risk: row.risk as RiskTier,
    summary: row.summary,
    detail: row.detail ?? undefined,
    diff: row.diff_json ? JSON.parse(row.diff_json) : null,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    requestedBy: row.requested_by as InvocationSource,
    state: row.state,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  }
}
