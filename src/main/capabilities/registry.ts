import { requestApproval, hasSessionGrant, recordSessionGrant } from './approval'
import { recordInvocation, type AuditOutcome } from './audit'
import { getDecodedSetting } from '../db/queries'
import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type CapabilityDef,
  type CapabilityDiff,
  type CapabilityInfo,
} from './types'

/**
 * Global override: prompt for write/destructive work even when the user
 * clicked the button themselves.
 *
 * Default on. Dispatch alone cannot tell "the user pressed Execute on a plan
 * they just read" from "the user pressed a button whose blast radius is 400
 * files across six folders" — only the capability's risk tier can, and it
 * says both are destructive. Defaulting to on means the file organiser and
 * shell cannot move or delete anything without a second look; turning it off
 * restores the quieter behaviour of trusting any UI-initiated action.
 */
export const REQUIRE_APPROVAL_ALL_KEY = 'requireApprovalForAllCapabilities'

function requireApprovalForAll(): boolean {
  // Absent means never configured, which must read as on — a security default
  // that only applies once someone visits Settings is not a default.
  return getDecodedSetting(REQUIRE_APPROVAL_ALL_KEY) !== 'false'
}

/**
 * The single place a capability is declared.
 *
 * One declaration produces all three surfaces the app needs — the IPC handler
 * the UI calls, the preload method that reaches it, and the LangChain tool the
 * model calls. Before this, each feature was written three times against three
 * hand-maintained lists, which is why `ipc/tasks.ts` and `agents/tools/taskTools.ts`
 * duplicate each other today.
 *
 * Registration is strict on purpose. Every rule below is one that, if left to
 * convention, eventually gets forgotten in a hurry:
 *  - duplicate ids throw, rather than silently shadowing
 *  - write/destructive capabilities must declare an approval spec
 *  - `uiOnly` must state a reason, so the model-invisible list stays auditable
 */

const registry = new Map<string, AnyCapability>()

export function registerCapability<TArgs, TResult>(def: CapabilityDef<TArgs, TResult>): void {
  if (registry.has(def.id)) {
    throw new Error(
      `Capability id collision: "${def.id}" is already registered. Ids must be unique across the whole app.`
    )
  }

  if (!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+$/.test(def.id)) {
    throw new Error(
      `Capability id "${def.id}" must be dotted camelCase, e.g. "youtube.listVideos".`
    )
  }

  // A dynamic tier can escalate to write/destructive at call time, so such a
  // capability needs an approval spec regardless of what it declares
  // statically — otherwise the escalation would hit `cap.approval!` at
  // dispatch and crash instead of prompting.
  const needsApproval = def.risk === 'write' || def.risk === 'destructive' || !!def.dynamicRisk
  if (needsApproval && !def.approval) {
    throw new Error(
      `Capability "${def.id}" is risk:${def.risk} and must declare an approval spec. ` +
        'Mutating capabilities are gated by the registry, not by their call sites.'
    )
  }

  // Same rule for the tier-independent axis: a policy that says "ask the user"
  // with nothing to show them would reach `cap.approval!` at dispatch and crash.
  if (def.approvalPolicy && !def.approval) {
    throw new Error(
      `Capability "${def.id}" declares approvalPolicy:${def.approvalPolicy} and must also ` +
        'declare an approval spec — there is nothing to put on the card without one.'
    )
  }

  if (def.uiOnly && !def.uiOnlyReason) {
    throw new Error(
      `Capability "${def.id}" is uiOnly but gives no uiOnlyReason. ` +
        'The set of capabilities hidden from the model must be explainable.'
    )
  }

  registry.set(def.id, def as AnyCapability)
}

export function registerCapabilities(defs: AnyCapability[]): void {
  for (const def of defs) registerCapability(def)
}

export function getCapability(id: string): AnyCapability | undefined {
  return registry.get(id)
}

