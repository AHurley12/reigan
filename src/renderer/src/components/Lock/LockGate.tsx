import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, LazyMotion, domAnimation } from 'framer-motion'
import { LockScreen } from './LockScreen'
import { useAuthStore } from '../../stores/authStore'

/**
 * Wraps the app shell in the lock.
 *
 * The shell is unmounted while genuinely locked and mounted again the instant
 * main reports an unlock — which is *before* the reveal animation finishes, so
 * the lock plate scales away over a real, already-painted interface rather
 * than over a placeholder. That is what makes the transition feel like part of
 * the app instead of a screen handing off to another screen.
 *
 * Keeping the shell unmounted while locked also means its panels are not
 * quietly fetching mail and files behind the lock plate.
 *
 * LazyMotion lives here rather than inside LockScreen so the feature bundle
 * outlives the exiting child — AnimatePresence needs the provider to still be
 * mounted while the exit animation runs. `strict` forbids the full `motion`
 * import anywhere below, which is what keeps the animation bundle small.
 */

/** Never ping main more than this often, however much the user is typing. */
const ACTIVITY_PING_INTERVAL_MS = 30_000

export function LockGate({ children }: { children: ReactNode }): JSX.Element {
  const status = useAuthStore((s) => s.status)
  const setStatus = useAuthStore((s) => s.setStatus)
  const setPhase = useAuthStore((s) => s.setPhase)
  const hydrate = useAuthStore((s) => s.hydrate)
  const lastPing = useRef(0)

  useEffect(() => {
    void hydrate()
    const unsubscribe = window.reigan?.auth.onStateChanged((event) => {
      setStatus(event.status)
      // A lock arriving from main (idle timeout, or another window) has to
      // reset local animation state, or the orb resumes mid-'unlocking'.
      if (event.cause === 'locked') setPhase('idle')
    })
    return unsubscribe
  }, [hydrate, setStatus, setPhase])

  // Idle-timeout heartbeat. Throttled hard: main only needs to know that the
  // user is alive, not what they did, so one message every 30 s of real
  // interaction is plenty and costs nothing when the user is away.
  useEffect(() => {
    if (status?.locked !== false) return

    const ping = (): void => {
      const now = Date.now()
      if (now - lastPing.current < ACTIVITY_PING_INTERVAL_MS) return
      lastPing.current = now
      window.reigan?.auth.ping()
    }

    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener('pointerdown', ping, opts)
    window.addEventListener('keydown', ping, opts)
    window.addEventListener('wheel', ping, opts)
    return () => {
      window.removeEventListener('pointerdown', ping)
      window.removeEventListener('keydown', ping)
      window.removeEventListener('wheel', ping)
    }
  }, [status?.locked])

  // Until main has answered, assume locked. Rendering the shell first and
  // covering it a frame later would flash the user's mail at anyone watching.
  const locked = status?.locked ?? true

  return (
    <LazyMotion features={domAnimation} strict>
      {!locked && children}
      <AnimatePresence onExitComplete={() => setPhase('idle')}>
        {locked && <LockScreen key="lock" />}
      </AnimatePresence>
    </LazyMotion>
  )
}
