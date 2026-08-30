/**
 * Hashing and plan canonicalization.
 *
 * `canonicalJsonStringify` is not a formatting convenience — it is what binds
 * an approval token to the exact plan a user saw. The order-sensitivity tests
 * below are the load-bearing ones: object key order must NOT affect the hash
 * (or valid approvals would break at random), while array order MUST affect it
 * (or the items of an approved plan could be resequenced after approval).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { canonicalJsonStringify, sha256Buffer, sha256Canonical, sha256File } from '../hash'
import { guardPath } from '../pathGuard'
import type { GuardContext } from '../types'

let base = ''
let rootDir = ''

function ctx(): GuardContext {
  return {
    roots: [rootDir],
    denyRoots: [],
    denySegments: [],
    platform: process.platform,
    longPathAware: true,
  }
}

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reigan-hash-')))
  rootDir = path.join(base, 'root')
  await fs.mkdir(rootDir)
})

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true }).catch(() => undefined)
})

describe('sha256File', () => {
  it('matches the known digest for a small file', async () => {
    const file = path.join(rootDir, 'hello.txt')
    await fs.writeFile(file, 'hello')

    const guarded = await guardPath(file, ctx())
    if (!guarded.ok) throw new Error(`fixture path rejected: ${guarded.error.code}`)

    expect(await sha256File(guarded.path)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })

  it('produces identical digests for identical content in different files', async () => {
    // The property snapshot blob dedupe depends on.
    const a = path.join(rootDir, 'a.bin')
    const b = path.join(rootDir, 'b.bin')
    const payload = Buffer.alloc(3 * 1024 * 1024, 7) // spans several read chunks
    await fs.writeFile(a, payload)
    await fs.writeFile(b, payload)

    const ga = await guardPath(a, ctx())
    const gb = await guardPath(b, ctx())
    if (!ga.ok || !gb.ok) throw new Error('fixture path rejected')

    expect(await sha256File(ga.path)).toBe(await sha256File(gb.path))
  })

  it('detects a single flipped byte in a large file', async () => {
    const file = path.join(rootDir, 'large.bin')
    const payload = Buffer.alloc(2 * 1024 * 1024, 1)
    await fs.writeFile(file, payload)

    const guarded = await guardPath(file, ctx())
    if (!guarded.ok) throw new Error('fixture path rejected')
    const before = await sha256File(guarded.path)

    payload[1024 * 1024] = 2
    await fs.writeFile(file, payload)

    expect(await sha256File(guarded.path)).not.toBe(before)
  })

  it('rejects a missing file rather than resolving to an empty digest', async () => {
    const missing = path.join(rootDir, 'gone.txt')
    const guarded = await guardPath(missing, ctx())
    if (!guarded.ok) throw new Error('fixture path rejected')

    // An empty-file digest returned for a missing file would let postflight
    // "verify" something that is not there.
    await expect(sha256File(guarded.path)).rejects.toThrow()
  })
})

describe('canonicalJsonStringify', () => {
  it('is independent of object key order', () => {
    const a = { intent: 'move invoices', planId: '1', items: [{ op: 'move', source: 'x' }] }
    const b = { items: [{ source: 'x', op: 'move' }], planId: '1', intent: 'move invoices' }
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b))
    expect(sha256Canonical(a)).toBe(sha256Canonical(b))
  })

  it('sorts keys at every depth, not just the top level', () => {
    const a = { outer: { z: 1, a: { y: 2, b: 3 } } }
    const b = { outer: { a: { b: 3, y: 2 }, z: 1 } }
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b))
  })

  it('PRESERVES array order so plan items cannot be resequenced after approval', () => {
    // Sorting arrays here would be a security bug: the executor runs items in
    // order, so a reordered plan is a different plan and must not reuse a token.
    const a = { items: ['first', 'second'] }
    const b = { items: ['second', 'first'] }
    expect(canonicalJsonStringify(a)).not.toBe(canonicalJsonStringify(b))
    expect(sha256Canonical(a)).not.toBe(sha256Canonical(b))
  })

  it('treats an absent key and an explicitly undefined key as the same', () => {
    expect(canonicalJsonStringify({ a: 1 })).toBe(canonicalJsonStringify({ a: 1, b: undefined }))
  })

  it('distinguishes null from undefined', () => {
    // null is a real value in a manifest (blobHash: null means metadata-only).
    expect(canonicalJsonStringify({ a: null })).not.toBe(canonicalJsonStringify({ a: undefined }))
  })

  it('changes the hash when any value changes', () => {
    const plan = { items: [{ op: 'move', source: 'a.txt', target: 'Archive/a.txt' }] }
    const tampered = { items: [{ op: 'move', source: 'a.txt', target: 'Archive/../../a.txt' }] }
    expect(sha256Canonical(plan)).not.toBe(sha256Canonical(tampered))
  })
})

describe('sha256Buffer', () => {
  it('hashes a string and its buffer equivalently', () => {
    expect(sha256Buffer('hello')).toBe(sha256Buffer(Buffer.from('hello')))
  })
})
