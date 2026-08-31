import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS, runMigrations } from '../db/migrations'
import { CACHE_DIR_NAMES, isExcludedDir } from './excludedDirs'

const MIGRATION_20 = MIGRATIONS.find((m) => m.version === 20)!

/**
 * A database at version 19 — the state a real install upgrading to this build
 * is in, and the only state where migration 20 has rows to act on.
 */
function atVersion19(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const m of MIGRATIONS) {
    if (m.version > 19) break
    m.up(db)
  }
  return db
}

/**
 * The file index had grown to 98.4% of an 86 MB database. Two causes, pinned
 * here so neither can come back quietly:
 *
 *  - `idx_files_dir`, 15.57 MB, read by no query in the app.
 *  - 89,180 `.dvcc` files under one video-editor cache tree — 71% of all rows.
 */

function migrated(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function addFile(db: Database.Database, path: string, dir: string, name: string): void {
  db.prepare(
    `INSERT INTO files_index (path, name, dir, ext, size, mtime, is_dir, indexed_at)
     VALUES (?, ?, ?, '', 0, 0, 0, 0)`
  ).run(path, name, dir)
}

describe('isExcludedDir', () => {
  it('skips the media cache trees that dominated the index', () => {
    expect(isExcludedDir('CacheClip')).toBe(true)
    expect(isExcludedDir('GPUCache')).toBe(true)
    expect(isExcludedDir('Crashpad')).toBe(true)
  })

  it('still skips everything it skipped before', () => {
    for (const name of ['node_modules', 'AppData', 'dist', '__pycache__', '$RECYCLE.BIN']) {
      expect(isExcludedDir(name), name).toBe(true)
    }
    expect(isExcludedDir('.git')).toBe(true)
  })

  it('does not skip the user\u2019s own directories', () => {
    // The failure that would matter: an over-broad rule quietly hiding real
    // files. Extension-based exclusion was rejected for exactly this reason —
    // the same scan's `.meta` files were a real application's resources.
    for (const name of ['Documents', 'Projects', 'Cache Notes', 'My Cached Recipes', 'Videos']) {
      expect(isExcludedDir(name), name).toBe(false)
    }
  })
})

describe('migration 20: files-index-slimming', () => {
  it('drops the index no query ever read', () => {
    const db = migrated()

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='files_index'").all() as Array<{ name: string }>
    ).map((r) => r.name)

    expect(indexes).not.toContain('idx_files_dir')
    // The ones queries genuinely use must survive.
    expect(indexes).toContain('idx_files_ext')
    expect(indexes).toContain('idx_files_mtime')
    expect(indexes).toContain('idx_files_indexed_at')
    db.close()
  })

  it('purges cache rows already in the index, at any depth', () => {
    const db = atVersion19()
    addFile(db, 'C:\\Users\\a\\Videos\\CacheClip\\x\\Seq\\f.dvcc', 'C:\\Users\\a\\Videos\\CacheClip\\x\\Seq', 'f.dvcc')
    addFile(db, 'C:\\Users\\a\\AppData\\GPUCache\\d.bin', 'C:\\Users\\a\\AppData\\GPUCache', 'd.bin')
    addFile(db, 'C:\\Users\\a\\Docs\\notes.md', 'C:\\Users\\a\\Docs', 'notes.md')

    MIGRATION_20.up(db)

    const left = db.prepare('SELECT name FROM files_index ORDER BY name').all() as Array<{ name: string }>
    expect(left.map((r) => r.name)).toEqual(['notes.md'])
    db.close()
  })

  it('matches a cache directory that is the whole trailing segment', () => {
    const db = atVersion19()
    addFile(db, 'C:\\a\\CacheClip\\f.dvcc', 'C:\\a\\CacheClip', 'f.dvcc')

    MIGRATION_20.up(db)

    expect((db.prepare('SELECT COUNT(*) n FROM files_index').get() as { n: number }).n).toBe(0)
    db.close()
  })

  it('leaves a directory that merely contains a cache word alone', () => {
    // Segment-anchored matching is the guard. A substring match would delete
    // all three of these, and they are the user's own files.
    const db = atVersion19()
    addFile(db, 'C:\\a\\Cache Notes\\r.md', 'C:\\a\\Cache Notes', 'r.md')
    addFile(db, 'C:\\a\\MyCacheClipArchive\\v.mp4', 'C:\\a\\MyCacheClipArchive', 'v.mp4')
    addFile(db, 'C:\\a\\Uncached\\x.txt', 'C:\\a\\Uncached', 'x.txt')

    MIGRATION_20.up(db)

    expect((db.prepare('SELECT COUNT(*) n FROM files_index').get() as { n: number }).n).toBe(3)
    db.close()
  })

  it('matches forward-slash paths too', () => {
    const db = atVersion19()
    addFile(db, '/home/a/Videos/CacheClip/f.dvcc', '/home/a/Videos/CacheClip', 'f.dvcc')

    MIGRATION_20.up(db)

    expect((db.prepare('SELECT COUNT(*) n FROM files_index').get() as { n: number }).n).toBe(0)
    db.close()
  })

  it('keeps the FTS index consistent when rows are purged', () => {
    // The DELETE relies on the files_index_ad trigger; a stale FTS index would
    // return hits for files that no longer exist.
    const db = atVersion19()
    addFile(db, 'C:\\a\\CacheClip\\junk.dvcc', 'C:\\a\\CacheClip', 'junk.dvcc')

    MIGRATION_20.up(db)

    const hits = db.prepare("SELECT COUNT(*) n FROM files_fts WHERE files_fts MATCH 'junk'").get() as { n: number }
    expect(hits.n).toBe(0)
    db.close()
  })

  it('has a frozen copy of the cache names that still covers the living list', () => {
    // The migration deliberately holds a snapshot. If the living list gains a
    // name, that is fine — but the snapshot must never contain something the
    // living list has dropped, or the migration would delete rows the indexer
    // would happily re-add on the next scan.
    const frozen = [
      'CacheClip', 'Cache', 'Caches', 'CachedData', 'cache2',
      'GPUCache', 'ShaderCache', 'Code Cache', 'DawnCache', 'GrShaderCache',
      'CrashDumps', 'Crashpad', 'Thumbnails', 'thumbnails',
    ]
    for (const name of frozen) {
      expect(CACHE_DIR_NAMES.has(name), `${name} is purged by migration 20 but no longer excluded`).toBe(true)
    }
  })
})
