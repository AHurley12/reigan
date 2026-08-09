/**
 * Path guard test suite (§12).
 *
 * These tests deliberately use a *real* temp-directory fixture with real
 * junctions and real symlinks rather than mocking `fs`. The whole point of the
 * guard is that it survives actual operating-system path semantics; a mocked
 * `realpath` would only ever prove that the mock agrees with the guard.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { guardPath } from '../pathGuard'
import type { GuardContext, PathGuardResult } from '../types'

const isWindows = process.platform === 'win32'

let base = ''
let rootDir = ''
let outsideDir = ''
let snapshotStore = ''
let docsDir = ''
let docsPrivateDir = ''

/** Narrowing helpers — keep the assertions readable and type-safe. */
function expectRejected(result: PathGuardResult): asserts result is Extract<PathGuardResult, { ok: false }> {
  expect(result.ok).toBe(false)
}
function expectAccepted(result: PathGuardResult): asserts result is Extract<PathGuardResult, { ok: true }> {
  if (!result.ok) throw new Error(`Expected acceptance but got ${result.error.code}: ${result.error.message}`)
}

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    roots: [rootDir],
    denyRoots: [snapshotStore],
    denySegments: ['.git', 'node_modules'],
    platform: process.platform,
    longPathAware: false,
    ...overrides,
  }
}

beforeAll(async () => {
  // realpath the temp base: on some systems os.tmpdir() is itself a symlink
  // (notably /var -> /private/var on macOS), which would make every containment
  // assertion below fail for reasons that have nothing to do with the guard.
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reigan-guard-')))

  rootDir = path.join(base, 'AllowedRoot')
  outsideDir = path.join(base, 'Outside')
  // Deliberately nested INSIDE the allowlisted root, to prove the snapshot
  // store is protected by the deny list rather than by happening to live
  // somewhere the allowlist does not reach.
  snapshotStore = path.join(rootDir, 'reigan-snapshots')
  docsDir = path.join(base, 'Docs')
  docsPrivateDir = path.join(base, 'Docs-Private')

  await fs.mkdir(rootDir)
  await fs.mkdir(outsideDir)
  await fs.mkdir(snapshotStore, { recursive: true })
  await fs.mkdir(docsDir)
  await fs.mkdir(docsPrivateDir)
  await fs.mkdir(path.join(rootDir, 'project', 'src'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'project', 'node_modules', 'pkg'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'project', '.git', 'refs'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'MiXeDCase'))

  await fs.writeFile(path.join(rootDir, 'notes.txt'), 'hello')
  await fs.writeFile(path.join(rootDir, 'project', 'src', 'index.ts'), 'export {}')
  await fs.writeFile(path.join(rootDir, 'project', 'node_modules', 'pkg', 'index.js'), '// pkg')
  await fs.writeFile(path.join(rootDir, 'project', '.git', 'config'), '[core]')
  await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'classified')
  await fs.writeFile(path.join(docsPrivateDir, 'salary.txt'), 'confidential')
  await fs.writeFile(path.join(snapshotStore, 'blob'), 'snapshot data')
})

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true }).catch(() => undefined)
})

// ── Input shape ─────────────────────────────────────────────────────────────

