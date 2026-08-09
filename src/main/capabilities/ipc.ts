import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { invokeCapability, listCapabilities } from './registry'
import {
  APPROVAL_RESOLVE_CHANNEL,
  initApprovals,
  listApprovalHistory,
  listPendingApprovals,
  resolveApproval,
} from './approval'

/**
 * The UI surface for every capability, as three generic channels rather than one
 * channel per feature.
 *
 * The old pattern needed a new entry in the `IPC` string enum, a new
 * `ipcMain.handle` call, and a new hand-written preload method for every single
 * operation — three edits in three files before a feature could be reached from
 * the renderer. Dispatch is uniform, so the plumbing should be too.
 */

export const CAP_INVOKE = 'capability:invoke'
export const CAP_LIST = 'capability:list'
export const CAP_CANCEL = 'capability:cancel'
export const CAP_PROGRESS = 'capability:progress'
export const APPROVALS_PENDING = 'approvals:pending'
export const APPROVALS_HISTORY = 'approvals:history'

/** In-flight cancellable invocations, so the UI can abort a long index or sync. */
const inFlight = new Map<string, AbortController>()

export function registerCapabilityHandlers(win: BrowserWindow): void {
  initApprovals(win)

  ipcMain.handle(
    CAP_INVOKE,
    async (_event, payload: { id: string; args?: unknown; invocationId?: string }) => {
      const invocationId = payload.invocationId ?? randomUUID()
      const controller = new AbortController()
      inFlight.set(invocationId, controller)

      try {
        return await invokeCapability(payload.id, payload.args, {
          invokedBy: 'ui',
          signal: controller.signal,
          onProgress: (progress) => {
            if (win.isDestroyed()) return
            win.webContents.send(CAP_PROGRESS, { invocationId, ...progress })
          },
        })
      } finally {
        inFlight.delete(invocationId)
      }
    }
  )

  ipcMain.handle(CAP_CANCEL, (_event, invocationId: string) => {
    const controller = inFlight.get(invocationId)
    if (!controller) return false
    controller.abort()
    return true
  })

  ipcMain.handle(CAP_LIST, () => listCapabilities())

  ipcMain.handle(APPROVALS_PENDING, () => listPendingApprovals())
  ipcMain.handle(APPROVALS_HISTORY, (_event, limit?: number) => listApprovalHistory(limit ?? 100))

  ipcMain.on(APPROVAL_RESOLVE_CHANNEL, (_event, payload: { id: string; approved: boolean }) => {
    const { row } = resolveApproval(payload.id, payload.approved)

    // A queued job approval has no awaiting promise to resume — the original
    // caller is gone. Phase 1 subscribes here to re-dispatch the parked run.
    if (row && row.state === 'approved') {
      queuedApprovalHandlers.forEach((fn) => fn(row.id, row.capabilityId, row.args))
    }
  })
}

type QueuedApprovalHandler = (approvalId: string, capabilityId: string, args: unknown) => void
const queuedApprovalHandlers: QueuedApprovalHandler[] = []

/** Phase 1's job engine registers here to resume runs parked on approval. */
export function onQueuedApprovalGranted(fn: QueuedApprovalHandler): void {
  queuedApprovalHandlers.push(fn)
}
