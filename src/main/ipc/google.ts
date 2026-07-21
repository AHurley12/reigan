import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { googleAuth } from '../auth/googleAuth'
import { resetExecutor } from '../agents/reigan'

export function registerGoogleHandlers(): void {
  ipcMain.handle(IPC.GOOGLE_STATUS, () => ({
    configured: googleAuth.isConfigured(),
    connected: googleAuth.isAuthenticated(),
  }))

  ipcMain.handle(IPC.GOOGLE_CONNECT, async () => {
    try {
      await googleAuth.connect()
      resetExecutor()
      return { connected: true }
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.GOOGLE_DISCONNECT, () => {
    googleAuth.disconnect()
    resetExecutor()
    return { connected: false }
  })
}
