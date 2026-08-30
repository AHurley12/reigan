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

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
