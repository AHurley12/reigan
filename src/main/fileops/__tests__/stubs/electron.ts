/**
 * Minimal stand-in for the `electron` module so main-process fileops code can
 * be unit-tested in plain Node. Aliased in vitest.config.ts.
 *
 * Only the surface the fileops modules actually touch is implemented. Anything
 * not implemented throws loudly rather than returning undefined — a test that
 * silently exercises a no-op is worse than one that fails.
 */

import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { mkdtempSync } from 'fs'

const stubUserData = mkdtempSync(path.join(os.tmpdir(), 'reigan-userdata-'))
const stubHome = os.homedir()

export const app = {
  getPath(name: string): string {
    switch (name) {
      case 'userData':
        return stubUserData
      case 'home':
        return stubHome
      case 'temp':
        return os.tmpdir()
      default:
        throw new Error(`electron stub: app.getPath(${name}) is not implemented`)
    }
  },
  getAppPath(): string {
    return process.cwd()
  },
}

export const dialog = {
  showOpenDialog(): never {
    throw new Error(
      'electron stub: dialog.showOpenDialog cannot be exercised in a unit test. ' +
        'Root registration is picker-only by design; test the validation path instead.'
    )
  },
}

/** Cleanup hook for suites that want to remove the stub userData directory. */
export async function __cleanupStubUserData(): Promise<void> {
  await fs.rm(stubUserData, { recursive: true, force: true })
}

export type BrowserWindow = unknown
