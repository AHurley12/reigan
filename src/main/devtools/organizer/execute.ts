import { promises as fsp } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import { shell } from 'electron'
import { getDatabase } from '../../db/database'
import { getGuardContext } from '../../fileops/allowlist'
import { guardPath } from '../../fileops/pathGuard'
import { sha256File } from '../../fileops/hash'
import { recordAppError } from '../../errors/errorLog'
import type { Plan, PlannedOp } from './plan'

/**
 * Execution and undo.
 *
 * Every operation is re-guarded at execution time, not trusted from the plan.
 * A plan is data that may have sat in an approval queue for a while, and the
 * filesystem can have changed under it — re-checking is the difference between
 * approving a plan and approving whatever that plan resolves to later.
 *
 * Deletes go to the Recycle Bin via shell.trashItem. There is no unlink path
 * anywhere in this module, deliberately: with a journal that records a
 * checksum, every operation this feature performs is reversible.
 */

export interface ExecuteResult {
  runId: string
  executed: number
  failed: Array<{ path: string; error: string }>
  bytesMoved: number
}

export async function executePlan(
  plan: Plan,
  options: { ruleId?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<ExecuteResult> {
  const db = getDatabase()
  const ctx = await getGuardContext()
  const runId = randomUUID()
  const startedAt = Date.now()

  db.prepare(
    `INSERT INTO organizer_runs (id, rule_id, started_at, mode, ops_planned, status)
     VALUES (?, ?, ?, 'execute', ?, 'running')`
  ).run(runId, options.ruleId ?? null, startedAt, plan.ops.length)

  const journal = db.prepare(
    `INSERT INTO organizer_journal (id, run_id, op_type, source_path, dest_path, executed_at, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  const failed: ExecuteResult['failed'] = []
  let executed = 0
  let bytesMoved = 0

  for (const [index, op] of plan.ops.entries()) {
    if (options.signal?.aborted) break
    options.onProgress?.(index, plan.ops.length)

    try {
      const checksum = await executeOp(op, ctx)
      journal.run(
        randomUUID(),
        runId,
        op.type,
        op.sourcePath,
        op.destPath ?? null,
        Date.now(),
        checksum
      )
      executed += 1
      if (op.type === 'move' || op.type === 'copy') bytesMoved += op.sizeBytes
    } catch (err) {
      failed.push({ path: op.sourcePath, error: err instanceof Error ? err.message : String(err) })
      // The run itself still succeeds, so nothing downstream will ever see
      // this. Without a durable record, "the organiser said it moved them but
      // three are still there" is unanswerable after the result is discarded.
      recordAppError({
        source: 'organizer',
        operation: 'executeOp',
        error: err,
        subject: op.sourcePath,
        context: { runId, opType: op.type, destPath: op.destPath ?? null },
      })
    }
  }

  db.prepare(
    `UPDATE organizer_runs
     SET finished_at = ?, ops_executed = ?, bytes_moved = ?, status = ?, error = ?
     WHERE id = ?`
  ).run(
    Date.now(),
    executed,
    bytesMoved,
    failed.length === 0 ? 'success' : 'partial',
    failed.length ? `${failed.length} operation(s) failed` : null,
    runId
  )

  if (options.ruleId) {
    db.prepare(
      'UPDATE organizer_rules SET last_run_at = ?, files_affected_total = files_affected_total + ? WHERE id = ?'
    ).run(Date.now(), executed, options.ruleId)
  }

  return { runId, executed, failed, bytesMoved }
}

async function executeOp(op: PlannedOp, ctx: Awaited<ReturnType<typeof getGuardContext>>): Promise<string | null> {
  const sourceGuard = await guardPath(op.sourcePath, ctx)
  if (!sourceGuard.ok) throw new Error(`source refused — ${sourceGuard.error.message}`)

  // Hashed before the move so undo can prove the file it puts back is the
  // file that was taken. Comparing names would call a same-named different
  // file a successful restore.
  const checksum =
    op.type === 'move' || op.type === 'rename' ? await sha256File(sourceGuard.path).catch(() => null) : null

  if (op.type === 'trash') {
    await shell.trashItem(op.sourcePath)
    return checksum
  }

  if (op.type === 'tag' || op.type === 'flag') {
    // Recorded in the journal only. Tagging deliberately does not touch the
    // file: writing metadata into the filesystem would be a mutation the user
    // did not ask for and cannot easily see.
    return null
  }

  if (!op.destPath) throw new Error('operation has no destination')
  const destGuard = await guardPath(op.destPath, ctx)
  if (!destGuard.ok) throw new Error(`destination refused — ${destGuard.error.message}`)

  await fsp.mkdir(dirname(op.destPath), { recursive: true })

  if (op.type === 'copy') {
    await fsp.copyFile(op.sourcePath, op.destPath)
    return checksum
  }

  // move / rename. rename() fails across volumes with EXDEV, where the only
  // correct answer is copy-then-delete.
  try {
    await fsp.rename(op.sourcePath, op.destPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fsp.copyFile(op.sourcePath, op.destPath)
    await shell.trashItem(op.sourcePath)
  }
  return checksum
}

export interface UndoResult {
  runId: string
  reversed: number
  failed: Array<{ path: string; reason: string }>
  /** Reversed but with different content than when it was moved. */
  checksumMismatches: string[]
}

/**
 * Reverses a run.
 *
 * Trashed files are *not* restored automatically: the Recycle Bin has no
 * scriptable restore-by-path on Windows that is safe to rely on, and pretending
 * otherwise would report a success that did not happen. They are reported so
 * the user can restore them from the bin themselves, which takes one click and
 * is honest.
 */
export async function undoRun(runId: string): Promise<UndoResult> {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT * FROM organizer_journal
       WHERE run_id = ? AND reversed_at IS NULL
       ORDER BY executed_at DESC`
    )
    .all(runId) as any[]

  if (rows.length === 0) {
    throw new Error(`Run ${runId} has nothing left to reverse.`)
  }

  const ctx = await getGuardContext()
  const markReversed = db.prepare('UPDATE organizer_journal SET reversed_at = ? WHERE id = ?')

  const failed: UndoResult['failed'] = []
  const checksumMismatches: string[] = []
  let reversed = 0

  for (const row of rows) {
    const { op_type: opType, source_path: sourcePath, dest_path: destPath, checksum } = row

    try {
      if (opType === 'trash') {
        failed.push({
          path: sourcePath,
          reason: 'sent to the Recycle Bin — restore it from there',
        })
        continue
      }

      if (opType === 'tag' || opType === 'flag') {
        markReversed.run(Date.now(), row.id)
        reversed += 1
        continue
      }

      if (opType === 'copy') {
        // The original was never touched; undoing means removing the copy.
        if (destPath) await shell.trashItem(destPath)
        markReversed.run(Date.now(), row.id)
        reversed += 1
        continue
      }

      if (!destPath) throw new Error('journal row has no destination to reverse')

      const guard = await guardPath(destPath, ctx)
      if (!guard.ok) throw new Error(guard.error.message)

      if (checksum) {
        const current = await sha256File(guard.path).catch(() => null)
        if (current && current !== checksum) {
          // Still restored — the user's edit is more valuable where they can
          // find it — but reported, because silently moving a changed file
          // back would hide that the change happened.
          checksumMismatches.push(destPath)
        }
      }

      await fsp.mkdir(dirname(sourcePath), { recursive: true })
      await fsp.rename(destPath, sourcePath)
      markReversed.run(Date.now(), row.id)
      reversed += 1
    } catch (err) {
      failed.push({ path: destPath ?? sourcePath, reason: err instanceof Error ? err.message : String(err) })
      // A failed undo is the worst outcome this feature has — the file is
      // neither where it started nor where the user asked it back to — so it
      // is logged as fatal rather than error.
      recordAppError({
        source: 'organizer',
        operation: 'undoOp',
        error: err,
        subject: destPath ?? sourcePath,
        severity: 'fatal',
        context: { runId, opType, sourcePath, destPath },
      })
    }
  }

  return { runId, reversed, failed, checksumMismatches }
}

export interface RunRow {
  id: string
  ruleId: string | null
  startedAt: number
  finishedAt: number | null
  mode: string
  opsPlanned: number
  opsExecuted: number
  bytesMoved: number
  status: string
  reversible: boolean
}

export function listRuns(limit = 50): RunRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM organizer_journal j
                WHERE j.run_id = r.id AND j.reversed_at IS NULL
                  AND j.op_type IN ('move','rename','copy')) AS pending
       FROM organizer_runs r
       ORDER BY r.started_at DESC LIMIT ?`
    )
    .all(Math.min(limit, 200)) as any[]

  return rows.map((r) => ({
    id: r.id,
    ruleId: r.rule_id ?? null,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    mode: r.mode,
    opsPlanned: r.ops_planned,
    opsExecuted: r.ops_executed,
    bytesMoved: r.bytes_moved,
    status: r.status,
    reversible: r.pending > 0,
  }))
}
