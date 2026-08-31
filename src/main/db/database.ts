import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'reigan.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Schema comes from the versioned migration runner, not from re-executing a
  // DDL blob on every boot. The old approach kept the same schema in two
  // hand-maintained copies (schema.sql plus an inline duplicate) and, being all
  // `CREATE TABLE IF NOT EXISTS`, could never alter an existing table.
  const result = runMigrations(db)
  if (result.applied.length > 0) {
    console.log(
      `[db] migrated schema ${result.from} → ${result.to}: ${result.applied.join(', ')}`
    )
  }

  reclaimAfterSlimming(db, result.applied)

  return db
}

/**
 * Returns the pages migration 20 freed to the operating system.
 *
 * SQLite moves freed pages to its freelist and reuses them; it does not shrink
 * the file. Migration 20 drops a 15.57 MB index and deletes the bulk of the
 * rows, so without this the user's 86 MB file stays 86 MB and the reclaim is
 * invisible — the whole point of the change was the disk.
 *
 * Runs here rather than inside the migration because VACUUM cannot execute
 * inside a transaction, and the runner wraps every migration in one. Guarded on
 * that migration actually having been applied, so this is a one-time cost on a
 * single boot and never runs again.
 */
function reclaimAfterSlimming(database: Database.Database, applied: string[]): void {
  if (!applied.some((a) => a.startsWith('20:'))) return

  const pageSize = database.pragma('page_size', { simple: true }) as number
  const before = (database.pragma('page_count', { simple: true }) as number) * pageSize

  try {
    database.exec('VACUUM')
  } catch (err) {
    // A failed reclaim is not a reason to refuse to start: the database is
    // correct either way, it is merely still large.
    console.warn('[db] VACUUM after slimming failed; file left at its current size:', err)
    return
  }

  const after = (database.pragma('page_count', { simple: true }) as number) * pageSize
  const mb = (n: number): string => (n / 1048576).toFixed(1)
  console.log(`[db] reclaimed ${mb(before - after)} MB (${mb(before)} → ${mb(after)} MB)`)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
