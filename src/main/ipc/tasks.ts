import { ipcMain } from 'electron'
import { IPC } from '../../shared/types'
import { createTask, listTasks, updateTask, deleteTask } from '../db/queries'

export function registerTaskHandlers(): void {
  ipcMain.handle(IPC.TASK_CREATE, (_event, params) => createTask(params))
  ipcMain.handle(IPC.TASK_LIST, (_event, params) => listTasks(params))
  ipcMain.handle(IPC.TASK_UPDATE, (_event, { id, updates }) => updateTask(id, updates))
  ipcMain.handle(IPC.TASK_DELETE, (_event, id) => { deleteTask(id); return { success: true } })
}
