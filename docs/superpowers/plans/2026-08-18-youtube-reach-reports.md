# YouTube Reach-Report Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill `yt_daily_stats.impressions` and `.ctr` with real thumbnail-impression data from the YouTube Reporting API, re-enabling the `revival_thumbnail` and `revival_content` audit findings.

**Architecture:** A daily system job runs a new `youtube.ingestReach` capability. It ensures a `channel_reach_basic_a1` reporting job exists on Google's side, lists reports it has not consumed, downloads each as CSV, parses it with a pure function, and upserts the rows. Network access stays in thin wrappers; the parser is pure and the ingest is DB-level, so both are tested without mocking `googleapis`.

**Tech Stack:** TypeScript, Electron main process, `googleapis` v144 (`youtubereporting` v1), `better-sqlite3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-youtube-reach-reports-design.md`

## Global Constraints

- Report type id is exactly `channel_reach_basic_a1`. Never hardcode a different one.
- CSV metric columns are `video_thumbnail_impressions` and `video_thumbnail_impressions_ctr`. Locate them **by header name**, never by column position.
- `ctr` is stored as a **fraction** (0.043 = 4.3%), because `audit.ts` multiplies it by 100 for display.
- `date` is stored as `YYYY-MM-DD`, matching every other row in `yt_daily_stats`.
- Reporting API calls MUST NOT go through `meteredCall` — they do not consume Data API units.
- Every Reporting API call goes through `reportingCall`, so `invalid_grant` reaches `handleInvalidGrant` in exactly one place.
- "Reporting job just created" and "no new reports" are **success** results, never failures. A failure here burns the job's 4-attempt retry budget and disables it before data can arrive.
- Run `npx vitest run <file>` for a single file and `npx vitest run` for the suite. Typecheck with `npx tsc --noEmit -p tsconfig.node.json`.
- Commit messages: lowercase conventional prefix, and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/db/migrations.ts` | **Modify.** Add migration 15, `yt-reach-reports`. |
| `src/main/youtube/reachStore.ts` | **Create.** The ledger of consumed reports: record, query, prune. No network. |
| `src/main/youtube/reachCsv.ts` | **Create.** Pure CSV → rows. No imports, no I/O. |
| `src/main/youtube/reporting.ts` | **Create.** Reporting API client, job ensure, list/download, ingest orchestration. |
| `src/main/youtube/api.ts` | **Modify.** Add `getReportingClient()` and `reportingCall()`. |
| `src/main/youtube/sync.ts` | **Modify.** Stop the stats upsert from owning `impressions`/`ctr`. |
| `src/main/capabilities/defs/youtube.ts` | **Modify.** Register `youtube.ingestReach`. |
| `src/main/jobs/seed.ts` | **Modify.** Seed the daily job, disabled. |
| `src/main/youtube/audit.ts` | **Modify.** `ctr_unavailable` copy names the job to enable. |

The spec calls for one new module. The pure parser is split into `reachCsv.ts` because it touches no API surface and its test table is large enough to deserve its own file; `reporting.ts` remains the only code that imports `youtubereporting`.

---

### Task 1: Migration 15 and the consumed-report ledger

**Files:**
- Modify: `src/main/db/migrations.ts` (append to `MIGRATIONS`, after the `version: 14` entry)
- Create: `src/main/youtube/reachStore.ts`
- Test: `src/main/youtube/reachStore.test.ts`

**Interfaces:**
- Consumes: `getDatabase()` from `../db/database`.
- Produces: `recordIngestedReport(r: IngestedReport): void`, `ingestedReportIds(): Set<string>`, `pruneReachReports(olderThanMs: number): number`, and `interface IngestedReport { reportId: string; jobId: string; windowStart: string; windowEnd: string; rowsIngested: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/main/youtube/reachStore.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-reach-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { recordIngestedReport, ingestedReportIds, pruneReachReports } = await import('./reachStore')

const report = (reportId: string) => ({
  reportId,
  jobId: 'job-1',
  windowStart: '2026-08-01',
  windowEnd: '2026-08-02',
  rowsIngested: 12,
})

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_reach_reports')
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('reach report ledger', () => {
  it('remembers a report so it is never ingested twice', () => {
    recordIngestedReport(report('r-1'))

    expect(ingestedReportIds().has('r-1')).toBe(true)
    expect(ingestedReportIds().has('r-2')).toBe(false)
  })

  it('treats a re-recorded report as the same row rather than a duplicate', () => {
    recordIngestedReport(report('r-1'))
    recordIngestedReport({ ...report('r-1'), rowsIngested: 30 })

    const rows = getDatabase().prepare('SELECT * FROM yt_reach_reports').all()
    expect(rows).toHaveLength(1)
    expect((rows[0] as { rows_ingested: number }).rows_ingested).toBe(30)
  })

  it('prunes ledger rows older than the retention window', () => {
    recordIngestedReport(report('old'))
    getDatabase()
      .prepare('UPDATE yt_reach_reports SET ingested_at = ? WHERE report_id = ?')
      .run(Date.now() - 100 * 86_400_000, 'old')
    recordIngestedReport(report('fresh'))

    expect(pruneReachReports(90 * 86_400_000)).toBe(1)
    expect(ingestedReportIds().has('old')).toBe(false)
    expect(ingestedReportIds().has('fresh')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/youtube/reachStore.test.ts`
Expected: FAIL — `Cannot find module './reachStore'`.

- [ ] **Step 3: Add migration 15**

In `src/main/db/migrations.ts`, append this entry to the `MIGRATIONS` array immediately after the `version: 14` entry:

```typescript
  {
    version: 15,
    name: 'yt-reach-reports',
    // The ledger of Reporting API reports already consumed.
    //
    // Dedupe is by report id alone, which also handles YouTube's replacement
    // datasets correctly: a corrected window arrives as a *new* report id, so it
    // reads as new work and its rows overwrite the originals through the same
    // upsert. Tracking versions per window would add state that buys nothing.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS yt_reach_reports (
          report_id     TEXT PRIMARY KEY,
          job_id        TEXT NOT NULL,
          window_start  TEXT NOT NULL,
          window_end    TEXT NOT NULL,
          rows_ingested INTEGER NOT NULL DEFAULT 0,
          ingested_at   INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_yt_reach_ingested
          ON yt_reach_reports(ingested_at);
      `)
    },
  },
```

- [ ] **Step 4: Write `reachStore.ts`**

Create `src/main/youtube/reachStore.ts`:

```typescript
import { getDatabase } from '../db/database'

/**
 * The ledger of Reporting API reports this app has already consumed.
 *
 * Kept separate from the ingest itself so "what have we already read?" is
 * answerable without touching the network, and so the retention rule lives in
 * one place rather than being re-derived at each call site.
 */

export interface IngestedReport {
  reportId: string
  jobId: string
  windowStart: string
  windowEnd: string
  rowsIngested: number
}

export function recordIngestedReport(report: IngestedReport): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_reach_reports
         (report_id, job_id, window_start, window_end, rows_ingested, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id) DO UPDATE SET
         rows_ingested = excluded.rows_ingested,
         ingested_at = excluded.ingested_at`
    )
    .run(
      report.reportId,
      report.jobId,
      report.windowStart,
      report.windowEnd,
      report.rowsIngested,
      Date.now()
    )
}

/** Every report id already consumed, for filtering a fresh listing. */
export function ingestedReportIds(): Set<string> {
  const rows = getDatabase()
    .prepare('SELECT report_id FROM yt_reach_reports')
    .all() as Array<{ report_id: string }>
  return new Set(rows.map((r) => r.report_id))
}

/**
 * Drops ledger rows past the retention window, returning how many went.
 *
 * Google keeps reports for 60 days, so a ledger entry older than that can never
 * match a listed report again and is pure growth. This is a ledger of what has
 * been consumed, not an archive.
 */
export function pruneReachReports(olderThanMs: number): number {
  return getDatabase()
    .prepare('DELETE FROM yt_reach_reports WHERE ingested_at < ?')
    .run(Date.now() - olderThanMs).changes
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/main/youtube/reachStore.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Confirm the migration runner still agrees with itself**

Run: `npx vitest run src/main/db/migrations.test.ts`
Expected: PASS. `LATEST_SCHEMA_VERSION` is derived from `MIGRATIONS.length`, so no number needs updating — but `assertMigrationsWellFormed` will throw if the new entry is out of order.

- [ ] **Step 7: Commit**

```bash
git add src/main/db/migrations.ts src/main/youtube/reachStore.ts src/main/youtube/reachStore.test.ts
git commit -m "feat(youtube): add the consumed reach-report ledger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The pure CSV parser

**Files:**
- Create: `src/main/youtube/reachCsv.ts`
- Test: `src/main/youtube/reachCsv.test.ts`

**Interfaces:**
- Consumes: nothing. This file imports nothing.
- Produces: `parseReachCsv(text: string): ReachRow[]` and `interface ReachRow { date: string; videoId: string; impressions: number; ctr: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/main/youtube/reachCsv.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { parseReachCsv } from './reachCsv'

const header = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr'

describe('parseReachCsv', () => {
  it('reads a report into dated per-video rows', () => {
    const rows = parseReachCsv(`${header}\n20260815,UC123,vid-a,4000,0.043\n`)

    expect(rows).toEqual([{ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.043 }])
  })

  it('accepts an already-hyphenated date', () => {
    // Google's docs do not pin the format down, so both are handled rather than
    // guessed at.
    const rows = parseReachCsv(`${header}\n2026-08-15,UC123,vid-a,4000,0.043\n`)

    expect(rows[0].date).toBe('2026-08-15')
  })

  it('normalises a percentage CTR to a fraction', () => {
    // The metric is documented as a "percentage" and defined as "clicks divided
    // by impressions", which are different scales. audit.ts multiplies by 100,
    // so anything above 1 must be a percentage.
    const rows = parseReachCsv(`${header}\n20260815,UC123,vid-a,4000,4.3\n`)

    expect(rows[0].ctr).toBeCloseTo(0.043)
  })

  it('finds columns by header name rather than position', () => {
    const reordered = 'video_thumbnail_impressions_ctr,video_id,date,video_thumbnail_impressions'
    const rows = parseReachCsv(`${reordered}\n0.043,vid-a,20260815,4000\n`)

    expect(rows[0]).toEqual({ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.043 })
  })

  it('unwraps quoted fields', () => {
    const rows = parseReachCsv(`${header}\n"20260815","UC123","vid-a","4000","0.043"\n`)

    expect(rows[0].videoId).toBe('vid-a')
    expect(rows[0].impressions).toBe(4000)
  })

  it('returns nothing for an empty or header-only report', () => {
    expect(parseReachCsv('')).toEqual([])
    expect(parseReachCsv(`${header}\n`)).toEqual([])
  })

  it('skips a row with a missing video id or unparseable numbers', () => {
    const rows = parseReachCsv(
      `${header}\n20260815,UC123,,4000,0.043\n20260815,UC123,vid-b,not-a-number,0.043\n` +
        '20260815,UC123,vid-c,900,0.02\n'
    )

    expect(rows.map((r) => r.videoId)).toEqual(['vid-c'])
  })

  it('throws when the file is not a reach report at all', () => {
    // A silent empty array here would look exactly like "no data yet" and hide a
    // report type change behind a job that reports success forever.
    expect(() => parseReachCsv('views,likes\n10,2\n')).toThrow(/video_thumbnail_impressions/)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/youtube/reachCsv.test.ts`
Expected: FAIL — `Cannot find module './reachCsv'`.

- [ ] **Step 3: Write `reachCsv.ts`**

Create `src/main/youtube/reachCsv.ts`:

```typescript
/**
 * Reach-report CSV → rows, and nothing else.
 *
 * Pure on purpose: the two things about this format that Google's documentation
 * does not pin down — the date format and whether the CTR is a percentage or a
 * fraction — are absorbed here, where both readings can be tested without a
 * network round trip or a fixture file.
 */

export interface ReachRow {
  date: string
  videoId: string
  impressions: number
  ctr: number
}

const DATE = 'date'
const VIDEO = 'video_id'
const IMPRESSIONS = 'video_thumbnail_impressions'
const CTR = 'video_thumbnail_impressions_ctr'

export function parseReachCsv(text: string): ReachRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []

  const header = splitCsvLine(lines[0])
  const at = (name: string): number => header.indexOf(name)
  const dateAt = at(DATE)
  const videoAt = at(VIDEO)
  const impressionsAt = at(IMPRESSIONS)
  const ctrAt = at(CTR)

  // Failing loudly beats returning []: an empty result is indistinguishable from
  // "no data yet", which would let a changed report type sit undetected behind a
  // job that reports success every night.
  if (dateAt < 0 || videoAt < 0 || impressionsAt < 0 || ctrAt < 0) {
    throw new Error(
      `Not a reach report: expected ${IMPRESSIONS} and ${CTR} columns, got "${lines[0]}".`
    )
  }

  const rows: ReachRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const videoId = cells[videoAt] ?? ''
    const impressions = Number(cells[impressionsAt])
    const ctr = Number(cells[ctrAt])
    const date = normaliseDate(cells[dateAt] ?? '')

    // One malformed row must not cost the other 1,200 in the same file.
    if (!videoId || !date || !Number.isFinite(impressions) || !Number.isFinite(ctr)) continue

    rows.push({ date, videoId, impressions, ctr: normaliseCtr(ctr) })
  }
  return rows
}

/** `20260815` and `2026-08-15` both mean the same day; yt_daily_stats stores the latter. */
function normaliseDate(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** A click-through rate cannot exceed 1, so anything above it arrived as a percentage. */
function normaliseCtr(value: number): number {
  return value > 1 ? value / 100 : value
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/main/youtube/reachCsv.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/youtube/reachCsv.ts src/main/youtube/reachCsv.test.ts
git commit -m "feat(youtube): parse reach-report CSV into dated per-video rows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Ingest rows, and stop the sync from erasing them

**Files:**
- Create: `src/main/youtube/reachIngest.ts`
- Modify: `src/main/youtube/sync.ts:188-200` (the `upsertStat` statement)
- Test: `src/main/youtube/reachIngest.test.ts`

**Interfaces:**
- Consumes: `ReachRow` from `./reachCsv`, `getDatabase()` from `../db/database`.
- Produces: `ingestReachRows(rows: ReachRow[]): { written: number; skipped: number }`.

This is the task the spec exists for. `syncVideoDailyStats` currently writes literal `0` into `impressions` and `ctr` and its `ON CONFLICT` clause copies those zeroes over any existing value — so without this change the 05:00 sync erases what the 05:30 ingest wrote, every night.

- [ ] **Step 1: Write the failing test**

Create `src/main/youtube/reachIngest.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-ingest-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { ingestReachRows } = await import('./reachIngest')

function addVideo(id: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_videos
         (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
          has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
       VALUES (?, 'T', 'd', ?, 600, 'public', null, 1, '[]', '22', 100, 0, 0, ?)`
    )
    .run(id, Date.now(), Date.now())
}

function addStatRow(videoId: string, date: string, views: number): void {
  getDatabase()
    .prepare('INSERT INTO yt_daily_stats (video_id, date, views) VALUES (?, ?, ?)')
    .run(videoId, date, views)
}

const statRow = (videoId: string, date: string) =>
  getDatabase()
    .prepare('SELECT * FROM yt_daily_stats WHERE video_id = ? AND date = ?')
    .get(videoId, date) as { views: number; impressions: number; ctr: number } | undefined

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_videos; DELETE FROM yt_daily_stats;')
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ingestReachRows', () => {
  it('adds impressions to a day the sync already wrote, leaving views alone', () => {
    addVideo('vid-a')
    addStatRow('vid-a', '2026-08-15', 120)

    const result = ingestReachRows([
      { date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.03 },
    ])

    expect(result).toEqual({ written: 1, skipped: 0 })
    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 120, impressions: 4000, ctr: 0.03 })
  })

  it('creates a row for a day the sync never wrote', () => {
    // A day with impressions and no views is not noise — it is exactly the
    // signal revival_thumbnail exists to catch.
    addVideo('vid-a')

    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 900, ctr: 0.01 }])

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 0, impressions: 900 })
  })

  it('skips a video that is not in the catalog', () => {
    const result = ingestReachRows([
      { date: '2026-08-15', videoId: 'deleted-vid', impressions: 900, ctr: 0.01 },
    ])

    expect(result).toEqual({ written: 0, skipped: 1 })
    expect(statRow('deleted-vid', '2026-08-15')).toBeUndefined()
  })

  it('overwrites an earlier value when a corrected report arrives', () => {
    addVideo('vid-a')
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 900, ctr: 0.01 }])
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 1500, ctr: 0.02 }])

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ impressions: 1500, ctr: 0.02 })
  })

  it('survives the channel sync writing the same day', () => {
    // The regression this whole design turns on: the sync writes 0 into
    // impressions and ctr, so if its upsert owns those columns it erases every
    // ingested value on the next nightly run.
    addVideo('vid-a')
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.03 }])

    getDatabase()
      .prepare(
        `INSERT INTO yt_daily_stats
           (video_id, date, views, watch_time_minutes, avg_view_duration_s, avg_view_percentage,
            subs_gained, subs_lost, impressions, ctr, likes, comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, date) DO UPDATE SET
           views = excluded.views, watch_time_minutes = excluded.watch_time_minutes,
           avg_view_duration_s = excluded.avg_view_duration_s,
           avg_view_percentage = excluded.avg_view_percentage,
           subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost,
           likes = excluded.likes, comments = excluded.comments`
      )
      .run('vid-a', '2026-08-15', 200, 40, 60, 50, 1, 0, 0, 0, 3, 1)

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 200, impressions: 4000, ctr: 0.03 })
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/youtube/reachIngest.test.ts`
Expected: FAIL — `Cannot find module './reachIngest'`.

- [ ] **Step 3: Write `reachIngest.ts`**

Create `src/main/youtube/reachIngest.ts`:

```typescript
import { getDatabase } from '../db/database'
import type { ReachRow } from './reachCsv'

