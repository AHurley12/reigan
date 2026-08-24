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

  it('leaves a dismissed fact dismissed when a producer observes it again', () => {
    // Deleting a fact has to stick. Both producers re-observe constantly — the
    // distiller re-derives the same slug from the same conversation, a stats
    // run re-seeds the same threshold fact every launch — so reactivating here
    // made deletion nothing more than suppression that expired in a few turns.
    const f = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Wants to pass the SIE', source: 'distilled' }, 1_000)!
    store.dismissFact(f.id, 1_500)
    const rewritten = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Still on the SIE', source: 'distilled' }, 2_000)

    expect(rewritten!.status).toBe('dismissed')
    expect(store.listFacts()).toHaveLength(0)

    // The row still tracks reality, so it stays current and decay keeps
    // seeing an honest last-seen time.
    expect(rewritten!.body).toBe('Still on the SIE')
    expect(rewritten!.lastSeenAt).toBe(2_000)
  })

  it('keeps a dismissed stat fact dismissed across a later stats run', () => {
    const f = store.upsertFact({ kind: 'tendency', key: 'overdue-backlog', body: 'Lets tasks run late', source: 'stat' }, 1_000)!
    store.dismissFact(f.id, 1_500)

    store.upsertFact({ kind: 'tendency', key: 'overdue-backlog', body: 'Lets tasks run late', source: 'stat' }, 2_000)

    expect(store.listFacts()).toHaveLength(0)
  })

  it('reactivates a dismissed fact for a user write', () => {
    // The user asserting the fact is not a producer re-observing it — and this
    // is the path Restore in Settings depends on.
    const f = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Wants to pass the SIE', source: 'distilled' }, 1_000)!
    store.dismissFact(f.id, 1_500)
    const revived = store.upsertFact({ kind: 'goal', key: 'sie-exam', body: 'Sitting the SIE in November', source: 'user' }, 2_000)

    expect(revived!.status).toBe('active')
    expect(revived!.source).toBe('user')
  })
})

describe('reactivateFact', () => {
  it('restores a dismissed fact without promoting it to user-authored', () => {
    // Restore used to route through editFactBody, which set source 'user' and
    // confidence 1 — permanently outranking the stats run that wrote the row,
    // so its numbers could never update again.
    const f = store.upsertFact({ kind: 'tendency', key: 'overdue-backlog', body: 'Lets tasks run late', source: 'stat' }, 1_000)!
    store.dismissFact(f.id, 1_500)

    const restored = store.reactivateFact(f.id, 2_000)!

    expect(restored.status).toBe('active')
    expect(restored.source).toBe('stat')
    expect(restored.confidence).toBe(0.9)
    expect(restored.body).toBe('Lets tasks run late')
  })
})

describe('slugifyKey', () => {
  it('is stable for the same text, so re-adding updates instead of duplicating', () => {
    expect(store.slugifyKey('I work the AWP evening shift.')).toBe(store.slugifyKey('I work the AWP evening shift.'))
    expect(store.slugifyKey('I work the AWP evening shift.')).toBe('i-work-the-awp-evening-shift')
  })

  it('never yields an empty key', () => {
    expect(store.slugifyKey('!!!')).toBe('note')
  })

  it('truncates without leaving a trailing separator', () => {
    const key = store.slugifyKey('a'.repeat(60) + ' tail')
    expect(key.length).toBeLessThanOrEqual(48)
    expect(key.endsWith('-')).toBe(false)
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

  it('applies once per stale period however often it runs', () => {
    // refreshStats runs on every app launch and decayFacts never recorded that
    // it had fired, so the multiplier reapplied every boot: 0.8 -> 0.56 -> 0.39
    // -> 0.27, dropping under the 0.35 render threshold inside an afternoon
    // rather than over the nine months the 90-day rule describes.
    store.upsertFact({ kind: 'goal', key: 'stale', body: 'Old', source: 'distilled', confidence: 0.8 }, 1_000)
    const now = 1_000 + 91 * DAY

    expect(store.decayFacts(now)).toBe(1)
    expect(store.decayFacts(now)).toBe(0)
    expect(store.decayFacts(now)).toBe(0)

    expect(store.listFacts()[0].confidence).toBeCloseTo(0.56)
  })

  it('decays again only after another full stale period', () => {
    store.upsertFact({ kind: 'goal', key: 'stale', body: 'Old', source: 'distilled', confidence: 0.8 }, 1_000)
    store.decayFacts(1_000 + 91 * DAY)
    store.decayFacts(1_000 + 181 * DAY)

    expect(store.listFacts()[0].confidence).toBeCloseTo(0.392)
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

  it('removes dismissed facts and the derived stats too', () => {
    // The digest renders from both tables, so clearing only context_facts left
    // the assistant still opening with "### Current numbers" — while the
    // confirmation the user agreed to said it starts over from nothing.
    const f = store.upsertFact({ kind: 'goal', key: 'a', body: 'A', source: 'distilled' }, 1_000)!
    store.dismissFact(f.id, 1_000)
    store.setStat('tasks.overdue', { count: 9, oldestDays: 40 }, 1_000)

    store.clearAllFacts()

    expect(store.listFacts({ status: 'active' })).toHaveLength(0)
    expect(store.listFacts({ status: 'dismissed' })).toHaveLength(0)
    expect(store.getStat('tasks.overdue')).toBeNull()
  })
})
