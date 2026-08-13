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
import { getDatabase, closeDatabase } from './db/database'
import { getDecodedSetting } from './db/queries'
import { migrateSecretsToSafeStorage } from './db/secrets'
import { registerCapabilityHandlers } from './capabilities/ipc'
import { registerAllCapabilities } from './capabilities/register'
import { seedTemplates } from './devtools/vault/templates'
import { initJobEngine } from './jobs'
import { stopScheduler } from './jobs/scheduler'
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
  sakura: '#14121A',
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
    // Cold-start budget instrumentation. Gated behind an env var so it costs
    // nothing normally, and lives in the shipped code path so before/after
    // numbers are measured identically rather than by hand-editing.
    if (process.env.REIGAN_STARTUP_TRACE) {
      // process.uptime() covers Electron boot too, which is what "cold start"
      // means to the user — not just the time since our first line ran.
      console.log(`[startup] ready-to-show ${(process.uptime() * 1000).toFixed(0)}ms`)
    }
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

    // Initialize DB (runs pending schema migrations — see db/migrations.ts)
    const db = getDatabase()

    // Encrypt any credential rows left in plaintext by an earlier build. Must
    // come after whenReady(): safeStorage has no OS keyring before that point.
    const encrypted = migrateSecretsToSafeStorage(db)
    if (encrypted > 0) console.log(`[secrets] encrypted ${encrypted} plaintext credential row(s)`)

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

    // Capability registry: declares every capability, then exposes the single
    // generic IPC surface the renderer and the agent both dispatch through.
    registerAllCapabilities()
    registerCapabilityHandlers(mainWindow)

    // Idempotent: seeds the shipped config templates on first run only.
    const seeded = seedTemplates()
    if (seeded > 0) console.log(`[vault] seeded ${seeded} built-in config template(s)`)

    // Durable job engine. Started after the capability registry, since every job
    // dispatches through it. Boot catch-up runs here — see jobs/scheduler.ts.
    initJobEngine(mainWindow)

    // Registered last: initialise() locks the session, so anything above that
    // wants to run at startup does so before the gate closes.
    registerVoiceAuthHandlers(mainWindow)

    // The file index is now the "Rebuild file index" job (seeded in jobs/seed.ts)
    // rather than an untracked boot-time side effect, so its runs, failures and
    // timings show up in the Jobs view like everything else.

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
  // Before closeDatabase(): stopping aborts in-flight runs, and their handlers
  // write a final job_runs row on the way out.
  stopScheduler()
  closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
