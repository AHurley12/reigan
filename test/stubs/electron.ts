/**
 * Minimal `electron` stand-in for unit tests.
 *
 * Only the surfaces the code under test actually reaches are implemented.
 * safeStorage reports encryption as unavailable, which exercises the plaintext
 * fallback path in db/secrets.ts without needing an OS keyring.
 */
export const app = {
  getPath: () => process.cwd(),
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
