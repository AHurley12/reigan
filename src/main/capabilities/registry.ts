import { requestApproval } from './approval'
import {
  CapabilityError,
  type AnyCapability,
  type CapabilityContext,
  type CapabilityDef,
  type CapabilityDiff,
  type CapabilityInfo,
} from './types'

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

  const needsApproval = def.risk === 'write' || def.risk === 'destructive'
  if (needsApproval && !def.approval) {
    throw new Error(
      `Capability "${def.id}" is risk:${def.risk} and must declare an approval spec. ` +
        'Mutating capabilities are gated by the registry, not by their call sites.'
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
      requiresApproval: c.risk === 'write' || c.risk === 'destructive',
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
  const cap = registry.get(id)
  if (!cap) {
    return fail(`No capability named "${id}".`, 'not_found')
  }

  // A uiOnly capability reaching agent/job dispatch means the tool generator
  // leaked it. Refuse rather than serve it — this is Phase 7's privacy boundary.
  if (cap.uiOnly && ctx.invokedBy !== 'ui') {
    return fail(
      `"${id}" is not available to the assistant (${cap.uiOnlyReason ?? 'UI only'}).`,
      'denied'
    )
  }

  const parsed = cap.schema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return fail(`Invalid arguments for "${id}" — ${issues}`, 'invalid_args')
  }
  const args = parsed.data

  // Approval is required by tier, and only when something other than the user's
  // own click initiated it. A UI invocation *is* the user acting; prompting them
  // to approve the button they just pressed is noise, and trains the reflex to
  // approve without reading — which is exactly what breaks the agent case.
  const needsApproval = cap.risk === 'write' || cap.risk === 'destructive'
  if (needsApproval && ctx.invokedBy !== 'ui') {
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
      risk: cap.risk,
      summary: spec.summary(args),
      diff,
      args,
      requestedBy: ctx.invokedBy,
      jobRunId: ctx.jobRunId,
    })

    if (outcome.status === 'denied') return fail(outcome.reason, 'denied')
    if (outcome.status === 'queued') {
      return {
        ok: false,
        error: `Waiting for your approval: ${spec.summary(args)}`,
        errorCode: 'awaiting_approval',
        awaitingApprovalId: outcome.approvalId,
      }
    }
  }

  try {
    const result = await cap.handler(args, ctx)
    return { ok: true, result }
  } catch (err) {
    if (err instanceof CapabilityError) {
      return fail(err.message, err.code)
    }
    if ((err as Error)?.name === 'AbortError') {
      return fail(`"${id}" was cancelled.`, 'cancelled')
    }
    return fail(`"${id}" failed: ${(err as Error)?.message ?? String(err)}`, 'handler_failed')
  }
}

function fail(error: string, errorCode: string): InvokeResult {
  return { ok: false, error, errorCode }
}
