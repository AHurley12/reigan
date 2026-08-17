import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { googleAuth } from '../auth/googleAuth'
import { resetExecutor } from '../agents/reigan'

export function registerGoogleHandlers(): void {
  ipcMain.handle(IPC.GOOGLE_STATUS, () => ({
    configured: googleAuth.isConfigured(),
    connected: googleAuth.isAuthenticated(),
    // Per-feature, because "connected" is not the same as "allowed to call
    // YouTube": a token minted before the YouTube scopes existed authenticates
    // fine and 403s on every stats call. Reporting one boolean is what made
    // that failure look like a Cloud console problem.
    grants: {
      youtube: googleAuth.hasScopes('youtube'),
      gmail: googleAuth.hasScopes('gmail'),
      calendar: googleAuth.hasScopes('calendar'),
    },
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
