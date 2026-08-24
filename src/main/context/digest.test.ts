import { describe, expect, it } from 'vitest'
import { MAX_DIGEST_CHARS, hashDigest, renderDigest } from './digest'
import type { ContextFact } from '../../shared/types'

function fact(over: Partial<ContextFact> = {}): ContextFact {
  return {
    id: over.key ?? 'id',
    kind: 'tendency',
    key: 'k',
    body: 'Body',
    evidence: null,
    confidence: 0.8,
    source: 'distilled',
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: 0,
    ...over,
  }
}

describe('renderDigest', () => {
  it('renders nothing when there is nothing known', () => {
    // An empty scaffold is worse than absence: it burns tokens and invites the
    // model to fill the silence with invented observations.
    expect(renderDigest([], {})).toBe('')
  })

  it('groups facts under their kind', () => {
    const out = renderDigest(
      [
        fact({ key: 'a', kind: 'duty', body: 'Works the AWP evening shift' }),
        fact({ key: 'b', kind: 'goal', body: 'Sitting the SIE in November' }),
      ],
      {},
    )

    expect(out).toContain('Duties & roles')
    expect(out).toContain('Works the AWP evening shift')
    expect(out).toContain('Goals & projects')
    expect(out).toContain('Sitting the SIE in November')
  })

  it('drops facts below the render threshold', () => {
    const out = renderDigest([fact({ key: 'weak', body: 'Barely supported', confidence: 0.2 })], {})
    expect(out).not.toContain('Barely supported')
  })

  it('marks user-authored facts as ground truth', () => {
    const out = renderDigest([fact({ key: 'u', source: 'user', confidence: 1, body: 'Works evenings' })], {})
    expect(out).toContain('stated directly')
  })

  it('renders stats as concrete numbers', () => {
    const out = renderDigest([], {
      tasksOverdue: { count: 7, oldestDays: 21 },
      coldProjects: [{ name: 'alpha', days: 70 }],
    })

    expect(out).toContain('7 overdue')
    expect(out).toContain('21 days')
    expect(out).toContain('alpha')
  })

  it('enforces the character cap, dropping lowest-confidence facts first', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      fact({ key: `k${i}`, body: `Observation number ${i} `.repeat(6), confidence: i / 400 }),
    )

    const out = renderDigest(many, {})

    expect(out.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS)
    expect(out).toContain('Observation number 399')  // highest confidence survives
    expect(out).not.toContain('Observation number 0 ') // lowest is cut
  })

  it('tells the model to cite recorded patterns and never invent them', () => {
    const out = renderDigest([fact()], {})
    expect(out).toContain('Never invent')
  })
})

describe('hashDigest', () => {
  it('is stable for identical text', () => {
    expect(hashDigest('abc')).toBe(hashDigest('abc'))
  })

  it('differs for different text', () => {
    expect(hashDigest('abc')).not.toBe(hashDigest('abd'))
  })

  it('hashes empty text without throwing', () => {
    expect(hashDigest('')).toHaveLength(12)
  })
})