export function listCapabilities(): CapabilityInfo[] {
  return [...registry.values()]
    .map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      risk: c.risk,
      uiOnly: !!c.uiOnly,
      uiOnlyReason: c.uiOnlyReason,
      requiresApproval: c.risk === 'write' || c.risk === 'destructive' || !!c.approvalPolicy,
      requiresGoogle: !!c.requiresGoogle,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Capabilities the model may see. The enforcement point for `uiOnly`. */
export function listModelVisibleCapabilities(): AnyCapability[] {
  return [...registry.values()].filter((c) => !c.uiOnly)
}

/** Test/dev only — the registry is otherwise append-only for the process lifetime. */
export function clearRegistry(): void {
  registry.clear()
}

export interface InvokeResult {
  ok: boolean
  result?: unknown
  error?: string
  errorCode?: string
  /** Set when a job-sourced call parked awaiting the user's approval. */
  awaitingApprovalId?: string
}

/**
 * Validates, gates, and dispatches. Every surface goes through here, so the
 * approval and validation rules cannot be bypassed by calling from a different
 * entry point.
 */
export async function invokeCapability(
  id: string,
  rawArgs: unknown,
  ctx: CapabilityContext
): Promise<InvokeResult> {
  const startedAt = Date.now()

  // Audits on the way out rather than at each return, so a path added later
  // cannot quietly escape the log by forgetting to call it.
  const audit = (outcome: AuditOutcome, r: InvokeResult): InvokeResult => {
    recordInvocation({
      capabilityId: id,
      invokedBy: ctx.invokedBy,
      args: rawArgs,
      outcome,
      errorCode: r.errorCode,
      error: r.error,
      durationMs: Date.now() - startedAt,
    })
    return r
  }
  const auditFail = (message: string, code: string): InvokeResult =>
    audit(code === 'denied' ? 'denied' : 'error', fail(message, code))

  const cap = registry.get(id)
  if (!cap) {
    return auditFail(`No capability named "${id}".`, 'not_found')
  }

  // A uiOnly capability reaching agent/job dispatch means the tool generator
  // leaked it. Refuse rather than serve it — this is Phase 7's privacy boundary.
  if (cap.uiOnly && ctx.invokedBy !== 'ui') {
    return auditFail(
      `"${id}" is not available to the assistant (${cap.uiOnlyReason ?? 'UI only'}).`,
      'denied'
    )
  }

  const parsed = cap.schema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return auditFail(`Invalid arguments for "${id}" — ${issues}`, 'invalid_args')
  }
  const args = parsed.data

  // Approval is required by tier, and only when something other than the user's
  // own click initiated it. A UI invocation *is* the user acting; prompting them
  // to approve the button they just pressed is noise, and trains the reflex to
  // approve without reading — which is exactly what breaks the agent case.
  // A capability may narrow (or raise) its tier for this particular call —
  // see CapabilityDef.dynamicRisk. Falls back to the declared tier, so
  // anything that throws or is absent keeps the stricter static answer.
  let effectiveRisk = cap.risk
  if (cap.dynamicRisk) {
    try {
      effectiveRisk = cap.dynamicRisk(args)
    } catch {
      effectiveRisk = cap.risk
    }
  }

  const tierNeedsApproval = effectiveRisk === 'write' || effectiveRisk === 'destructive'

  // The tier-independent axis. 'always' is never satisfied in advance; 'session'
  // is satisfied by an approval already given in this conversation. Checked
  // before the prompt so a granted capability costs nothing on later calls.
  //
  // Only the agent may spend that grant. The user answered a card about the
  // conversation they were sitting in front of, so a scheduled job firing while
  // that conversation happens to still be open is not covered by it — it would
  // be unattended work running on consent nobody gave it. A job falls through
  // to its own approval, which the scheduler parks until the user answers.
  const grantCovers = ctx.invokedBy === 'agent' && hasSessionGrant(cap.id)

  const policyNeedsApproval =
    cap.approvalPolicy === 'always' ||
    (cap.approvalPolicy === 'session' && !grantCovers)

  const needsApproval = tierNeedsApproval || policyNeedsApproval
  if (needsApproval && (ctx.invokedBy !== 'ui' || requireApprovalForAll())) {
    const spec = cap.approval!
    let diff: CapabilityDiff | null = null
    try {
      diff = (await spec.diff?.(args)) ?? null
    } catch {
      // A diff is an aid to the decision, not a precondition for it. Losing the
      // preview must not block the action entirely.
      diff = null
    }

    const outcome = await requestApproval({
      capabilityId: cap.id,
      title: cap.title,
      risk: effectiveRisk,
      summary: spec.summary(args),
      diff,
      args,
      requestedBy: ctx.invokedBy,
      jobRunId: ctx.jobRunId,
    })

    if (outcome.status === 'queued') {
      return audit('awaiting_approval', {
        ok: false,
        error: `Waiting for your approval: ${spec.summary(args)}`,
        errorCode: 'awaiting_approval',
        awaitingApprovalId: outcome.approvalId,
      })
    }

    // Fail closed. Written as "anything that isn't an approval stops here"
    // rather than as a list of the statuses that stop, so adding a new
    // non-approving outcome cannot fall through and run unapproved work — the
    // shape of the old check, which tested only for `denied` and `queued`.
    if (outcome.status !== 'approved') {
      return auditFail(outcome.reason, outcome.status)
    }

    // Approved, and only past the guard above — a grant must never be banked
    // for a call that was denied. Only a 'session' policy banks it: a
    // tier-driven approval covers this call alone, and 'always' means what it
    // says. Banked only for the agent, mirroring who is allowed to spend it, so
    // a job's approval covers that one run and nothing after it.
    if (cap.approvalPolicy === 'session' && ctx.invokedBy === 'agent') {
      recordSessionGrant(cap.id)
    }
  }

  try {
    const result = await cap.handler(args, ctx)
    return audit('ok', { ok: true, result })
  } catch (err) {
    if (err instanceof CapabilityError) {
      return auditFail(err.message, err.code)
    }
    if ((err as Error)?.name === 'AbortError') {
      return auditFail(`"${id}" was cancelled.`, 'cancelled')
    }
    return auditFail(`"${id}" failed: ${(err as Error)?.message ?? String(err)}`, 'handler_failed')
  }
}

function fail(error: string, errorCode: string): InvokeResult {
  return { ok: false, error, errorCode }
}
