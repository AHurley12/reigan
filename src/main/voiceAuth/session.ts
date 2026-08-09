/**
 * Session and auto-lock.
 *
 * The lock state lives here, in main, and nowhere else. The renderer is told
 * about it but is never trusted to enforce it: a renderer that decides on its
 * own that it is unlocked has bypassed nothing, because every guarded handler
 * asks this module instead of taking the caller's word for it.
 *
 * The session token exists so that guarded IPC can be checked without a round
 * trip through the window's identity, and so a stale renderer (reloaded, or a
 * devtools console) cannot act on a session that has since been revoked.
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { AUTH_DEFAULTS, type LockReason } from '../../shared/auth-types'

interface Session {
  token: Buffer
  /** Hard cap, independent of activity. */
  absoluteExpiry: number
  /** Rolling idle deadline. */
  idleExpiry: number
}

let session: Session | null = null
let idleTimeoutMs: number = AUTH_DEFAULTS.idleTimeoutMs
let timer: NodeJS.Timeout | null = null
let onLock: ((reason: LockReason) => void) | null = null

export function setLockListener(fn: (reason: LockReason) => void): void {
  onLock = fn
}

export function setIdleTimeout(ms: number): void {
  idleTimeoutMs = Math.max(0, ms)
  if (session) {
    session.idleExpiry = idleTimeoutMs > 0 ? Date.now() + idleTimeoutMs : Number.MAX_SAFE_INTEGER
    arm()
  }
}

export function getIdleTimeout(): number {
  return idleTimeoutMs
}

function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * Schedules the next expiry check.
 *
 * Re-armed rather than run on an interval so an idle app is genuinely idle —
 * a 1 Hz timer that exists only to notice nothing has happened is exactly the
 * kind of background wakeup the low-GPU-load brief is trying to avoid.
 */
function arm(): void {
  clearTimer()
  if (!session) return

  const next = Math.min(session.absoluteExpiry, session.idleExpiry)
  const delay = next - Date.now()
  if (delay <= 0) {
    expire()
    return
  }
  // Node clamps timeouts at ~24.8 days; re-arm in chunks past that.
  timer = setTimeout(expire, Math.min(delay, 2 ** 31 - 1))
}

function expire(): void {
  if (!session) return
  const now = Date.now()
  if (now >= session.absoluteExpiry || now >= session.idleExpiry) {
    lock('idle')
    return
  }
  arm()
}

export function unlock(): { token: string; expiresAt: number } {
  const now = Date.now()
  const absolute =
    AUTH_DEFAULTS.sessionMaxMs > 0 ? now + AUTH_DEFAULTS.sessionMaxMs : Number.MAX_SAFE_INTEGER
  session = {
    token: randomBytes(32),
    absoluteExpiry: absolute,
    idleExpiry: idleTimeoutMs > 0 ? now + idleTimeoutMs : Number.MAX_SAFE_INTEGER,
  }
  arm()
  return {
    token: session.token.toString('base64'),
    expiresAt: Math.min(absolute, session.idleExpiry),
  }
}

export function lock(reason: LockReason): void {
  const wasUnlocked = session !== null
  session = null
  clearTimer()
  if (wasUnlocked || reason === 'startup') onLock?.(reason)
}

export function isUnlocked(): boolean {
  if (!session) return false
  const now = Date.now()
  if (now >= session.absoluteExpiry || now >= session.idleExpiry) {
    lock('idle')
    return false
  }
  return true
}

/** Resets the idle countdown. Called from the renderer's debounced activity ping. */
export function touch(): void {
  if (!session || idleTimeoutMs <= 0) return
  if (!isUnlocked()) return
  session.idleExpiry = Date.now() + idleTimeoutMs
  arm()
}

/** Constant-time token check for guarded IPC. */
export function validateToken(token: string | undefined): boolean {
  if (!session || !token) return false
  if (!isUnlocked()) return false
  let provided: Buffer
  try {
    provided = Buffer.from(token, 'base64')
  } catch {
    return false
  }
  if (provided.length !== session.token.length) return false
  return timingSafeEqual(provided, session.token)
}

export function expiresAt(): number {
  if (!session) return 0
  return Math.min(session.absoluteExpiry, session.idleExpiry)
}

/**
 * Guard for sensitive IPC handlers. Not retrofitted onto Reigan's existing
 * handlers by this change — see the note in ipc/voiceAuth.ts about which
 * surfaces still need wrapping.
 */
export function requireUnlocked(token?: string): void {
  if (!validateToken(token)) {
    throw new Error('locked')
  }
}
