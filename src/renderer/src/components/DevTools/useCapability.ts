import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Calling a capability from the renderer.
 *
 * One hook for every operation in the tab, because there is one IPC channel
 * for every operation — the same registry the agent dispatches through. There
 * is deliberately no per-feature bridge method to add.
 */

export interface CapabilityProgress {
  done: number
  total: number
  label?: string
}

export interface CapabilityState<T> {
  data: T | null
  loading: boolean
  /** Null until something fails; the actual message, never a generic one. */
  error: string | null
  progress: CapabilityProgress | null
}

interface InvokeOutcome {
  ok: boolean
  result?: unknown
  error?: string
  errorCode?: string
}

let invocationCounter = 0

export function useCapability<T>(id: string) {
  const [state, setState] = useState<CapabilityState<T>>({
    data: null,
    loading: false,
    error: null,
    progress: null,
  })

  const activeInvocation = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Progress arrives on a broadcast channel, so each subscriber filters for
  // its own invocation; two panes running scans at once must not drive each
  // other's progress bar.
  useEffect(() => {
    const off = window.reigan?.capabilities?.onProgress?.((event) => {
      if (!mounted.current) return
      if (event.invocationId !== activeInvocation.current) return
      setState((s) => ({ ...s, progress: { done: event.done, total: event.total, label: event.label } }))
    })
    return () => off?.()
  }, [])

  const run = useCallback(
    async (args?: unknown): Promise<T | null> => {
      const invocationId = `${id}-${(invocationCounter += 1)}`
      activeInvocation.current = invocationId
      setState({ data: null, loading: true, error: null, progress: null })

      try {
        const outcome = (await window.reigan?.capabilities?.invoke(id, args, invocationId)) as
          | InvokeOutcome
          | undefined

        if (!mounted.current) return null

        if (!outcome) {
          setState({ data: null, loading: false, error: 'No response from the main process.', progress: null })
          return null
        }
        if (!outcome.ok) {
          // Surfaced verbatim. A capability's error text is written to be read
          // by a person; replacing it with "Something went wrong" throws away
          // the only useful part.
          setState({
            data: null,
            loading: false,
            error: outcome.error ?? `${id} failed (${outcome.errorCode ?? 'unknown'}).`,
            progress: null,
          })
          return null
        }

        setState({ data: outcome.result as T, loading: false, error: null, progress: null })
        return outcome.result as T
      } catch (err) {
        if (!mounted.current) return null
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          progress: null,
        })
        return null
      } finally {
        if (activeInvocation.current === invocationId) activeInvocation.current = null
      }
    },
    [id]
  )

  const cancel = useCallback(() => {
    if (activeInvocation.current) {
      void window.reigan?.capabilities?.cancel(activeInvocation.current)
    }
  }, [])

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null, progress: null })
  }, [])

  return { ...state, run, cancel, reset, canCancel: state.loading }
}
