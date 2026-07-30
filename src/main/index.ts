import { app, BrowserWindow, shell, ipcMain, globalShortcut, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerLLMHandlers } from './ipc/llm'
import { registerTaskHandlers } from './ipc/tasks'
import { registerSystemHandlers } from './ipc/system'
import { registerVoiceHandlers } from './ipc/voice'
import { registerGoogleHandlers } from './ipc/google'
import { registerCalendarHandlers } from './ipc/calendar'
import { registerMailHandlers } from './ipc/mail'
import { getDatabase, closeDatabase } from './db/database'
import { createAvatarOverlayWindow, getAvatarOverlayWindow, toggleAvatarOverlayWindow } from './windows/avatarOverlay'
import { IPC } from '../shared/types'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#06080F',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.reigan.app')

  // Grant mic access and output-device switching for the voice pipeline.
  // The OS is still the real gatekeeper on Windows (Settings > Privacy > Microphone);
  // this only controls Electron/Chromium's own permission layer.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize DB
  getDatabase()

  const mainWindow = createWindow()
  createAvatarOverlayWindow()

  // Avatar overlay IPC — relay agent state from the main window to the overlay window
  ipcMain.handle(IPC.AVATAR_TOGGLE, () => toggleAvatarOverlayWindow())
  ipcMain.on(IPC.AVATAR_STATE_SYNC, (_event, state) => {
    getAvatarOverlayWindow()?.webContents.send(IPC.AVATAR_STATE_SYNC, state)
  })

  // Register all IPC handlers
  registerLLMHandlers(mainWindow)
  registerTaskHandlers()
  registerSystemHandlers()
  registerVoiceHandlers(mainWindow)
  registerGoogleHandlers()
  registerCalendarHandlers()
  registerMailHandlers()

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
