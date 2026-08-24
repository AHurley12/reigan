import { ipcMain } from 'electron'
import { CONTEXT_FACT_KINDS, IPC, type ContextFact, type ContextFactKind } from '../../shared/types'
import {
  clearAllFacts,
  dismissFact,
  editFactBody,
  listFacts,
  reactivateFact,
  slugifyKey,
  upsertFact,
} from '../context/store'
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

  // Restore, not re-assert. Reactivating through editFactBody would promote a
  // stat-derived row to user-authored and freeze its numbers permanently.
  ipcMain.handle(IPC.CONTEXT_RESTORE_FACT, (_e, id: string) => reactivateFact(id))

  // The one place the user authors a fact outright. Written as `source: 'user'`
  // so it outranks every producer, and keyed on a slug of its own text so
  // typing the same thing twice corrects the row rather than stacking a
  // near-duplicate beside it.
  ipcMain.handle(IPC.CONTEXT_ADD_FACT, (_e, payload: { kind: string; body: string }) => {
    const body = (payload?.body ?? '').trim()
    if (!body) return null

    const kind = CONTEXT_FACT_KINDS.includes(payload?.kind as ContextFactKind)
      ? (payload.kind as ContextFactKind)
      : 'duty'

    return upsertFact({ kind, key: slugifyKey(body), body, source: 'user', evidence: 'stated in Settings' })
  })

  ipcMain.handle(IPC.CONTEXT_CLEAR_FACTS, () => {
    clearAllFacts()
    return { ok: true }
  })

  ipcMain.handle(IPC.CONTEXT_REFRESH_STATS, () => refreshStats())
}
