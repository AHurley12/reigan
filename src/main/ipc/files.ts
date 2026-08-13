import { ipcMain, shell } from 'electron'
import { IPC, type FileSearchParams } from '../../shared/types'
import {
  listDirectory,
  searchFiles,
  getIndexStatus,
  runFullIndex,
  readFileContent,
  isPathAllowed,
  getHomeDir,
} from '../files/fileIndexer'

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.FILES_LIST_DIR, async (_event, dirPath?: string) => {
    const target = dirPath || getHomeDir()
    return listDirectory(target)
  })

  ipcMain.handle(IPC.FILES_SEARCH, async (_event, params: FileSearchParams) => {
    return searchFiles(params)
  })

  ipcMain.handle(IPC.FILES_INDEX_STATUS, async () => getIndexStatus())

  ipcMain.handle(IPC.FILES_REINDEX, async () => {
    // Still fire-and-forget — the renderer polls FILES_INDEX_STATUS for progress
    // — but the rejection is no longer discarded. runFullIndex records the
    // failure on the index status before it throws, so the panel's error line
    // picks it up on the next poll; this catch only stops an unhandled rejection.
    runFullIndex().catch((err) => {
      console.error('[files] manual reindex failed:', err)
    })
    return { started: true }
  })

  ipcMain.handle(IPC.FILES_READ_CONTENT, async (_event, filePath: string) => {
    return readFileContent(filePath)
  })

  ipcMain.handle(IPC.FILES_OPEN, async (_event, filePath: string) => {
    if (!isPathAllowed(filePath)) throw new Error('That location is outside the allowed scope.')
    const err = await shell.openPath(filePath)
    if (err) throw new Error(err)
    return { opened: true }
  })

  ipcMain.handle(IPC.FILES_REVEAL, async (_event, filePath: string) => {
    if (!isPathAllowed(filePath)) throw new Error('That location is outside the allowed scope.')
    shell.showItemInFolder(filePath)
    return { revealed: true }
  })
}
