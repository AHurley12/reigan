import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The error log's load-bearing promises:
 *  - recording a failure can never itself cause one,
 *  - repeated identical failures collapse instead of flooding the table, and
 *  - a secret that reaches it in context is not written in plaintext.
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
    const { recordDevToolsError, listDevToolsErrors } = await load()
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' })

    recordDevToolsError({
      feature: 'scanner',
      operation: 'runScan',
      error: err,
      subject: 'C:/Users/x/protected',
    })

    const [row] = listDevToolsErrors()
    expect(row.feature).toBe('scanner')
    expect(row.operation).toBe('runScan')
    expect(row.message).toBe('permission denied')
    expect(row.code).toBe('EACCES')
    expect(row.subject).toBe('C:/Users/x/protected')
    expect(row.severity).toBe('error')
    expect(row.occurrences).toBe(1)
    expect(row.stack).toContain('Error: permission denied')
  })

  it('accepts a thrown non-Error without losing the message', async () => {
    const { recordDevToolsError, listDevToolsErrors } = await load()
    recordDevToolsError({ feature: 'shell', operation: 'run', error: 'exited with signal SIGKILL' })
    expect(listDevToolsErrors()[0].message).toBe('exited with signal SIGKILL')
  })

  it('never throws, even with an unserialisable context', async () => {
    const { recordDevToolsError, listDevToolsErrors } = await load()
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() =>
      recordDevToolsError({
        feature: 'vault',
        operation: 'searchSnippets',
        error: new Error('boom'),
        context: circular,
      })
    ).not.toThrow()

    expect(listDevToolsErrors()).toHaveLength(1)
  })
})

describe('collapsing', () => {
  it('counts repeats of the same failure on one row', async () => {
    const { recordDevToolsError, listDevToolsErrors, summariseDevToolsErrors } = await load()
    for (let i = 0; i < 40; i++) {
      recordDevToolsError({
        feature: 'organizer',
        operation: 'executeOp',
        error: Object.assign(new Error('permission denied'), { code: 'EACCES' }),
        subject: `C:/files/${i}.txt`,
      })
    }

    const rows = listDevToolsErrors()
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(40)
    // The newest example is kept — when reading a recurring failure you want a
    // current instance, not the first one from weeks ago.
    expect(rows[0].subject).toBe('C:/files/39.txt')

    const summary = summariseDevToolsErrors()
    expect(summary.distinct).toBe(1)
    expect(summary.total).toBe(40)
  })

  it('ignores digits in the message, so a varying timeout is one problem', async () => {
    const { recordDevToolsError, listDevToolsErrors } = await load()
    recordDevToolsError({ feature: 'localhost', operation: 'probe', error: new Error('timed out after 5001ms') })
    recordDevToolsError({ feature: 'localhost', operation: 'probe', error: new Error('timed out after 5002ms') })

    const rows = listDevToolsErrors()
    expect(rows).toHaveLength(1)
    expect(rows[0].occurrences).toBe(2)
  })

  it('keeps genuinely different failures apart', async () => {
    const { recordDevToolsError, listDevToolsErrors } = await load()
    recordDevToolsError({ feature: 'scanner', operation: 'runScan', error: new Error('disk full') })
    recordDevToolsError({ feature: 'scanner', operation: 'runScan', error: new Error('permission denied') })
    recordDevToolsError({ feature: 'vault', operation: 'runScan', error: new Error('disk full') })

    expect(listDevToolsErrors()).toHaveLength(3)
  })
})

describe('redaction', () => {
  it('does not write a secret carried in context', async () => {
    const { recordDevToolsError, listDevToolsErrors, db } = await load()
    const secret = 'postgres://admin:hunter2@db.internal:5432/prod'

    recordDevToolsError({
      feature: 'vault',
      operation: 'createSnippet',
      error: new Error('encryption unavailable'),
      context: { title: 'prod db', body: secret },
    })

    const stored = listDevToolsErrors()[0].context as { title: string; body: string }
    expect(stored.title).toBe('prod db')
    expect(stored.body).toBe('[redacted]')

    // Belt and braces: the plaintext must not be anywhere in the row, not just
    // absent from the key we happened to check.
    const raw = db.prepare('SELECT * FROM devtools_errors').all()
    expect(JSON.stringify(raw)).not.toContain('hunter2')
  })
})

describe('filtering and retention', () => {
  it('filters by feature and severity', async () => {
    const { recordDevToolsError, listDevToolsErrors } = await load()
    recordDevToolsError({ feature: 'shell', operation: 'loadUserRules', error: new Error('db locked'), severity: 'fatal' })
    recordDevToolsError({ feature: 'localhost', operation: 'enrich', error: new Error('no cim'), severity: 'warning' })

    expect(listDevToolsErrors({ feature: 'shell' })).toHaveLength(1)
    expect(listDevToolsErrors({ severity: 'warning' })[0].feature).toBe('localhost')
    expect(listDevToolsErrors({ feature: 'scanner' })).toHaveLength(0)
  })

  it('stays bounded once past the retention limit', async () => {
    const { recordDevToolsError, db } = await load()
    // Each is a distinct problem, so none of them collapse.
    for (let i = 0; i < 560; i++) {
      recordDevToolsError({ feature: 'scanner', operation: `step-${i}`, error: new Error('failed') })
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM devtools_errors').get() as { n: number }
    expect(n).toBeLessThanOrEqual(500)
  })

  it('clears one feature without touching the rest', async () => {
    const { recordDevToolsError, clearDevToolsErrors, listDevToolsErrors } = await load()
    recordDevToolsError({ feature: 'shell', operation: 'run', error: new Error('a') })
    recordDevToolsError({ feature: 'vault', operation: 'search', error: new Error('b') })

    expect(clearDevToolsErrors('shell')).toBe(1)
    const rest = listDevToolsErrors()
    expect(rest).toHaveLength(1)
    expect(rest[0].feature).toBe('vault')
  })
})
