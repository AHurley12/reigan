import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC, type AgentPermissionRequest } from '../../shared/types'

const RESPONSE_TIMEOUT_MS = 2 * 60 * 1000

let mainWindow: BrowserWindow | null = null
const pending = new Map<string, (approved: boolean) => void>()

export function initPermissionGate(win: BrowserWindow): void {
  mainWindow = win
}

/**
 * Pauses the calling tool until the user approves or denies the action in
 * the UI. Auto-denies if the window is gone or nothing arrives in time —
 * an unattended agent turn should never sit blocked forever.
 */
export function requestPermission(tool: string, summary: string, detail?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve(false)
      return
    }

    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(false)
    }, RESPONSE_TIMEOUT_MS)

    pending.set(id, (approved) => {
      clearTimeout(timer)
      resolve(approved)
    })

    const request: AgentPermissionRequest = { id, tool, summary, detail }
    mainWindow.webContents.send(IPC.AGENT_PERMISSION_REQUEST, request)
  })
}

export function resolvePermission(id: string, approved: boolean): void {
  const resolve = pending.get(id)
  if (!resolve) return
  pending.delete(id)
  resolve(approved)
}
