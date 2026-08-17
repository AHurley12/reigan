import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ERROR_SOURCES } from '../../shared/errors'

/**
 * The error log's load-bearing promises:
 *  - recording a failure can never itself cause one,
 *  - repeated identical failures collapse instead of flooding the table,
 *  - a secret that reaches it in context is not written in plaintext, and
 *  - a row outlives whatever it describes.
 */

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'reigan-errorlog-'))
  process.env.REIGAN_TEST_USERDATA = userData
})

afterEach(async () => {
  const { closeDatabase } = await import('../db/database')
  closeDatabase()
  rmSync(userData, { recursive: true, force: true })
})

async function load() {
  const [{ getDatabase }, { runMigrations }, log] = await Promise.all([
    import('../db/database'),
    import('../db/migrations'),
    import('./errorLog'),
  ])
  runMigrations(getDatabase())
  return { db: getDatabase(), ...log }
}

describe('recording', () => {
  it('stores a failure with its code, subject and stack', async () => {
    const { recordAppError, listAppErrors } = await load()
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })

    recordAppError({
      source: 'scanner',
      operation: 'runScan',
      error: err,
      subject: 'C:/Users/x/protected',
    })

    const [row] = listAppErrors()
    expect(row.source).toBe('scanner')
    expect(row.operation).toBe('runScan')
    expect(row.message).toBe('permission denied')
    expect(row.code).toBe('EACCES')
    expect(row.subject).toBe('C:/Users/x/protected')
    expect(row.severity).toBe('error')
    expect(row.occurrences).toBe(1)
    expect(row.stack).toContain('Error: permission denied')
  })

  it('accepts a thrown non-Error without losing the message', async () => {
    const { recordAppError, listAppErrors } = await load()
    recordAppError({ source: 'shell', operation: 'run', error: 'exited with signal SIGKILL' })
    expect(listAppErrors()[0].message).toBe('exited with signal SIGKILL')
  })

  it('never throws, even with an unserialisable context', async () => {
    const { recordAppError, listAppErrors } = await load()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() =>
      recordAppError({
        source: 'vault',
        operation: 'searchSnippets',
        error: new Error('boom'),
        context: circular,
      })
    ).not.toThrow()

    expect(listAppErrors()).toHaveLength(1)
  })

  it('accepts every source the shared vocabulary declares', async () => {
    const { recordAppError, listAppErrors } = await load()
    for (const source of ERROR_SOURCES) {
      recordAppError({ source, operation: 'probe', error: new Error(`from ${source}`) })
    }
    // A source rejected by the CHECK constraint would be swallowed by the
    // never-throw guarantee, so the only way to notice is to count.
    expect(listAppErrors({ limit: 500 })).toHaveLength(ERROR_SOURCES.length)
  })
})

describe('schema and vocabulary agree', () => {
  it('accepts exactly the sources shared/errors.ts declares', async () => {
    const { schemaAllowedSources } = await load()
    // The migration hardcodes its CHECK list on purpose — a migration is
    // history and must not shift under an already-migrated database. That makes
    // drift possible, so it is caught here instead: adding a source to
    // shared/errors.ts without a migration to widen the constraint fails this
    // test rather than silently dropping every write from the new source.
    expect(schemaAllowedSources().sort()).toEqual([...ERROR_SOURCES].sort())
  })
})

