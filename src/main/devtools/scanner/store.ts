import { randomUUID } from 'crypto'
import { getDatabase } from '../../db/database'
import { classifyStatus } from './detect'
import type { ProjectStatus, ScannedProject } from './types'

export interface ProjectRow {
  id: string
  path: string
  name: string
  status: ProjectStatus
  primaryLanguage: string | null
  languages: Record<string, number>
  frameworks: string[]
  packageManager: string | null
  lastModified: number | null
  lastCommitAt: number | null
  branch: string | null
  isDirty: boolean
  unpushedCount: number
  readmeStatus: string
  loc: number
  sizeBytes: number
  sizeBytesNoDeps: number
  hasTests: boolean
  remoteUrl: string | null
  githubRepoId: string | null
  firstSeen: number
  lastScanned: number
  notes: string | null
}

/** Derived flags, computed rather than stored so they cannot go stale. */
export interface ProjectFlags {
  neverCommitted: boolean
  noReadme: boolean
  uncommittedChanges: boolean
  unpushedCommits: boolean
}

export interface ProjectWithFlags extends ProjectRow {
  flags: ProjectFlags
}

export function flagsFor(p: ProjectRow): ProjectFlags {
  return {
    // A repository with a branch but no commit date has a HEAD pointing at
    // nothing — a `git init` that never went further.
    neverCommitted: p.branch !== null && p.lastCommitAt === null,
    noReadme: p.readmeStatus !== 'exists',
    uncommittedChanges: p.isDirty,
    unpushedCommits: p.unpushedCount > 0,
  }
}

export function upsertProjects(projects: ScannedProject[], now = Date.now()): number {
  const db = getDatabase()

  const insert = db.prepare(`
    INSERT INTO projects (
      id, path, name, status, primary_language, languages_json, frameworks_json,
      package_manager, last_modified, last_commit_at, branch, is_dirty,
      unpushed_count, readme_status, loc, size_bytes, size_bytes_no_deps,
      has_tests, remote_url, first_seen, last_scanned
    ) VALUES (
      @id, @path, @name, @status, @primaryLanguage, @languages, @frameworks,
      @packageManager, @lastModified, @lastCommitAt, @branch, @isDirty,
      @unpushedCount, @readmeStatus, @loc, @sizeBytes, @sizeBytesNoDeps,
      @hasTests, @remoteUrl, @now, @now
    )
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      primary_language = excluded.primary_language,
      languages_json = excluded.languages_json,
      frameworks_json = excluded.frameworks_json,
      package_manager = excluded.package_manager,
      last_modified = excluded.last_modified,
      last_commit_at = excluded.last_commit_at,
      branch = excluded.branch,
      is_dirty = excluded.is_dirty,
      unpushed_count = excluded.unpushed_count,
      readme_status = excluded.readme_status,
      loc = excluded.loc,
      size_bytes = excluded.size_bytes,
      size_bytes_no_deps = excluded.size_bytes_no_deps,
      has_tests = excluded.has_tests,
      remote_url = excluded.remote_url,
      last_scanned = excluded.last_scanned
      /* first_seen is deliberately not updated — it is the one field that
         records when this project entered the user's world, and a rescan
         must not overwrite it. */
  `)

  const run = db.transaction((rows: ScannedProject[]) => {
    for (const p of rows) {
      insert.run({
        id: randomUUID(),
        path: p.path,
        name: p.name,
        status: classifyStatus(p.lastModified, p.lastCommitAt, now),
        primaryLanguage: p.primaryLanguage,
        languages: JSON.stringify(p.languages),
        frameworks: JSON.stringify(p.frameworks),
        packageManager: p.packageManager,
        lastModified: Math.round(p.lastModified) || null,
        lastCommitAt: p.lastCommitAt,
        branch: p.branch,
        isDirty: p.isDirty ? 1 : 0,
        unpushedCount: p.unpushedCount,
        readmeStatus: p.readmeStatus,
        loc: p.loc,
        sizeBytes: p.sizeBytes,
        sizeBytesNoDeps: p.sizeBytesNoDeps,
        hasTests: p.hasTests ? 1 : 0,
        remoteUrl: p.remoteUrl,
        now,
      })
    }
  })

  run(projects)
  return projects.length
}

