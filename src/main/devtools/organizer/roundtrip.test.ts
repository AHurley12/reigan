import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * The organiser's central promise, tested end to end: a plan can be executed
 * and then reversed, and every file comes back *by content*, not merely by
 * name. A test that checked filenames would pass while silently restoring
 * different bytes.
 *
 * Runs against a real temp directory and the real SQLite engine — the point is
 * to exercise actual filesystem semantics, which is precisely what a mocked
 * `fs` would not do.
 */

let workDir: string
let userData: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'reigan-org-'))
  userData = mkdtempSync(join(tmpdir(), 'reigan-data-'))
  process.env.REIGAN_TEST_USERDATA = userData
})

afterEach(async () => {
  // Windows will not unlink an open file, and the module-level connection is
  // still holding reigan.db. Closing it also stops the next test inheriting
  // this one's database through the cached singleton.
  const { closeDatabase } = await import('../../db/database')
  closeDatabase()
  rmSync(workDir, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(path)).digest('hex')
}

/** Imports fresh each time so the DB module picks up this test's userData. */
async function load() {
  const [{ getDatabase }, { runMigrations }, plan, execute, dupes] = await Promise.all([
    import('../../db/database'),
    import('../../db/migrations'),
    import('./plan'),
    import('./execute'),
    import('./duplicates'),
  ])
  const db = getDatabase()
  runMigrations(db)
  return { db, ...plan, ...execute, ...dupes }
}

function allowRoot(db: any, path: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO fileops_roots (id, display_path, resolved_path, added_at, is_protected) VALUES (?, ?, ?, ?, 0)'
  ).run(randomUUID(), path, resolve(path), Date.now())
}

describe('organiser round trip', () => {
  it('moves files by plan and restores every one by hash on undo', async () => {
    const { db, buildPlan, executePlan, undoRun } = await load()
    allowRoot(db, workDir)

    const originals: Record<string, string> = {
      'alpha.pdf': 'contents of alpha',
      'beta.pdf': 'contents of beta — different length entirely',
      'gamma.png': 'not a pdf, should not move',
    }
    for (const [name, body] of Object.entries(originals)) {
      await fsp.writeFile(join(workDir, name), body)
    }

    const before: Record<string, string> = {}
    for (const name of Object.keys(originals)) {
      before[name] = await sha256(join(workDir, name))
    }

    const plan = await buildPlan({
      scopePath: workDir,
      recursive: false,
      conditions: [{ kind: 'extension', values: ['.pdf'] }],
      actions: [{ kind: 'moveTo', destination: 'Docs/{yyyy}' }],
      collisionPolicy: 'rename',
    })

    expect(plan.ops).toHaveLength(2)
    expect(plan.ops.every((o) => o.type === 'move')).toBe(true)

    const run = await executePlan(plan)
    expect(run.executed).toBe(2)
    expect(run.failed).toEqual([])

    // Moved away...
    await expect(fsp.access(join(workDir, 'alpha.pdf'))).rejects.toThrow()
    // ...and the non-matching file untouched.
    await expect(fsp.access(join(workDir, 'gamma.png'))).resolves.toBeUndefined()

    const undo = await undoRun(run.runId)
    expect(undo.reversed).toBe(2)
    expect(undo.failed).toEqual([])

    // The actual assertion: same path AND same bytes.
    for (const name of ['alpha.pdf', 'beta.pdf']) {
      expect(await sha256(join(workDir, name)), name).toBe(before[name])
    }
  })

  it('refuses to plan against a folder that is not an allowlisted root', async () => {
    const { buildPlan } = await load()
    // Deliberately not allowlisted.
    await expect(
      buildPlan({
        scopePath: 'C:\\Windows',
        recursive: false,
        conditions: [{ kind: 'extension', values: ['.dll'] }],
        actions: [{ kind: 'trash' }],
        collisionPolicy: 'skip',
      })
    ).rejects.toThrow(/Cannot plan against/i)
  })

  it('refuses a deny-rooted path even when a parent root is allowlisted', async () => {
    const { db, buildPlan } = await load()
    // Allowlist the drive root, then aim at Windows inside it. Containment
    // alone must not be enough to reach a denied location.
    allowRoot(db, 'C:\\')
    await expect(
      buildPlan({
        scopePath: 'C:\\Windows\\System32',
        recursive: false,
        conditions: [{ kind: 'extension', values: ['.dll'] }],
        actions: [{ kind: 'trash' }],
        collisionPolicy: 'skip',
      })
    ).rejects.toThrow()
  })

  it('marks a run reversible only while it has un-reversed operations', async () => {
    const { db, buildPlan, executePlan, undoRun, listRuns } = await load()
    allowRoot(db, workDir)
    await fsp.writeFile(join(workDir, 'one.log'), 'x')

    const plan = await buildPlan({
      scopePath: workDir,
      recursive: false,
      conditions: [{ kind: 'extension', values: ['.log'] }],
      actions: [{ kind: 'moveTo', destination: 'Logs' }],
      collisionPolicy: 'rename',
    })
    const run = await executePlan(plan)

    expect(listRuns().find((r: any) => r.id === run.runId)?.reversible).toBe(true)
    await undoRun(run.runId)
    expect(listRuns().find((r: any) => r.id === run.runId)?.reversible).toBe(false)
  })
})

describe('duplicate detection', () => {
  it('finds an identical pair and ignores same-size files that differ', async () => {
    const { db, findDuplicates } = await load()
    allowRoot(db, workDir)

    // Identical content, different names.
    await fsp.writeFile(join(workDir, 'copy-a.bin'), 'X'.repeat(4096))
    await fsp.writeFile(join(workDir, 'copy-b.bin'), 'X'.repeat(4096))
    // Same size as each other, different bytes — the false-positive trap that
    // a size-only comparison would fall into.
    await fsp.writeFile(join(workDir, 'same-size-1.bin'), 'A'.repeat(2048))
    await fsp.writeFile(join(workDir, 'same-size-2.bin'), 'B'.repeat(2048))

    const report = await findDuplicates({ scopePath: workDir, minSizeBytes: 1 })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].files.map((f) => f.path).sort()).toEqual(
      [join(workDir, 'copy-a.bin'), join(workDir, 'copy-b.bin')].sort()
    )
    expect(report.groups[0].wastedBytes).toBe(4096)
  })

  it('detects duplicates larger than the head+tail window', async () => {
    const { db, findDuplicates } = await load()
    allowRoot(db, workDir)

    // 200KB: past the 128KB small-file shortcut and the 64KB head/tail reads,
    // so this exercises the full three-stage cascade rather than the shortcut.
    const body = Buffer.alloc(200 * 1024, 7)
    await fsp.writeFile(join(workDir, 'big-1.bin'), body)
    await fsp.writeFile(join(workDir, 'big-2.bin'), body)

    // Same size, identical head and tail, different middle — the case the
    // cheap digest cannot distinguish and the full hash must.
    const tricky = Buffer.alloc(200 * 1024, 7)
    tricky.write('different', 100 * 1024)
    await fsp.writeFile(join(workDir, 'big-3.bin'), tricky)

    const report = await findDuplicates({ scopePath: workDir, minSizeBytes: 1 })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0].files).toHaveLength(2)
    expect(report.groups[0].files.map((f) => f.path)).not.toContain(join(workDir, 'big-3.bin'))
  })
})
