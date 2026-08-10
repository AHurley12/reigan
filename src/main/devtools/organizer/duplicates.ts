import { createHash } from 'crypto'
import { promises as fsp } from 'fs'
import { basename, join } from 'path'
import { getGuardContext } from '../../fileops/allowlist'
import { guardPath } from '../../fileops/pathGuard'
import { mimeFamilyFor } from './rules'

/**
 * Duplicate detection.
 *
 * Three stages, cheapest first, because hashing everything is the naive
 * approach and is unusable on a real Downloads folder. Files are grouped by
 * exact size; only groups with more than one member are read at all; those get
 * a cheap head+tail digest; and only the survivors of *that* are fully hashed.
 * Most near-misses die at stage one for the price of a stat.
 */

const HEAD_TAIL_BYTES = 64 * 1024

/** Below this, a full hash is cheaper than two seeks, so stage 2 is skipped. */
const SMALL_FILE_BYTES = 128 * 1024

export interface DuplicateGroup {
  hash: string
  sizeBytes: number
  files: Array<{ path: string; modifiedAt: number }>
  /** The copy worth keeping, by the heuristic below. */
  suggestedKeeper: string
  wastedBytes: number
}

export interface DuplicateReport {
  groups: DuplicateGroup[]
  filesScanned: number
  totalWastedBytes: number
  truncated: boolean
}

const MAX_FILES = 20000

async function headTailDigest(path: string, size: number): Promise<string> {
  const handle = await fsp.open(path, 'r')
  try {
    const hash = createHash('sha256')
    const head = Buffer.alloc(Math.min(HEAD_TAIL_BYTES, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)

    if (size > HEAD_TAIL_BYTES) {
      const tailLength = Math.min(HEAD_TAIL_BYTES, size - HEAD_TAIL_BYTES)
      const tail = Buffer.alloc(tailLength)
      await handle.read(tail, 0, tailLength, size - tailLength)
      hash.update(tail)
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

async function fullHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fsp.open(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    let position = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

/**
 * Picks which copy to keep.
 *
 * Prefers a file that is *not* in a Downloads-shaped folder — a duplicate in
 * Downloads is nearly always the redundant re-download of something already
 * filed — and falls back to the oldest, which is the one other things are more
 * likely to reference.
 */
function suggestKeeper(files: Array<{ path: string; modifiedAt: number }>): string {
  const scored = files.map((f) => ({
    ...f,
    transient: /[\\/](downloads|temp|tmp|desktop)[\\/]/i.test(f.path) ? 1 : 0,
  }))
  scored.sort((a, b) => a.transient - b.transient || a.modifiedAt - b.modifiedAt)
  return scored[0].path
}

export async function findDuplicates(params: {
  scopePath: string
  recursive?: boolean
  minSizeBytes?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, label?: string) => void
}): Promise<DuplicateReport> {
  const ctx = await getGuardContext()
  const guard = await guardPath(params.scopePath, ctx)
  if (!guard.ok) {
    throw new Error(`Cannot scan ${params.scopePath}: ${guard.error.message}`)
  }

  const minSize = params.minSizeBytes ?? 1024
  const bySize = new Map<number, Array<{ path: string; modifiedAt: number }>>()
  let filesScanned = 0
  let truncated = false

  const stack = [params.scopePath]
  while (stack.length > 0) {
    if (params.signal?.aborted) break
    if (filesScanned >= MAX_FILES) {
      truncated = true
      break
    }

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
        if (params.recursive !== false) stack.push(full)
        continue
      }
      if (!entry.isFile()) continue

      try {
        const stat = await fsp.stat(full)
        if (stat.size < minSize) continue
        filesScanned += 1
        const bucket = bySize.get(stat.size)
        if (bucket) bucket.push({ path: full, modifiedAt: stat.mtimeMs })
        else bySize.set(stat.size, [{ path: full, modifiedAt: stat.mtimeMs }])
      } catch {
        continue
      }
    }
  }

  // Stage 1 result: only same-size groups can possibly be duplicates.
  const candidates = [...bySize.entries()].filter(([, files]) => files.length > 1)
  const groups: DuplicateGroup[] = []
  let processed = 0

  for (const [size, files] of candidates) {
    if (params.signal?.aborted) break
    processed += 1
    params.onProgress?.(processed, candidates.length, 'Comparing same-size files')

    // Stage 2: cheap digest. Skipped for small files, where reading the whole
    // thing costs no more than reading both ends of it.
    let stage2: Map<string, typeof files>
    if (size <= SMALL_FILE_BYTES) {
      stage2 = new Map([['small', files]])
    } else {
      stage2 = new Map()
      for (const file of files) {
        try {
          const digest = await headTailDigest(file.path, size)
          const bucket = stage2.get(digest)
          if (bucket) bucket.push(file)
          else stage2.set(digest, [file])
        } catch {
          // Locked or unreadable — excluded rather than guessed at.
        }
      }
    }

    // Stage 3: full hash, only for files that survived both filters.
    for (const bucket of stage2.values()) {
      if (bucket.length < 2) continue

      const byHash = new Map<string, typeof files>()
      for (const file of bucket) {
        try {
          const hash = await fullHash(file.path)
          const existing = byHash.get(hash)
          if (existing) existing.push(file)
          else byHash.set(hash, [file])
        } catch {
          continue
        }
      }

      for (const [hash, matched] of byHash) {
        if (matched.length < 2) continue
        groups.push({
          hash,
          sizeBytes: size,
          files: matched,
          suggestedKeeper: suggestKeeper(matched),
          wastedBytes: size * (matched.length - 1),
        })
      }
    }
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes)

  return {
    groups,
    filesScanned,
    totalWastedBytes: groups.reduce((sum, g) => sum + g.wastedBytes, 0),
    truncated,
  }
}

export function describeDuplicates(report: DuplicateReport): string {
  if (report.groups.length === 0) {
    return `No duplicates among ${report.filesScanned} file(s).`
  }
  const mb = (report.totalWastedBytes / 1048576).toFixed(1)
  const lines = report.groups.slice(0, 20).map((g) => {
    const others = g.files.filter((f) => f.path !== g.suggestedKeeper)
    return (
      `  • ${basename(g.suggestedKeeper)} (${mimeFamilyFor(g.suggestedKeeper)}, ${(g.sizeBytes / 1048576).toFixed(1)} MB) ` +
      `— ${g.files.length} copies, keep:\n      ${g.suggestedKeeper}\n` +
      others.map((f) => `      dup: ${f.path}`).join('\n')
    )
  })
  const more = report.groups.length > 20 ? `\n  …and ${report.groups.length - 20} more groups.` : ''
  return `${report.groups.length} duplicate group(s) across ${report.filesScanned} file(s), wasting ${mb} MB:\n${lines.join('\n')}${more}`
}
