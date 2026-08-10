import { promises as fsp } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { getGuardContext } from '../../fileops/allowlist'
import { guardPath } from '../../fileops/pathGuard'
import {
  expandTokens,
  matchesRule,
  mimeFamilyFor,
  type Action,
  type CollisionPolicy,
  type Condition,
  type DescribedFile,
} from './rules'

/**
 * Planning: turn a rule into an explicit, reviewable list of atomic operations.
 *
 * Nothing here writes. A plan is a value the user reads before anything
 * happens, which is the whole safety model for this feature — the destructive
 * step is a separate capability that consumes a plan, so "what would you clean
 * up in Downloads?" is answerable in full with no risk at all.
 */

export type OpType = 'move' | 'rename' | 'copy' | 'trash' | 'mkdir' | 'tag' | 'flag'

export interface PlannedOp {
  type: OpType
  sourcePath: string
  destPath?: string
  sizeBytes: number
  /** Why this file matched, in plain language, for the review UI. */
  note?: string
}

export interface Plan {
  scopePath: string
  ops: PlannedOp[]
  /** Files that matched but could not be planned, with the reason. */
  skipped: Array<{ path: string; reason: string }>
  totalBytes: number
  filesConsidered: number
  /** Distinct destination directories the plan would create or write into. */
  destinations: string[]
  truncated: boolean
}

/** A plan larger than this is almost certainly a mistargeted rule. */
const MAX_OPS = 5000

async function describe(path: string): Promise<DescribedFile | null> {
  try {
    const stat = await fsp.stat(path)
    if (!stat.isFile()) return null
    const name = basename(path)
    return {
      path,
      name,
      ext: extname(name),
      sizeBytes: stat.size,
      // birthtimeMs is unreliable on some Windows filesystems and comes back
      // as 0; falling back to mtime keeps age conditions meaningful rather
      // than making every such file look like it was created in 1970.
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      modifiedAt: stat.mtimeMs,
      mimeFamily: mimeFamilyFor(name),
    }
  } catch {
    return null
  }
}

async function listFiles(scope: string, recursive: boolean): Promise<string[]> {
  const out: string[] = []
  const stack = [scope]

  while (stack.length > 0 && out.length < MAX_OPS * 4) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (recursive) stack.push(full)
        continue
      }
      if (entry.isFile()) out.push(full)
    }
  }

  return out
}

/**
 * Resolves a destination that does not collide with an existing file.
 *
 * `rename` appends " (2)", " (3)" and so on. Note this checks the filesystem
 * only — two operations in the same plan targeting the same new name would
 * still collide, so the planner also tracks claimed destinations.
 */
async function resolveCollision(
  destPath: string,
  policy: CollisionPolicy,
  claimed: Set<string>
): Promise<{ path: string; skip: boolean }> {
  const taken = async (p: string): Promise<boolean> => {
    if (claimed.has(p.toLowerCase())) return true
    try {
      await fsp.access(p)
      return true
    } catch {
      return false
    }
  }

  if (!(await taken(destPath))) return { path: destPath, skip: false }
  if (policy === 'skip') return { path: destPath, skip: true }
  if (policy === 'overwrite') return { path: destPath, skip: false }

  const dir = dirname(destPath)
  const ext = extname(destPath)
  const stem = basename(destPath, ext)
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = join(dir, `${stem} (${counter})${ext}`)
    if (!(await taken(candidate))) return { path: candidate, skip: false }
  }
  return { path: destPath, skip: true }
}

export interface PlanParams {
  scopePath: string
  recursive: boolean
  conditions: Condition[]
  actions: Action[]
  collisionPolicy: CollisionPolicy
  duplicatesByPath?: Map<string, string>
}

