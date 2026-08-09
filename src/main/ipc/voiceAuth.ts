/**
 * IPC surface for voice authentication.
 *
 * Two rules govern everything here:
 *
 *   1. Enrolment is a privileged operation. Once a voiceprint exists, changing
 *      or clearing it requires an unlocked session — otherwise the lock screen
 *      hands an attacker a "just enrol your own voice instead" button, which
 *      is a complete bypass. Only first-time enrolment is open.
 *   2. Nothing that could help an attacker calibrate crosses the bridge.
 *      No scores, no thresholds on the failure path, no distinction between
 *      "wrong voice" and "right voice, wrong phrase".
 */

import { ipcMain, type BrowserWindow } from 'electron'
import { AUTH_IPC, type AudioPayload } from '../../shared/auth-types'
import * as auth from '../voiceAuth'

export function registerVoiceAuthHandlers(mainWindow: BrowserWindow): void {
  const broadcast = (
    cause: 'unlocked' | 'locked' | 'enrolled' | 'reset' | 'cooldown-changed',
    lockReason?: string
  ): void => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send(AUTH_IPC.STATE_CHANGED, {
      status: auth.getStatus(),
      cause,
      lockReason,
    })
  }

  auth.setLockListener((reason) => broadcast('locked', reason))

  // After the listener is wired, so the startup lock is actually broadcast
  // rather than firing into a listener that does not exist yet.
  auth.initialise()

  ipcMain.handle(AUTH_IPC.STATUS, () => auth.getStatus())

  // ── Enrolment ──

  /** Throws unless the caller is either first-time enrolling or already unlocked. */
  const requireEnrolmentRights = (): void => {
    if (auth.getStatus().enrolled && !auth.isUnlocked()) {
      throw new Error('locked')
    }
  }

  ipcMain.handle(AUTH_IPC.ENROLL_BEGIN, () => {
    requireEnrolmentRights()
    auth.beginEnrollment()
    return { ok: true }
  })

  ipcMain.handle(AUTH_IPC.ENROLL_SAMPLE, (_e, payload: AudioPayload) => {
    requireEnrolmentRights()
    return auth.addEnrollmentSample(payload.pcm, payload.sampleRate)
  })

  ipcMain.handle(AUTH_IPC.ENROLL_COMMIT, (_e, fallbackPassphrase: string) => {
    requireEnrolmentRights()
    const result = auth.commitEnrollment(fallbackPassphrase)
    if (result.ok) broadcast('enrolled')
    return result
  })

  ipcMain.handle(AUTH_IPC.ENROLL_CANCEL, () => {
    auth.cancelEnrollment()
    return { ok: true }
  })

  ipcMain.handle(AUTH_IPC.RESET, () => {
    // Always privileged — there is no "first time" for a reset.
    if (!auth.isUnlocked()) throw new Error('locked')
    auth.resetEnrollment()
    broadcast('reset')
    return { ok: true }
  })

  // ── Unlocking ──

  ipcMain.handle(AUTH_IPC.CHALLENGE, () => auth.issueChallenge())

  ipcMain.handle(
    AUTH_IPC.VERIFY,
    (_e, payload: AudioPayload & { challengeId?: string }) => {
      const result = auth.verify(payload.pcm, payload.sampleRate, payload.challengeId)
      broadcast(result.ok ? 'unlocked' : 'cooldown-changed')
      return result
    }
  )

  ipcMain.handle(AUTH_IPC.VERIFY_FALLBACK, (_e, passphrase: string) => {
    const result = auth.verifyPassphrase(passphrase)
    broadcast(result.ok ? 'unlocked' : 'cooldown-changed')
    return result
  })

  ipcMain.handle(AUTH_IPC.LOCK, () => {
    auth.lock('manual')
    return { ok: true }
  })

  ipcMain.handle(AUTH_IPC.SET_IDLE_TIMEOUT, (_e, ms: number) => {
    // Changing the auto-lock window is a security setting, so it needs the
    // same privilege as a reset — otherwise the lock screen could be handed a
    // way to disable auto-lock before anyone authenticates.
    if (!auth.isUnlocked()) throw new Error('locked')
    if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid timeout')
    auth.setIdleTimeout(ms)
    broadcast('cooldown-changed')
    return { ok: true }
  })

  // Fire-and-forget: the renderer debounces this to roughly once every 30 s of
  // real interaction, so it is far cheaper than an idle timer on either side.
  ipcMain.on(AUTH_IPC.ACTIVITY, () => auth.touch())
}

/**
 * Guard for handlers that should refuse to run while locked.
 *
 * NOT yet applied to Reigan's existing handlers — doing so touches every
 * registered channel and belongs in its own change, so that each surface can be
 * considered on its merits (mail and files clearly need it; theme reads clearly
 * do not). Until then the lock is a UI boundary plus a hard gate on the auth
 * channels themselves. Wrap a handler like:
 *
 *   ipcMain.handle(IPC.MAIL_LIST_THREADS, (_e, params) => {
 *     requireUnlockedOrThrow()
 *     return listThreads(params)
 *   })
 */
export function requireUnlockedOrThrow(): void {
  if (!auth.isUnlocked()) throw new Error('locked')
}