export interface ListProjectsFilter {
  status?: ProjectStatus
  language?: string
  framework?: string
  flag?: 'never-committed' | 'no-readme' | 'uncommitted-changes' | 'unpushed-commits'
  search?: string
  limit?: number
}

export interface ProjectSummary {
  total: number
  byStatus: Record<ProjectStatus, number>
  totalSizeBytes: number
  totalSizeBytesNoDeps: number
  withUncommittedChanges: number
  withUnpushedCommits: number
  missingReadme: number
  topLanguages: Array<{ language: string; count: number }>
}

export function listProjects(filter: ListProjectsFilter = {}): {
  projects: ProjectWithFlags[]
  summary: ProjectSummary
} {
  const db = getDatabase()
  const all = (db.prepare('SELECT * FROM projects ORDER BY last_modified DESC').all() as any[]).map(
    rowToProject
  )

  // The summary describes the whole picture, not the filtered slice: "you have
  // 7 abandoned projects" should not change because the user is currently
  // looking at Rust ones.
  const summary = summarise(all)

  let rows = all
  if (filter.status) rows = rows.filter((p) => p.status === filter.status)
  if (filter.language) {
    const wanted = filter.language.toLowerCase()
    rows = rows.filter(
      (p) =>
        p.primaryLanguage?.toLowerCase() === wanted ||
        Object.keys(p.languages).some((l) => l.toLowerCase() === wanted)
    )
  }
  if (filter.framework) {
    const wanted = filter.framework.toLowerCase()
    rows = rows.filter((p) => p.frameworks.some((f) => f.toLowerCase() === wanted))
  }
  if (filter.flag) {
    rows = rows.filter((p) => {
      const f = flagsFor(p)
      if (filter.flag === 'never-committed') return f.neverCommitted
      if (filter.flag === 'no-readme') return f.noReadme
      if (filter.flag === 'uncommitted-changes') return f.uncommittedChanges
      return f.unpushedCommits
    })
  }
  if (filter.search) {
    const q = filter.search.toLowerCase()
    rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
  }

  const limit = filter.limit ?? 500
  return {
    projects: rows.slice(0, limit).map((p) => ({ ...p, flags: flagsFor(p) })),
    summary,
  }
}

