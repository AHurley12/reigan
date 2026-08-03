import { promises as fs } from 'fs'
import { join, resolve, extname, basename, dirname, sep } from 'path'
import { app } from 'electron'
import { getDatabase } from '../db/database'
import { FILE_TYPE_CATEGORIES } from '../../shared/constants'
import type { FileEntry, FileSearchParams, FileIndexStatus, FileTypeCategoryId } from '../../shared/types'

// Read-only scope: the user's home profile only. Never Program Files, Windows,
// other user profiles, or drives outside this tree — "everything regarding the
// computer's systems/performance is off limits" per user instruction.
function getRootDir(): string {
  return resolve(app.getPath('home'))
}

// Matched by directory *name* at any depth, so this also catches nested copies
// (e.g. a project's own node_modules). AppData and the legacy Windows profile
// junctions are excluded outright — mostly app config/cache/credentials, not
// the user's own files, and junctions can otherwise loop.
const EXCLUDED_DIR_NAMES = new Set([
  'AppData', 'Application Data', 'Cookies', 'Local Settings', 'My Documents',
  'NetHood', 'PrintHood', 'Recent', 'SendTo', 'Templates', 'Start Menu', 'History',
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache',
  'venv', '.venv', '__pycache__', '.tox',
  '$RECYCLE.BIN', 'System Volume Information',
])

// Hidden (dot-prefixed) directories are skipped wholesale — covers .git, .ssh,
// .aws, .gnupg, etc. without needing an exhaustive denylist of secret locations.
function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIR_NAMES.has(name)
}

const MAX_INDEXED_ENTRIES = 250_000
const YIELD_EVERY = 300
const BATCH_SIZE = 500

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'yml', 'yaml', 'csv', 'log',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
  'html', 'css', 'scss', 'sql', 'sh', 'ps1', 'xml', 'ini', 'cfg', 'conf', 'toml',
])
const MAX_PREVIEW_BYTES = 200_000

let status: Omit<FileIndexStatus, 'homeDir'> = { indexing: false, filesIndexed: 0, lastIndexedAt: null, error: null }

export function getIndexStatus(): FileIndexStatus {
  return { ...status, homeDir: getRootDir() }
}

export function getHomeDir(): string {
  return getRootDir()
}

/** True if `target` resolves inside the home root and doesn't pass through an excluded directory. */
export function isPathAllowed(target: string): boolean {
  if (!target) return false
  const root = getRootDir()
  let resolved: string
  try {
    resolved = resolve(target)
  } catch {
    return false
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (resolved.toLowerCase() !== root.toLowerCase() && !resolved.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    return false
  }
  const rel = resolved.slice(root.length).replace(/^[\\/]/, '')
  if (!rel) return true
  const segments = rel.split(/[\\/]/)
  return !segments.some((seg) => isExcludedDir(seg))
}

function toEntry(fullPath: string, name: string, isDir: boolean, size: number, mtimeMs: number): FileEntry {
  return {
    path: fullPath,
    name,
    dir: dirname(fullPath),
    ext: isDir ? '' : extname(name).slice(1).toLowerCase(),
    size,
    mtime: Math.round(mtimeMs),
    isDir,
  }
}

/** Live listing of one directory (not from the index) — used for the Browse view. */
export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  if (!isPathAllowed(dirPath)) throw new Error('That location is outside the allowed scope.')
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const entries: FileEntry[] = []
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    if (dirent.isDirectory() && isExcludedDir(dirent.name)) continue
    if (!dirent.isDirectory() && !dirent.isFile()) continue

    const full = join(dirPath, dirent.name)
    try {
      const stat = await fs.stat(full)
      entries.push(toEntry(full, dirent.name, dirent.isDirectory(), stat.size, stat.mtimeMs))
    } catch {
      // Permission-denied or race with deletion — skip silently.
    }
  }

  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return entries
}

async function walk(dir: string, onEntry: (e: FileEntry) => Promise<boolean>): Promise<boolean> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    const full = join(dir, dirent.name)

    if (dirent.isDirectory()) {
      if (isExcludedDir(dirent.name)) continue
      try {
        const stat = await fs.stat(full)
        if (await onEntry(toEntry(full, dirent.name, true, stat.size, stat.mtimeMs))) return true
      } catch {
        continue
      }
      if (await walk(full, onEntry)) return true
    } else if (dirent.isFile()) {
      try {
        const stat = await fs.stat(full)
        if (await onEntry(toEntry(full, dirent.name, false, stat.size, stat.mtimeMs))) return true
      } catch {
        // skip
      }
    }
  }
  return false
}