describe('collapsing', () => {
  it('counts repeats of the same failure on one row', async () => {
    const { recordAppError, listAppErrors, summariseAppErrors } = await load()
    for (let i = 0; i < 40; i++) {
      recordAppError({
        source: 'organizer',
        operation: 'executeOp',
        error: Object.assign(new Error('permission denied'), { code: 'EACCES' }),
        subject: `C:/files/${i}.txt`,
      })
    }

    const rows = listAppErrors()
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(40)
    // The newest example is kept — when reading a recurring failure you want a
    // current instance, not the first one from weeks ago.
    expect(rows[0].subject).toBe('C:/files/39.txt')

    const summary = summariseAppErrors()
    expect(summary.distinct).toBe(1)
    expect(summary.total).toBe(40)
  })

  it('ignores digits in the message, so a varying timeout is one problem', async () => {
    const { recordAppError, listAppErrors } = await load()
    recordAppError({ source: 'localhost', operation: 'probe', error: new Error('timed out after 5001ms') })
    recordAppError({ source: 'localhost', operation: 'probe', error: new Error('timed out after 5002ms') })

    const rows = listAppErrors()
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(2)
  })

  it('keeps genuinely different failures apart', async () => {
    const { recordAppError, listAppErrors } = await load()
    recordAppError({ source: 'scanner', operation: 'runScan', error: new Error('disk full') })
    recordAppError({ source: 'scanner', operation: 'runScan', error: new Error('permission denied') })
    recordAppError({ source: 'vault', operation: 'runScan', error: new Error('disk full') })

    expect(listAppErrors()).toHaveLength(3)
  })

  it('collapses a job retried through to its disable onto one escalating row', async () => {
    const { recordAppError, listAppErrors } = await load()
    // What four failing attempts of one automation actually look like.
    for (let attempt = 1; attempt <= 4; attempt++) {
      recordAppError({
        source: 'jobs',
        operation: 'youtube.syncChannel',
        error: 'YouTube Analytics API has not been used in project 220819498258 before or it is disabled.',
        subject: 'Sync YouTube channel',
        severity: attempt === 4 ? 'fatal' : 'error',
        context: { attempt },
      })
    }

    const rows = listAppErrors()
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(4)
    // The attempt that gave up upgrades the row rather than adding one.
    expect(rows[0].severity).toBe('fatal')
    expect(rows[0].subject).toBe('Sync YouTube channel')
  })
})

describe('redaction', () => {
  it('does not write a secret carried in context', async () => {
    const { recordAppError, listAppErrors, db } = await load()
    const secret = 'postgres://admin:hunter2@db.internal:5432/prod'

    recordAppError({
      source: 'vault',
      operation: 'createSnippet',
      error: new Error('encryption unavailable'),
      context: { title: 'prod db', body: secret },
    })

    const stored = listAppErrors()[0].context as { title: string; body: string }
    expect(stored.title).toBe('prod db')
    expect(stored.body).toBe('[redacted]')

    // Belt and braces: the plaintext must not be anywhere in the row, not just
    // absent from the key we happened to check.
    const raw = db.prepare('SELECT * FROM app_errors').all()
    expect(JSON.stringify(raw)).not.toContain('hunter2')
  })

  it('does not write OAuth tokens or prompt text', async () => {
    const { recordAppError, db } = await load()
    // Widening the log past Dev Tools widened what can reach it: the auth and
    // LLM paths carry these, and neither existed when the redaction list was
    // first written.
    recordAppError({
      source: 'google',
      operation: 'refreshGrant',
      error: new Error('invalid_grant'),
      context: {
        refresh_token: 'rt-SHOULDNOTAPPEAR',
        access_token: 'at-SHOULDNOTAPPEAR',
        clientSecret: 'cs-SHOULDNOTAPPEAR',
        prompt: 'the user asked SHOULDNOTAPPEAR',
        endpoint: 'oauth2.googleapis.com/token',
      },
    })

    const raw = JSON.stringify(db.prepare('SELECT * FROM app_errors').all())
    expect(raw).not.toContain('SHOULDNOTAPPEAR')
    // Non-sensitive context still survives, or the row would be useless.
    expect(raw).toContain('oauth2.googleapis.com/token')
  })
})