describe('input rejection', () => {
  it('rejects an empty path', async () => {
    const result = await guardPath('', ctx())
    expectRejected(result)
    expect(result.error.code).toBe('EMPTY_PATH')
  })

  it('rejects relative paths', async () => {
    for (const input of ['relative/file.txt', './file.txt', '../file.txt', 'file.txt']) {
      const result = await guardPath(input, ctx())
      expectRejected(result)
      expect(result.error.code).toBe('NOT_ABSOLUTE')
    }
  })

  it('rejects an unexpanded ~ rather than guessing what it means', async () => {
    // Expansion belongs upstream where it is visible; the guard must not
    // silently invent a home directory for a path it was handed literally.
    const result = await guardPath('~/Documents/file.txt', ctx())
    expectRejected(result)
    expect(result.error.code).toBe('NOT_ABSOLUTE')
  })

  it.runIf(isWindows)('rejects drive-relative paths that only look absolute', async () => {
    // path.isAbsolute('/foo') is true on Windows, but it resolves against
    // whatever drive the process happens to be on — not a location anyone approved.
    for (const input of ['/Windows/System32', '\\Windows\\System32', 'C:notabsolute']) {
      const result = await guardPath(input, ctx())
      expectRejected(result)
      expect(result.error.code).toBe('NOT_ABSOLUTE')
    }
  })

  it('rejects NUL bytes', async () => {
    // "report.pdf\0.exe" can be shown to a user as one thing and opened as another.
    const result = await guardPath(`${path.join(rootDir, 'report.pdf')}\0.exe`, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('NUL_BYTE')
  })

  it('rejects other control characters', async () => {
    const result = await guardPath(path.join(rootDir, 'we\u0007ird.txt'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('CONTROL_CHARS')
  })
})

// ── Allowlist containment ───────────────────────────────────────────────────

describe('containment', () => {
  it('refuses everything when no roots are configured', async () => {
    // The shipped default. An empty allowlist is not "allow all".
    const result = await guardPath(path.join(rootDir, 'notes.txt'), ctx({ roots: [] }))
    expectRejected(result)
    expect(result.error.code).toBe('NO_ROOTS_CONFIGURED')
  })

  it('accepts a file inside an allowlisted root', async () => {
    const result = await guardPath(path.join(rootDir, 'notes.txt'), ctx())
    expectAccepted(result)
    expect(result.path).toBe(path.join(rootDir, 'notes.txt'))
    expect(result.root).toBe(rootDir)
  })

  it('accepts the root itself', async () => {
    const result = await guardPath(rootDir, ctx())
    expectAccepted(result)
    expect(result.path).toBe(rootDir)
  })

  it('accepts a target that does not exist yet', async () => {
    // The common create/move-destination case: resolving the full path would
    // throw ENOENT, so the guard resolves the deepest existing ancestor instead.
    const target = path.join(rootDir, 'newfolder', 'newfile.txt')
    const result = await guardPath(target, ctx())
    expectAccepted(result)
    expect(result.path).toBe(target)
  })

  it('rejects a path outside every root', async () => {
    const result = await guardPath(path.join(outsideDir, 'secret.txt'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('rejects .. traversal that escapes the root', async () => {
    const escape = path.join(rootDir, '..', 'Outside', 'secret.txt')
    const result = await guardPath(escape, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('rejects deeply nested .. traversal', async () => {
    const escape = path.join(rootDir, 'project', 'src', '..', '..', '..', 'Outside', 'secret.txt')
    const result = await guardPath(escape, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('rejects the Docs vs Docs-Private prefix trap', async () => {
    // The reason containment uses path.relative() and never startsWith().
    expect(docsPrivateDir.startsWith(docsDir)).toBe(true) // a naive guard would allow this

    const result = await guardPath(path.join(docsPrivateDir, 'salary.txt'), ctx({ roots: [docsDir] }))
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('still accepts a legitimately contained name beginning with dots', async () => {
    // Guards against over-correcting the trap above with a bare
    // rel.startsWith('..'), which would reject a contained "..config".
    const target = path.join(rootDir, '..config')
    const result = await guardPath(target, ctx())
    expectAccepted(result)
    expect(result.path).toBe(target)
  })

  it.runIf(isWindows)('rejects a path on a different drive', async () => {
    const otherDrive = rootDir.startsWith('C:') ? 'D:\\data\\file.txt' : 'C:\\data\\file.txt'
    const result = await guardPath(otherDrive, ctx())
    expectRejected(result)
    // Either the drive does not exist (unresolvable) or it does and is outside
    // every root. Both are refusals; both are correct.
    expect(['OUTSIDE_ROOTS', 'REALPATH_FAILED']).toContain(result.error.code)
  })
})

// ── Link escapes ────────────────────────────────────────────────────────────

describe('symlink and junction escapes', () => {
  it.runIf(isWindows)('rejects a path through a directory junction pointing outside the root', async () => {
    const junction = path.join(rootDir, 'escape-junction')
    await fs.symlink(outsideDir, junction, 'junction')

    const result = await guardPath(path.join(junction, 'secret.txt'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it.runIf(isWindows)('rejects a NEW file created through an escaping junction', async () => {
    // The dangerous variant: the target does not exist, so the guard only
    // learns where it would land by resolving the junction partway down.
    const junction = path.join(rootDir, 'escape-junction-2')
    await fs.symlink(outsideDir, junction, 'junction')

    const result = await guardPath(path.join(junction, 'does-not-exist-yet.txt'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('rejects a symlinked file pointing outside the root', async () => {
    const link = path.join(rootDir, 'escape-link.txt')
    try {
      await fs.symlink(path.join(outsideDir, 'secret.txt'), link, 'file')
    } catch (err) {
      // Windows needs Developer Mode or admin for file symlinks; junction
      // coverage above is the load-bearing case there.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return
      throw err
    }

    const result = await guardPath(link, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('OUTSIDE_ROOTS')
  })

  it('accepts a link that stays inside the root', async () => {
    const link = path.join(rootDir, 'inside-link.txt')
    try {
      await fs.symlink(path.join(rootDir, 'notes.txt'), link, 'file')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return
      throw err
    }

    const result = await guardPath(link, ctx())
    expectAccepted(result)
    // Resolved to its target, not left as the link path — later checks (and the
    // executor) must operate on the real file.
    expect(result.path).toBe(path.join(rootDir, 'notes.txt'))
  })
})

// ── Case sensitivity ────────────────────────────────────────────────────────

describe('case handling', () => {
  it.runIf(isWindows || process.platform === 'darwin')(
    'treats a differently-cased root as the same root',
    async () => {
      const result = await guardPath(path.join(rootDir, 'notes.txt'), ctx({ roots: [rootDir.toUpperCase()] }))
      expectAccepted(result)
    }
  )

  it.runIf(isWindows || process.platform === 'darwin')(
    'accepts a differently-cased path within the root',
    async () => {
      const result = await guardPath(path.join(rootDir, 'NOTES.TXT'), ctx())
      expectAccepted(result)
      // realpath reports the true on-disk casing, which is what makes
      // collision detection between Report.pdf and report.pdf possible later.
      expect(result.path).toBe(path.join(rootDir, 'notes.txt'))
    }
  )

  it.runIf(isWindows || process.platform === 'darwin')(
    'canonicalises directory casing so two spellings produce one path',
    async () => {
      const lower = await guardPath(path.join(rootDir, 'mixedcase'), ctx())
      const upper = await guardPath(path.join(rootDir, 'MIXEDCASE'), ctx())
      expectAccepted(lower)
      expectAccepted(upper)
      expect(lower.path).toBe(upper.path)
      expect(lower.path).toBe(path.join(rootDir, 'MiXeDCase'))
    }
  )
})

// ── Deny lists ──────────────────────────────────────────────────────────────

describe('deny lists', () => {
  it('protects the snapshot store even though it sits inside an allowlisted root', async () => {
    // If a plan could reach the snapshot store, a batch could destroy the very
    // backups that exist to undo it.
    const result = await guardPath(snapshotStore, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('protects files inside the snapshot store', async () => {
    const result = await guardPath(path.join(snapshotStore, 'blob'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('protects a not-yet-existing path inside the snapshot store', async () => {
    const result = await guardPath(path.join(snapshotStore, 'objects', 'ab', 'cdef'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('rejects node_modules at any depth', async () => {
    const result = await guardPath(path.join(rootDir, 'project', 'node_modules', 'pkg', 'index.js'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('rejects .git internals at any depth', async () => {
    const result = await guardPath(path.join(rootDir, 'project', '.git', 'config'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('rejects arbitrary deny roots such as a system directory', async () => {
    const systemish = path.join(base, 'FakeWindows')
    await fs.mkdir(systemish, { recursive: true })
    const result = await guardPath(path.join(systemish, 'system32', 'kernel32.dll'), {
      ...ctx({ roots: [base] }),
      denyRoots: [snapshotStore, systemish],
    })
    expectRejected(result)
    expect(result.error.code).toBe('DENIED_LOCATION')
  })

  it('accepts an ordinary project file that trips none of the deny rules', async () => {
    const result = await guardPath(path.join(rootDir, 'project', 'src', 'index.ts'), ctx())
    expectAccepted(result)
  })
})

// ── Windows name semantics ──────────────────────────────────────────────────

describe.runIf(isWindows)('Windows filename semantics', () => {
  it('rejects reserved device names', async () => {
    for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
      const result = await guardPath(path.join(rootDir, name), ctx())
      expectRejected(result)
      expect(result.error.code).toBe('RESERVED_DEVICE_NAME')
    }
  })

  it('rejects reserved device names carrying an extension', async () => {
    for (const name of ['CON.txt', 'com1.log', 'NUL.pdf']) {
      const result = await guardPath(path.join(rootDir, name), ctx())
      expectRejected(result)
      expect(result.error.code).toBe('RESERVED_DEVICE_NAME')
    }
  })

  it('rejects a reserved name in a directory segment, not just the filename', async () => {
    const result = await guardPath(path.join(rootDir, 'AUX', 'report.pdf'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('RESERVED_DEVICE_NAME')
  })

  it('does not over-block names that merely start with a reserved word', async () => {
    for (const name of ['CONSOLE.txt', 'COM10.log', 'PRINTER.doc', 'AUXILIARY']) {
      const result = await guardPath(path.join(rootDir, name), ctx())
      expectAccepted(result)
    }
  })

  it('rejects trailing dots and spaces', async () => {
    // Windows strips these silently, so "create notes.txt." would overwrite notes.txt.
    for (const name of ['notes.txt.', 'notes.txt ', 'report.', 'report ']) {
      const result = await guardPath(path.join(rootDir, name), ctx())
      expectRejected(result)
      expect(result.error.code).toBe('TRAILING_DOT_OR_SPACE')
    }
  })

  it('rejects a trailing space in a directory segment', async () => {
    const result = await guardPath(path.join(rootDir, 'folder ', 'file.txt'), ctx())
    expectRejected(result)
    expect(result.error.code).toBe('TRAILING_DOT_OR_SPACE')
  })

  it('warns as a path approaches MAX_PATH', async () => {
    const target = buildPathOfLength(rootDir, 250)
    const result = await guardPath(target, ctx())
    expectAccepted(result)
    expect(result.warnings.map((w) => w.code)).toContain('PATH_LENGTH_NEAR_LIMIT')
  })

  it('rejects a path beyond MAX_PATH', async () => {
    const target = buildPathOfLength(rootDir, 300)
    const result = await guardPath(target, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('PATH_TOO_LONG')
  })

  it('allows a long path when the process is verified long-path-aware', async () => {
    const target = buildPathOfLength(rootDir, 300)
    const result = await guardPath(target, ctx({ longPathAware: true }))
    expectAccepted(result)
  })

  it('does not warn for an ordinary short path', async () => {
    const result = await guardPath(path.join(rootDir, 'notes.txt'), ctx())
    expectAccepted(result)
    expect(result.warnings).toHaveLength(0)
  })
})

// ── Resolution failures ─────────────────────────────────────────────────────

describe('resolution', () => {
  it('resolves through an ancestor that is a file rather than failing closed', async () => {
    // ENOTDIR must be treated like ENOENT during the walk-up. Preflight is
    // where "your parent is a file" gets reported — the guard's job is only to
    // work out where the path points.
    const target = path.join(rootDir, 'notes.txt', 'child.txt')
    const result = await guardPath(target, ctx())
    expectAccepted(result)
    expect(result.path).toBe(target)
  })

  it('fails closed when no part of the path exists, including its volume', async () => {
    const unusedDrive = await findUnusedDriveLetter()
    if (unusedDrive === null) return // every letter mounted; nothing to assert

    const result = await guardPath(`${unusedDrive}:\\somewhere\\file.txt`, ctx())
    expectRejected(result)
    expect(result.error.code).toBe('REALPATH_FAILED')
  })
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a non-existent path of approximately `targetLength` characters using
 * several mid-length segments.
 *
 * Deliberately not one enormous filename: a single segment over 255 characters
 * fails with ENAMETOOLONG during resolution, which would test the wrong branch.
 */
function buildPathOfLength(root: string, targetLength: number): string {
  const segments: string[] = []
  let current = root.length
  while (current < targetLength) {
    const remaining = targetLength - current
    const segmentLength = Math.max(1, Math.min(40, remaining - 1))
    segments.push('x'.repeat(segmentLength))
    current += segmentLength + 1
  }
  return path.join(root, ...segments)
}

async function findUnusedDriveLetter(): Promise<string | null> {
  if (!isWindows) return null
  for (const letter of ['Q', 'R', 'V', 'W', 'X', 'Y', 'Z']) {
    try {
      await fs.access(`${letter}:\\`)
    } catch {
      return letter
    }
  }
  return null
}