function summarise(projects: ProjectRow[]): ProjectSummary {
  const byStatus: Record<ProjectStatus, number> = { active: 0, warm: 0, dormant: 0, abandoned: 0 }
  const languageCounts = new Map<string, number>()
  let totalSizeBytes = 0
  let totalSizeBytesNoDeps = 0
  let withUncommittedChanges = 0
  let withUnpushedCommits = 0
  let missingReadme = 0

  for (const p of projects) {
    byStatus[p.status] += 1
    totalSizeBytes += p.sizeBytes
    totalSizeBytesNoDeps += p.sizeBytesNoDeps
    if (p.isDirty) withUncommittedChanges += 1
    if (p.unpushedCount > 0) withUnpushedCommits += 1
    if (p.readmeStatus !== 'exists') missingReadme += 1
    if (p.primaryLanguage) {
      languageCounts.set(p.primaryLanguage, (languageCounts.get(p.primaryLanguage) ?? 0) + 1)
    }
  }

  return {
    total: projects.length,
    byStatus,
    totalSizeBytes,
    totalSizeBytesNoDeps,
    withUncommittedChanges,
    withUnpushedCommits,
    missingReadme,
    topLanguages: [...languageCounts.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  }
}

export function getProjectByPath(path: string): ProjectWithFlags | null {
  const row = getDatabase().prepare('SELECT * FROM projects WHERE path = ?').get(path) as any
  if (!row) return null
  const project = rowToProject(row)
  return { ...project, flags: flagsFor(project) }
}

export function getProjectById(id: string): ProjectWithFlags | null {
  const row = getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
  if (!row) return null
  const project = rowToProject(row)
  return { ...project, flags: flagsFor(project) }
}

/**
 * Resolves a loose reference — an id, an exact path, or a name — to one
 * project. The model refers to projects by name because that is how the user
 * does; requiring it to remember an opaque id would mean a lookup call before
 * every action.
 */
export function resolveProject(ref: string): ProjectWithFlags | null {
  return (
    getProjectById(ref) ??
    getProjectByPath(ref) ??
    (() => {
      const rows = getDatabase()
        .prepare('SELECT * FROM projects WHERE lower(name) = lower(?) ORDER BY last_modified DESC')
        .all(ref) as any[]
      if (rows.length === 0) return null
      const project = rowToProject(rows[0])
      return { ...project, flags: flagsFor(project) }
    })()
  )
}

export function recordScanRun(params: {
  roots: string[]
  startedAt: number
  finishedAt: number
  dirsWalked: number
  projectsFound: number
  error?: string
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO scan_runs (id, started_at, finished_at, roots_json, dirs_walked, projects_found, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      params.startedAt,
      params.finishedAt,
      JSON.stringify(params.roots),
      params.dirsWalked,
      params.projectsFound,
      params.error ?? null
    )
}

export function getKnownRootMtimes(): Record<string, number> {
  const rows = getDatabase().prepare('SELECT root, last_mtime FROM scan_root_state').all() as Array<{
    root: string
    last_mtime: number
  }>
  return Object.fromEntries(rows.map((r) => [r.root, r.last_mtime]))
}

export function saveRootMtimes(mtimes: Record<string, number>): void {
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO scan_root_state (root, last_mtime, last_scanned) VALUES (?, ?, ?)
     ON CONFLICT(root) DO UPDATE SET last_mtime = excluded.last_mtime, last_scanned = excluded.last_scanned`
  )
  const now = Date.now()
  db.transaction(() => {
    for (const [root, mtime] of Object.entries(mtimes)) stmt.run(root, Math.round(mtime), now)
  })()
}

/** Drops rows whose directory no longer exists, so deletions don't linger. */
export function pruneMissingProjects(existingPaths: Set<string>, scannedRoots: string[]): number {
  if (scannedRoots.length === 0) return 0
  const db = getDatabase()
  const all = db.prepare('SELECT id, path FROM projects').all() as Array<{ id: string; path: string }>
  const del = db.prepare('DELETE FROM projects WHERE id = ?')

  let removed = 0
  db.transaction(() => {
    for (const row of all) {
      // Only consider projects under a root we actually just scanned —
      // otherwise a scan of ~/code would delete everything found under
      // ~/Desktop on a previous run.
      const underScannedRoot = scannedRoots.some((r) => row.path.toLowerCase().startsWith(r.toLowerCase()))
      if (!underScannedRoot) continue
      if (existingPaths.has(row.path)) continue
      del.run(row.id)
      removed += 1
    }
  })()
  return removed
}

function rowToProject(row: any): ProjectRow {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    status: row.status,
    primaryLanguage: row.primary_language ?? null,
    languages: safeJson(row.languages_json, {}),
    frameworks: safeJson(row.frameworks_json, []),
    packageManager: row.package_manager ?? null,
    lastModified: row.last_modified ?? null,
    lastCommitAt: row.last_commit_at ?? null,
    branch: row.branch ?? null,
    isDirty: !!row.is_dirty,
    unpushedCount: row.unpushed_count ?? 0,
    readmeStatus: row.readme_status,
    loc: row.loc ?? 0,
    sizeBytes: row.size_bytes ?? 0,
    sizeBytesNoDeps: row.size_bytes_no_deps ?? 0,
    hasTests: !!row.has_tests,
    remoteUrl: row.remote_url ?? null,
    githubRepoId: row.github_repo_id ?? null,
    firstSeen: row.first_seen,
    lastScanned: row.last_scanned,
    notes: row.notes ?? null,
  }
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
