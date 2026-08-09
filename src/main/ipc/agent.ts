import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { initPermissionGate, resolvePermission } from '../agents/permissionGate'

export function registerAgentHandlers(mainWindow: BrowserWindow): void {
  initPermissionGate(mainWindow)

  ipcMain.on(IPC.AGENT_PERMISSION_RESPOND, (_event, { id, approved }: { id: string; approved: boolean }) => {
    resolvePermission(id, approved)
  })
}
