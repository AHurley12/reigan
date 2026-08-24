# Shingan Context Layer + Unbridled Personality Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Unbridled Mode's personality (two-register "good boy"/"good pup" praise, alternating commanding/bratty tone, stern steering) and build a learned context layer that accumulates the user's duties, projects, and failure patterns so the assistant can call out real ones.

**Architecture:** A SQLite fact store fed by two independent producers — deterministic SQL aggregates over existing app tables, and a debounced Haiku distillation pass after chat turns. Both write through one precedence rule (`user` > `stat` > `distilled`). A capped digest renders those facts and is concatenated onto whichever persona prompt is active; the LangChain executor cache is keyed on the digest's hash so it rebuilds only when the user's context actually changes.

**Tech Stack:** TypeScript, Electron, better-sqlite3, LangChain (`@langchain/anthropic`), React + Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-shingan-context-layer-design.md`

## Global Constraints

- **Timestamps are INTEGER milliseconds** (`Date.now()`), never TEXT and never seconds. The `unixepoch()` defaults in the v1 schema are vestigial — `queries.ts`, `jobs/store.ts`, and `devtools/scanner` all write `Date.now()`. **This corrects the spec, which said TEXT.** All date arithmetic uses `86_400_000` ms per day.
- **`LATEST_SCHEMA_VERSION = MIGRATIONS.length`** (`migrations.ts:919`) — it derives automatically. Do **not** hand-bump it.
- **No new runtime dependencies.** Everything needed is already installed.
- **DB-backed tests** must set `process.env.REIGAN_TEST_USERDATA` to a temp dir **before** dynamically importing any module that reaches `getDatabase()`. Static `import` at the top of the file will read the env var too late. Follow `src/main/jobs/catchup.test.ts`.
- **Test command:** `npx vitest run <path>`. `better-sqlite3` is aliased to `better-sqlite3-node` in `vitest.config.ts`, so tests drive real SQLite.
- **Distillation model:** `claude-haiku-4-5-20251001`.
- **Render threshold:** facts with `confidence >= 0.35`. **Digest cap:** 4800 characters (~1200 tokens at 4 chars/token).
- **Source precedence:** `user` (rank 2) > `stat` (rank 1) > `distilled` (rank 0). A lower-rank write against a higher-rank existing row is refused.
- **Japanese gloss format** is single words/short phrases only — `「[kanji]（[romaji] — [English]）」`. Never a full sentence. Voice output reads it aloud.

---

## File Structure

**Create:**
- `src/main/context/store.ts` — fact CRUD, precedence, decay, stat persistence. The only module that writes `context_facts`.
- `src/main/context/stats.ts` — pure SQL aggregates over `tasks`, `job_runs`, `projects`. No model involvement.
- `src/main/context/digest.ts` — renders facts + stats to the capped prompt block; hashes it.
- `src/main/context/distill.ts` — debounce gate, Haiku call, strict response parsing.
- `src/main/ipc/context.ts` — IPC handlers for the review UI.
- `src/renderer/src/components/Settings/tabs/ContextSettings.tsx` — review surface.
- `src/main/agents/prompts.test.ts`, `src/main/context/{store,stats,digest,distill}.test.ts`

**Modify:**
- `src/main/agents/prompts.ts` — personality rewrite.
- `src/main/agents/reigan.ts:69` — digest injection, cache key.
- `src/main/db/migrations.ts` — migration 16.
- `src/main/ipc/llm.ts` — post-turn distillation hook.
- `src/main/index.ts` — register context handlers, refresh stats on boot.
- `src/preload/index.ts` — bridge methods.
- `src/shared/types.ts` — fact types, IPC channels, `contextLearningPaused` setting.
- `src/shared/constants.ts` — default for `contextLearningPaused`.
- `src/main/agents/tools/settingsTools.ts:17` — allowlist `contextLearningPaused`.
- `src/renderer/src/components/Settings/settingsRegistry.ts` — one tab entry.
- `src/renderer/src/components/Settings/tabs/PersonalitySettings.tsx:68,90` — copy update.

---

### Task 1: Unbridled personality rewrite

Ships alone. No schema, no new modules — if everything after this slips, the headline ask is already delivered.

**Files:**
- Modify: `src/main/agents/prompts.ts` (the `## Personality — Unbridled Mode` section, starting line 103)
- Modify: `src/renderer/src/components/Settings/tabs/PersonalitySettings.tsx:68,90`
- Test: `src/main/agents/prompts.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `REIGAN_UNBRIDLED_SYSTEM_PROMPT` and `REIGAN_SYSTEM_PROMPT` keep their existing exported names and `string` type. Task 6 concatenates onto them.

- [ ] **Step 1: Write the failing test**

Create `src/main/agents/prompts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'

