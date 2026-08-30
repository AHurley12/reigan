/**
 * Ownership of "which folders exist as far as Reigan is concerned", and of the
 * live {@link GuardContext} that `pathGuard` validates against.
 *
 * Two properties matter more than anything else in this file:
 *
 *  1. **Roots can only be added by a human at a native directory picker.**
 *     There is deliberately no exported function that takes a path string and
 *     turns it into a root. The model cannot call one, an IPC message cannot
 *     carry one, and typing a path into chat cannot produce one. If you are
 *     about to add `addRoot(path: string)` for convenience, that convenience is
 *     the whole vulnerability.
 *
 *  2. **A root that has gone missing is reported, never silently dropped.**
 *     Silently dropping it would quietly shrink Reigan's world and turn a
 *     disconnected drive into "that file never existed", which is exactly the
 *     kind of confident wrongness this subsystem exists to prevent.
 *
 * The allowlist ships empty. The user opts into every root explicitly.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { app, dialog, type BrowserWindow } from 'electron'
import { getDatabase } from '../db/database'
import { __internal as guardInternal } from './pathGuard'
import type { AllowlistedRoot, GuardContext, RootStatus } from './types'

/** Directory name of the snapshot store, under `userData`. */
export const SNAPSHOT_DIR_NAME = 'reigan-snapshots'

/** Path segments refused at any depth, inside allowlisted roots or not. */
const DENY_SEGMENTS: readonly string[] = ['.git', 'node_modules']

interface RootRow {
  id: string
  display_path: string
  resolved_path: string
  added_at: number
  is_protected: number
}

// ── Deny roots ──────────────────────────────────────────────────────────────

/**
 * Builds the list of locations that are refused even when they sit inside an
 * allowlisted root (a user who allows `C:\` must still not get Windows).
 *
 * Pure and fully parameterized so it can be unit-tested without Electron. The
 * env map is passed in rather than read from `process.env` for the same reason.
 */
export function computeDenyRoots(params: {
  userDataDir: string
  appInstallDir: string
  homeDir: string
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
}): string[] {
  const { userDataDir, appInstallDir, homeDir, platform, env } = params

  const denied: Array<string | undefined> = [
    // Reigan's own state. The snapshot store lives inside userData and is
    // therefore covered — critical, because a plan that could target the
    // snapshot store could destroy the very backups meant to undo it.
    userDataDir,
    appInstallDir,
  ]

  if (platform === 'win32') {
    denied.push(
      env.SystemRoot ?? env.windir ?? 'C:\\Windows',
      env.ProgramFiles ?? 'C:\\Program Files',
      env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      env.ProgramData ?? 'C:\\ProgramData',
      // Roaming\Microsoft holds credentials, protected storage and Office
      // recovery state — user-owned in the ACL sense, but not "the user's files".
      env.APPDATA !== undefined ? path.join(env.APPDATA, 'Microsoft') : path.join(homeDir, 'AppData', 'Roaming', 'Microsoft'),
      env.LOCALAPPDATA !== undefined ? path.join(env.LOCALAPPDATA, 'Microsoft') : path.join(homeDir, 'AppData', 'Local', 'Microsoft')
    )
  } else if (platform === 'darwin') {
    denied.push('/System', '/Library', '/Applications', '/private', '/usr', '/bin', '/sbin', path.join(homeDir, 'Library'))
  } else {
    denied.push('/proc', '/sys', '/dev', '/boot', '/usr', '/bin', '/sbin', '/etc')
  }

  return denied
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => path.normalize(path.resolve(value)))
}

function liveDenyRoots(): string[] {
  return computeDenyRoots({
    userDataDir: app.getPath('userData'),
    appInstallDir: app.getAppPath(),
    homeDir: app.getPath('home'),
    platform: process.platform,
    env: process.env,
  })
}

/** Absolute path of the snapshot store. Deny-listed, so never a `SafePath`. */
export function getSnapshotRoot(): string {
  return path.join(app.getPath('userData'), SNAPSHOT_DIR_NAME)
}

// ── Persistence ─────────────────────────────────────────────────────────────

function readRootRows(): RootRow[] {
  return getDatabase()
    .prepare('SELECT * FROM fileops_roots ORDER BY added_at ASC')
    .all() as RootRow[]
}

async function statusOf(resolvedPath: string): Promise<{ status: RootStatus; detail?: string }> {
  try {
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) {
      return { status: 'not_a_directory', detail: 'This path is no longer a folder.' }
    }
    // Prove it is actually readable, rather than assuming from the stat.
    await fs.readdir(resolvedPath)
    return { status: 'ok' }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return {
        status: 'missing',
        detail: 'This folder no longer exists at this path. If it is on a removable or network drive, reconnect it — Reigan will not act on files here until it is back.',
      }
    }
    return { status: 'unreadable', detail: `This folder cannot be read (${code ?? 'unknown error'}).` }
  }
}

/**
 * Every configured root with its current status. Called on app start and
 * whenever the settings UI opens.
 *
 * Note it returns *all* roots including broken ones — see the module header.
 * Callers that need only usable roots filter on `status === 'ok'` themselves,
 * which keeps the "we hid something from you" decision visible at the call site.
 */
export async function listRoots(): Promise<AllowlistedRoot[]> {
  const rows = readRootRows()
  return Promise.all(
    rows.map(async (row): Promise<AllowlistedRoot> => {
      const { status, detail } = await statusOf(row.resolved_path)
      return {
        id: row.id,
        displayPath: row.display_path,
        resolvedPath: row.resolved_path,
        addedAt: new Date(row.added_at).toISOString(),
        status,
        statusDetail: detail,
        protected: row.is_protected === 1,
      }
    })
  )
}

