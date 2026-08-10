import type { z } from 'zod'

/**
 * Risk tier drives approval enforcement at dispatch. It is declared once, on the
 * capability, rather than being re-decided at each call site — the previous
 * design made approval opt-in per caller, so forgetting `withPermission()` in a
 * new tool produced an ungated write with no type error and no lint failure.
 *
 *  read        — reads local state. Never prompts.
 *  network     — reaches an external service. Never prompts on its own, but the
 *                scheduler defers these when offline instead of failing them.
 *  write       — mutates the user's data, locally or on a remote service
 *                (YouTube metadata, calendar events, Gmail labels). Prompts.
 *  destructive — irreversible or bulk-destructive. Prompts, and the UI says so
 *                in stronger terms.
 */
export type RiskTier = 'read' | 'network' | 'write' | 'destructive'

/** Who initiated a capability call. Determines whether approval is required. */
export type InvocationSource = 'ui' | 'agent' | 'job'

export interface CapabilityContext {
  invokedBy: InvocationSource
  /** Set when invoked by the scheduler; ties any approval request back to the run. */
  jobRunId?: string
  /** Cooperative cancellation for long operations. */
  signal?: AbortSignal
  /** Progress reporting for determinate UI progress bars. */
  onProgress?: (progress: { done: number; total: number; label?: string }) => void
}

/**
 * A structured before/after for the approval card. Far more reviewable than the
 * flat `detail` string the old gate accepted — Phase 2's metadata updates and
 * Phase 5's rule dry-runs both need the user to see exactly what changes.
 */
export interface CapabilityDiff {
  /** e.g. the video title, so the card says *what* is being changed. */
  subject: string
  changes: Array<{ field: string; before: string | null; after: string | null }>
}

export interface ApprovalSpec<TArgs> {
  /** Plain language, describing exactly what will happen. Not the capability id. */
  summary: (args: TArgs) => string
  /** Optional structured diff, resolved before the prompt is shown. */
  diff?: (args: TArgs) => Promise<CapabilityDiff | null> | CapabilityDiff | null
}

export interface CapabilityDef<TArgs = unknown, TResult = unknown> {
  /** Dotted, stable, unique: `jobs.list`, `youtube.sync`. Part of the public tool surface. */
  id: string
  /** Short human label for the UI. */
  title: string
  /** Written for the model — this becomes the tool description verbatim. */
  description: string
  risk: RiskTier

  /**
   * Recomputes the risk tier from the actual arguments.
   *
   * Exists for one shape that a static tier cannot express: `shell.run` is
   * read-only for `git status` and destructive for everything else, and the
   * difference is only knowable once the command has been parsed. Without
   * this, the capability would have to run its own approval prompt inside its
   * handler — which is precisely the "approval decided at the call site"
   * pattern the registry exists to abolish.
   *
   * The declared `risk` remains the honest worst case and is what the
   * capability list and the model's tool description show; this can only be
   * consulted to pick a tier for one specific invocation.
   */
  dynamicRisk?: (args: TArgs) => RiskTier

  /**
   * Excludes this capability from the generated tool schema, so the model cannot
   * see or call it. The enforcement point for Phase 7's privacy guarantee:
   * `usage.getSessions` returns raw window titles and must never be reachable by
   * the model, while `usage.getSummary` (aggregates only) is.
   *
   * Requires `uiOnlyReason` — an unexplained exclusion is indistinguishable from
   * an accident, and this list must be auditable.
   */
  uiOnly?: boolean
  uiOnlyReason?: string

  /** Argument schema. Validated at dispatch and converted to the model's tool schema. */
  schema: z.ZodType<TArgs>

  /** Required for write/destructive capabilities — enforced at registration. */
  approval?: ApprovalSpec<TArgs>

  /** Gates registration of the tool on a connected Google account. */
  requiresGoogle?: boolean

  handler: (args: TArgs, ctx: CapabilityContext) => Promise<TResult> | TResult

  /**
   * Renders the result as text for the model. Defaults to JSON. Worth supplying
   * for anything the model narrates back to the user, since prose survives the
   * round trip better than a JSON blob.
   */
  formatResult?: (result: TResult) => string
}

/** Erased form for storage in the registry map. */
export type AnyCapability = CapabilityDef<any, any>

/** Metadata safe to hand to the renderer for introspection/debugging. */
export interface CapabilityInfo {
  id: string
  title: string
  description: string
  risk: RiskTier
  uiOnly: boolean
  uiOnlyReason?: string
  requiresApproval: boolean
  requiresGoogle: boolean
}

/** Thrown for a failure the model should report honestly rather than retry blindly. */
export class CapabilityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid_args'
      | 'denied'
      | 'offline'
      | 'not_connected'
      | 'cancelled'
      | 'handler_failed'
  ) {
    super(message)
    this.name = 'CapabilityError'
  }
}
