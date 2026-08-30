/**
 * Minimal `electron` stand-in for unit tests.
 *
 * Only the surfaces the code under test actually reaches are implemented.
 * safeStorage reports encryption as unavailable, which exercises the plaintext
 * fallback path in db/secrets.ts without needing an OS keyring.
 */

/** Tests point this at a temp directory before importing anything that opens the DB. */
export const app = {
  getPath: () => process.env.REIGAN_TEST_USERDATA ?? process.cwd(),
  // Deny-root computation needs the install directory. Pointing it at cwd
  // would deny-list the whole repo, including any temp fixture created
  // beneath it, so it gets its own implausible path.
  getAppPath: () => process.env.REIGAN_TEST_APPDIR ?? 'C:\\__reigan_install__',
  whenReady: () => Promise.resolve(),
  on: () => {},
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer) => b.toString('utf-8'),
}

export const ipcMain = { handle: () => {}, on: () => {} }

/**
 * `trashItem` really deletes in tests.
 *
 * There is no Recycle Bin in a headless test run, and the alternative —
 * leaving the file in place — would make the organiser's trash operations
 * silently pass while doing nothing, which is worse than a fixture file being
 * removed from a temp directory.
 */
export const shell = {
  openExternal: () => Promise.resolve(),
  trashItem: async (path: string) => {
    const { promises: fsp } = await import('fs')
    await fsp.rm(path, { force: true, recursive: true })
  },
}
export const BrowserWindow = class {}

/** Overridable so tests can drive the scheduler's offline branch. */
export const net = {
  isOnline: () => (process.env.REIGAN_TEST_OFFLINE === '1' ? false : true),
}

export const powerMonitor = {
  on: () => {},
  off: () => {},
  getSystemIdleTime: () => 0,
}

export const Notification = Object.assign(
  class {
    show(): void {}
  },
  { isSupported: () => false }
)
