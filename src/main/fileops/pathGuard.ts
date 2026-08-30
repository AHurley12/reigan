/**
 * The single chokepoint through which every path in the fileops subsystem must
 * pass before anything else looks at it.
 *
 * READ THIS BEFORE SIMPLIFYING ANYTHING HERE. Each step below exists because a
 * specific, real trick defeats the obvious implementation:
 *
 *  - `startsWith()` containment lets `C:\Users\a\Docs-Private` pass a check for
 *    `C:\Users\a\Docs`. We compare with `path.relative()` shape instead.
 *  - Skipping `realpath()` lets a symlink or Windows junction *inside* an
 *    allowlisted root point anywhere on the disk. Resolving only the full path
 *    is not enough either, because the destination of a create usually does not
 *    exist yet — so we resolve the deepest existing ancestor and re-append the
 *    non-existent tail.
 *  - Case-sensitive comparison on Windows and macOS treats `Report.pdf` and
 *    `report.pdf` as different files. The filesystem does not.
 *  - Windows silently strips trailing dots and spaces from filenames, which
 *    quietly turns a "create `notes.txt. `" into an overwrite of `notes.txt`.
 *
 * The guard never throws for a rejected path — it returns a discriminated
 * union. A rejection is an expected outcome to be reported to the user, not an
 * exceptional condition. It *does* fail closed on unexpected I/O errors: if we
 * cannot determine where a path really points, the operation does not run.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import type {
  GuardContext,
  PathGuardError,
  PathGuardErrorCode,
  PathGuardResult,
  PathGuardWarning,
  SafePath,
} from './types'

/**
 * Windows silently truncates at MAX_PATH unless the process is long-path-aware.
 * We warn well before the cliff and hard-fail at it, because a truncated path
 * is a path pointing somewhere other than where the user thinks.
 */
const WINDOWS_PATH_WARN_LENGTH = 240
const WINDOWS_PATH_MAX_LENGTH = 259

/**
 * Reserved DOS device names. Opening `CON` or `LPT1` talks to a device, not a
 * file — a "write" to one succeeds and stores nothing, and a "move" to one
 * destroys the source. Checked with and without an extension, since `CON.txt`
 * is equally reserved.
 */
