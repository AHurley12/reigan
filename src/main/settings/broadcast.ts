import type { BrowserWindow } from 'electron'

/**
 * Tells the renderer that a setting changed underneath it.
 *
 * The renderer's settings store hydrates once, at startup, and is otherwise the
 * only writer — every change until now originated from a control the user was
 * looking at, so there was nothing to push back. An agent-driven change breaks
 * that assumption: main writes the row, and the Settings panel, the theme, the
 * orb and the avatar all keep rendering the value they read at boot. The user
 * approves "switch to Sakura", the card disappears, and nothing happens until
 * they restart.
 *
 * Voice is the one setting that would have appeared to work, because
 * `ipc/llm.ts` re-reads `voiceId` from the database on every utterance. That
 * accident is not a design, and it does not extend to anything the renderer
 * owns — hence this channel.
 */

export const SETTINGS_CHANGED_CHANNEL = 'settings:changed'

export interface SettingChangeEvent {
  key: string
  /** Already JSON-decoded, ready to drop into the store. */
  value: unknown
}

let mainWindow: BrowserWindow | null = null

export function initSettingsBroadcast(win: BrowserWindow): void {
  mainWindow = win
}

/**
 * Never called for a credential. Secrets are excluded from the agent's
 * editable set entirely, and the renderer is deliberately never handed their
 * values (see `getSettingsForRenderer`); pushing one here would undo that.
 */
export function broadcastSettingChange(key: string, value: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(SETTINGS_CHANGED_CHANNEL, { key, value } satisfies SettingChangeEvent)
}
