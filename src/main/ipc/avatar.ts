import { ipcMain, app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { IPC } from '../../shared/types'

function customModelPath(): string {
  const dir = join(app.getPath('userData'), 'avatars')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'custom.glb')
}

export function registerAvatarHandlers(): void {
  ipcMain.handle(IPC.AVATAR_SAVE_MODEL, (_event, data: ArrayBuffer) => {
    writeFileSync(customModelPath(), Buffer.from(data))
    return { success: true }
  })

  ipcMain.handle(IPC.AVATAR_LOAD_MODEL, () => {
    const path = customModelPath()
    if (!existsSync(path)) return null
    return readFileSync(path)
  })
}
