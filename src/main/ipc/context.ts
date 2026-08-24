import { ipcMain } from 'electron'
import { IPC, type ContextFact } from '../../shared/types'
import { clearAllFacts, dismissFact, editFactBody, listFacts } from '../context/store'
import { refreshStats } from '../context/stats'

export function registerContextHandlers(): void {
  // Both active and dismissed, so the review UI can show what was rejected and
  // let the user put it back.
  ipcMain.handle(IPC.CONTEXT_LIST_FACTS, (): { active: ContextFact[]; dismissed: ContextFact[] } => ({
    active: listFacts({ status: 'active' }),
    dismissed: listFacts({ status: 'dismissed' }),
  }))

  ipcMain.handle(IPC.CONTEXT_EDIT_FACT, (_e, payload: { id: string; body: string }) =>
    editFactBody(payload.id, payload.body),
  )

  ipcMain.handle(IPC.CONTEXT_DISMISS_FACT, (_e, id: string) => {
    dismissFact(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.CONTEXT_CLEAR_FACTS, () => {
    clearAllFacts()
    return { ok: true }
  })

  ipcMain.handle(IPC.CONTEXT_REFRESH_STATS, () => refreshStats())
}
