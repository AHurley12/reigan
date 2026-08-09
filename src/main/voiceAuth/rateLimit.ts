/**
 * Failed-attempt throttling.
 *
 * Persisted rather than in-memory: a counter that resets when the app restarts
 * is not a rate limit, it is a speed bump with extra steps.
 *
 * Clock rollback is handled explicitly. Storing a cooldown as a wall-clock
 * deadline invites the obvious attack — set the system clock back an hour and
 * the cooldown evaporates. Each record also carries the remaining duration and
 * the time it was last observed, so time moving backwards is detected and the
 * cooldown is re-anchored to the new "now" instead of being skipped.
 */

import { AUTH_DEFAULTS } from '../../shared/auth-types'
import { readAuthState, writeAuthState, deleteAuthState } from './crypto'

const ROW = 'rate_limit'

interface RateState {
  /** Failures since the last success. */
  failures: number
  /** How many cooldowns have been served — indexes the ladder. */
  tier: number
  /** Wall-clock deadline. */
  cooldownUntil: number
  /** Duration still owed, used to re-anchor if the clock moves backwards. */
  remainingMs: number
  lastSeenAt: number
}

const EMPTY: RateState = { failures: 0, tier: 0, cooldownUntil: 0, remainingMs: 0, lastSeenAt: 0 }

function load(): RateState {
  const raw = readAuthState(ROW)
  if (!raw) return { ...EMPTY }
  try {
    return { ...EMPTY, ...JSON.parse(raw) }
  } catch {
    return { ...EMPTY }
  }
}

function save(state: RateState): void {
  writeAuthState(ROW, JSON.stringify(state))
}

/**
 * Reconciles the stored cooldown against the current clock.
 * Returns the state with `cooldownUntil` valid for right now.
 */
function reconcile(state: RateState): RateState {
  const now = Date.now()
  if (state.remainingMs <= 0) return state

  if (state.lastSeenAt > 0 && now < state.lastSeenAt) {
    // Clock went backwards. Re-anchor the outstanding duration to now so the
    // full penalty is still served.
    const reanchored: RateState = {
      ...state,
      cooldownUntil: now + state.remainingMs,
      lastSeenAt: now,
    }
    save(reanchored)
    return reanchored
  }

  const elapsed = state.lastSeenAt > 0 ? now - state.lastSeenAt : 0
  const remaining = Math.max(0, state.remainingMs - elapsed)
  const updated: RateState = {
    ...state,
    remainingMs: remaining,
    cooldownUntil: remaining > 0 ? now + remaining : 0,
    lastSeenAt: now,
  }
  save(updated)
  return updated
}

export interface RateVerdict {
  allowed: boolean
  cooldownUntil: number
  attemptsRemaining: number
}

export function check(): RateVerdict {
  const state = reconcile(load())
  const inCooldown = state.remainingMs > 0
  return {
    allowed: !inCooldown,
    cooldownUntil: inCooldown ? state.cooldownUntil : 0,
    attemptsRemaining: Math.max(0, AUTH_DEFAULTS.maxAttempts - state.failures),
  }
}

/** Records a failure and engages the next cooldown tier once the limit is hit. */
export function recordFailure(): RateVerdict {
  const state = reconcile(load())
  const failures = state.failures + 1

  if (failures < AUTH_DEFAULTS.maxAttempts) {
    save({ ...state, failures, lastSeenAt: Date.now() })
    return {
      allowed: true,
      cooldownUntil: 0,
      attemptsRemaining: AUTH_DEFAULTS.maxAttempts - failures,
    }
  }

  const ladder = AUTH_DEFAULTS.cooldownLadderMs
  const duration = ladder[Math.min(state.tier, ladder.length - 1)]
  const now = Date.now()
  save({
    failures: 0, // reset the window; the tier is what escalates
    tier: state.tier + 1,
    cooldownUntil: now + duration,
    remainingMs: duration,
    lastSeenAt: now,
  })
  return { allowed: false, cooldownUntil: now + duration, attemptsRemaining: 0 }
}

/**
 * Clears failures on success. The tier is also reset — a legitimate unlock is
 * strong evidence the earlier failures were the user fumbling, not an attack.
 */
export function recordSuccess(): void {
  deleteAuthState(ROW)
}

export function reset(): void {
  deleteAuthState(ROW)
}
