import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { getSetting, setSetting } from '../db/queries'
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
    setSetting(key, value)
    if (key === 'anthropicApiKey') resetExecutor()
    return { success: true }
  })
}
