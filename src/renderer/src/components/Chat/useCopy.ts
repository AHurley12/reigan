import { useCallback, useEffect, useRef, useState } from 'react'
import { useToastStore } from '../../stores/toastStore'

/** How long the button shows its confirmed state before reverting. */
const CONFIRM_MS = 2000

/**
 * Copy-to-clipboard with a short confirmed state.
 *
 * The confirmation is deliberately two signals, not one: the icon swaps *and* a
 * toast fires. Relying on the icon alone would mean the only feedback lives in
 * a control that is often revealed on hover and may already be out of view by
 * the time the copy lands.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // Without this, copying and then navigating away sets state on an unmounted
  // component when the timer fires.
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = useCallback(async (text: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), CONFIRM_MS)
      useToastStore.getState().push('Copied to clipboard', 'success')
    } catch (err) {
      // Says what to do about it, not just that it broke.
      useToastStore.getState().push(
        `Could not copy: ${err instanceof Error ? err.message : String(err)}. Select the text and use Ctrl+C.`,
        'error'
      )
    }
  }, [])

  return { copied, copy }
}
