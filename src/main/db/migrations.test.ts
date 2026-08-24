import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { addColumnIfMissing, LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from './migrations'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('migration runner', () => {
  it('takes a fresh database to the latest version', () => {
    const db = freshDb()
    const result = runMigrations(db)

    expect(result.from).toBe(0)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
    expect(result.applied).toHaveLength(MIGRATIONS.length)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
  })

  it('is a no-op on an already-migrated database', () => {
    const db = freshDb()
    runMigrations(db)
    const second = runMigrations(db)

    expect(second.applied).toEqual([])
    expect(second.from).toBe(LATEST_SCHEMA_VERSION)
    expect(second.to).toBe(LATEST_SCHEMA_VERSION)
  })

  it('adopts a pre-existing database without destroying its rows', () => {
    // Simulates a real user's database: created by the old schema blob, holding
    // data, and sitting at user_version 0 because the runner did not exist yet.
    const db = freshDb()
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'backlog',
        priority TEXT NOT NULL DEFAULT 'medium',
        due_date INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER, tags TEXT DEFAULT '[]'
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    db.prepare('INSERT INTO tasks (id, title) VALUES (?, ?)').run('t1', 'Pre-existing task')
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('theme', 'gothic')
    expect(db.pragma('user_version', { simple: true })).toBe(0)

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(db.prepare('SELECT title FROM tasks WHERE id = ?').get('t1')).toEqual({
      title: 'Pre-existing task',
    })
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('theme')).toEqual({
      value: 'gothic',
    })
  })

  it('applies only migrations newer than the recorded version', () => {
    const db = freshDb()
    runMigrations(db)

    // Rewind to 1, as if this build introduced everything after it.
    db.pragma('user_version = 1')
    const result = runMigrations(db)

    expect(result.from).toBe(1)
    expect(result.applied.every((a) => !a.startsWith('1:'))).toBe(true)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
  })

  it('rolls back the version bump when a migration throws', () => {
    const db = freshDb()
    runMigrations(db)
    const before = db.pragma('user_version', { simple: true })

    const broken = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: 'intentionally-broken',
      up: () => {
        throw new Error('boom')
      },
    }
    MIGRATIONS.push(broken)
    try {
      expect(() => runMigrations(db)).toThrow(/intentionally-broken.*boom/)
      // The version must not have advanced — otherwise the next boot would skip
      // the failed migration and run against a half-built schema.
      expect(db.pragma('user_version', { simple: true })).toBe(before)
    } finally {
      MIGRATIONS.pop()
    }
  })

  it('rejects a malformed migration list', () => {
    const db = freshDb()
    const outOfOrder = { version: 99, name: 'gap', up: () => {} }
    MIGRATIONS.push(outOfOrder)
    try {
      expect(() => runMigrations(db)).toThrow(/malformed/)
    } finally {
      MIGRATIONS.pop()
    }
  })

  it('creates the schema the app actually queries', () => {
    const db = freshDb()
    runMigrations(db)

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name)

    for (const expected of ['tasks', 'conversations', 'messages', 'settings', 'files_index', 'approvals']) {
      expect(tables).toContain(expected)
    }
  })

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
})

describe('addColumnIfMissing', () => {
  it('adds a column, then tolerates a second call', () => {
    const db = freshDb()
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')

    addColumnIfMissing(db, 't', 'content_item_id', 'TEXT')
    addColumnIfMissing(db, 't', 'content_item_id', 'TEXT')

    const columns = (db.prepare('PRAGMA table_info(t)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(columns).toEqual(['id', 'content_item_id'])
  })

  it('is what makes altering an existing table possible at all', () => {
    // The regression this whole system exists to prevent: `CREATE TABLE IF NOT
    // EXISTS` with an added column is a silent no-op against a table that
    // already exists, so the column never appears.
    const db = freshDb()
    db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT)')
    db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT, owner TEXT)')

    const afterBlob = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(afterBlob).not.toContain('owner')

    addColumnIfMissing(db, 'tasks', 'owner', 'TEXT')
    const afterAlter = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(afterAlter).toContain('owner')
  })
})
