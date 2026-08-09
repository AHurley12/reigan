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
import { registerAvatarHandlers } from './ipc/avatar'
import { registerFileHandlers } from './ipc/files'
import { registerPerformanceHandlers } from './ipc/performance'
import { registerAgentHandlers } from './ipc/agent'
import { registerVoiceAuthHandlers } from './ipc/voiceAuth'
import { stopMonitoring } from './perf/perfMonitor'
import { runFullIndex } from './files/fileIndexer'
import { getDatabase, closeDatabase } from './db/database'
import { getDecodedSetting } from './db/queries'
import {
  UI_SCALE,
  BASE_WINDOW_WIDTH,
  BASE_WINDOW_HEIGHT,
  BASE_WINDOW_MIN_WIDTH,
  BASE_WINDOW_MIN_HEIGHT,
} from '../shared/constants'

// Kept in sync with the surface.base value in each theme's tokens.ts —
// only used for the BrowserWindow's initial paint before the renderer loads.
const THEME_BACKGROUNDS: Record<string, string> = {
  shingan: '#0B0A08',
  gothic: '#0A0B0F',
  // Aero's surface.base is transparent (the ambient layer is its ground), so
  // there is no token to mirror here — this is the sky the ambient gradient
  // starts from, which is what the window should flash before it paints.
  aero: '#7FD4F5',
}
const DEFAULT_THEME_ID = 'shingan'

function createWindow(initialThemeId: string): BrowserWindow {
  const mainWindow = new BrowserWindow({
    // Scaled alongside webPreferences.zoomFactor so the renderer still sees a
    // BASE_WINDOW_WIDTH x BASE_WINDOW_HEIGHT CSS viewport — see UI_SCALE.
    width: Math.round(BASE_WINDOW_WIDTH * UI_SCALE),
    height: Math.round(BASE_WINDOW_HEIGHT * UI_SCALE),
    minWidth: Math.round(BASE_WINDOW_MIN_WIDTH * UI_SCALE),
    minHeight: Math.round(BASE_WINDOW_MIN_HEIGHT * UI_SCALE),
    show: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: THEME_BACKGROUNDS[initialThemeId] ?? THEME_BACKGROUNDS[DEFAULT_THEME_ID],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: UI_SCALE,
      additionalArguments: [`--initial-theme=${initialThemeId}`],
    },
  })

  // Chromium remembers a per-origin zoom level that outranks the webPreferences
  // seed, and dev-server HMR reloads re-apply it — so re-assert on every load.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(UI_SCALE)
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

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows()
    if (existingWindow) {
      if (existingWindow.isMinimized()) existingWindow.restore()
      existingWindow.focus()
    }
  })

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

    // Synchronous (better-sqlite3) so the window's initial theme is known
    // before creation — see THEME_BACKGROUNDS and preload/index.ts.
    const initialThemeId = getDecodedSetting('theme') ?? DEFAULT_THEME_ID
    const mainWindow = createWindow(initialThemeId)

    // Register all IPC handlers
    registerLLMHandlers(mainWindow)
    registerTaskHandlers()
    registerSystemHandlers()
    registerVoiceHandlers(mainWindow)
    registerGoogleHandlers()
    registerCalendarHandlers()
    registerMailHandlers()
    registerAvatarHandlers()
    registerFileHandlers()
    registerPerformanceHandlers(mainWindow)
    registerAgentHandlers(mainWindow)
    // Registered last: initialise() locks the session, so anything above that
    // wants to run at startup does so before the gate closes.
    registerVoiceAuthHandlers(mainWindow)

    // Background file index build — non-blocking, renderer polls FILES_INDEX_STATUS.
    runFullIndex().catch(() => {})

    // Window control IPC
    ipcMain.on('window:minimize', () => mainWindow.minimize())
    ipcMain.on('window:maximize', () => {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    })
    ipcMain.on('window:close', () => mainWindow.close())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(getDecodedSetting('theme') ?? DEFAULT_THEME_ID)
      }
    })
  })
}

app.on('window-all-closed', () => {
  stopMonitoring()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