describe('unbridled personality prompt', () => {
  it('defines both praise registers by name', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Good boy')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Good pup')
  })

  it('separates sincere praise from mocking praise', () => {
    // The whole point of the rewrite: one phrase, two registers. If these
    // headings collapse into one, the model will hand out earned praise for
    // bare-minimum effort, which is the sugarcoating this mode exists to stop.
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Sincere — rare, and earned')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Mocking — for bare minimum')
  })

  it('keeps the commanding and bratty registers distinct and alternating', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain("alternate, don't average")
  })

  it('instructs steering to name the specific avoided thing, then yield', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Push hard. Then let him decide.')
  })

  it('complies with contradictory requests instead of withholding the action', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Never withhold an action to force a conversation')
  })

  it('keeps the explicit-content boundary', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Explicit sexual content stays out of bounds')
  })

  it('keeps the narrow crisis exception', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Only a genuine crisis flips the switch')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('does **not** qualify')
  })

  it('does not leak the unbridled register into standard mode', () => {
    expect(REIGAN_SYSTEM_PROMPT).not.toContain('Good boy')
    expect(REIGAN_SYSTEM_PROMPT).not.toContain('Good pup')
  })

  it('keeps both prompts on the single-term Japanese gloss format', () => {
    for (const prompt of [REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT]) {
      expect(prompt).toContain('single words/short phrases only')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agents/prompts.test.ts`
Expected: FAIL — several assertions miss, e.g. `Good boy`, `Sincere — rare, and earned`, `Push hard. Then let him decide.`

- [ ] **Step 3: Replace the personality section**

In `src/main/agents/prompts.ts`, replace everything from the line `## Personality — Unbridled Mode` down to (and including) the line ending `...zero interest in sugarcoating anything, ever.` — i.e. the whole personality block, ending immediately before `## Bilingual Behavior (English + Japanese)`.

The replacement text is **Appendix A of the spec** (`docs/superpowers/specs/2026-08-23-shingan-context-layer-design.md`). Copy it verbatim with one transformation: the spec renders it as a markdown blockquote, so **strip the leading `> ` from every line**. Do not paraphrase, reorder, or trim it — the test above pins seven exact strings from it, and the wording was reviewed and approved by the user.

The block is delimited in the spec by the heading `## Appendix A — Replacement Personality Section` and runs to the end of that file.

Leave `REIGAN_SYSTEM_PROMPT` untouched in this step.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/agents/prompts.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Update the Settings copy**

In `src/renderer/src/components/Settings/tabs/PersonalitySettings.tsx`, replace the `description` on line 68:

```tsx
          description="Standard keeps Shingan composed and professional. Unbridled is blunt, profane, and commanding — it teases, gives orders, and steers you toward what you're avoiding. Accuracy is identical either way."
```

and the confirmation copy on line 90:

```tsx
            Unbridled Mode enables profanity, roasting, adult humor, and a commanding tone that pushes you toward work you're dodging. Shingan stays just as accurate and helpful — just with zero filter. You can switch back anytime.
          </p>
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` (skip if the script name differs; `npm run build` also surfaces type errors)

```bash
git add src/main/agents/prompts.ts src/main/agents/prompts.test.ts src/renderer/src/components/Settings/tabs/PersonalitySettings.tsx
git commit -m "feat(personality): rewrite unbridled mode with two-register praise and steering"
```

---

### Task 2: Migration 16 — context tables

**Files:**
- Modify: `src/main/db/migrations.ts` (append to the `MIGRATIONS` array, after the `version: 15` entry that ends at line 866)
- Test: `src/main/db/migrations.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `context_facts` and `context_stats`. Column names are consumed verbatim by Task 3's SQL.

- [ ] **Step 1: Write the failing test**

Append to `src/main/db/migrations.test.ts`, inside the top-level `describe('migration runner', ...)` block:

```ts
  it('creates the context layer tables', () => {
    const db = freshDb()
    runMigrations(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'context_%'")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort()

    expect(tables).toEqual(['context_facts', 'context_stats'])
  })

  it('enforces one fact per (kind, key)', () => {
    const db = freshDb()
    runMigrations(db)

    const insert = db.prepare(`
      INSERT INTO context_facts
        (id, kind, key, body, confidence, source, status, created_at, updated_at, last_seen_at)
      VALUES (?, 'tendency', 'sie-reschedule', ?, 0.5, 'distilled', 'active', 0, 0, 0)
    `)
    insert.run('f1', 'Reschedules the SIE block')

    // Without the unique index the layer accumulates near-duplicate facts and
    // the digest fills with the same observation phrased six ways.
    expect(() => insert.run('f2', 'Reschedules the SIE block again')).toThrow(/UNIQUE/)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/db/migrations.test.ts`
Expected: FAIL — `expected [] to equal [ 'context_facts', 'context_stats' ]`

- [ ] **Step 3: Add the migration**

In `src/main/db/migrations.ts`, add this object to the end of the `MIGRATIONS` array (after the `version: 15` entry, before the closing `]`):

```ts
  {
    version: 16,
    name: 'context-layer',
    // What Shingan has learned about the user, so a personality built to call
    // out patterns has an actual record of them instead of a vibe.
    //
    // Timestamps are milliseconds (Date.now()), matching every other table the
    // app writes through TypeScript. The `unixepoch()` defaults elsewhere in
    // this file are vestigial — no insert path in the codebase omits its
    // timestamp columns, so they never fire.
    //
    // The unique index on (kind, key) is what makes this a *layer* rather than
    // a log: a repeat observation updates one row instead of appending a near
    // duplicate that would crowd the digest with the same fact six ways.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS context_facts (
          id           TEXT PRIMARY KEY,
          kind         TEXT NOT NULL,
          key          TEXT NOT NULL,
          body         TEXT NOT NULL,
          evidence     TEXT,
          confidence   REAL NOT NULL DEFAULT 0.5,
          source       TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'active',
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_context_facts_kind_key
          ON context_facts(kind, key);

        CREATE INDEX IF NOT EXISTS idx_context_facts_render
          ON context_facts(status, confidence DESC);

        CREATE TABLE IF NOT EXISTS context_stats (
          metric      TEXT PRIMARY KEY,
          value_json  TEXT NOT NULL,
          computed_at INTEGER NOT NULL
        );
      `)
    },
  },
```

`kind`, `source`, and `status` are validated in TypeScript at the store boundary rather than by SQL `CHECK` constraints — matching how `context_*` values will be written and keeping the enum in one place.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/db/migrations.test.ts`
Expected: PASS — including the pre-existing `takes a fresh database to the latest version` test, which picks up version 16 automatically because `LATEST_SCHEMA_VERSION = MIGRATIONS.length`.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/migrations.test.ts
git commit -m "feat(db): add context_facts and context_stats tables"
```

---

### Task 3: Fact store with source precedence

**Files:**
- Create: `src/main/context/store.ts`
- Modify: `src/shared/types.ts` (add fact types near the `PersonalityMode` export at line 5)
- Test: `src/main/context/store.test.ts` (create)

**Interfaces:**
- Consumes: `context_facts` / `context_stats` from Task 2; `getDatabase()` from `../db/database`.
- Produces:
  - `SOURCE_RANK: Record<ContextFactSource, number>`
  - `upsertFact(input: FactInput, now?: number): ContextFact | null` — `null` means precedence refused the write
  - `listFacts(opts?: { status?: ContextFactStatus; minConfidence?: number }): ContextFact[]`
  - `getFactById(id: string): ContextFact | null`
  - `editFactBody(id: string, body: string, now?: number): ContextFact | null`
  - `dismissFact(id: string, now?: number): void`
  - `clearAllFacts(): void`
  - `decayFacts(now?: number, staleDays?: number, factor?: number): number`
  - `setStat(metric: string, value: unknown, now?: number): void`
  - `getStat<T>(metric: string): T | null`
  - types `ContextFact`, `ContextFactKind`, `ContextFactSource`, `ContextFactStatus`, `FactInput`

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, immediately after line 5 (`export type PersonalityMode = 'standard' | 'unbridled';`):

```ts
export type ContextFactKind = 'duty' | 'role' | 'project' | 'goal' | 'tendency';
export type ContextFactSource = 'distilled' | 'stat' | 'user';
export type ContextFactStatus = 'active' | 'dismissed' | 'superseded';

export const CONTEXT_FACT_KINDS: readonly ContextFactKind[] = [
  'role', 'duty', 'project', 'goal', 'tendency',
] as const;

export interface ContextFact {
  id: string;
  kind: ContextFactKind;
  key: string;
  body: string;
  evidence: string | null;
  confidence: number;
  source: ContextFactSource;
  status: ContextFactStatus;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}
```

`CONTEXT_FACT_KINDS` is ordered for rendering (Task 5 iterates it), not alphabetically.

- [ ] **Step 2: Write the failing test**

Create `src/main/context/store.test.ts`:

```ts
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
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npx vitest run src/main/context/store.test.ts`
Expected: FAIL — `Cannot find module './store'`

- [ ] **Step 3: Write the store**

Create `src/main/context/store.ts`:

```ts
import { randomUUID } from 'crypto'
import { getDatabase } from '../db/database'
import type {
  ContextFact,
  ContextFactKind,
  ContextFactSource,
  ContextFactStatus,
} from '../../shared/types'

/**
 * Write precedence. A producer may only overwrite a fact whose source ranks at
 * or below its own, which is the single rule that stops the layer arguing with
 * itself: a nightly stats run cannot bury a correction the user typed, and a
 * model paraphrase cannot bury either.
 */
export const SOURCE_RANK: Record<ContextFactSource, number> = {
  distilled: 0,
  stat: 1,
  user: 2,
}

const DEFAULT_CONFIDENCE: Record<ContextFactSource, number> = {
  distilled: 0.5,
  stat: 0.9,
  user: 1,
}

export interface FactInput {
  kind: ContextFactKind
  key: string
  body: string
  source: ContextFactSource
  confidence?: number
  evidence?: string | null
}

interface FactRow {
  id: string
  kind: string
  key: string
  body: string
  evidence: string | null
  confidence: number
  source: string
  status: string
  created_at: number
  updated_at: number
  last_seen_at: number
}

function toFact(row: FactRow): ContextFact {
  return {
    id: row.id,
    kind: row.kind as ContextFactKind,
    key: row.key,
    body: row.body,
    evidence: row.evidence,
    confidence: row.confidence,
    source: row.source as ContextFactSource,
    status: row.status as ContextFactStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function getFactById(id: string): ContextFact | null {
  const row = getDatabase()
    .prepare('SELECT * FROM context_facts WHERE id = ?')
    .get(id) as FactRow | undefined
  return row ? toFact(row) : null
}

/**
 * Insert or update one fact, keyed on (kind, key).
 *
 * Returns null when precedence refuses the write — the caller has not failed,
 * it has simply been outranked, so this is not an error path.
 */
export function upsertFact(input: FactInput, now = Date.now()): ContextFact | null {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT * FROM context_facts WHERE kind = ? AND key = ?')
    .get(input.kind, input.key) as FactRow | undefined

  if (existing && SOURCE_RANK[input.source] < SOURCE_RANK[existing.source as ContextFactSource]) {
    return null
  }

  const confidence = clamp(input.confidence ?? DEFAULT_CONFIDENCE[input.source])

  if (existing) {
    db.prepare(`
      UPDATE context_facts
         SET body = ?, evidence = ?, confidence = ?, source = ?,
             status = 'active', updated_at = ?, last_seen_at = ?
       WHERE id = ?
    `).run(input.body, input.evidence ?? null, confidence, input.source, now, now, existing.id)
    return getFactById(existing.id)
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO context_facts
      (id, kind, key, body, evidence, confidence, source, status, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, input.kind, input.key, input.body, input.evidence ?? null, confidence, input.source, now, now, now)

  return getFactById(id)
}

export function listFacts(
  opts: { status?: ContextFactStatus; minConfidence?: number } = {},
): ContextFact[] {
  const status = opts.status ?? 'active'
  const minConfidence = opts.minConfidence ?? 0

  const rows = getDatabase()
    .prepare(`
      SELECT * FROM context_facts
       WHERE status = ? AND confidence >= ?
       ORDER BY confidence DESC, last_seen_at DESC
    `)
    .all(status, minConfidence) as FactRow[]

  return rows.map(toFact)
}

/**
 * A hand-edit is the strongest signal the layer ever gets, so it both rewrites
 * the body and promotes the row to user-authored — which makes it immune to
 * every later distillation pass and to decay.
 */
export function editFactBody(id: string, body: string, now = Date.now()): ContextFact | null {
  getDatabase()
    .prepare(`
      UPDATE context_facts
         SET body = ?, source = 'user', confidence = 1, status = 'active', updated_at = ?
       WHERE id = ?
    `)
    .run(body, now, id)
  return getFactById(id)
}

export function dismissFact(id: string, now = Date.now()): void {
  getDatabase()
    .prepare("UPDATE context_facts SET status = 'dismissed', updated_at = ? WHERE id = ?")
    .run(now, id)
}

export function clearAllFacts(): void {
  getDatabase().exec('DELETE FROM context_facts')
}

/**
 * Fade facts nothing has re-observed lately. Nothing is deleted — a decayed
 * fact drops out of the digest but stays visible and restorable in Settings,
 * because "we stopped seeing evidence" is not the same as "this was false".
 */
export function decayFacts(now = Date.now(), staleDays = 90, factor = 0.7): number {
  const cutoff = now - staleDays * 86_400_000
  const result = getDatabase()
    .prepare(`
      UPDATE context_facts
         SET confidence = confidence * ?, updated_at = ?
       WHERE status = 'active' AND source != 'user' AND last_seen_at < ?
    `)
    .run(factor, now, cutoff)
  return result.changes
}

export function setStat(metric: string, value: unknown, now = Date.now()): void {
  getDatabase()
    .prepare(`
      INSERT INTO context_stats (metric, value_json, computed_at) VALUES (?, ?, ?)
      ON CONFLICT(metric) DO UPDATE SET value_json = excluded.value_json, computed_at = excluded.computed_at
    `)
    .run(metric, JSON.stringify(value), now)
}

export function getStat<T>(metric: string): T | null {
  const row = getDatabase()
    .prepare('SELECT value_json FROM context_stats WHERE metric = ?')
    .get(metric) as { value_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return null
  }
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/context/store.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/context/store.ts src/main/context/store.test.ts
git commit -m "feat(context): fact store with source precedence and decay"
```

---

### Task 4: Deterministic stats collector

**Files:**
- Create: `src/main/context/stats.ts`
- Test: `src/main/context/stats.test.ts` (create)

**Interfaces:**
- Consumes: `setStat` from Task 3; existing tables `tasks`, `job_runs`, `projects`.
- Produces:
  - `interface ContextStats { tasksThroughput; tasksOverdue; tasksLatencyDays; jobsReliability; coldProjects }` (exact shape below)
  - `computeStats(db: Database.Database, now?: number): ContextStats`
  - `refreshStats(now?: number): ContextStats` — computes, persists each metric, seeds threshold facts, runs decay

**Correction to spec:** the spec proposed joining `scan_runs` for cold projects. Unnecessary — `projects.status` already encodes exactly this (`active` ≤14d, `warm` 15–60, `dormant` 61–180, `abandoned` 180+, per `devtools/scanner/detect.ts:classifyStatus`). Query the column.

- [ ] **Step 1: Write the failing test**

Create `src/main/context/stats.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.REIGAN_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'reigan-stats-'))

const { getDatabase } = await import('../db/database')
const { computeStats, refreshStats } = await import('./stats')
const store = await import('./store')

const NOW = 1_700_000_000_000
const DAY = 86_400_000

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM tasks; DELETE FROM job_runs; DELETE FROM jobs;
    DELETE FROM projects; DELETE FROM context_facts; DELETE FROM context_stats;
  `)
})

function addTask(p: { id: string; status?: string; created?: number; completed?: number | null; due?: number | null }) {
  getDatabase()
    .prepare(`
      INSERT INTO tasks (id, title, status, priority, due_date, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, 'medium', ?, ?, ?, ?)
    `)
    .run(p.id, `Task ${p.id}`, p.status ?? 'backlog', p.due ?? null, p.created ?? NOW, p.created ?? NOW, p.completed ?? null)
}

describe('computeStats — tasks', () => {
  it('counts creations and completions inside the 30-day window only', () => {
    addTask({ id: 'recent', created: NOW - 5 * DAY })
    addTask({ id: 'old', created: NOW - 40 * DAY })
    addTask({ id: 'done-recent', status: 'done', created: NOW - 10 * DAY, completed: NOW - 2 * DAY })

    const s = computeStats(getDatabase(), NOW)

    expect(s.tasksThroughput.created).toBe(2)
    expect(s.tasksThroughput.completed).toBe(1)
    expect(s.tasksThroughput.open).toBe(2)
  })

  it('reports overdue count and the age of the oldest', () => {
    addTask({ id: 'late', due: NOW - 21 * DAY })
    addTask({ id: 'later', due: NOW - 3 * DAY })
    addTask({ id: 'fine', due: NOW + 5 * DAY })
    addTask({ id: 'done', status: 'done', due: NOW - 90 * DAY, completed: NOW })

    const s = computeStats(getDatabase(), NOW)

    // A finished task is never overdue, however late it was.
    expect(s.tasksOverdue.count).toBe(2)
    expect(s.tasksOverdue.oldestDays).toBe(21)
  })

  it('uses the median completion latency, not the mean', () => {
    // Means are worthless here: one task abandoned for a year drags the
    // average past every real datapoint and the digest reports a fiction.
    addTask({ id: 'a', status: 'done', created: NOW - 10 * DAY, completed: NOW - 9 * DAY })
    addTask({ id: 'b', status: 'done', created: NOW - 10 * DAY, completed: NOW - 8 * DAY })
    addTask({ id: 'c', status: 'done', created: NOW - 400 * DAY, completed: NOW })

    expect(computeStats(getDatabase(), NOW).tasksLatencyDays).toBe(2)
  })

  it('reports null latency when nothing has been completed', () => {
    addTask({ id: 'open' })
    expect(computeStats(getDatabase(), NOW).tasksLatencyDays).toBeNull()
  })
})

describe('computeStats — jobs and projects', () => {
  it('computes the job failure rate over the window', () => {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO jobs (id, name, capability_id, schedule_kind, schedule_expr, created_at)
      VALUES ('j1', 'Nightly', 'test.sync', 'interval', '1h', ?)
    `).run(NOW - 40 * DAY)

    const run = db.prepare('INSERT INTO job_runs (id, job_id, started_at, status) VALUES (?, ?, ?, ?)')
    run.run('r1', 'j1', NOW - 2 * DAY, 'success')
    run.run('r2', 'j1', NOW - 2 * DAY, 'failure')
    run.run('r3', 'j1', NOW - 2 * DAY, 'timeout')
    run.run('r4', 'j1', NOW - 60 * DAY, 'failure') // outside the window

    const s = computeStats(db, NOW)

    expect(s.jobsReliability.runs).toBe(3)
    expect(s.jobsReliability.failures).toBe(2) // timeout counts as a failure
    expect(s.jobsReliability.failureRate).toBeCloseTo(0.667, 2)
  })

  it('lists cold projects oldest first', () => {
    const db = getDatabase()
    const p = db.prepare(`
      INSERT INTO projects (id, path, name, status, last_modified, first_seen, last_scanned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    p.run('p1', '/a', 'alpha', 'dormant', NOW - 70 * DAY, NOW, NOW)
    p.run('p2', '/b', 'beta', 'abandoned', NOW - 200 * DAY, NOW, NOW)
    p.run('p3', '/c', 'gamma', 'active', NOW - 2 * DAY, NOW, NOW)

    const s = computeStats(db, NOW)

    expect(s.coldProjects.map((c) => c.name)).toEqual(['beta', 'alpha'])
    expect(s.coldProjects[0].days).toBe(200)
  })
})

describe('refreshStats', () => {
  it('persists each metric', () => {
    addTask({ id: 'late', due: NOW - 10 * DAY })
    refreshStats(NOW)

    expect(store.getStat('tasks.overdue')).toEqual({ count: 1, oldestDays: 10 })
  })

  it('seeds a tendency fact once the overdue pile passes the threshold', () => {
    for (let i = 0; i < 6; i++) addTask({ id: `t${i}`, due: NOW - (i + 1) * DAY })
    refreshStats(NOW)

    const fact = store.listFacts().find((f) => f.key === 'overdue-backlog')
    expect(fact).toBeDefined()
    expect(fact!.source).toBe('stat')
    expect(fact!.body).toContain('6')
  })

  it('does not seed the fact below the threshold', () => {
    addTask({ id: 't0', due: NOW - DAY })
    refreshStats(NOW)
    expect(store.listFacts().find((f) => f.key === 'overdue-backlog')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/context/stats.test.ts`
Expected: FAIL — `Cannot find module './stats'`

- [ ] **Step 3: Write the collector**

Create `src/main/context/stats.ts`:

```ts
import type Database from 'better-sqlite3'
import { getDatabase } from '../db/database'
import { decayFacts, setStat, upsertFact } from './store'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30
const OVERDUE_FACT_THRESHOLD = 5

export interface ContextStats {
  tasksThroughput: { created: number; completed: number; open: number }
  tasksOverdue: { count: number; oldestDays: number }
  tasksLatencyDays: number | null
  jobsReliability: { runs: number; failures: number; failureRate: number }
  coldProjects: Array<{ name: string; days: number }>
}

/**
 * Aggregates the user's own activity straight out of SQL.
 *
 * These are the numbers the model is not allowed to invent. Everything the
 * digest says about how far behind the user is traces back to a row count here,
 * which is what separates "you've rescheduled this four times" from a plausible
 * sounding figure a language model produced under pressure to land a joke.
 *
 * All timestamps in this database are milliseconds (Date.now()), not seconds.
 */
export function computeStats(db: Database.Database, now = Date.now()): ContextStats {
  const windowStart = now - WINDOW_DAYS * DAY_MS

  const created = (db
    .prepare('SELECT COUNT(*) AS c FROM tasks WHERE created_at >= ?')
    .get(windowStart) as { c: number }).c

  const completed = (db
    .prepare('SELECT COUNT(*) AS c FROM tasks WHERE completed_at IS NOT NULL AND completed_at >= ?')
    .get(windowStart) as { c: number }).c

  const open = (db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE status != 'done'")
    .get() as { c: number }).c

  const overdue = db
    .prepare(`
      SELECT COUNT(*) AS c, MIN(due_date) AS oldest
        FROM tasks
       WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ?
    `)
    .get(now) as { c: number; oldest: number | null }

  const durations = (db
    .prepare(`
      SELECT (completed_at - created_at) AS d
        FROM tasks
       WHERE completed_at IS NOT NULL AND completed_at >= created_at
       ORDER BY d ASC
    `)
    .all() as Array<{ d: number }>).map((r) => r.d)

  const jobs = db
    .prepare(`
      SELECT COUNT(*) AS runs,
             SUM(CASE WHEN status IN ('failure', 'timeout') THEN 1 ELSE 0 END) AS failures
        FROM job_runs
       WHERE started_at >= ?
    `)
    .get(windowStart) as { runs: number; failures: number | null }

  const cold = (db
    .prepare(`
      SELECT name, last_modified
        FROM projects
       WHERE status IN ('dormant', 'abandoned') AND last_modified IS NOT NULL
       ORDER BY last_modified ASC
       LIMIT 5
    `)
    .all() as Array<{ name: string; last_modified: number }>)

  const failures = jobs.failures ?? 0

  return {
    tasksThroughput: { created, completed, open },
    tasksOverdue: {
      count: overdue.c,
      oldestDays: overdue.oldest === null ? 0 : Math.floor((now - overdue.oldest) / DAY_MS),
    },
    tasksLatencyDays: median(durations) === null ? null : Math.round(median(durations)! / DAY_MS),
    jobsReliability: {
      runs: jobs.runs,
      failures,
      failureRate: jobs.runs === 0 ? 0 : failures / jobs.runs,
    },
    coldProjects: cold.map((p) => ({
      name: p.name,
      days: Math.floor((now - p.last_modified) / DAY_MS),
    })),
  }
}

/** Computes, persists, seeds threshold-tripped facts, and ages old ones. */
export function refreshStats(now = Date.now()): ContextStats {
  const stats = computeStats(getDatabase(), now)

  setStat('tasks.throughput', stats.tasksThroughput, now)
  setStat('tasks.overdue', stats.tasksOverdue, now)
  setStat('tasks.latency', { days: stats.tasksLatencyDays }, now)
  setStat('jobs.reliability', stats.jobsReliability, now)
  setStat('projects.cold', stats.coldProjects, now)

  if (stats.tasksOverdue.count > OVERDUE_FACT_THRESHOLD) {
    upsertFact(
      {
        kind: 'tendency',
        key: 'overdue-backlog',
        body: `Has ${stats.tasksOverdue.count} overdue tasks; the oldest is ${stats.tasksOverdue.oldestDays} days past due.`,
        source: 'stat',
        evidence: 'tasks table',
      },
      now,
    )
  }

  decayFacts(now)
  return stats
}

/** SQLite has no median. Averages are unusable here — see the latency test. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/context/stats.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/context/stats.ts src/main/context/stats.test.ts
git commit -m "feat(context): deterministic behavioural stats from app data"
```

---

### Task 5: Digest renderer

**Files:**
- Create: `src/main/context/digest.ts`
- Test: `src/main/context/digest.test.ts` (create)

**Interfaces:**
- Consumes: `ContextFact` type; `listFacts`, `getStat` from Task 3; `ContextStats` from Task 4.
- Produces:
  - `RENDER_THRESHOLD = 0.35`, `MAX_DIGEST_CHARS = 4800`
  - `renderDigest(facts: ContextFact[], stats: Partial<ContextStats>): string`
  - `hashDigest(text: string): string`
  - `buildContextDigest(): { text: string; hash: string }`

- [ ] **Step 1: Write the failing test**

Create `src/main/context/digest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/context/digest.test.ts`
Expected: FAIL — `Cannot find module './digest'`

- [ ] **Step 3: Write the renderer**

Create `src/main/context/digest.ts`:

```ts
import { createHash } from 'crypto'
import { CONTEXT_FACT_KINDS, type ContextFact, type ContextFactKind } from '../../shared/types'
import { getStat, listFacts } from './store'
import type { ContextStats } from './stats'

export const RENDER_THRESHOLD = 0.35
/** ~1200 tokens at the usual 4-chars-per-token rule of thumb. */
export const MAX_DIGEST_CHARS = 4800

const GROUP_HEADINGS: Record<ContextFactKind, string> = {
  role: 'Duties & roles',
  duty: 'Duties & roles',
  project: 'Goals & projects',
  goal: 'Goals & projects',
  tendency: 'Patterns worth naming',
}

/**
 * Renders what is known about the user into a block appended to the persona.
 *
 * Ranking is global by confidence and the cap is applied before grouping, so a
 * long tail of weakly-supported guesses can never crowd out a fact the user
 * typed by hand.
 */
export function renderDigest(facts: ContextFact[], stats: Partial<ContextStats>): string {
  const ranked = facts
    .filter((f) => f.status === 'active' && f.confidence >= RENDER_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)

  const statLines = renderStatLines(stats)
  if (ranked.length === 0 && statLines.length === 0) return ''

  const header = '## What you know about this user\n'
  const footer =
    '\nThis is what you have actually observed. When you call out a pattern, cite one from this list. ' +
    'Never invent a pattern, a count, or a date to make a better line — a confident wrong callout costs you ' +
    'more than saying nothing. Items marked (stated directly) came from the user and are ground truth.\n'

  const budget = MAX_DIGEST_CHARS - header.length - footer.length - statLines.join('\n').length - 32

  const kept: ContextFact[] = []
  let used = 0
  for (const f of ranked) {
    const line = factLine(f)
    if (used + line.length > budget) continue
    kept.push(f)
    used += line.length
  }

  const sections: string[] = []
  const seenHeadings = new Set<string>()
  for (const kind of CONTEXT_FACT_KINDS) {
    const heading = GROUP_HEADINGS[kind]
    if (seenHeadings.has(heading)) continue
    seenHeadings.add(heading)

    const inGroup = kept.filter((f) => GROUP_HEADINGS[f.kind] === heading)
    if (inGroup.length === 0) continue

    sections.push(`\n### ${heading}\n${inGroup.map(factLine).join('')}`)
  }

  if (statLines.length > 0) {
    sections.push(`\n### Current numbers\n${statLines.map((l) => `- ${l}\n`).join('')}`)
  }

  return `${header}${sections.join('')}${footer}`
}

function factLine(f: ContextFact): string {
  const mark = f.source === 'user' ? ' (stated directly)' : ''
  return `- ${f.body}${mark}\n`
}

function renderStatLines(stats: Partial<ContextStats>): string[] {
  const lines: string[] = []

  if (stats.tasksOverdue && stats.tasksOverdue.count > 0) {
    lines.push(
      `${stats.tasksOverdue.count} overdue tasks; the oldest is ${stats.tasksOverdue.oldestDays} days past due.`,
    )
  }
  if (stats.tasksThroughput) {
    const { created, completed, open } = stats.tasksThroughput
    lines.push(`Last 30 days: ${created} tasks created, ${completed} completed, ${open} still open.`)
  }
  if (stats.tasksLatencyDays !== null && stats.tasksLatencyDays !== undefined) {
    lines.push(`Median time from creating a task to finishing it: ${stats.tasksLatencyDays} days.`)
  }
  if (stats.jobsReliability && stats.jobsReliability.runs > 0 && stats.jobsReliability.failures > 0) {
    const pct = Math.round(stats.jobsReliability.failureRate * 100)
    lines.push(`${pct}% of scheduled job runs failed in the last 30 days.`)
  }
  if (stats.coldProjects && stats.coldProjects.length > 0) {
    const list = stats.coldProjects.map((p) => `${p.name} (${p.days}d)`).join(', ')
    lines.push(`Projects gone cold: ${list}.`)
  }

  return lines
}

export function hashDigest(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

/** Reads the live store and renders. Returns empty text when nothing is known. */
export function buildContextDigest(): { text: string; hash: string } {
  const facts = listFacts({ minConfidence: RENDER_THRESHOLD })
  const stats: Partial<ContextStats> = {
    tasksThroughput: getStat('tasks.throughput') ?? undefined,
    tasksOverdue: getStat('tasks.overdue') ?? undefined,
    tasksLatencyDays: getStat<{ days: number | null }>('tasks.latency')?.days ?? null,
    jobsReliability: getStat('jobs.reliability') ?? undefined,
    coldProjects: getStat('projects.cold') ?? undefined,
  }

  const text = renderDigest(facts, stats)
  return { text, hash: hashDigest(text) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/context/digest.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/context/digest.ts src/main/context/digest.test.ts
git commit -m "feat(context): capped digest renderer with confidence ranking"
```

---

### Task 6: Inject the digest into the agent

**Files:**
- Modify: `src/main/agents/reigan.ts:19-20,58-80,95-99,145-148`
- Test: `src/main/agents/reigan.test.ts` (create)

**Interfaces:**
- Consumes: `buildContextDigest()` from Task 5; `REIGAN_*_SYSTEM_PROMPT` from Task 1.
- Produces: `composeSystemPrompt(mode: PersonalityMode, digest: string): string` (newly exported for testability); `resetExecutor()` keeps its existing signature.

- [ ] **Step 1: Write the failing test**

Create `src/main/agents/reigan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from './reigan'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'

describe('composeSystemPrompt', () => {
  it('returns the bare persona when nothing is known yet', () => {
    expect(composeSystemPrompt('standard', '')).toBe(REIGAN_SYSTEM_PROMPT)
    expect(composeSystemPrompt('unbridled', '')).toBe(REIGAN_UNBRIDLED_SYSTEM_PROMPT)
  })

  it('appends the digest after the persona', () => {
    const digest = '## What you know about this user\n- Works evenings\n'
    const out = composeSystemPrompt('unbridled', digest)

    expect(out.startsWith(REIGAN_UNBRIDLED_SYSTEM_PROMPT)).toBe(true)
    expect(out).toContain('Works evenings')
  })

  it('feeds the same digest to standard mode', () => {
    // The context layer is shared; only the delivery differs between modes.
    const digest = '## What you know about this user\n- Works evenings\n'
    expect(composeSystemPrompt('standard', digest)).toContain('Works evenings')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agents/reigan.test.ts`
Expected: FAIL — `composeSystemPrompt is not a function`

- [ ] **Step 3: Wire the digest in**

In `src/main/agents/reigan.ts`:

Add the import beside the existing prompt import:

```ts
import { buildContextDigest } from '../context/digest'
```

Replace the two module-level cache variables:

```ts
let executor: AgentExecutor | null = null
let executorKey: string | null = null
```

Add the composer above `buildExecutor`:

```ts
/**
 * The persona plus whatever has been learned about the user.
 *
 * Concatenated rather than injected as a ChatPromptTemplate variable:
 * prompts.ts contains no curly braces today, so a template slot would work —
 * but the prompts are prose that gets edited often, and a stray brace in a
 * future edit would be parsed as a template variable and throw at runtime.
 */
export function composeSystemPrompt(mode: PersonalityMode, digest: string): string {
  const persona = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT
  return digest ? `${persona}\n\n${digest}` : persona
}
```

Change `buildExecutor`'s signature and its prompt line:

```ts
function buildExecutor(apiKey: string, mode: PersonalityMode, digest: string): AgentExecutor {
```

```ts
  const systemPrompt = composeSystemPrompt(mode, digest)
```

In `streamResponse`, replace the mode/cache block:

```ts
  const mode = getPersonalityMode()
  const { text: digest, hash } = buildContextDigest()
  const cacheKey = `${mode}:${hash}`

  if (!executor || executorKey !== cacheKey) {
    executor = buildExecutor(apiKey, mode, digest)
    executorKey = cacheKey
  }
```

And update `resetExecutor`:

```ts
export function resetExecutor(): void {
  executor = null
  executorKey = null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/agents/reigan.test.ts src/main/agents/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/reigan.ts src/main/agents/reigan.test.ts
git commit -m "feat(context): feed the learned digest into both personality modes"
```

---

### Task 7: Distillation pass

**Files:**
- Create: `src/main/context/distill.ts`
- Modify: `src/main/ipc/llm.ts` (after the assistant `saveMessage` call, ~line 60)
- Modify: `src/shared/types.ts` (add `contextLearningPaused: boolean` to `AppSettings`, after `unbridledModeAcknowledged` at line 75)
- Modify: `src/shared/constants.ts` (add `contextLearningPaused: false,` after line 46)
- Modify: `src/main/agents/tools/settingsTools.ts:17` (allowlist the key)
- Test: `src/main/context/distill.test.ts` (create)

**Interfaces:**
- Consumes: `upsertFact` from Task 3; `getDecodedSetting` from `../db/queries`; `recordAppError` from `../errors/errorLog`.
- Produces:
  - `parseDistillResponse(raw: string): FactInput[]`
  - `shouldDistill(conversationId: string, exchangeChars: number): boolean`
  - `resetDistillCounters(): void` (test seam)
  - `runDistillation(conversationId, turns, apiKey): Promise<number>`
  - `maybeDistill(conversationId, exchangeChars, turns, apiKey): void` — fire-and-forget entry point

- [ ] **Step 1: Write the failing test**

Create `src/main/context/distill.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { parseDistillResponse, resetDistillCounters, shouldDistill } from './distill'

beforeEach(() => resetDistillCounters())

const LONG = 'x'.repeat(300)

describe('shouldDistill', () => {
  it('does not fire before the turn threshold', () => {
    expect(shouldDistill('c1', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(false)
  })

  it('fires on the fourth substantive turn, then resets', () => {
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c1', LONG)).toBe(true)
    expect(shouldDistill('c1', LONG)).toBe(false)
  })

  it('ignores trivial exchanges entirely', () => {
    // "thanks" / "yep" carry nothing to learn and must not advance the counter,
    // or four acknowledgements in a row would trigger a pointless paid call.
    for (let i = 0; i < 10; i++) expect(shouldDistill('c1', 'thanks')).toBe(false)
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c1', LONG)).toBe(true)
  })

  it('counts each conversation separately', () => {
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c2', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(true)
  })
})

describe('parseDistillResponse', () => {
  it('parses a well-formed array', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'duty', key: 'day-job', body: 'Works the AWP evening shift', confidence: 0.7 },
    ]))

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'duty', key: 'day-job', source: 'distilled', confidence: 0.7 })
  })

  it('unwraps a fenced code block', () => {
    const raw = '```json\n[{"kind":"goal","key":"sie","body":"Sitting the SIE","confidence":0.6}]\n```'
    expect(parseDistillResponse(raw)).toHaveLength(1)
  })

  it('returns nothing for unparseable output', () => {
    // A model that returns prose must write zero facts, not a garbage row that
    // then gets recited back to the user as something Shingan "knows".
    expect(parseDistillResponse('Sure! Here are some observations about the user.')).toEqual([])
    expect(parseDistillResponse('')).toEqual([])
    expect(parseDistillResponse('{"not":"an array"}')).toEqual([])
  })

  it('drops entries with an unknown kind', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'vibe', key: 'a', body: 'Nope', confidence: 0.5 },
      { kind: 'goal', key: 'b', body: 'Yes', confidence: 0.5 },
    ]))

    expect(out.map((f) => f.key)).toEqual(['b'])
  })

  it('drops entries missing a key or body', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'goal', key: '', body: 'No key', confidence: 0.5 },
      { kind: 'goal', key: 'x', body: '   ', confidence: 0.5 },
      { kind: 'goal', key: 'ok', body: 'Fine', confidence: 0.5 },
    ]))

    expect(out.map((f) => f.key)).toEqual(['ok'])
  })

  it('clamps confidence into range and defaults when absent', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'goal', key: 'a', body: 'High', confidence: 5 },
      { kind: 'goal', key: 'b', body: 'Negative', confidence: -2 },
      { kind: 'goal', key: 'c', body: 'Missing' },
    ]))

    expect(out[0].confidence).toBe(1)
    expect(out[1].confidence).toBe(0)
    expect(out[2].confidence).toBe(0.5)
  })

  it('caps how many facts one pass may write', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: 'goal', key: `k${i}`, body: `B${i}`, confidence: 0.5 }))
    expect(parseDistillResponse(JSON.stringify(many))).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/context/distill.test.ts`
Expected: FAIL — `Cannot find module './distill'`

- [ ] **Step 3: Write the distiller**

Create `src/main/context/distill.ts`:

```ts
import { ChatAnthropic } from '@langchain/anthropic'
import { CONTEXT_FACT_KINDS, type ContextFactKind } from '../../shared/types'
import { getDecodedSetting } from '../db/queries'
import { recordAppError } from '../errors/errorLog'
import { listFacts, upsertFact, type FactInput } from './store'

