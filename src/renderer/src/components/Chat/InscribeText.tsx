import { useEffect, useRef } from 'react'
import { useTheme } from '../../theme/useTheme'
import type { TextReveal } from '../../theme/types'

interface Props {
  /** Full text rendered so far. Only the newly-appended tail gets revealed. */
  text: string
  className?: string
}

/**
 * Reveals streamed assistant text using whatever animation the active theme
 * declares. This component owns the *mechanism* — splitting the incoming
 * stream into units and staggering them — and knows nothing about how any
 * particular theme looks: the unit, timing and @keyframes name all come from
 * theme.textReveal, so a new theme changes the reveal without touching this
 * file.
 *
 * The wrapping is done imperatively against a ref (not via React children)
 * so a 2000-character response doesn't become 2000 reconciled React elements
 * on every token.
 */
export function InscribeText({ text, className }: Props) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const renderedRef = useRef(0)
  const { theme, reducedMotion } = useTheme()

  // Reduced motion still shows the complete text — it just arrives at once.
  const reveal: TextReveal = reducedMotion ? { ...theme.textReveal, unit: 'none' } : theme.textReveal

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Content shrank or was replaced wholesale — start over.
    if (text.length < renderedRef.current) {
      host.textContent = ''
      renderedRef.current = 0
    }

    if (reveal.unit === 'none') {
      host.textContent = text
      renderedRef.current = text.length
      return
    }

    // In word mode, only commit up to the last completed word. The trailing
    // partial word is held back (at most one word behind the stream) so words
    // animate in whole rather than re-animating on every token that extends
    // them — which is the entire point of a word-granularity reveal.
    const commitTo =
      reveal.unit === 'word' ? lastBoundary(text, renderedRef.current) : text.length

    const tail = text.slice(renderedRef.current, commitTo)
    if (!tail) return

    const units = reveal.unit === 'word' ? tail.match(/\s+|\S+/g) ?? [] : Array.from(tail)

    const fragment = document.createDocumentFragment()
    let step = 0
    for (const unit of units) {
      if (unit === '\n') {
        fragment.appendChild(document.createElement('br'))
        continue
      }
      // Whitespace runs carry no animation of their own; they'd only add
      // empty boxes to the stagger.
      if (/^\s+$/.test(unit)) {
        fragment.appendChild(document.createTextNode(unit))
        continue
      }
      const span = document.createElement('span')
      span.className = 'reveal-unit'
      span.textContent = unit
      // Stagger within this batch only, so a fast stream stays in step.
      span.style.animationName = reveal.animation
      span.style.animationDuration = `${reveal.durationMs}ms`
      span.style.animationDelay = `${Math.min(step * reveal.staggerMs, reveal.maxDelayMs)}ms`
      fragment.appendChild(span)
      step++
    }
    host.appendChild(fragment)
    renderedRef.current = commitTo
  }, [text, reveal.unit, reveal.animation, reveal.durationMs, reveal.staggerMs, reveal.maxDelayMs])

  return <span ref={hostRef} className={className} />
}

/**
 * Index just past the last whitespace character, i.e. the end of the last
 * word we can safely treat as finished. Returns `from` when the tail holds no
 * whitespace yet (still mid-word).
 */
function lastBoundary(text: string, from: number): number {
  for (let i = text.length - 1; i >= from; i--) {
    if (/\s/.test(text[i])) return i + 1
  }
  return from
}
