/** Shared between the scan worker and the main-process orchestrator. */

export type ProjectStatus = 'active' | 'warm' | 'dormant' | 'abandoned'
export type ReadmeStatus = 'exists' | 'missing' | 'stub'

export interface ScanOptions {
  roots: string[]
  /** Directory depth below each root. Default 6. */
  maxDepth: number
  /** Hard ceiling on directories walked, per scan, across all roots. */
  dirCeiling: number
  /** Skip a root whose newest top-level mtime hasn't moved since last scan. */
  knownRootMtimes: Record<string, number>
}

export interface ScannedProject {
  path: string
  name: string
  /** Extension census weighted by bytes, as percentages that sum to ~100. */
  languages: Record<string, number>
  primaryLanguage: string | null
  frameworks: string[]
  packageManager: string | null
  /** Newest mtime among source files, ignoring build output. */
  lastModified: number
  lastCommitAt: number | null
  branch: string | null
  isDirty: boolean
  unpushedCount: number
  readmeStatus: ReadmeStatus
  loc: number
  sizeBytes: number
  sizeBytesNoDeps: number
  hasTests: boolean
  remoteUrl: string | null
}

export type WorkerMessage =
  | { type: 'progress'; dirsWalked: number; projectsFound: number; current?: string }
  | { type: 'done'; projects: ScannedProject[]; dirsWalked: number; rootMtimes: Record<string, number>; skippedRoots: string[] }
  | { type: 'error'; message: string }
