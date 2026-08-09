import { parentPort, workerData } from 'worker_threads'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import { join, extname } from 'path'
import {
  PRUNE_DIRS,
  isContainerDir,
  isProjectMarker,
  languageForExt,
  isSourceExt,
  toLanguagePercentages,
  primaryLanguage,
  detectFrameworks,
  detectPackageManager,
  classifyReadme,
  hasTests,
  projectNameFor,
  isMonorepoRoot,
} from './detect'
import { readGitMeta, EMPTY_GIT_META } from './gitmeta'
import type { ScanOptions, ScannedProject, WorkerMessage } from './types'

/**
 * The scan, running off the main thread.
 *
 * Two separate walks, for two different reasons. Discovery is a breadth-first
 * descent that stops as soon as it finds a project marker — the outermost
 * match wins, so a repository's own sub-packages are not each reported as
 * projects. The per-project census is a second, contained walk that stats
 * files for the language and size figures.
 *
 * Written by hand rather than with fdir for the discovery pass specifically
 * because of that early stop: the interesting behaviour is *not descending*,
 * and a crawler that collects everything and filters afterwards would walk the
 * entire drive to answer a question that should terminate at the first
 * `package.json`.
 */

/**
 * Files stat'ed per project before size figures become lower bounds.
 *
 * A precise total for a project with a 90,000-file `node_modules` costs
 * seconds of stat calls to tell the user something they already suspect. The
 * un-vendored total, which is the number that actually distinguishes projects,
 * is always exact — the cap only ever truncates the dependency portion.
 */
const STAT_CAP_PER_PROJECT = 20000

const opts = workerData as ScanOptions
const HOME_DIR = homedir()

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message)
}

let dirsWalked = 0
let projectsFound = 0
let lastProgressAt = 0

function reportProgress(current?: string): void {
  const now = Date.now()
  // Throttled: a message per directory would cost more in IPC than the walk.
  if (now - lastProgressAt < 120) return
  lastProgressAt = now
  post({ type: 'progress', dirsWalked, projectsFound, current })
}

interface DirEntrySummary {
  files: Set<string>
  dirs: Set<string>
}

async function readDirSummary(dir: string): Promise<DirEntrySummary | null> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const files = new Set<string>()
    const dirs = new Set<string>()
    for (const e of entries) {
      // A symlink is reported as neither file nor directory here, which is the
      // behaviour we want: following them invites cycles and duplicate
      // projects reached by two paths.
      if (e.isDirectory()) dirs.add(e.name)
      else if (e.isFile()) files.add(e.name)
    }
    return { files, dirs }
  } catch {
    // Permission denied, or the directory vanished mid-scan. Both are normal
    // when walking a live user profile.
    return null
  }
}

function looksLikeProject(summary: DirEntrySummary): boolean {
  for (const f of summary.files) if (isProjectMarker(f, false)) return true
  for (const d of summary.dirs) if (isProjectMarker(d, true)) return true
  return false
}

/** Breadth-first so shallow projects are found before deep ones under a ceiling. */
async function discover(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = []
  let frontier: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]

  while (frontier.length > 0) {
    const next: Array<{ path: string; depth: number }> = []

    for (const { path, depth } of frontier) {
      if (dirsWalked >= opts.dirCeiling) return found

      const summary = await readDirSummary(path)
      dirsWalked += 1
      reportProgress(path)
      if (!summary) continue

      // A container is descended into even when it carries a marker file —
      // see isContainerDir for the stray-package.json case that motivates it.
      if (looksLikeProject(summary) && !isContainerDir(path, HOME_DIR)) {
        found.push(path)
        projectsFound += 1

        // A monorepo root is a project *and* a parent of projects; anything
        // else absorbs whatever is nested inside it.
        const pkg = await readJson(join(path, 'package.json'))
        if (!isMonorepoRoot(pkg, summary.files)) continue
      }

      if (depth >= maxDepth) continue

      for (const dirName of summary.dirs) {
        if (PRUNE_DIRS.has(dirName)) continue
        if (dirName.startsWith('.') && dirName !== '.github') continue
        next.push({ path: join(path, dirName), depth: depth + 1 })
      }
    }

    frontier = next
  }

  return found
}