export async function buildPlan(params: PlanParams): Promise<Plan> {
  const ctx = await getGuardContext()

  // The scope itself must be allowlisted before anything is even listed. This
  // is what makes a plan against C:\Windows impossible rather than merely
  // unexecuted — refusing at plan time means the paths never enter a plan the
  // user could later approve.
  const scopeGuard = await guardPath(params.scopePath, ctx)
  if (!scopeGuard.ok) {
    throw new Error(
      `Cannot plan against ${params.scopePath}: ${scopeGuard.error.message} ` +
        'Add the folder as a managed root in Dev Tools settings if you want REIGAN to organise it.'
    )
  }

  const scope = resolve(params.scopePath)
  const files = await listFiles(scope, params.recursive)

  const ops: PlannedOp[] = []
  const skipped: Array<{ path: string; reason: string }> = []
  const claimed = new Set<string>()
  const destinations = new Set<string>()
  let totalBytes = 0
  let truncated = false

  for (const path of files) {
    if (ops.length >= MAX_OPS) {
      truncated = true
      break
    }

    const described = await describe(path)
    if (!described) continue

    const dup = params.duplicatesByPath?.get(path.toLowerCase())
    if (dup) described.duplicateOf = dup

    if (!matchesRule(described, params.conditions)) continue

    for (const action of params.actions) {
      const planned = await planAction(action, described, params.collisionPolicy, claimed, ctx, scope)
      if ('reason' in planned) {
        skipped.push({ path, reason: planned.reason })
        continue
      }
      if (planned.op.destPath) {
        claimed.add(planned.op.destPath.toLowerCase())
        destinations.add(dirname(planned.op.destPath))
      }
      totalBytes += planned.op.sizeBytes
      ops.push(planned.op)
    }
  }

  return {
    scopePath: scope,
    ops,
    skipped,
    totalBytes,
    filesConsidered: files.length,
    destinations: [...destinations].sort(),
    truncated,
  }
}

type PlannedOrSkipped = { op: PlannedOp } | { reason: string }

async function planAction(
  action: Action,
  file: DescribedFile,
  policy: CollisionPolicy,
  claimed: Set<string>,
  ctx: Awaited<ReturnType<typeof getGuardContext>>,
  scope: string
): Promise<PlannedOrSkipped> {
  switch (action.kind) {
    case 'trash':
      return {
        op: { type: 'trash', sourcePath: file.path, sizeBytes: file.sizeBytes, note: 'to Recycle Bin' },
      }

    case 'tag':
      return { op: { type: 'tag', sourcePath: file.path, sizeBytes: 0, note: `tag "${action.tag}"` } }

    case 'flagForReview':
      return {
        op: {
          type: 'flag',
          sourcePath: file.path,
          sizeBytes: 0,
          note: file.duplicateOf ? `duplicate of ${file.duplicateOf}` : 'flagged',
        },
      }

    case 'moveTo':
    case 'copyTo': {
      // A relative destination is interpreted inside the scope, which is what
      // "sort Downloads into Images/2026/08" means. An absolute one is taken
      // literally and still has to survive the guard.
      const expanded = expandTokens(action.destination, file)
      const targetDir = /^[a-z]:[\\/]|^[\\/]/i.test(expanded) ? expanded : join(scope, expanded)
      const desired = join(targetDir, file.name)

      const guard = await guardPath(desired, ctx)
      if (!guard.ok) return { reason: `destination refused — ${guard.error.message}` }

      const resolved = await resolveCollision(desired, policy, claimed)
      if (resolved.skip) return { reason: 'a file already exists there' }

      return {
        op: {
          type: action.kind === 'moveTo' ? 'move' : 'copy',
          sourcePath: file.path,
          destPath: resolved.path,
          sizeBytes: file.sizeBytes,
          note: resolved.path === desired ? undefined : 'renamed to avoid a collision',
        },
      }
    }

    case 'renameTo': {
      const newName = expandTokens(action.pattern, file)
      const desired = join(dirname(file.path), newName)

      const guard = await guardPath(desired, ctx)
      if (!guard.ok) return { reason: `new name refused — ${guard.error.message}` }

      const resolved = await resolveCollision(desired, policy, claimed)
      if (resolved.skip) return { reason: 'a file already exists with that name' }

      return {
        op: { type: 'rename', sourcePath: file.path, destPath: resolved.path, sizeBytes: file.sizeBytes },
      }
    }

    default:
      return { reason: 'unsupported action' }
  }
}

/** One-line human summary, used in the approval card and by the model. */
export function describePlan(plan: Plan): string {
  if (plan.ops.length === 0) {
    return `Nothing to do in ${plan.scopePath} — ${plan.filesConsidered} file(s) considered, none matched.`
  }

  const counts = new Map<OpType, number>()
  for (const op of plan.ops) counts.set(op.type, (counts.get(op.type) ?? 0) + 1)

  const parts = [...counts.entries()].map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`)
  const mb = (plan.totalBytes / 1048576).toFixed(1)

  return (
    `${plan.ops.length} operation(s) in ${plan.scopePath}: ${parts.join(', ')} — ${mb} MB affected, ` +
    `across ${plan.destinations.length} destination folder(s). ` +
    `${plan.filesConsidered} file(s) considered${plan.skipped.length ? `, ${plan.skipped.length} skipped` : ''}` +
    `${plan.truncated ? ' (plan truncated at 5000 operations)' : ''}.`
  )
}