const TURNS_PER_RUN = 4
const MIN_EXCHANGE_CHARS = 200
const MAX_FACTS_PER_PASS = 12
const DISTILL_MODEL = 'claude-haiku-4-5-20251001'

const turnCounters = new Map<string, number>()

/** Test seam — module state would otherwise leak between cases. */
export function resetDistillCounters(): void {
  turnCounters.clear()
}

/**
 * Debounce gate.
 *
 * Trivial exchanges deliberately do not advance the counter: four
 * "thanks"/"yep" turns in a row carry nothing to learn, and letting them tick
 * the counter would buy a paid model call that can only produce noise.
 */
export function shouldDistill(conversationId: string, exchange: string): boolean {
  if (exchange.length < MIN_EXCHANGE_CHARS) return false

  const next = (turnCounters.get(conversationId) ?? 0) + 1
  if (next < TURNS_PER_RUN) {
    turnCounters.set(conversationId, next)
    return false
  }

  turnCounters.set(conversationId, 0)
  return true
}

const PROMPT = `You maintain a factual profile of one person, used by their personal assistant.

From the conversation below, extract only DURABLE facts about the person — their duties, roles, active projects, stated goals, and behavioural tendencies. A durable fact is still true next month.

Do NOT extract: anything about the current task, one-off questions, your own suggestions, or transient moods.

Return ONLY a JSON array, no prose. Each element:
  { "kind": "duty" | "role" | "project" | "goal" | "tendency",
    "key": "stable-kebab-slug",
    "body": "one sentence, third person",
    "confidence": 0.0-1.0 }

Reuse an existing key verbatim when you are updating that same fact. Return [] if nothing durable appeared.

EXISTING FACTS:
{existing}

CONVERSATION:
{conversation}`

