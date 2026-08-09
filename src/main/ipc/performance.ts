import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { getStaticInfo, startMonitoring, stopMonitoring } from '../perf/perfMonitor'

export function registerPerformanceHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.PERF_STATIC_INFO, () => getStaticInfo())

  ipcMain.handle(IPC.PERF_START, () => {
    startMonitoring(mainWindow)
    return { started: true }
  })

  ipcMain.handle(IPC.PERF_STOP, () => {
    stopMonitoring()
    return { stopped: true }
  })
}
