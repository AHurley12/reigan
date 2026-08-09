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
  whenReady: () => Promise.resolve(),
  on: () => {},
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer) => b.toString('utf-8'),
}

export const ipcMain = { handle: () => {}, on: () => {} }
export const shell = { openExternal: () => Promise.resolve() }
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