/**
 * Parses the model's reply, discarding anything malformed.
 *
 * Deliberately strict and silent: a distillation that returns prose, or a row
 * with an invented `kind`, must write nothing at all. A garbage fact does not
 * stay garbage — it gets rendered into the digest and recited back to the user
 * as something the assistant believes about them.
 */
export function parseDistillResponse(raw: string): FactInput[] {
  const text = stripFence(raw).trim()
  if (!text) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: FactInput[] = []
  for (const entry of parsed) {
    if (out.length >= MAX_FACTS_PER_PASS) break
    if (typeof entry !== 'object' || entry === null) continue

    const e = entry as Record<string, unknown>
    const kind = e.kind
    const key = typeof e.key === 'string' ? e.key.trim() : ''
    const body = typeof e.body === 'string' ? e.body.trim() : ''

    if (typeof kind !== 'string') continue
    if (!CONTEXT_FACT_KINDS.includes(kind as ContextFactKind)) continue
    if (!key || !body) continue

    const rawConfidence = typeof e.confidence === 'number' ? e.confidence : 0.5
    const confidence = Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0.5

    out.push({ kind: kind as ContextFactKind, key, body, confidence, source: 'distilled' })
  }

  return out
}

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1] : raw
}

export async function runDistillation(
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
): Promise<number> {
  const existing = listFacts()
    .map((f) => `- [${f.kind}/${f.key}] ${f.body}`)
    .join('\n')

  const conversation = turns
    .slice(-8)
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join('\n\n')

  const llm = new ChatAnthropic({
    apiKey,
    model: DISTILL_MODEL,
    temperature: null,
    topP: 1,
    maxTokens: 1024,
  })

  const reply = await llm.invoke([
    {
      role: 'user',
      content: PROMPT.replace('{existing}', existing || '(none yet)').replace(
        '{conversation}',
        conversation,
      ),
    },
  ])

  const raw = typeof reply.content === 'string'
    ? reply.content
    : reply.content
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text) : ''))
        .join('')

  let written = 0
  for (const fact of parseDistillResponse(raw)) {
    if (upsertFact(fact)) written++
  }
  return written
}