/**
 * Writes reach rows into `yt_daily_stats`, touching only the two columns the
 * Reporting API owns.
 *
 * Rows for videos absent from `yt_videos` are dropped rather than inserted:
 * reports cover deleted and private videos too, and orphan stat rows would
 * survive every catalog cleanup with nothing to join them back to.
 */
export function ingestReachRows(rows: ReachRow[]): { written: number; skipped: number } {
  const db = getDatabase()

  const known = new Set(
    (db.prepare('SELECT id FROM yt_videos').all() as Array<{ id: string }>).map((r) => r.id)
  )

  const upsert = db.prepare(
    `INSERT INTO yt_daily_stats (video_id, date, impressions, ctr)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(video_id, date) DO UPDATE SET
       impressions = excluded.impressions, ctr = excluded.ctr`
  )

  let written = 0
  let skipped = 0

  db.transaction(() => {
    for (const row of rows) {
      if (!known.has(row.videoId)) {
        skipped++
        continue
      }
      upsert.run(row.videoId, row.date, row.impressions, row.ctr)
      written++
    }
  })()

  return { written, skipped }
}
```

- [ ] **Step 4: Stop the sync from owning the reach columns**

In `src/main/youtube/sync.ts`, the `upsertStat` statement (around line 188) currently ends its conflict clause with `impressions = excluded.impressions, ctr = excluded.ctr,`. Delete that one line so the statement reads:

```typescript
  const upsertStat = db.prepare(
    `INSERT INTO yt_daily_stats
       (video_id, date, views, watch_time_minutes, avg_view_duration_s, avg_view_percentage,
        subs_gained, subs_lost, impressions, ctr, likes, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id, date) DO UPDATE SET
       views = excluded.views, watch_time_minutes = excluded.watch_time_minutes,
       avg_view_duration_s = excluded.avg_view_duration_s,
       avg_view_percentage = excluded.avg_view_percentage,
       subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost,
       likes = excluded.likes, comments = excluded.comments`
  )