const WINDOWS_RESERVED_NAMES = new Set<string>([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** Platforms whose filesystems are case-insensitive by default. */
function isCaseInsensitive(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

function fail(code: PathGuardErrorCode, message: string, input: string): PathGuardResult {
  const error: PathGuardError = { code, message, input }
  return { ok: false, error }
}

function fold(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value
}

/**
 * True when `child` is `parent` or sits beneath it.
 *
 * Uses `path.relative()` and inspects the *shape* of the result rather than
 * comparing strings: an escaping path yields something starting with `..`, and
 * a different volume yields an absolute path. Both are rejected.
 *
 * The `rel === '..'` / `'..' + sep` split matters — a bare `startsWith('..')`
 * would wrongly reject a legitimately contained sibling named `..config`.
 */
function isWithin(child: string, parent: string, caseInsensitive: boolean): boolean {
  const rel = path.relative(fold(parent, caseInsensitive), fold(child, caseInsensitive))
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || rel.startsWith('../')) return false
  return !path.isAbsolute(rel)
}

/**
 * On Windows, `path.isAbsolute('/foo')` is true, but such a path is only
 * "absolute" relative to the current drive — it resolves against whatever
 * drive the process happens to be on. That is not a location we can reason
 * about, so we require a drive letter or a UNC prefix.
 */
function isTrulyAbsolute(input: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return path.posix.isAbsolute(input) || path.isAbsolute(input)
  if (/^[\\/]{2}[^\\/]/.test(input)) return true // UNC: \\server\share
  return /^[a-zA-Z]:[\\/]/.test(input)
}

/** Splits a resolved absolute path into its segments, dropping the volume root. */
function segmentsOf(resolved: string): string[] {
  const parsed = path.parse(resolved)
  const withoutRoot = resolved.slice(parsed.root.length)
  return withoutRoot.split(/[\\/]/).filter((segment) => segment.length > 0)
}

interface RealPathOk {
  readonly ok: true
  readonly resolved: string
}
interface RealPathFailed {
  readonly ok: false
  readonly message: string
}

/**
 * Resolves symlinks and junctions by realpath-ing the deepest ancestor that
 * actually exists, then re-appending the segments that do not exist yet.
 *
 * WHY NOT JUST `fs.realpath(fullPath)`: most write targets do not exist at plan
 * time, so realpath would throw ENOENT and we would learn nothing. Resolving
 * only the existing prefix still catches the attack that matters — a link
 * partway down the path redirecting the whole subtree elsewhere.
 */
async function resolveThroughLinks(absolute: string): Promise<RealPathOk | RealPathFailed> {
  const nonExistentTail: string[] = []
  let current = absolute

  for (;;) {
    try {
      const real = await fs.realpath(current)
      return {
        ok: true,
        resolved: nonExistentTail.length > 0 ? path.join(real, ...nonExistentTail) : real,
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code

      // ENOENT: this component does not exist yet — keep walking up.
      // ENOTDIR: an ancestor is a file, so this cannot exist either; walking up
      // still finds the real prefix, and preflight reports the type error.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        // EACCES, ELOOP, EPERM, EIO — we cannot determine where this points.
        // Fail closed: an unresolvable path is never a safe path.
        return { ok: false, message: `Could not resolve this path (${code ?? 'unknown error'}).` }
      }

      const parent = path.dirname(current)
      if (parent === current) {
        // Walked all the way to the volume root without finding anything real.
        return { ok: false, message: 'No part of this path exists, including its drive or root.' }
      }

      nonExistentTail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Validates a path and, on success, mints the only `SafePath` values in the
 * program. This function holds the single cast; nothing else may create one.
 *
 * Checks run in the order documented at the top of the file. The first failure
 * returns — unlike preflight, there is no value in collecting multiple reasons
 * for rejecting a single path, and later checks are not meaningful once an
 * earlier one has failed (there is no point length-checking a path we could not
 * resolve).
 */
export async function guardPath(input: string, ctx: GuardContext): Promise<PathGuardResult> {
  const caseInsensitive = isCaseInsensitive(ctx.platform)
  const warnings: PathGuardWarning[] = []

  // 1. Something to validate at all.
  if (typeof input !== 'string' || input.length === 0) {
    return fail('EMPTY_PATH', 'No path was provided.', String(input ?? ''))
  }

  // 2. NUL bytes truncate paths in some native APIs — "a.txt\0.png" can be
  //    presented to the user as one thing and opened as another. Checked before
  //    anything normalizes the string and hides it.
  if (input.includes('\0')) {
    return fail('NUL_BYTE', 'This path contains a NUL byte, which is never valid.', input)
  }

  // eslint-disable-next-line no-control-regex -- deliberately matching control chars
  if (/[\u0001-\u001f\u007f]/.test(input)) {
    return fail(
      'CONTROL_CHARS',
      'This path contains control characters, which cannot be displayed reliably and are never valid in a filename.',
      input
    )
  }

  // 3. Relative paths resolve against the process working directory, which is
  //    not a location the user has approved. `~` must be expanded upstream,
  //    where the expansion is visible, and then validated here.
  if (!isTrulyAbsolute(input, ctx.platform)) {
    return fail(
      'NOT_ABSOLUTE',
      ctx.platform === 'win32'
        ? 'Paths must be absolute and include a drive (for example C:\\Users\\you\\Documents).'
        : 'Paths must be absolute (starting from /).',
      input
    )
  }

  // 4. Normalize away `.`, `..` and duplicate separators before resolving links.
  const normalized = path.normalize(path.resolve(input))

  // 5. Resolve symlinks/junctions. Fails closed on any error but ENOENT.
  const real = await resolveThroughLinks(normalized)
  if (!real.ok) {
    return fail('REALPATH_FAILED', real.message, input)
  }
  const resolved = real.resolved

  // 6. Containment. An empty allowlist means nothing is reachable — that is the
  //    shipped default, and it is deliberate: the user opts into every root.
  if (ctx.roots.length === 0) {
    return fail(
      'NO_ROOTS_CONFIGURED',
      'No folders have been allowed yet. Add one in Settings before Reigan can work with files.',
      input
    )
  }

  const containingRoot = ctx.roots.find((root) => isWithin(resolved, root, caseInsensitive))
  if (containingRoot === undefined) {
    return fail(
      'OUTSIDE_ROOTS',
      'This path is outside every folder you have allowed. It may be a shortcut or link that points elsewhere.',
      input
    )
  }

  // 7a. Deny roots override the allowlist — a system directory nested inside an
  //     allowed root is still a system directory. Reigan's own snapshot store
  //     lives here too: if a plan could target it, a rollback could be
  //     destroyed by the very batch it exists to undo.
  const deniedRoot = ctx.denyRoots.find((deny) => isWithin(resolved, deny, caseInsensitive))
  if (deniedRoot !== undefined) {
    return fail(
      'DENIED_LOCATION',
      'This location is protected and cannot be touched, even though it sits inside an allowed folder.',
      input
    )
  }

  // 7b. Denied segments at any depth (`.git`, `node_modules`) — these catch
  //     nested copies that a root-prefix check would miss entirely.
  const segments = segmentsOf(resolved)
  const deniedSegment = segments.find((segment) =>
    ctx.denySegments.some((deny) => fold(deny, caseInsensitive) === fold(segment, caseInsensitive))
  )
  if (deniedSegment !== undefined) {
    return fail(
      'DENIED_LOCATION',
      `This path goes through "${deniedSegment}", which is protected from file operations.`,
      input
    )
  }

  // 7c. Reserved device names. Windows-only: on other platforms `com1.txt` is
  //     an ordinary file and blocking it would be over-reach.
  if (ctx.platform === 'win32') {
    const reserved = segments.find((segment) => {
      const stem = segment.split('.')[0] ?? ''
      return WINDOWS_RESERVED_NAMES.has(stem.trim().toUpperCase())
    })
    if (reserved !== undefined) {
      return fail(
        'RESERVED_DEVICE_NAME',
        `"${reserved}" is a reserved Windows device name. Writing to it would talk to hardware rather than create a file.`,
        input
      )
    }

    // 8. Windows strips trailing dots and spaces from names. "notes.txt " and
    //    "notes.txt" are the same file to the OS but not to us, so a plan built
    //    on the difference would overwrite a file it never named.
    const trailing = segments.find((segment) => /[. ]$/.test(segment))
    if (trailing !== undefined) {
      return fail(
        'TRAILING_DOT_OR_SPACE',
        `"${trailing}" ends with a dot or space. Windows silently removes those, so this name would not refer to the file you expect.`,
        input
      )
    }

    // 9. Length. Warn early, hard-fail at the limit unless the process is
    //    verified long-path-aware. Defaults to not-aware, which fails closed.
    if (!ctx.longPathAware) {
      if (resolved.length > WINDOWS_PATH_MAX_LENGTH) {
        return fail(
          'PATH_TOO_LONG',
          `This path is ${resolved.length} characters. Windows cannot reliably handle paths over ${WINDOWS_PATH_MAX_LENGTH} here, and would silently truncate it.`,
          input
        )
      }
      if (resolved.length > WINDOWS_PATH_WARN_LENGTH) {
        warnings.push({
          code: 'PATH_LENGTH_NEAR_LIMIT',
          message: `This path is ${resolved.length} characters, close to the ${WINDOWS_PATH_MAX_LENGTH}-character Windows limit. Moving it any deeper may fail.`,
        })
      }
    }
  }

  // 10. The only place a SafePath is created.
  return {
    ok: true,
    path: resolved as SafePath,
    root: containingRoot,
    warnings,
  }
}

/**
 * Convenience for the common "validate several paths, stop at the first bad
 * one" case. Returns the first rejection rather than a partial list, because a
 * caller that got any rejection is going to abort the whole batch anyway.
 */
export async function guardPaths(
  inputs: readonly string[],
  ctx: GuardContext
): Promise<{ ok: true; paths: SafePath[] } | { ok: false; error: PathGuardError }> {
  const paths: SafePath[] = []
  for (const input of inputs) {
    const result = await guardPath(input, ctx)
    if (!result.ok) return { ok: false, error: result.error }
    paths.push(result.path)
  }
  return { ok: true, paths }
}

/** Exported for tests and for the allowlist's own root-vs-root containment checks. */
export const __internal = { isWithin, isTrulyAbsolute, segmentsOf, resolveThroughLinks }
