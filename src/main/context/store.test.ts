import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Must precede the dynamic import below: database.ts resolves its path from
// this env var at first getDatabase() call, and a static import would run first.
process.env.REIGAN_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'reigan-context-'))

const { getDatabase } = await import('../db/database')
const store = await import('./store')

beforeEach(() => {
  getDatabase().exec('DELETE FROM context_facts; DELETE FROM context_stats;')
})

describe('upsertFact', () => {
  it('inserts a new fact as active', () => {
    const fact = store.upsertFact(
      { kind: 'tendency', key: 'sie-reschedule', body: 'Reschedules the SIE block', source: 'distilled' },
      1_000,
    )

    expect(fact).not.toBeNull()
    expect(fact!.status).toBe('active')
    expect(fact!.confidence).toBe(0.5)
    expect(fact!.createdAt).toBe(1_000)
  })

  it('updates in place on a repeat observation instead of duplicating', () => {
    store.upsertFact({ kind: 'tendency', key: 'sie-reschedule', body: 'First read', source: 'distilled' }, 1_000)
    const second = store.upsertFact(
      { kind: 'tendency', key: 'sie-reschedule', body: 'Sharper read', source: 'distilled', confidence: 0.8 },
      2_000,
    )

    expect(store.listFacts()).toHaveLength(1)
    expect(second!.body).toBe('Sharper read')
    expect(second!.confidence).toBe(0.8)
    expect(second!.lastSeenAt).toBe(2_000)
    expect(second!.createdAt).toBe(1_000) // original creation time survives
  })

  it('refuses a distilled write over a user-authored fact', () => {
    store.upsertFact({ kind: 'duty', key: 'day-job', body: 'Works the AWP evening shift', source: 'user' }, 1_000)

    const refused = store.upsertFact(
      { kind: 'duty', key: 'day-job', body: 'Works mornings', source: 'distilled' },
      2_000,
    )

    // A model paraphrase must never overwrite something the user typed by hand.
    expect(refused).toBeNull()
    expect(store.listFacts()[0].body).toBe('Works the AWP evening shift')
  })

  it('refuses a distilled write over a stat-derived fact', () => {
    store.upsertFact({ kind: 'tendency', key: 'overdue-pile', body: '7 tasks overdue', source: 'stat' }, 1_000)
    expect(store.upsertFact({ kind: 'tendency', key: 'overdue-pile', body: 'Roughly on top of things', source: 'distilled' }, 2_000)).toBeNull()
  })

  it('allows a user write over a distilled fact', () => {
    store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Wants to pass the SIE', source: 'distilled' }, 1_000)
    const corrected = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Sitting the SIE in November', source: 'user' }, 2_000)

    expect(corrected!.body).toBe('Sitting the SIE in November')
    expect(corrected!.source).toBe('user')
    expect(corrected!.confidence).toBe(1)
  })

  it('reactivates a dismissed fact when the same source observes it again', () => {
    const f = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Wants to pass the SIE', source: 'distilled' }, 1_000)!
    store.dismissFact(f.id, 1_500)
    const revived = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Still on the SIE', source: 'distilled' }, 2_000)

    expect(revived!.status).toBe('active')
  })
})

describe('listFacts', () => {
  it('returns active facts sorted by confidence descending', () => {
    store.upsertFact({ kind: 'goal', key: 'a', body: 'A', source: 'distilled', confidence: 0.3 }, 1_000)
    store.upsertFact({ kind: 'goal', key: 'b', body: 'B', source: 'distilled', confidence: 0.9 }, 1_000)

    expect(store.listFacts().map((f) => f.key)).toEqual(['b', 'a'])
  })

  it('filters below minConfidence', () => {
    store.upsertFact({ kind: 'goal', key: 'a', body: 'A', source: 'distilled', confidence: 0.2 }, 1_000)
    store.upsertFact({ kind: 'goal', key: 'b', body: 'B', source: 'distilled', confidence: 0.9 }, 1_000)

    expect(store.listFacts({ minConfidence: 0.35 }).map((f) => f.key)).toEqual(['b'])
  })

  it('excludes dismissed facts by default', () => {
    const f = store.upsertFact({ kind: 'goal', key: 'a', body: 'A', source: 'distilled' }, 1_000)!
    store.dismissFact(f.id, 2_000)

    expect(store.listFacts()).toHaveLength(0)
    expect(store.listFacts({ status: 'dismissed' })).toHaveLength(1)
  })
})

describe('editFactBody', () => {
  it('promotes an edited fact to user-authored at full confidence', () => {
    const f = store.upsertFact({ kind: 'duty', key: 'shift', body: 'Wrong', source: 'distilled', confidence: 0.4 }, 1_000)!
    const edited = store.editFactBody(f.id, 'Right', 2_000)!

    expect(edited.body).toBe('Right')
    expect(edited.source).toBe('user')
    expect(edited.confidence).toBe(1)
  })
})

describe('decayFacts', () => {
  const DAY = 86_400_000

  it('decays facts not seen in 90 days', () => {
    store.upsertFact({ kind: 'goal', key: 'stale', body: 'Old', source: 'distilled', confidence: 0.8 }, 1_000)
    const changed = store.decayFacts(1_000 + 91 * DAY)

    expect(changed).toBe(1)
    expect(store.listFacts()[0].confidence).toBeCloseTo(0.56)
  })

  it('leaves recent facts alone', () => {
    store.upsertFact({ kind: 'goal', key: 'fresh', body: 'New', source: 'distilled', confidence: 0.8 }, 1_000)
    expect(store.decayFacts(1_000 + 10 * DAY)).toBe(0)
  })

  it('never decays user-authored facts', () => {
    // The user typed it. Time passing is not evidence against it.
    store.upsertFact({ kind: 'duty', key: 'job', body: 'Works evenings', source: 'user' }, 1_000)
    expect(store.decayFacts(1_000 + 500 * DAY)).toBe(0)
    expect(store.listFacts()[0].confidence).toBe(1)
  })
})

describe('stats', () => {
  it('round-trips a JSON stat value', () => {
    store.setStat('tasks.overdue', { count: 7, oldestDays: 21 }, 1_000)
    expect(store.getStat('tasks.overdue')).toEqual({ count: 7, oldestDays: 21 })
  })

  it('overwrites on recompute', () => {
    store.setStat('tasks.overdue', { count: 7, oldestDays: 21 }, 1_000)
    store.setStat('tasks.overdue', { count: 2, oldestDays: 3 }, 2_000)
    expect(store.getStat('tasks.overdue')).toEqual({ count: 2, oldestDays: 3 })
  })

  it('returns null for an unknown metric', () => {
    expect(store.getStat('nope')).toBeNull()
  })
})

describe('clearAllFacts', () => {
  it('removes every fact', () => {
    store.upsertFact({ kind: 'goal', key: 'a', body: 'A', source: 'user' }, 1_000)
    store.upsertFact({ kind: 'duty', key: 'b', body: 'B', source: 'distilled' }, 1_000)
    store.clearAllFacts()
    expect(store.listFacts({ status: 'active' })).toHaveLength(0)
  })
})
