/**
 * Shared types for the guarded file operations subsystem.
 *
 * This module is intentionally logic-free: it is imported by every other
 * fileops module, and a cycle here would be very hard to unpick later.
 * Anything that needs a runtime value (constants, guards, factories) belongs
 * in the module that owns the behaviour, not here.
 */

// ── Branded safe path ───────────────────────────────────────────────────────

/**
 * Phantom brand for {@link SafePath}. `declare` means this has no runtime
 * existence at all — it is erased by the compiler, so branding costs nothing.
 */
declare const __safePathBrand: unique symbol

/**
 * An absolute, normalized, realpath-resolved path that has been proven to sit
 * inside an allowlisted root and outside every deny-listed location.
 *
 * WHY A BRAND: every fs-touching function in this subsystem accepts `SafePath`
 * and never `string`. A plain string cannot be assigned to it, so forgetting to
 * validate a path is a *compile error* rather than something a reviewer has to
 * notice. Only `pathGuard.ts` may mint one (it holds the single cast), which is
 * what makes it a genuine chokepoint rather than a convention.
 */
export type SafePath = string & { readonly [__safePathBrand]: true }

// ── Path guard ──────────────────────────────────────────────────────────────

/**
 * Every distinct reason a path can be refused. Codes are stable strings so the
 * audit log and the renderer can key off them without parsing prose.
 */
export type PathGuardErrorCode =
  | 'EMPTY_PATH'
  | 'NOT_ABSOLUTE'
  | 'NUL_BYTE'
  | 'CONTROL_CHARS'
  | 'NO_ROOTS_CONFIGURED'
  | 'REALPATH_FAILED'
  | 'OUTSIDE_ROOTS'
  | 'DENIED_LOCATION'
  | 'RESERVED_DEVICE_NAME'
  | 'TRAILING_DOT_OR_SPACE'
  | 'PATH_TOO_LONG'

export type PathGuardWarningCode = 'PATH_LENGTH_NEAR_LIMIT'

export interface PathGuardError {
  readonly code: PathGuardErrorCode
  /** Plain-language explanation, safe to show the user verbatim. */
  readonly message: string
  /** The input as supplied by the caller, never a resolved form. */
  readonly input: string
}

export interface PathGuardWarning {
  readonly code: PathGuardWarningCode
  readonly message: string
}

export type PathGuardResult =
  | {
      readonly ok: true
      readonly path: SafePath
      /** The allowlisted root that contains this path, in resolved form. */
      readonly root: string
      readonly warnings: readonly PathGuardWarning[]
    }
  | { readonly ok: false; readonly error: PathGuardError }

/**
 * Everything the guard needs to make a decision, passed explicitly rather than
 * read from Electron/global state.
 *
 * WHY EXPLICIT: the guard is the one module that must be exhaustively testable
 * against real symlinks, junctions and drive layouts. Injecting the context
 * means the test suite constructs real temp-dir scenarios with no Electron
 * runtime and no mocking of `fs`, which is the only way these tests prove
 * anything about the actual OS semantics they are guarding against.
 */
export interface GuardContext {
  /** Allowlisted roots, absolute and already realpath-resolved. */
  readonly roots: readonly string[]
  /**
   * Locations that are refused even when they sit inside an allowlisted root:
   * OS directories, Program Files, Reigan's own userData and snapshot store.
   */
  readonly denyRoots: readonly string[]
  /**
   * Path *segments* that are refused at any depth (`.git`, `node_modules`).
   * Compared case-insensitively on case-insensitive platforms.
   */
  readonly denySegments: readonly string[]
  readonly platform: NodeJS.Platform
  /**
   * True only when the process has been verified long-path-aware (manifest +
   * registry opt-in on Windows). Defaults to false: assuming we are NOT
   * long-path-aware fails closed.
   */
  readonly longPathAware: boolean
}

// ── Allowlisted roots ───────────────────────────────────────────────────────

export type RootStatus = 'ok' | 'missing' | 'not_a_directory' | 'unreadable'

