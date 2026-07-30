import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let avatarWindow: BrowserWindow | null = null

export function createAvatarOverlayWindow(): BrowserWindow {
  avatarWindow = new BrowserWindow({
    width: 260,
    height: 340,
    minWidth: 160,
    minHeight: 200,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  avatarWindow.setAlwaysOnTop(true, 'floating')

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    avatarWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/avatar.html`)
  } else {
    avatarWindow.loadFile(join(__dirname, '../renderer/avatar.html'))
  }

  avatarWindow.on('closed', () => {
    avatarWindow = null
  })

  return avatarWindow
}

export function getAvatarOverlayWindow(): BrowserWindow | null {
  return avatarWindow
}

export function toggleAvatarOverlayWindow(): { visible: boolean } {
  if (!avatarWindow) return { visible: false }
  if (avatarWindow.isVisible()) {
    avatarWindow.hide()
    return { visible: false }
  }
  avatarWindow.show()
  return { visible: true }
}