async function readText(path: string, maxBytes = 512 * 1024): Promise<string | null> {
  try {
    const handle = await fsp.open(path, 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, maxBytes)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, 0)
      return buffer.toString('utf-8')
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

async function readJson(path: string): Promise<any | null> {
  const text = await readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    // A malformed package.json is common in abandoned projects and must not
    // abort the scan of an otherwise readable tree.
    return null
  }
}

interface Census {
  bytesByLanguage: Record<string, number>
  loc: number
  sizeBytes: number
  sizeBytesNoDeps: number
  newestSourceMtime: number
  sawTestFile: boolean
  testDirNames: Set<string>
  truncated: boolean
}

/**
 * Walks a single project, collecting the language census and size totals.
 *
 * Descends dependency directories only to total their bytes — no language or
 * line counting inside them, since vendored code is not the user's code and
 * would dominate every figure it touched.
 */
async function census(projectPath: string): Promise<Census> {
  const result: Census = {
    bytesByLanguage: {},
    loc: 0,
    sizeBytes: 0,
    sizeBytesNoDeps: 0,
    newestSourceMtime: 0,
    sawTestFile: false,
    testDirNames: new Set(),
    truncated: false,
  }

  // Two passes, and the order is the point. The project's own files are
  // measured exhaustively — languages, LOC and the un-vendored size are the
  // figures that distinguish one project from another, so they must never be
  // approximate. Dependency directories are totalled afterwards under a stat
  // budget, because a precise byte count for a 90,000-file node_modules costs
  // seconds to tell the user something they already know.
  const depDirs: string[] = []
  const stack: string[] = [projectPath]

  while (stack.length > 0) {
    const path = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = join(path, entry.name)

      if (entry.isDirectory()) {
        // `.git` holds the object database — large, and counting it as project
        // size would make every repository look bloated.
        if (entry.name === '.git') continue
        if (PRUNE_DIRS.has(entry.name)) {
          depDirs.push(full)
          continue
        }
        result.testDirNames.add(entry.name)
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue

      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }

      result.sizeBytes += stat.size
      result.sizeBytesNoDeps += stat.size

      const ext = extname(entry.name)
      if (!isSourceExt(ext)) continue

      const language = languageForExt(ext)
      if (language) {
        result.bytesByLanguage[language] = (result.bytesByLanguage[language] ?? 0) + stat.size
      }
      if (stat.mtimeMs > result.newestSourceMtime) result.newestSourceMtime = stat.mtimeMs

      if (/\.(test|spec)\.[a-z]+$/i.test(entry.name) || /^test_.*\.py$/i.test(entry.name)) {
        result.sawTestFile = true
      }

      // Line counting reads the file, so it is capped well below the size
      // limit used for text reads — a 5MB generated bundle contributes
      // nothing useful to a LOC estimate.
      if (stat.size <= 1024 * 1024) {
        const text = await readText(full, 1024 * 1024)
        if (text !== null) result.loc += countLines(text)
      }
    }
  }

  result.sizeBytes += await totalDependencyBytes(depDirs, result)
  return result
}

/**
 * Sums dependency directories under a stat budget.
 *
 * Sets `truncated` when the budget runs out, so the reported total is honestly
 * a lower bound rather than silently wrong.
 */