describe('filtering and retention', () => {
  it('filters by source and severity', async () => {
    const { recordAppError, listAppErrors } = await load()
    recordAppError({ source: 'shell', operation: 'loadUserRules', error: new Error('db locked'), severity: 'fatal' })
    recordAppError({ source: 'localhost', operation: 'enrich', error: new Error('no cim'), severity: 'warning' })

    expect(listAppErrors({ source: 'shell' })).toHaveLength(1)
    expect(listAppErrors({ severity: 'warning' })[0].source).toBe('localhost')
    expect(listAppErrors({ source: 'scanner' })).toHaveLength(0)
  })

  it('stays bounded once past the retention limit', async () => {
    const { recordAppError, db } = await load()
    // Each is a distinct problem, so none of them collapse.
    for (let i = 0; i < 560; i++) {
      recordAppError({ source: 'scanner', operation: `step-${i}`, error: new Error('failed') })
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM app_errors').get() as { n: number }
    expect(n).toBeLessThanOrEqual(500)
  })

  it('clears one source without touching the rest', async () => {
    const { recordAppError, clearAppErrors, listAppErrors } = await load()
    recordAppError({ source: 'shell', operation: 'run', error: new Error('a') })
    recordAppError({ source: 'vault', operation: 'search', error: new Error('b') })

    expect(clearAppErrors('shell')).toBe(1)
    const rest = listAppErrors()
    expect(rest).toHaveLength(1)
    expect(rest[0].source).toBe('vault')
  })
})

describe('outliving what it describes', () => {
  it('keeps a job failure after the job itself is deleted', async () => {
    const { recordAppError, listAppErrors, db } = await load()

    db.prepare(
      `INSERT INTO jobs (id, name, capability_id, args_json, schedule_kind, enabled, created_at)
       VALUES (?, ?, ?, '{}', 'manual', 1, ?)`
    ).run('job-1', 'Sync YouTube channel', 'youtube.syncChannel', Date.now())
    db.prepare(
      `INSERT INTO job_runs (id, job_id, started_at, status, error, attempt, triggered_by)
       VALUES (?, ?, ?, 'failure', ?, 4, 'schedule')`
    ).run('run-1', 'job-1', Date.now(), 'YouTube Analytics API has not been used in project.')

    recordAppError({
      source: 'jobs',
      operation: 'youtube.syncChannel',
      error: 'YouTube Analytics API has not been used in project 220819498258 before or it is disabled.',
      subject: 'Sync YouTube channel',
      severity: 'fatal',
      context: { jobId: 'job-1' },
    })

    // `job_runs` is ON DELETE CASCADE from `jobs`, so deleting the automation
    // takes its entire run history with it. This log is deliberately not a
    // foreign key, and that is the whole reason it is a separate table: the
    // question "what was it that kept breaking?" is usually asked about
    // something the user has already removed.
    db.prepare('DELETE FROM jobs WHERE id = ?').run('job-1')

    const { runs } = db
      .prepare('SELECT COUNT(*) AS runs FROM job_runs WHERE job_id = ?')
      .get('job-1') as { runs: number }
    expect(runs).toBe(0)

    const rows = listAppErrors({ source: 'jobs' })
    expect(rows).toHaveLength(1)
    expect(rows[0].subject).toBe('Sync YouTube channel')
    expect(rows[0].severity).toBe('fatal')
  })
})

describe('migration 13', () => {
  it('carries existing Dev Tools rows onto the widened table', async () => {
    const [{ getDatabase }, { runMigrations }] = await Promise.all([
      import('../db/database'),
      import('../db/migrations'),
    ])
    const db = getDatabase()

    // Rebuild the shape migration 12 left behind, then pin the database to it.
    db.exec(`
      DROP TABLE IF EXISTS app_errors;
      CREATE TABLE devtools_errors (
        id TEXT PRIMARY KEY,
        feature TEXT NOT NULL
          CHECK (feature IN ('scanner', 'localhost', 'shell', 'organizer', 'vault', 'github')),
        operation TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'error'
          CHECK (severity IN ('warning', 'error', 'fatal')),
        message TEXT NOT NULL,
        code TEXT,
        subject TEXT,
        context_json TEXT NOT NULL DEFAULT '{}',
        stack TEXT,
        fingerprint TEXT NOT NULL,
        occurrences INTEGER NOT NULL DEFAULT 1,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      INSERT INTO devtools_errors
        (id, feature, operation, severity, message, code, subject, context_json,
         stack, fingerprint, occurrences, first_seen, last_seen)
      VALUES
        ('old-1', 'organizer', 'executeOp', 'fatal', 'permission denied', 'EACCES',
         'C:/files/a.txt', '{"runId":"r1"}', NULL, 'fp-old-1', 17, 1000, 2000);
    `)
    db.pragma('user_version = 12')

    const result = runMigrations(db)
    expect(result.applied).toContain('13:app-wide-error-log')

    const { listAppErrors } = await import('./errorLog')
    const [row] = listAppErrors()
    expect(row.id).toBe('old-1')
    expect(row.source).toBe('organizer')
    expect(row.severity).toBe('fatal')
    expect(row.occurrences).toBe(17)
    expect(row.firstSeen).toBe(1000)
    expect(row.context).toEqual({ runId: 'r1' })

    // The old table is gone, not merely shadowed.
    const old = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devtools_errors'`)
      .get()
    expect(old).toBeUndefined()
  })
})
