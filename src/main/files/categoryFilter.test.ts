import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FILE_TYPE_CATEGORIES, matchesCategory } from '../../shared/constants'
import type { FileEntry, FileTypeCategoryId } from '../../shared/types'

/**
 * The type tabs run through two independent code paths — an in-memory filter
 * over one directory (browse) and a SQL WHERE clause over the index (search) —
 * and they disagreed in the shipped build. Browse kept every folder in every
 * tab via an `e.isDir ||` short-circuit, so picking "Archives" in a folder of
 * subfolders changed nothing visible.
 *
 * These tests assert the rule once and then assert the two paths agree on it,
 * because a fix in one is worth nothing if the other drifts.
 */

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-filecat-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { searchFiles } = await import('./fileIndexer')

const TYPED = FILE_TYPE_CATEGORIES.map((c) => c.id).filter((id) => id !== 'all')

/** Fixtures live directly under the temp root so isPathAllowed accepts them. */
const FIXTURES: Array<{ name: string; isDir: boolean }> = [
  { name: 'Projects', isDir: true },
  { name: 'Pictures', isDir: true },
  { name: 'Archive', isDir: true },
  { name: 'report.pdf', isDir: false },
  { name: 'notes.md', isDir: false },
  { name: 'budget.xlsx', isDir: false },
  { name: 'holiday.JPG', isDir: false },
  { name: 'diagram.svg', isDir: false },
  { name: 'shot.heic', isDir: false },
  { name: 'index.ts', isDir: false },
  { name: 'styles.scss', isDir: false },
  { name: 'config.toml', isDir: false },
  { name: 'deploy.ps1', isDir: false },
  { name: 'clip.webm', isDir: false },
  { name: 'song.flac', isDir: false },
  { name: 'movie.divx', isDir: false },
  { name: 'backup.tgz', isDir: false },
  { name: 'disk.iso', isDir: false },
  { name: 'setup.exe', isDir: false },
  { name: 'LICENSE', isDir: false },
]

/** Mirrors fileIndexer.toEntry — lowercased, dot-stripped extension. */
function toEntry(f: { name: string; isDir: boolean }): FileEntry {
  const dot = f.isDir ? -1 : f.name.lastIndexOf('.')
  return {
    path: join(tempDir, f.name),
    name: f.name,
    dir: tempDir,
    ext: dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '',
    size: f.isDir ? 0 : 1024,
    mtime: 1_700_000_000_000,
    isDir: f.isDir,
  }
}

const ENTRIES = FIXTURES.map(toEntry)

function namesFromSearch(category: FileTypeCategoryId): string[] {
  return searchFiles({ query: '', category }).map((e) => e.name).sort()
}

function namesFromBrowse(category: FileTypeCategoryId): string[] {
  return ENTRIES.filter((e) => matchesCategory(e, category)).map((e) => e.name).sort()
}

beforeAll(() => {
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO files_index (path, name, dir, ext, size, mtime, is_dir, indexed_at)
     VALUES (@path, @name, @dir, @ext, @size, @mtime, @is_dir, @indexed_at)`
  )
  for (const e of ENTRIES) {
    insert.run({
      path: e.path, name: e.name, dir: e.dir, ext: e.ext,
      size: e.size, mtime: e.mtime, is_dir: e.isDir ? 1 : 0, indexed_at: Date.now(),
    })
  }
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('indexed search — category segmentation', () => {
  it('returns everything, folders included, under All', () => {
    expect(namesFromSearch('all')).toEqual(FIXTURES.map((f) => f.name).sort())
  })

  it('excludes folders from every type tab', () => {
    for (const category of TYPED) {
      const names = namesFromSearch(category)
      for (const folder of ['Projects', 'Pictures', 'Archive']) {
        expect(names, `${category} leaked folder ${folder}`).not.toContain(folder)
      }
    }
  })

  it('segments files into the right buckets', () => {
    expect(namesFromSearch('documents')).toEqual(['budget.xlsx', 'notes.md', 'report.pdf'])
    // Uppercase .JPG is normalised at index time, so it lands with the images.
    expect(namesFromSearch('images')).toEqual(['diagram.svg', 'holiday.JPG', 'shot.heic'])
    expect(namesFromSearch('code')).toEqual(['config.toml', 'deploy.ps1', 'index.ts', 'styles.scss'])
    expect(namesFromSearch('media')).toEqual(['clip.webm', 'movie.divx', 'song.flac'])
    expect(namesFromSearch('archives')).toEqual(['backup.tgz', 'disk.iso'])
  })

  it('puts unclassifiable files — and only those — in Other', () => {
    // Extensionless files and executables, but no folders: Other is a file
    // bucket, not a leftovers bucket.
    expect(namesFromSearch('other')).toEqual(['LICENSE', 'setup.exe'])
  })

  it('assigns every file to exactly one type tab', () => {
    const counts = new Map<string, number>()
    for (const category of TYPED) {
      for (const name of namesFromSearch(category)) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    const files = FIXTURES.filter((f) => !f.isDir).map((f) => f.name)
    expect([...counts.keys()].sort()).toEqual(files.sort())
    expect([...counts.values()].every((n) => n === 1)).toBe(true)
  })

  it('still filters by category when a name query narrows the FTS match', () => {
    const hits = searchFiles({ query: 'holiday', category: 'images' }).map((e) => e.name)
    expect(hits).toEqual(['holiday.JPG'])
    expect(searchFiles({ query: 'holiday', category: 'code' })).toEqual([])
  })
})

describe('browse and search agree', () => {
  it('produces the same set for every tab', () => {
    for (const category of FILE_TYPE_CATEGORIES.map((c) => c.id)) {
      expect(namesFromBrowse(category), `mismatch on ${category}`).toEqual(namesFromSearch(category))
    }
  })
})