/**
 * Fire-and-forget entry point for the chat path.
 *
 * Never awaited by the caller and never throws: the reply is already on screen
 * by the time this runs, so a failure here must not touch the user's turn. It
 * is still recorded rather than swallowed — a learning layer that quietly
 * stopped learning would present as no symptom at all.
 */
export function maybeDistill(
  conversationId: string,
  exchange: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
): void {
  if (getDecodedSetting('contextLearningPaused') === 'true') return
  if (!apiKey) return
  if (!shouldDistill(conversationId, exchange)) return

  void runDistillation(turns, apiKey).catch((err) => {
    recordAppError({
      source: 'llm',
      operation: 'contextDistillation',
      error: err,
      severity: 'warning',
      context: { conversationId, consequence: 'context layer did not learn from this exchange' },
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/context/distill.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Add the setting**

In `src/shared/types.ts`, after `unbridledModeAcknowledged: boolean;` (line 75):

```ts
  /** Halts distillation. Existing facts stay and keep feeding the digest. */
  contextLearningPaused: boolean;
```

In `src/shared/constants.ts`, after `unbridledModeAcknowledged: false,` (line 46):

```ts
  contextLearningPaused: false,
```

In `src/main/agents/tools/settingsTools.ts:17`, add the key to the allowlist array:

```ts
  'audioInputDeviceId', 'audioOutputDeviceId', 'personalityMode', 'unbridledModeAcknowledged',
  'contextLearningPaused',
```

- [ ] **Step 6: Hook into the chat path**

In `src/main/ipc/llm.ts`, add the import:

```ts
import { maybeDistill } from '../context/distill'
```

Immediately after the existing `saveMessage({ conversationId: activeConversationId, role: 'assistant', content: fullResponse })` line, insert:

```ts
    // Fire-and-forget. Learning must never delay or break a reply, so this is
    // deliberately not awaited — see maybeDistill's own error handling.
    maybeDistill(
      activeConversationId,
      message + fullResponse,
      [...history, { role: 'user', content: message }, { role: 'assistant', content: fullResponse }],
      getDecodedSetting('anthropicApiKey') ?? '',
    )
```

- [ ] **Step 7: Run the full suite and commit**

Run: `npx vitest run`
Expected: PASS

```bash
git add src/main/context/distill.ts src/main/context/distill.test.ts src/main/ipc/llm.ts src/shared/types.ts src/shared/constants.ts src/main/agents/tools/settingsTools.ts
git commit -m "feat(context): debounced distillation of durable facts after chat turns"
```

---

### Task 8: IPC and boot wiring

**Files:**
- Create: `src/main/ipc/context.ts`
- Modify: `src/shared/types.ts` (IPC channels, in the `IPC` const at line 255)
- Modify: `src/preload/index.ts` (bridge methods, after the Settings group ~line 47)
- Modify: `src/main/index.ts` (import + register + boot stats refresh)

**Interfaces:**
- Consumes: `listFacts`, `editFactBody`, `dismissFact`, `clearAllFacts` from Task 3; `refreshStats` from Task 4.
- Produces: `registerContextHandlers(): void`; `window.api.listContextFacts/editContextFact/dismissContextFact/clearContextFacts/refreshContextStats`.

- [ ] **Step 1: Add the IPC channels**

In `src/shared/types.ts`, inside the `IPC` const (after the Settings group, ~line 274):

```ts
  // Context layer
  CONTEXT_LIST_FACTS: 'context:list-facts',
  CONTEXT_EDIT_FACT: 'context:edit-fact',
  CONTEXT_DISMISS_FACT: 'context:dismiss-fact',
  CONTEXT_CLEAR_FACTS: 'context:clear-facts',
  CONTEXT_REFRESH_STATS: 'context:refresh-stats',
```

- [ ] **Step 2: Write the handlers**

Create `src/main/ipc/context.ts`:

```ts
import { ipcMain } from 'electron'
import { IPC, type ContextFact } from '../../shared/types'
import { clearAllFacts, dismissFact, editFactBody, listFacts } from '../context/store'
import { refreshStats } from '../context/stats'

export function registerContextHandlers(): void {
  // Both active and dismissed, so the review UI can show what was rejected and
  // let the user put it back.
  ipcMain.handle(IPC.CONTEXT_LIST_FACTS, (): { active: ContextFact[]; dismissed: ContextFact[] } => ({
    active: listFacts({ status: 'active' }),
    dismissed: listFacts({ status: 'dismissed' }),
  }))

  ipcMain.handle(IPC.CONTEXT_EDIT_FACT, (_e, payload: { id: string; body: string }) =>
    editFactBody(payload.id, payload.body),
  )

  ipcMain.handle(IPC.CONTEXT_DISMISS_FACT, (_e, id: string) => {
    dismissFact(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.CONTEXT_CLEAR_FACTS, () => {
    clearAllFacts()
    return { ok: true }
  })

  ipcMain.handle(IPC.CONTEXT_REFRESH_STATS, () => refreshStats())
}
```

- [ ] **Step 3: Expose them in preload**

In `src/preload/index.ts`, inside the `api` object after the Settings group:

```ts
  // Context layer
  listContextFacts: () => ipcRenderer.invoke(IPC.CONTEXT_LIST_FACTS),
  editContextFact: (id: string, body: string) => ipcRenderer.invoke(IPC.CONTEXT_EDIT_FACT, { id, body }),
  dismissContextFact: (id: string) => ipcRenderer.invoke(IPC.CONTEXT_DISMISS_FACT, id),
  clearContextFacts: () => ipcRenderer.invoke(IPC.CONTEXT_CLEAR_FACTS),
  refreshContextStats: () => ipcRenderer.invoke(IPC.CONTEXT_REFRESH_STATS),
```

- [ ] **Step 4: Register at boot**

In `src/main/index.ts`, add the import beside the other IPC imports (~line 14):

```ts
import { registerContextHandlers } from './ipc/context'
```

and, beside `registerPerformanceHandlers()` in the registration block (~line 151):

```ts
    registerContextHandlers()
```

Then, after all handlers are registered, refresh the stats once so the digest has numbers on the first turn of a cold start:

```ts
    // Cheap: five aggregate queries against local SQLite. Guarded because a
    // stats failure must not stop the window from opening.
    try {
      refreshStats()
    } catch (err) {
      console.error('[context] initial stats refresh failed:', err)
    }
```

with the matching import:

```ts
import { refreshStats } from './context/stats'
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/context.ts src/main/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(context): IPC surface and boot-time stats refresh"
```

---

### Task 9: Context review Settings tab

**Files:**
- Create: `src/renderer/src/components/Settings/tabs/ContextSettings.tsx`
- Modify: `src/renderer/src/components/Settings/settingsRegistry.ts`

**Interfaces:**
- Consumes: `window.api.listContextFacts/editContextFact/dismissContextFact/clearContextFacts` from Task 8; `contextLearningPaused` setting from Task 7.
- Produces: `ContextSettings` component; one `SETTINGS_TABS` entry with `id: 'context'`.

- [ ] **Step 1: Build the tab**

Create `src/renderer/src/components/Settings/tabs/ContextSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Brain, Check, Trash2, X } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useToastStore } from '../../../stores/toastStore'
import { SettingRow } from '../controls/SettingRow'
import { Button } from '../../shared/Button'
import type { ContextFact, ContextFactKind } from '../../../../../shared/types'

const GROUPS: Array<{ heading: string; kinds: ContextFactKind[] }> = [
  { heading: 'Duties & roles', kinds: ['role', 'duty'] },
  { heading: 'Goals & projects', kinds: ['project', 'goal'] },
  { heading: 'Patterns', kinds: ['tendency'] },
]

export function ContextSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const push = useToastStore((s) => s.push)

  const [facts, setFacts] = useState<ContextFact[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const load = async () => {
    const result = await window.api.listContextFacts()
    setFacts(result.active)
  }

  useEffect(() => {
    void load()
  }, [])

  const startEdit = (fact: ContextFact) => {
    setEditingId(fact.id)
    setDraft(fact.body)
  }

  const saveEdit = async (id: string) => {
    if (!draft.trim()) return
    await window.api.editContextFact(id, draft.trim())
    setEditingId(null)
    await load()
    push('Correction saved — Shingan will treat this as ground truth', 'info')
  }

  const dismiss = async (id: string) => {
    await window.api.dismissContextFact(id)
    await load()
  }

  const clearAll = async () => {
    await window.api.clearContextFacts()
    setConfirmClear(false)
    await load()
    push('Cleared everything Shingan had learned', 'info')
  }

  return (
    <div className="space-y-6">
      <SettingRow
        label="Keep learning"
        labelJa="学習"
        description="Shingan builds up what it knows about your duties, projects, and habits from your conversations and your actual task data. Pausing keeps what it already knows but stops it adding more."
      >
        <Button
          size="sm"
          variant={settings.contextLearningPaused ? 'ghost' : 'primary'}
          onClick={() => set('contextLearningPaused', !settings.contextLearningPaused)}
        >
          {settings.contextLearningPaused ? 'Paused' : 'Active'}
        </Button>
      </SettingRow>

      {facts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg px-3 py-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <Brain size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Nothing learned yet. Facts appear here as you talk to Shingan and as your task data accumulates.
          </span>
        </div>
      ) : (
        GROUPS.map((group) => {
          const inGroup = facts.filter((f) => group.kinds.includes(f.kind))
          if (inGroup.length === 0) return null

          return (
            <div key={group.heading} className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {group.heading}
              </h3>

              {inGroup.map((fact) => (
                <div
                  key={fact.id}
                  className="rounded-lg px-3 py-2 flex items-start gap-2"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  {editingId === fact.id ? (
                    <>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(fact.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 bg-transparent text-sm outline-none"
                        style={{ color: 'var(--text-primary)' }}
                      />
                      <button onClick={() => void saveEdit(fact.id)} title="Save">
                        <Check size={14} style={{ color: 'var(--reigan-primary)' }} />
                      </button>
                      <button onClick={() => setEditingId(null)} title="Cancel">
                        <X size={14} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="flex-1 text-left text-sm"
                        style={{ color: 'var(--text-primary)' }}
                        onClick={() => startEdit(fact)}
                        title="Click to correct"
                      >
                        {fact.body}
                      </button>
                      {fact.source === 'user' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', color: 'var(--text-secondary)' }}>
                          yours
                        </span>
                      )}
                      <button onClick={() => void dismiss(fact.id)} title="Remove">
                        <Trash2 size={13} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )
        })
      )}

      {facts.length > 0 && (
        confirmClear ? (
          <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)' }}>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              This deletes everything Shingan has learned about you, including your own corrections. It starts over from nothing.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void clearAll()}>Clear everything</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>Clear everything</Button>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the tab**

In `src/renderer/src/components/Settings/settingsRegistry.ts`, add `Brain` to the lucide import, add the component import, and insert the entry directly after `personality`:

```ts
import { Sliders, Languages, Mic, Plug, Flame, Palette, ShieldCheck, Brain, type LucideIcon } from 'lucide-react'
```

```ts
import { ContextSettings } from './tabs/ContextSettings'
```

```ts
  { id: 'context', labelEn: 'Context', labelJa: '記憶', icon: Brain, component: ContextSettings },
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds. If `window.api` types are declared in a `.d.ts`, add the five methods from Task 8 Step 3 there too.

- [ ] **Step 4: Manual check**

Run: `npm run dev`. Open Settings (Ctrl+,) → Context. Expect the empty state. Toggle "Keep learning" off and on. Send four substantive chat messages, reopen the tab, and expect at least one fact. Click a fact, edit it, confirm it gains the "yours" badge.

- [ ] **Step 5: Run the full suite and commit**

Run: `npx vitest run`
Expected: PASS

```bash
git add src/renderer/src/components/Settings/tabs/ContextSettings.tsx src/renderer/src/components/Settings/settingsRegistry.ts
git commit -m "feat(context): Settings tab for reviewing and correcting learned facts"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Personality rewrite (§6, Appendix A) | 1 |
| Storage / migration 16 (§1) | 2 |
| Fact store + precedence (§2 precedence, §3 write rules) | 3 |
| Deterministic stats (§2) | 4 |
| Decay (§3) | 3 (`decayFacts`) + 4 (invoked by `refreshStats`) |
| Digest + cap + injection (§4) | 5, 6 |
| Distillation + debounce + failure handling (§3) | 7 |
| Review surface (§5) | 8, 9 |
| Pause learning / clear all (§5) | 7 (setting), 9 (UI) |
| Testing table (§Testing) | every task's test step |

No gaps.

**Corrections this plan makes to the spec** — all verified against the code at `7611645b`:

1. **Timestamps are INTEGER milliseconds, not TEXT.** `queries.ts:18`, `jobs/store.ts:150`, and `scanner/detect.ts:270` all write `Date.now()`. The `unixepoch()` defaults never fire.
2. **Cold projects come from `projects.status`, not a `scan_runs` join** — `classifyStatus` already encodes the exact staleness bands.
3. **`LATEST_SCHEMA_VERSION` is derived** (`MIGRATIONS.length`), so no manual bump.
4. **`timeout` counts as a job failure** alongside `failure` — the spec said "failure rate" without enumerating the statuses, and `job_runs.status` has eight of them.

**Placeholder scan:** clean. Every code step carries real code; the one cross-document reference (Task 1 Step 3 → spec Appendix A) points at an exact, approved, delimited block rather than deferring a decision.

**Type consistency:** `FactInput`, `ContextFact`, `ContextFactKind|Source|Status`, `SOURCE_RANK`, `ContextStats` are defined once (Tasks 3–4) and referenced with matching names and shapes in Tasks 5–9. `upsertFact` returns `ContextFact | null` at every call site, and both consumers (Task 4's `refreshStats`, Task 7's `runDistillation`) handle the `null` refusal.