```

The `impressions, ctr` columns stay in the INSERT list — a brand new row still needs a value, and the sync supplies `0`. Only the *update* path gives them up. Replace the two `0, // ... see above` argument comments in `syncVideoDailyStats` with:

```typescript
        0, // impressions — insert-only default; owned by reachIngest thereafter
        0, // ctr — insert-only default; owned by reachIngest thereafter
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/main/youtube/reachIngest.test.ts`
Expected: PASS, 5 tests — including `survives the channel sync writing the same day`.

- [ ] **Step 6: Commit**

```bash
git add src/main/youtube/reachIngest.ts src/main/youtube/reachIngest.test.ts src/main/youtube/sync.ts
git commit -m "feat(youtube): ingest reach rows without the sync erasing them

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Reporting API client and error funnel

**Files:**
- Modify: `src/main/youtube/api.ts` (append after `analyticsCall`)
- Test: `src/main/youtube/reportingCall.test.ts`

**Interfaces:**
- Consumes: `googleAuth`, `handleInvalidGrant`, `isInvalidGrantError` from `../auth/googleAuth`; `CapabilityError` from `../capabilities/types`.
- Produces: `getReportingClient(): youtubereporting_v1.Youtubereporting` and `reportingCall<T>(label: string, fn: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Create `src/main/youtube/reportingCall.test.ts`:

```typescript
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-reporting-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../db/database')
const { reportingCall } = await import('./api')
const { CapabilityError } = await import('../capabilities/types')

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('reportingCall', () => {
  it('passes a successful call straight through', async () => {
    await expect(reportingCall('jobs.list', async () => 'ok')).resolves.toBe('ok')
  })

  it('turns a dead grant into a not_connected error rather than a raw failure', async () => {
    // The whole point of the wrapper: every Google surface routes invalid_grant
    // to one place, so the user gets one "reconnect" prompt instead of N.
    const dead = Object.assign(new Error('invalid_grant'), {
      response: { data: { error: 'invalid_grant' } },
    })

    const err = await reportingCall('jobs.list', async () => {
      throw dead
    }).catch((e) => e)

    expect(err).toBeInstanceOf(CapabilityError)
    expect((err as InstanceType<typeof CapabilityError>).code).toBe('not_connected')
    expect((err as Error).message).toMatch(/Reconnect your Google account/)
  })

  it('reports any other failure with its own message intact', async () => {
    // Google's "API has not been used in project ..." text contains the
    // enablement link; wrapping it in something friendlier would throw away the
    // only actionable part.
    const err = await reportingCall('jobs.list', async () => {
      throw new Error('YouTube Reporting API has not been used in project 220819498258 before')
    }).catch((e) => e)

    expect((err as Error).message).toMatch(/has not been used in project 220819498258/)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/main/youtube/reportingCall.test.ts`
Expected: FAIL — `reportingCall is not a function`.

- [ ] **Step 3: Add the client and wrapper to `api.ts`**

In `src/main/youtube/api.ts`, widen the `googleapis` type import to include the reporting namespace:

```typescript
import { google, type youtube_v3, type youtubeAnalytics_v2, type youtubereporting_v1 } from 'googleapis'
```

Then append after `analyticsCall`:

```typescript
/**
 * The Reporting API client.
 *
 * A third Google surface, sharing the `yt-analytics.readonly` scope the
 * Analytics calls already hold — so a connected account needs no further
 * consent to use it.
 */
export function getReportingClient(): youtubereporting_v1.Youtubereporting {
  const auth = googleAuth.getClient()
  if (!auth) {
    throw new CapabilityError(
      'No Google account connected. Connect one in Settings first.',
      'not_connected'
    )
  }
  if (!googleAuth.hasScopes('youtube')) {
    throw new CapabilityError(
      'Your Google account is connected but has not granted YouTube access. ' +
        'Reconnect in Settings to approve the YouTube scopes.',
      'not_connected'
    )
  }
  return google.youtubereporting({ version: 'v1', auth })
}

/**
 * Reporting API calls, sharing the auth failure handling of the other two.
 *
 * Deliberately not metered: bulk reports draw on a separate quota, and charging
 * them against the 10,000 Data API units would refuse syncs that are affordable.
 * Errors other than a dead grant keep Google's own message — for a disabled API
 * that text carries the enablement link, which is the only useful part.
 */
export async function reportingCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isInvalidGrantError(err)) {
      throw new CapabilityError(handleInvalidGrant(`YouTube Reporting ${label}`), 'not_connected')
    }
    throw new CapabilityError(
      `YouTube Reporting ${label} failed: ${(err as Error)?.message ?? String(err)}`,
      'handler_failed'
    )
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/main/youtube/reportingCall.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no output. If `youtubereporting_v1` does not resolve, check the export name with `ls node_modules/googleapis/build/src/apis/youtubereporting/`.

- [ ] **Step 6: Commit**

```bash
git add src/main/youtube/api.ts src/main/youtube/reportingCall.test.ts
git commit -m "feat(youtube): add the Reporting API client and error funnel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Orchestration, capability, and scheduled job

**Files:**
- Create: `src/main/youtube/reporting.ts`
- Modify: `src/main/capabilities/defs/youtube.ts` (append to `youtubeCapabilities`)
- Modify: `src/main/jobs/seed.ts` (append a third `ensure(...)` call)

**Interfaces:**
- Consumes: `getReportingClient`, `reportingCall` from `./api`; `parseReachCsv` from `./reachCsv`; `ingestReachRows` from `./reachIngest`; `ingestedReportIds`, `recordIngestedReport`, `pruneReachReports` from `./reachStore`; `googleAuth` from `../auth/googleAuth`.
- Produces: `ingestReachReports(): Promise<ReachIngestResult>` where `interface ReachIngestResult { jobCreated: boolean; reportsIngested: number; rowsWritten: number; rowsSkipped: number; durationMs: number }`.

- [ ] **Step 1: Write `reporting.ts`**

There is no unit test for this file: it is the network wrapper the design deliberately keeps thin, and every branch worth asserting lives in `reachCsv`, `reachIngest`, `reachStore`, or `reportingCall`, all already covered. Verification is Step 4's registration test plus the real run in Task 6.

Create `src/main/youtube/reporting.ts`:

```typescript
import { getReportingClient, reportingCall } from './api'
import { parseReachCsv } from './reachCsv'
import { ingestReachRows } from './reachIngest'
import { ingestedReportIds, pruneReachReports, recordIngestedReport } from './reachStore'
import { googleAuth } from '../auth/googleAuth'
import { CapabilityError } from '../capabilities/types'

/**
 * Reach-report ingest.
 *
 * Thumbnail impressions and CTR exist in exactly one place in Google's APIs:
 * the Reporting API's bulk reach reports. They are not available to the
 * targeted Analytics queries `sync.ts` makes, which is why `yt_daily_stats`
 * carried two empty columns for as long as it did.
 *
 * The shape is dictated by how the API works. Reports are generated
 * asynchronously: a job is created once, Google backfills 30 days, and each new
 * day appears as a downloadable CSV within 48 hours. So the first two runs have
 * nothing to fetch — and must say so as a *success*, because a failure here
 * spends the scheduler's retry budget and disables the job before any data can
 * arrive.
 */

const REPORT_TYPE_ID = 'channel_reach_basic_a1'
const JOB_NAME = 'REIGAN reach'
/** Google keeps reports 60 days; a ledger row older than that can never match again. */
const LEDGER_RETENTION_MS = 90 * 86_400_000

export interface ReachIngestResult {
  jobCreated: boolean
  reportsIngested: number
  rowsWritten: number
  rowsSkipped: number
  durationMs: number
}

export async function ingestReachReports(): Promise<ReachIngestResult> {
  const startedAt = Date.now()
  const client = getReportingClient()

  const { jobId, created } = await ensureReportingJob(client)
  if (created) {
    // Nothing exists to download yet, and will not for ~48 hours. Returning
    // early keeps that first run honest rather than reporting "0 reports" as
    // though the job had been running for weeks.
    return {
      jobCreated: true,
      reportsIngested: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      durationMs: Date.now() - startedAt,
    }
  }

  const auth = googleAuth.getClient()
  if (!auth) throw new CapabilityError('No Google account connected.', 'not_connected')

  const already = ingestedReportIds()
  let reportsIngested = 0
  let rowsWritten = 0
  let rowsSkipped = 0

  for (const report of await listReports(client, jobId)) {
    if (!report.id || already.has(report.id) || !report.downloadUrl) continue

    // The download URL is an authenticated endpoint, so it goes through the
    // OAuth client rather than a bare fetch — that also keeps the access token
    // refreshed by the same code path as every other Google call.
    const csv = await reportingCall(`report ${report.id}`, () =>
      auth.request<string>({ url: report.downloadUrl as string, responseType: 'text' })
    )

    const rows = parseReachCsv(csv.data)
    const { written, skipped } = ingestReachRows(rows)

    recordIngestedReport({
      reportId: report.id,
      jobId,
      windowStart: (report.startTime ?? '').slice(0, 10),
      windowEnd: (report.endTime ?? '').slice(0, 10),
      rowsIngested: written,
    })

    reportsIngested++
    rowsWritten += written
    rowsSkipped += skipped
  }

  pruneReachReports(LEDGER_RETENTION_MS)

  return {
    jobCreated: false,
    reportsIngested,
    rowsWritten,
    rowsSkipped,
    durationMs: Date.now() - startedAt,
  }
}

/** Finds this app's reporting job, creating it on first use. Idempotent by report type. */
async function ensureReportingJob(
  client: ReturnType<typeof getReportingClient>
): Promise<{ jobId: string; created: boolean }> {
  const listed = await reportingCall('jobs.list', () => client.jobs.list({}))
  const existing = (listed.data.jobs ?? []).find((j) => j.reportTypeId === REPORT_TYPE_ID)
  if (existing?.id) return { jobId: existing.id, created: false }

  const created = await reportingCall('jobs.create', () =>
    client.jobs.create({ requestBody: { reportTypeId: REPORT_TYPE_ID, name: JOB_NAME } })
  )
  if (!created.data.id) {
    throw new CapabilityError('YouTube accepted the reporting job but returned no id.', 'handler_failed')
  }
  return { jobId: created.data.id, created: true }
}

/** Every report Google currently holds for the job, across pages. */
async function listReports(
  client: ReturnType<typeof getReportingClient>,
  jobId: string
): Promise<Array<{ id?: string | null; startTime?: string | null; endTime?: string | null; downloadUrl?: string | null }>> {
  const all: Array<{ id?: string | null; startTime?: string | null; endTime?: string | null; downloadUrl?: string | null }> = []
  let pageToken: string | undefined

  do {
    const res = await reportingCall('jobs.reports.list', () =>
      client.jobs.reports.list({ jobId, pageToken })
    )
    all.push(...(res.data.reports ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return all
}
```

- [ ] **Step 2: Register the capability**

In `src/main/capabilities/defs/youtube.ts`, add the import:

```typescript
import { ingestReachReports } from '../../youtube/reporting'
```

and append this entry to the `youtubeCapabilities` array, immediately after the `youtube.sync` entry:

```typescript
  {
    id: 'youtube.ingestReach',
    title: 'Ingest YouTube reach reports',
    description:
      'Download thumbnail impression and click-through-rate data from the YouTube Reporting API ' +
      'into the local cache. These metrics are unavailable to the Analytics API the channel sync ' +
      'uses, and they are what the thumbnail and packaging audit findings run on. ' +
      'Costs no Data API quota.',
    risk: 'network',
    requiresGoogle: true,
    schema: z.object({}),
    handler: () => ingestReachReports(),
    formatResult: (r: Awaited<ReturnType<typeof ingestReachReports>>) =>
      r.jobCreated
        ? 'Reach collection started. Google generates the first report within 48 hours, and ' +
          '30 days of history will backfill with it.'
        : r.reportsIngested === 0
          ? 'No new reach reports yet.'
          : `Ingested ${r.reportsIngested} report(s): ${r.rowsWritten} daily rows` +
            `${r.rowsSkipped > 0 ? `, ${r.rowsSkipped} skipped for videos not in the catalog` : ''}` +
            `, in ${(r.durationMs / 1000).toFixed(1)}s.`,
  },
```

- [ ] **Step 3: Seed the scheduled job**

In `src/main/jobs/seed.ts`, append a third `ensure(...)` call inside `seedSystemJobs()`, after the "Sync YouTube channel" block:

```typescript
  ensure({
    name: 'Ingest YouTube reach reports',
    capabilityId: 'youtube.ingestReach',
    scheduleKind: 'daily_at',
    // Half an hour after the channel sync, so the videos a report references
    // are already in the catalog — reach rows for an unknown video are dropped.
    scheduleExpr: '05:30',
    // Reports Google has already generated stay listed for 60 days, so a missed
    // night is picked up whole by the next run. Replaying each missed day would
    // re-download the same files to write the same rows.
    catchUpPolicy: 'run_once',
    timeoutMs: 15 * 60_000,
    enabled: false,
    disabledReason: 'Connect a Google account with YouTube access, then enable this job.',
  })
```

- [ ] **Step 4: Run the capability registration and seed tests**

Run: `npx vitest run src/main/capabilities/registration.test.ts src/main/jobs`
Expected: PASS. The registration test checks for id collisions and rule violations across every capability; a missing `schema` or a duplicate id fails here.

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx vitest run`
Expected: no typecheck output; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/youtube/reporting.ts src/main/capabilities/defs/youtube.ts src/main/jobs/seed.ts
git commit -m "feat(youtube): schedule daily reach-report ingest

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Point the audit at the new job, and prove the findings come back

**Files:**
- Modify: `src/main/youtube/audit.ts` (the `ctr_unavailable` finding's `detail` and `recommendation`)
- Test: `src/main/youtube/audit.test.ts` (append one test to the existing `CTR analysis availability` describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Copy and coverage only.

- [ ] **Step 1: Write the failing test**

Append to the `describe('CTR analysis availability', ...)` block in `src/main/youtube/audit.test.ts`:

```typescript
  it('names the job to enable rather than calling the data impossible', () => {
    addVideo({ id: 'quiet', title: 'No impression data', ageDays: 200, lifetimeViews: 2000 })
    addDailyStats('quiet', 28, { views: 20 })

    const finding = runCatalogAudit().find((f) => f.kind === 'ctr_unavailable')

    expect(finding!.recommendation).toMatch(/Ingest YouTube reach reports/)
  })

  it('produces the thumbnail finding once reach data has been ingested', () => {
    // The end state this whole feature exists for: with impressions present, the
    // packaging findings work again and the unavailability notice disappears.
    for (let i = 0; i < 5; i++) {
      addVideo({ id: `base${i}`, title: `Baseline ${i}`, ageDays: 200, lifetimeViews: 2000 })
      addDailyStats(`base${i}`, 28, { views: 20, impressions: 200, ctr: 0.1, avp: 50 })
    }
    addVideo({ id: 'lowctr', title: 'Poor thumbnail', ageDays: 200, lifetimeViews: 2000 })
    addDailyStats('lowctr', 28, { views: 10, impressions: 200, ctr: 0.02, avp: 50 })

    const findings = runCatalogAudit()

    expect(findings.find((f) => f.kind === 'revival_thumbnail')?.videoId).toBe('lowctr')
    expect(findings.some((f) => f.kind === 'ctr_unavailable')).toBe(false)
  })
```

- [ ] **Step 2: Run the tests and watch the first fail**

Run: `npx vitest run src/main/youtube/audit.test.ts`
Expected: FAIL on `names the job to enable` — the current recommendation says "until reach-report ingest is built". The second test should already PASS, since the audit logic was never the problem.

- [ ] **Step 3: Update the finding's copy**

In `src/main/youtube/audit.ts`, replace the `detail` and `recommendation` of the `ctr_unavailable` finding with:

```typescript
      detail:
        'No impression data has been collected for this channel yet. Thumbnail impressions and ' +
        'click-through rate come from the YouTube Reporting API, which delivers them as daily ' +
        'bulk reports rather than through the Analytics queries the channel sync makes.',
      evidence: { videosConsidered: recent.size, source: 'channel_reach_basic_a1' },
      recommendation:
        'Enable the "Ingest YouTube reach reports" job in Automations → Jobs. Google generates ' +
        'the first report within 48 hours and backfills 30 days of history with it; these ' +
        'findings start working as soon as it lands.',
```

Also update the comment above the `if` block: the reason the data is missing is no longer "this app does not ingest it" but "none has arrived yet".

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/main/youtube/audit.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && npx vitest run`
Expected: no typecheck output; every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/main/youtube/audit.ts src/main/youtube/audit.test.ts
git commit -m "feat(youtube): point the CTR gap notice at the ingest job

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan: the one thing code cannot do

`youtubereporting.googleapis.com` is a separate API and is almost certainly not enabled in Google Cloud project `220819498258`. The first real run will fail with Google's own message, which carries the enablement link:

> YouTube Reporting API has not been used in project 220819498258 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtubereporting.googleapis.com/overview?project=220819498258 then retry.

Enable it, enable the "Ingest YouTube reach reports" job in Automations → Jobs, and run it once manually. Expect "Reach collection started" on that first run, then real data about 48 hours later.
