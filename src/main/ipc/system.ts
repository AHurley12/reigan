import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { getSetting, setSetting, getSettingsForRenderer, getSecretPreviews } from '../db/queries'
import { isSecretKey } from '../db/secrets'
import { resetExecutor } from '../agents/reigan'

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.SYSTEM_INFO, () => ({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    appVersion: '0.1.0',
  }))

  // Credentials are never readable from the renderer, by key or in bulk.
  // Without this guard the bulk blanking below would be trivially sidestepped
  // by asking for one key at a time.
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) =>
    isSecretKey(key) ? '' : getSetting(key)
  )

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: string) => {
    // An empty write to a credential is the "user pressed Save without
    // retyping the key" case — the field is intentionally blank on load, so
    // honouring it would erase a working key on an accidental click.
    if (isSecretKey(key) && isBlankValue(value)) {
      return { success: true, unchanged: true }
    }
    setSetting(key, value)
    if (key === 'anthropicApiKey') resetExecutor()
    return { success: true }
  })

  ipcMain.handle(IPC.SETTINGS_LOAD_ALL, () => getSettingsForRenderer())
  ipcMain.handle(IPC.SETTINGS_SECRET_PREVIEWS, () => getSecretPreviews())
}

/** True for '' and for the JSON-encoded empty string the renderer sends. */
function isBlankValue(value: string): boolean {
  if (value === '') return true
  try {
    return JSON.parse(value) === ''
  } catch {
    return false
  }
}
