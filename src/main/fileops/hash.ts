/**
 * Streaming sha-256 for the fileops subsystem.
 *
 * Everything in this subsystem that claims two byte sequences are identical
 * proves it here. There are deliberately no size-and-mtime shortcuts: mtime is
 * forgeable, cheap to collide by accident, and preserved by half the tools a
 * user might have open. If we are going to tell someone their file survived a
 * move, the only honest basis for that is the bytes.
 */

import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import type { SafePath, Sha256 } from './types'

/** 1 MiB — large enough to keep syscall overhead down, small enough to stay off the large-object heap. */
const READ_CHUNK_BYTES = 1024 * 1024

async function hashStream(absolutePath: string): Promise<Sha256> {
  const hash = createHash('sha256')
  // pipeline (not manual 'data' listeners) so a mid-read error rejects rather
  // than leaving a dangling handle and a half-fed digest that still resolves.
  await pipeline(
    createReadStream(absolutePath, { highWaterMark: READ_CHUNK_BYTES }),
    hash
  )
  return hash.digest('hex')
}

/**
 * Hash a user file. Accepts `SafePath` only, so it is not reachable with a
 * path that has not been through the guard.
 */
export function sha256File(path: SafePath): Promise<Sha256> {
  return hashStream(path)
}

/**
 * Hash a file inside Reigan's own managed store (snapshot blobs, quarantine).
 *
 * WHY THIS EXISTS: the snapshot store is deny-listed by `pathGuard`, precisely
 * so no plan can ever target it — which means a blob's path can never be a
 * `SafePath`, and verifying a restored blob would otherwise be impossible.
 * This is the only sanctioned escape hatch, and it is named to be greppable.
 *
 * NEVER call this with a path derived from user input, a plan, or a model tool
 * call. Callers must construct the path themselves from `app.getPath('userData')`.
 */
export function sha256InternalFile(managedPath: string): Promise<Sha256> {
  return hashStream(managedPath)
}

export function sha256Buffer(data: Buffer | string): Sha256 {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Deterministic JSON serialization: object keys sorted at every depth.
 *
 * WHY: `planHash` binds an approval token to the exact plan the user saw. If
 * serialization depended on key insertion order, a semantically identical plan
 * could hash differently (breaking valid approvals) or — far worse — a
 * reordered plan could be made to hash the same as one the user approved.
 * Sorting removes the ambiguity in both directions.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
    // undefined-valued keys vanish under JSON.stringify anyway; dropping them
    // here keeps `{ a: 1 }` and `{ a: 1, b: undefined }` hashing identically.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const out: Record<string, unknown> = {}
  for (const [key, val] of entries) out[key] = canonicalize(val)
  return out
}

/** sha-256 of the canonical serialization of `value`. */
export function sha256Canonical(value: unknown): Sha256 {
  return sha256Buffer(canonicalJsonStringify(value))
}
