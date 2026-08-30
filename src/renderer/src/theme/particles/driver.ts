type FrameCallback = (now: number) => void

const subscribers = new Set<FrameCallback>()
let rafId: number | null = null

function tick(now: number): void {
  // Iterated over a copy: a field that unsubscribes from inside its own
  // callback (a theme swap lands mid-frame) must not invalidate the walk.
  for (const cb of Array.from(subscribers)) cb(now)
  rafId = subscribers.size > 0 ? requestAnimationFrame(tick) : null
}

/**
 * One requestAnimationFrame loop for every region field on screen.
 *
 * The app can have two fields live at once (the rail and the module area), and
 * a theme swap briefly overlaps a third. Each running its own RAF would mean
 * the browser scheduling several callbacks per frame that all want the same
 * 16ms — and the per-loop bookkeeping would be paid two or three times over
 * for work that is one repaint. Fields subscribe here instead and the loop
 * stops itself the moment the last one leaves, so an idle theme with no
 * particles costs nothing at all.
 */
export function subscribeToFrames(cb: FrameCallback): () => void {
  subscribers.add(cb)
  if (rafId === null) rafId = requestAnimationFrame(tick)

  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0 && rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }
}