/**
 * Re-validates every root at app start. Returns the roots that need the user's
 * attention so the UI can surface them; nothing is removed from the database.
 */
export async function revalidateRootsOnStartup(): Promise<AllowlistedRoot[]> {
  const roots = await listRoots()
  return roots.filter((root) => root.status !== 'ok')
}

// ── The live guard context ──────────────────────────────────────────────────

/**
 * Builds the context `pathGuard` validates against.
 *
 * Only roots that currently resolve are included: a missing root must not
 * behave like a permissive one, and a path "inside" a disconnected drive is not
 * a path we can verify anything about.
 */
export async function getGuardContext(): Promise<GuardContext> {
  const roots = await listRoots()
  return {
    roots: roots.filter((root) => root.status === 'ok').map((root) => root.resolvedPath),
    denyRoots: liveDenyRoots(),
    denySegments: DENY_SEGMENTS,
    platform: process.platform,
    // Not verified long-path-aware. Assuming we are not is the fail-closed
    // choice: at worst we refuse a legal long path, at best we avoid a silent
    // Windows truncation that would point an operation at the wrong file.
    longPathAware: false,
  }
}

/** True when the user has flagged the root containing `resolvedPath` as protected. */
export async function isUnderProtectedRoot(resolvedPath: string): Promise<boolean> {
  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
  const roots = await listRoots()
  return roots.some(
    (root) => root.protected && guardInternal.isWithin(resolvedPath, root.resolvedPath, caseInsensitive)
  )
}

// ── Mutation: picker only ───────────────────────────────────────────────────

export type AddRootOutcome =
  | { ok: true; root: AllowlistedRoot }
  | { ok: false; reason: string }

/**
 * Opens a native directory picker and, if the user chooses a folder, registers
 * it as an allowlisted root.
 *
 * THE PICKER IS THE POINT. This is the only way a root is ever created, which
 * is what makes "Reigan cannot expand its own access" a structural fact rather
 * than a promise. The chosen path is still validated below, because a picker
 * can hand back a symlink like anything else.
 */
export async function addRootViaPicker(parentWindow: BrowserWindow): Promise<AddRootOutcome> {
  const picked = await dialog.showOpenDialog(parentWindow, {
    title: 'Allow Reigan to work with a folder',
    message: 'Reigan will be able to read, edit, move and rename files inside this folder. It can never delete them.',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Allow this folder',
  })

  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false, reason: 'No folder was chosen.' }
  }

  const displayPath = picked.filePaths[0]
  if (displayPath === undefined) return { ok: false, reason: 'No folder was chosen.' }

  return registerPickedDirectory(displayPath)
}

/**
 * Validates and stores a directory the user picked.
 *
 * Kept private on purpose — exporting it would recreate the string-to-root path
 * the picker requirement exists to eliminate.
 */
async function registerPickedDirectory(displayPath: string): Promise<AddRootOutcome> {
  const normalized = path.normalize(path.resolve(displayPath))

  const real = await guardInternal.resolveThroughLinks(normalized)
  if (!real.ok) {
    return { ok: false, reason: real.message }
  }
  const resolvedPath = real.resolved

  const stat = await statusOf(resolvedPath)
  if (stat.status !== 'ok') {
    return { ok: false, reason: stat.detail ?? 'That folder cannot be used.' }
  }

  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

  // A root that *is* a denied location, or sits inside one, would hand back
  // exactly what the deny list exists to withhold.
  const denied = liveDenyRoots().find((deny) => guardInternal.isWithin(resolvedPath, deny, caseInsensitive))
  if (denied !== undefined) {
    return {
      ok: false,
      reason: 'That folder is a protected system or application location, so it cannot be allowed. Choose a folder containing your own files.',
    }
  }

  // The reverse case: allowing a parent of a denied location is fine (the deny
  // list still applies inside it), so it is not rejected here — but allowing
  // a drive root is worth a deliberate mention rather than a silent accept.
  const existing = readRootRows()
  const duplicate = existing.find(
    (row) => guardInternal.isWithin(resolvedPath, row.resolved_path, caseInsensitive)
  )
  if (duplicate !== undefined) {
    return {
      ok: false,
      reason:
        duplicate.resolved_path.toLowerCase() === resolvedPath.toLowerCase()
          ? 'That folder is already allowed.'
          : `That folder is already covered by an allowed folder (${duplicate.display_path}).`,
    }
  }

  const id = randomUUID()
  const addedAt = Date.now()
  getDatabase()
    .prepare(
      'INSERT INTO fileops_roots (id, display_path, resolved_path, added_at, is_protected) VALUES (?, ?, ?, ?, 0)'
    )
    .run(id, displayPath, resolvedPath, addedAt)

  return {
    ok: true,
    root: {
      id,
      displayPath,
      resolvedPath,
      addedAt: new Date(addedAt).toISOString(),
      status: 'ok',
      protected: false,
    },
  }
}

/**
 * Removes a root. Removal is safe in a way that addition is not — it can only
 * ever shrink what Reigan can reach — so it takes an id and needs no picker.
 */
export function removeRoot(id: string): void {
  getDatabase().prepare('DELETE FROM fileops_roots WHERE id = ?').run(id)
}

/** Marks a root as protected, requiring elevated confirmation to write into. */
export function setRootProtected(id: string, isProtected: boolean): void {
  getDatabase()
    .prepare('UPDATE fileops_roots SET is_protected = ? WHERE id = ?')
    .run(isProtected ? 1 : 0, id)
}