export interface AllowlistedRoot {
  readonly id: string
  /** The path exactly as the user picked it, for display. */
  readonly displayPath: string
  /** realpath-resolved form; this is what containment is checked against. */
  readonly resolvedPath: string
  readonly addedAt: string
  readonly status: RootStatus
  /** Set when status is not 'ok' — explains what the user needs to fix. */
  readonly statusDetail?: string
  /** User-flagged as protected: writes into it require extra confirmation. */
  readonly protected: boolean
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/** Lowercase hex sha-256. Named so signatures read unambiguously. */
export type Sha256 = string

// ── Planning ────────────────────────────────────────────────────────────────

export type OperationKind = 'move' | 'copy' | 'edit' | 'rename' | 'quarantine' | 'mixed'

export type PlannedOp = 'move' | 'copy' | 'rename' | 'edit' | 'quarantine' | 'mkdir'

export type CollisionKind = 'none' | 'target_exists' | 'case_only_conflict'

export type CollisionResolution = 'abort' | 'suffix' | 'overwrite_with_snapshot'

export interface PlannedItem {
  readonly op: PlannedOp
  readonly source: string
  readonly target?: string
  /** Required for 'edit' — pins the plan to the bytes the model actually read. */
  readonly sourceHashBefore?: Sha256
  /** For 'edit', the exact bytes to be written. */
  readonly newContent?: string
  readonly expectedSizeBytes: number
  readonly collision: CollisionKind
  readonly collisionResolution?: CollisionResolution
  readonly crossVolume: boolean
  readonly notes: readonly string[]
}

export interface OperationPlan {
  readonly planId: string
  readonly createdAt: string
  /** Default: 5 minutes after creation. A stale plan is an unvalidated plan. */
  readonly expiresAt: string
  /** The model's own natural-language statement of purpose, shown to the user. */
  readonly intent: string
  readonly operationKind: OperationKind
  readonly items: readonly PlannedItem[]
  readonly preflight: PreflightReport
  readonly reversible: boolean
  readonly planHash: Sha256
  readonly requiresElevatedConfirmation: boolean
}

// ── Preflight ───────────────────────────────────────────────────────────────

export type FindingSeverity = 'blocking' | 'warning' | 'info'

export type PreflightCode =
  | 'SOURCE_MISSING'
  | 'SOURCE_WRONG_TYPE'
  | 'SOURCE_UNREADABLE'
  | 'SOURCE_LOCKED'
  | 'HASH_DRIFT'
  | 'TARGET_PARENT_MISSING'
  | 'TARGET_EXISTS'
  | 'CASE_ONLY_COLLISION'
  | 'SELF_NESTING_MOVE'
  | 'DUPLICATE_TARGET'
  | 'MOVE_CYCLE'
  | 'PATH_REJECTED'
  | 'CROSS_VOLUME'
  | 'INSUFFICIENT_TARGET_SPACE'
  | 'INSUFFICIENT_SNAPSHOT_SPACE'
  | 'ITEM_COUNT_THRESHOLD'
  | 'PROTECTED_DIRECTORY'
  | 'PLAN_EXPIRED'
  | 'LARGE_CROSS_VOLUME_ROLLBACK_RISK'

export interface PreflightFinding {
  readonly code: PreflightCode
  readonly severity: FindingSeverity
  readonly message: string
  /** Index into `OperationPlan.items`; absent for batch-level findings. */
  readonly itemIndex?: number
  readonly path?: string
}

export interface PreflightReport {
  readonly ranAt: string
  readonly findings: readonly PreflightFinding[]
  /** True when no finding is `blocking`. The UI shows no approve button otherwise. */
  readonly approvable: boolean
  readonly totalBytesToWrite: number
  readonly estimatedSnapshotBytes: number
  /**
   * Directory listings captured before execution, keyed by directory path.
   * Postflight diffs against these to catch changes nobody planned.
   */
  readonly directoryFingerprints: Readonly<Record<string, readonly string[]>>
}

// ── Snapshot & rollback ─────────────────────────────────────────────────────

export type SnapshotStatus =
  | 'preparing'
  | 'executing'
  | 'committed'
  | 'rolled_back'
  | 'failed_dirty'

export type CaptureMethod = 'blob' | 'metadata_only'

export interface SnapshotEntry {
  readonly originalPath: string
  /** null for directories and for same-volume moves captured metadata-only. */
  readonly blobHash: Sha256 | null
  readonly sizeBytes: number
  readonly mtimeMs: number
  readonly mode: number
  readonly captureMethod: CaptureMethod
  readonly intendedTarget?: string
  /** Set true only after postflight verifies this specific entry. */
  applied: boolean
}

export interface SnapshotManifest {
  readonly batchId: string
  readonly createdAt: string
  status: SnapshotStatus
  readonly operationKind: OperationKind
  /** sha-256 of the canonicalized approved plan; binds manifest to approval. */
  readonly planHash: Sha256
  readonly entries: SnapshotEntry[]
  postflight?: PostflightResult
  error?: { readonly code: string; readonly message: string; readonly atEntry?: string }
}

// ── Postflight ──────────────────────────────────────────────────────────────

export type PostflightCode =
  | 'TARGET_MISSING'
  | 'TARGET_WRONG_TYPE'
  | 'SIZE_MISMATCH'
  | 'HASH_MISMATCH'
  | 'SOURCE_STILL_PRESENT'
  | 'COPY_SOURCE_ALTERED'
  | 'UNPLANNED_PATH_CHANGE'
  | 'PARSE_CHECK_FAILED'
  | 'ITEM_COUNT_MISMATCH'

export interface PostflightFinding {
  readonly code: PostflightCode
  readonly severity: FindingSeverity
  readonly message: string
  readonly path?: string
}

export interface PostflightResult {
  readonly ranAt: string
  readonly passed: boolean
  readonly findings: readonly PostflightFinding[]
  readonly itemsPlanned: number
  readonly itemsVerified: number
}

// ── Approval tokens ─────────────────────────────────────────────────────────

export interface ApprovalToken {
  readonly token: string
  readonly planId: string
  /** Bound to the plan's content hash, so an edited plan invalidates the token. */
  readonly planHash: Sha256
  readonly issuedAt: string
  readonly expiresAt: string
  /** The exact text the user typed, when a typed confirmation was required. */
  readonly typedConfirmation?: string
}

export type ApprovalResult =
  | { readonly approved: true; readonly token: string }
  | { readonly approved: false; readonly reason: string }

// ── Execution ───────────────────────────────────────────────────────────────

export type ExecutionErrorCode =
  | 'NO_TOKEN'
  | 'TOKEN_INVALID'
  | 'TOKEN_REUSED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_PLAN_MISMATCH'
  | 'PLAN_EXPIRED'
  | 'PLAN_NOT_FOUND'
  | 'PREFLIGHT_DRIFT'
  | 'SNAPSHOT_FAILED'
  | 'BATCH_IN_PROGRESS'
  | 'PATH_REJECTED'
  | 'IO_ERROR'
  | 'POSTFLIGHT_FAILED'
  | 'CANCELLED'

export interface ExecutionError {
  readonly code: ExecutionErrorCode
  readonly message: string
  readonly itemIndex?: number
  readonly path?: string
}

export type ItemOutcome = 'completed' | 'rolled_back' | 'not_attempted' | 'failed'

export interface ItemResult {
  readonly index: number
  readonly op: PlannedOp
  readonly source: string
  readonly target?: string
  readonly outcome: ItemOutcome
  readonly error?: ExecutionError
}

export interface BatchResult {
  readonly batchId: string
  readonly planId: string
  readonly status: SnapshotStatus
  readonly items: readonly ItemResult[]
  readonly postflight?: PostflightResult
  readonly error?: ExecutionError
}

export interface BatchProgressEvent {
  readonly batchId: string
  readonly phase: 'snapshot' | 'execute' | 'postflight' | 'rollback'
  readonly itemIndex: number
  readonly itemCount: number
  readonly path: string
}

// ── Quarantine ──────────────────────────────────────────────────────────────

export interface QuarantineEntry {
  readonly batchId: string
  readonly originalPath: string
  readonly quarantinePath: string
  readonly quarantinedAt: string
  readonly sizeBytes: number
  readonly blobHash: Sha256 | null
}

/** Thresholds above which stage-two confirmation escalates. Configurable downward only. */
export interface QuarantineThresholds {
  readonly maxItems: number
  readonly maxTotalBytes: number
  readonly maxDistinctDirectories: number
}

// ── Audit ───────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'plan_created'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'batch_started'
  | 'item_completed'
  | 'postflight_result'
  | 'rollback'
  | 'quarantine'
  | 'permanent_deletion'
  | 'root_added'
  | 'root_removed'

export interface AuditRecord {
  readonly at: string
  readonly type: AuditEventType
  readonly planId?: string
  readonly planHash?: Sha256
  readonly batchId?: string
  readonly path?: string
  /** The user's exact confirmation input, where one was typed. */
  readonly typedConfirmation?: string
  readonly detail?: string
}