async function totalDependencyBytes(roots: string[], result: Census): Promise<number> {
  let total = 0
  let statted = 0
  const stack = [...roots]

  while (stack.length > 0) {
    if (statted >= STAT_CAP_PER_PROJECT) {
      result.truncated = true
      break
    }

    const path = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(join(path, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (statted >= STAT_CAP_PER_PROJECT) {
        result.truncated = true
        break
      }
      try {
        total += (await fsp.stat(join(path, entry.name))).size
        statted += 1
      } catch {
        // Vanished mid-walk, or a permission wall inside a vendored package.
      }
    }
  }

  return total
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  let lines = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

const README_NAMES = ['README.md', 'README.MD', 'readme.md', 'README', 'README.txt', 'README.rst']

async function readReadme(projectPath: string, files: Set<string>): Promise<string | null> {
  for (const name of README_NAMES) {
    if (files.has(name)) {
      const text = await readText(join(projectPath, name))
      if (text !== null) return text
    }
  }
  return null
}

async function describeProject(projectPath: string): Promise<ScannedProject | null> {
  const summary = await readDirSummary(projectPath)
  if (!summary) return null

  const pkg = await readJson(join(projectPath, 'package.json'))
  const [counts, gitMeta] = await Promise.all([
    census(projectPath),
    summary.dirs.has('.git') ? readGitMeta(projectPath) : Promise.resolve({ ...EMPTY_GIT_META }),
  ])

  const languages = toLanguagePercentages(counts.bytesByLanguage)

  const frameworks = detectFrameworks({
    packageJson: pkg,
    pythonRequirements: await readText(join(projectPath, 'requirements.txt'), 64 * 1024),
    pyprojectToml: await readText(join(projectPath, 'pyproject.toml'), 64 * 1024),
    cargoToml: await readText(join(projectPath, 'Cargo.toml'), 64 * 1024),
    goMod: await readText(join(projectPath, 'go.mod'), 64 * 1024),
  })

  const readme = await readReadme(projectPath, summary.files)

  return {
    path: projectPath,
    name: projectNameFor(projectPath, pkg?.name),
    languages,
    primaryLanguage: primaryLanguage(languages),
    frameworks,
    packageManager: detectPackageManager(summary.files),
    // Falls back to the directory's own mtime for a project with no source
    // files we recognise, which is better than reporting the epoch.
    lastModified: counts.newestSourceMtime || (await dirMtime(projectPath)),
    lastCommitAt: gitMeta.lastCommitAt,
    branch: gitMeta.branch,
    isDirty: gitMeta.isDirty,
    unpushedCount: gitMeta.unpushedCount,
    readmeStatus: classifyReadme(readme),
    loc: counts.loc,
    sizeBytes: counts.sizeBytes,
    sizeBytesNoDeps: counts.sizeBytesNoDeps,
    hasTests: hasTests({
      dirNames: counts.testDirNames,
      fileNames: counts.sawTestFile ? new Set(['seen.test.ts']) : new Set(),
      packageScripts: pkg?.scripts ?? null,
    }),
    remoteUrl: gitMeta.remoteUrl,
  }
}

async function dirMtime(path: string): Promise<number> {
  try {
    return (await fsp.stat(path)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Newest mtime among a root's immediate children.
 *
 * Cheap enough to run on every scan, and sufficient for the incremental skip:
 * creating, deleting, or touching a project directory moves its parent's
 * mtime. It will not notice a change buried deep inside an existing project,
 * which is why a full rescan stays available.
 */
async function rootSignature(root: string): Promise<number> {
  const summary = await readDirSummary(root)
  if (!summary) return 0
  let newest = await dirMtime(root)
  for (const name of summary.dirs) {
    const m = await dirMtime(join(root, name))
    if (m > newest) newest = m
  }
  return newest
}

async function main(): Promise<void> {
  const projects: ScannedProject[] = []
  const rootMtimes: Record<string, number> = {}
  const skippedRoots: string[] = []

  for (const root of opts.roots) {
    const signature = await rootSignature(root)
    rootMtimes[root] = signature

    const known = opts.knownRootMtimes[root]
    if (known && signature && known === signature) {
      skippedRoots.push(root)
      continue
    }

    const discovered = await discover(root, opts.maxDepth)
    for (const path of discovered) {
      const described = await describeProject(path)
      if (described) projects.push(described)
      reportProgress(path)
    }
  }

  post({ type: 'done', projects, dirsWalked, rootMtimes, skippedRoots })
}

main().catch((err: unknown) => {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
})
