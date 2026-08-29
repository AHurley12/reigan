import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { getSetting, setSetting, getAllSettings, InvalidSettingError } from '../db/queries'
import { resetExecutor } from '../agents/reigan'

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC.SYSTEM_INFO, () => ({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    appVersion: '0.1.0',
  }))

  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => getSetting(key))

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: string) => {
    try {
      setSetting(key, value)
    } catch (err) {
      // A rejected setting is a normal outcome (see SETTING_GUARDS), not a
      // crash. Report it in the existing result shape so the renderer can show
      // the reason instead of the promise rejecting under the caller.
      if (err instanceof InvalidSettingError) {
        return { success: false, error: err.message }
      }
      throw err
    }
    // The system prompt embeds the live settings block, so any change leaves
    // the cached executor stale — not just an API-key change.
    resetExecutor()
    return { success: true }
  })

  ipcMain.handle(IPC.SETTINGS_LOAD_ALL, () => getAllSettings())
}