/** Full rescan of the home directory, upserting into files_index and pruning stale rows. */
export async function runFullIndex(): Promise<void> {
  if (status.indexing) return
  status = { indexing: true, filesIndexed: 0, lastIndexedAt: status.lastIndexedAt, error: null }

  const db = getDatabase()
  const scanStart = Date.now()
  const upsert = db.prepare(`
    INSERT INTO files_index (path, name, dir, ext, size, mtime, is_dir, indexed_at)
    VALUES (@path, @name, @dir, @ext, @size, @mtime, @is_dir, @indexed_at)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name, dir = excluded.dir, ext = excluded.ext, size = excluded.size,
      mtime = excluded.mtime, is_dir = excluded.is_dir, indexed_at = excluded.indexed_at
  `)
  const insertBatch = db.transaction((rows: ReturnType<typeof toRow>[]) => {
    for (const row of rows) upsert.run(row)
  })

  function toRow(e: FileEntry, indexedAt: number) {
    return { path: e.path, name: e.name, dir: e.dir, ext: e.ext, size: e.size, mtime: e.mtime, is_dir: e.isDir ? 1 : 0, indexed_at: indexedAt }
  }

  let batch: ReturnType<typeof toRow>[] = []
  let sinceYield = 0
  let capped = false

  try {
    await walk(getRootDir(), async (entry) => {
      batch.push(toRow(entry, scanStart))
      status.filesIndexed++

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch)
        batch = []
      }

      sinceYield++
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0
        await new Promise((r) => setImmediate(r))
      }

      if (status.filesIndexed >= MAX_INDEXED_ENTRIES) {
        capped = true
        return true // stop walking
      }
      return false
    })
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  }

  if (batch.length) insertBatch(batch)

  // Anything not touched by this scan (and older than it) has been deleted/moved.
  // Skipped while capped, since an early stop would otherwise prune untouched files.
  if (!capped) {
    db.prepare('DELETE FROM files_index WHERE indexed_at < ?').run(scanStart)
  }

  status = { indexing: false, filesIndexed: status.filesIndexed, lastIndexedAt: Date.now(), error: status.error }
}

function rowToEntry(row: any): FileEntry {
  return {
    path: row.path,
    name: row.name,
    dir: row.dir,
    ext: row.ext,
    size: row.size,
    mtime: row.mtime,
    isDir: !!row.is_dir,
  }
}

function buildMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_.-]/gu, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ')
}

/** Indexed search with optional type/date filters — powers the Files search bar. */
export function searchFiles(params: FileSearchParams): FileEntry[] {
  const db = getDatabase()
  const limit = Math.min(params.limit ?? 200, 500)
  const sortColumn = { name: 'f.name COLLATE NOCASE', modified: 'f.mtime', size: 'f.size' }[params.sortBy ?? 'name']
  const sortDir = params.sortDir === 'desc' ? 'DESC' : 'ASC'

  const conditions: string[] = []
  const values: any[] = []

  if (params.category && params.category !== 'all') {
    const cat = params.category as FileTypeCategoryId
    // Extension category is classified in JS (categorizeExt), not stored, so filter
    // with a subquery-free IN() built from the category's known extensions instead.
    const exts = extsForCategory(cat)
    if (exts) {
      conditions.push(`f.ext IN (${exts.map(() => '?').join(',')})`)
      values.push(...exts)
    } else if (cat === 'other') {
      const known = allKnownExts()
      conditions.push(`f.ext NOT IN (${known.map(() => '?').join(',')}) AND f.is_dir = 0`)
      values.push(...known)
    }
  }
  if (params.modifiedAfter) {
    conditions.push('f.mtime >= ?')
    values.push(params.modifiedAfter)
  }

  const query = buildMatchQuery(params.query || '')
  let rows: any[]

  if (query) {
    const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''
    rows = db
      .prepare(
        `SELECT f.* FROM files_fts
         JOIN files_index f ON f.id = files_fts.rowid
         WHERE files_fts MATCH ? ${where}
         ORDER BY ${sortColumn} ${sortDir}
         LIMIT ?`
      )
      .all(query, ...values, limit)
  } else {
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    rows = db
      .prepare(`SELECT * FROM files_index f ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT ?`)
      .all(...values, limit)
  }

  return rows.map(rowToEntry).filter((e) => isPathAllowed(e.path))
}

function extsForCategory(cat: FileTypeCategoryId): string[] | null {
  return FILE_TYPE_CATEGORIES.find((c) => c.id === cat)?.exts ?? null
}
function allKnownExts(): string[] {
  return FILE_TYPE_CATEGORIES.flatMap((c) => c.exts ?? [])
}

/** Reads a text file's content for preview/summarization. Binary and out-of-scope files return null. */
export async function readFileContent(targetPath: string): Promise<{ content: string; truncated: boolean } | null> {
  if (!isPathAllowed(targetPath)) return null
  const ext = extname(targetPath).slice(1).toLowerCase()
  if (!TEXT_EXTENSIONS.has(ext)) return null

  let stat
  try {
    stat = await fs.stat(targetPath)
  } catch {
    return null
  }
  if (!stat.isFile()) return null

  const fh = await fs.open(targetPath, 'r')
  try {
    const readLength = Math.min(stat.size, MAX_PREVIEW_BYTES)
    const buf = Buffer.alloc(readLength)
    await fh.read(buf, 0, readLength, 0)
    return { content: buf.toString('utf-8'), truncated: stat.size > MAX_PREVIEW_BYTES }
  } finally {
    await fh.close()
  }
}

export function fileBaseName(path: string): string {
  return basename(path)
}
