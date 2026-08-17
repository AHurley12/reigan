import { Worker } from 'worker_threads'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { getDecodedSetting } from '../../db/queries'
import {
  getKnownRootMtimes,
  pruneMissingProjects,
  recordScanRun,
  saveRootMtimes,
  upsertProjects,
} from './store'
import { recordAppError } from '../../errors/errorLog'
import type { ScanOptions, ScannedProject, WorkerMessage } from './types'

/**
 * Main-process orchestration for the project scan.
 *
 * Owns the worker's lifetime, forwards progress, and is the only place scan
 * results reach the database. The walk itself never runs here — see
 * scanWorker.ts for why that matters.
 */

export const SCAN_ROOTS_KEY = 'devtoolsScanRoots'
export const SCAN_DEPTH_KEY = 'devtoolsScanMaxDepth'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_DIR_CEILING = 60000

/** A scan that has not finished in this long has hit something pathological. */
const SCAN_TIMEOUT_MS = 10 * 60 * 1000

export interface ScanProgress {
  dirsWalked: number
  projectsFound: number
  current?: string
}

export interface ScanResult {
  projectsFound: number
  dirsWalked: number
  durationMs: number
  skippedRoots: string[]
  removed: number
  roots: string[]
}

let running = false

export function isScanRunning(): boolean {
  return running
}

/**
 * Default roots, filtered to those that exist.
 *
 * Deliberately excludes the drive root and the home directory itself. A scan
 * of `C:\` would spend most of its budget on Windows and Program Files, and
 * the home directory's own depth budget is better spent starting from the
 * folders where people actually keep code.
 */
export function defaultRoots(): string[] {
  const home = app.getPath('home')
  const candidates = [
    join(home, 'source'),
    join(home, 'repos'),
    join(home, 'code'),
    join(home, 'dev'),
    join(home, 'projects'),
    join(home, 'Documents'),
    join(home, 'Desktop'),
  ]
  return candidates.filter((p) => existsSync(p))
}

export function configuredRoots(): string[] {
  const raw = getDecodedSetting(SCAN_ROOTS_KEY)
  if (!raw) return defaultRoots()
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((p): p is string => typeof p === 'string' && existsSync(p))
    }
  } catch {
    // Fall through to defaults — a corrupt setting should not disable scanning.
  }
  return defaultRoots()
}

function configuredDepth(): number {
  const raw = getDecodedSetting(SCAN_DEPTH_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_DEPTH
  return Math.min(Math.max(Math.trunc(parsed), 1), 12)
}

function workerPath(): string {
  // Emitted beside index.js by the extra rollup entry in electron.vite.config.ts.
  return join(__dirname, 'scanWorker.js')
}

export async function runScan(params: {
  roots?: string[]
  full?: boolean
  onProgress?: (p: ScanProgress) => void
  signal?: AbortSignal
}): Promise<ScanResult> {
  if (running) throw new Error('A scan is already running.')

  const roots = params.roots?.length ? params.roots : configuredRoots()
  if (roots.length === 0) {
    throw new Error(
      'No scan roots configured, and none of the usual locations exist. Add a folder in Dev Tools settings.'
    )
  }

  const startedAt = Date.now()
  running = true

  const options: ScanOptions = {
    roots,
    maxDepth: configuredDepth(),
    dirCeiling: DEFAULT_DIR_CEILING,
    // A full scan ignores the incremental skip by presenting no history.
    knownRootMtimes: params.full ? {} : getKnownRootMtimes(),
  }

  try {
    const outcome = await runWorker(options, params.onProgress, params.signal)

    upsertProjects(outcome.projects)
    saveRootMtimes(outcome.rootMtimes)

    // Only prune under roots that were actually walked this time. A skipped
    // root's projects are still there; they just weren't re-listed.
    const walkedRoots = roots.filter((r) => !outcome.skippedRoots.includes(r))
    const removed = pruneMissingProjects(
      new Set(outcome.projects.map((p) => p.path)),
      walkedRoots
    )

    const finishedAt = Date.now()
    recordScanRun({
      roots,
      startedAt,
      finishedAt,
      dirsWalked: outcome.dirsWalked,
      projectsFound: outcome.projects.length,
    })

    return {
      projectsFound: outcome.projects.length,
      dirsWalked: outcome.dirsWalked,
      durationMs: finishedAt - startedAt,
      skippedRoots: outcome.skippedRoots,
      removed,
      roots,
    }
  } catch (err) {
    recordScanRun({
      roots,
      startedAt,
      finishedAt: Date.now(),
      dirsWalked: 0,
      projectsFound: 0,
      error: err instanceof Error ? err.message : String(err),
    })
    // scan_runs keeps one row per run and is pruned with the run history; this
    // keeps the failure alongside every other Dev Tools failure, so a scan that
    // has been dying for a fortnight is visible next to everything else that
    // has gone wrong rather than only to whoever opens the scan history.
    recordAppError({
      source: 'scanner',
      operation: 'runScan',
      error: err,
      severity: 'fatal',
      context: { roots, durationMs: Date.now() - startedAt },
    })
    throw err
  } finally {
    running = false
  }
}

interface WorkerOutcome {
  projects: ScannedProject[]
  dirsWalked: number
  rootMtimes: Record<string, number>
  skippedRoots: string[]
}

function runWorker(
  options: ScanOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal
): Promise<WorkerOutcome> {
  return new Promise((resolve, reject) => {
    const path = workerPath()
    if (!existsSync(path)) {
      reject(new Error(`Scan worker missing at ${path} — the build did not emit it.`))
      return
    }

    const worker = new Worker(path, { workerData: options })
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Scan timed out after 10 minutes.')))
    }, SCAN_TIMEOUT_MS)

    const onAbort = (): void => {
      finish(() => reject(Object.assign(new Error('Scan cancelled.'), { name: 'AbortError' })))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        onProgress?.({
          dirsWalked: message.dirsWalked,
          projectsFound: message.projectsFound,
          current: message.current,
        })
        return
      }
      if (message.type === 'error') {
        finish(() => reject(new Error(message.message)))
        return
      }
      finish(() =>
        resolve({
          projects: message.projects,
          dirsWalked: message.dirsWalked,
          rootMtimes: message.rootMtimes,
          skippedRoots: message.skippedRoots,
        })
      )
    })

    worker.on('error', (err) => finish(() => reject(err)))
    worker.on('exit', (code) => {
      // A non-zero exit before any 'done' message means the worker died
      // without reporting why — surface it rather than hanging the promise.
      if (code !== 0) finish(() => reject(new Error(`Scan worker exited with code ${code}.`)))
    })
  })
}
