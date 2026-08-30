export interface MarkdownSplit {
  /** Complete blocks, safe to hand to a markdown renderer. */
  settled: string
  /** The still-arriving fragment. Rendered as plain text. */
  tail: string
}

/**
 * The invariant: `settled + tail === content`, exactly, with no separator to
 * add back. Anything looser means the two halves can disagree about who owns
 * the newline between them, and a character goes missing or gets doubled on
 * screen for one frame.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Splits a streaming reply into the part that can be rendered as markdown and
 * the part that is still being written.
 *
 * Reigan used to render the whole reply as plain text until the stream ended
 * and then swap the entire block to markdown, so a code block arrived as an
 * unformatted wall and snapped into place at the end.
 *
 * Rendering the whole thing as markdown on every token is the other failure:
 * a half-written fence shows three literal backticks, a table without its
 * separator row renders as a paragraph of pipes, and both flicker as they
 * resolve. So only complete blocks are promoted.
 *
 * The boundary is a blank line outside a code fence, which is exactly where
 * markdown ends a block — a paragraph, a list, or a table. A construct that has
 * not reached its blank line yet stays whole in `tail`, which is what keeps a
 * mid-write table from being rendered half-parsed.
 */
export function splitStreamedMarkdown(content: string): MarkdownSplit {
  if (!content) return { settled: '', tail: '' }

  const lines = content.split('\n')
  let inFence = false
  /** Last blank line seen outside a fence. */
  let boundary = -1
  /** The boundary as it stood when the currently-open fence began. */
  let boundaryBeforeFence = -1

  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) {
      if (inFence) {
        inFence = false
      } else {
        inFence = true
        boundaryBeforeFence = boundary
      }
      continue
    }
    if (!inFence && lines[i].trim() === '') boundary = i
  }

  // An unterminated fence is the case that matters most: everything from its
  // opening line onward has to stay unrendered, or the reader sees literal
  // backticks until the closing fence arrives.
  if (inFence) boundary = boundaryBeforeFence

  if (boundary < 0) return { settled: '', tail: content }

  const settledLines = lines.slice(0, boundary + 1)
  const tailLines = lines.slice(boundary + 1)

  return {
    // The newline that joined the two halves belongs to `settled`, but only
    // when there is a tail for it to have separated from.
    settled: tailLines.length > 0 ? `${settledLines.join('\n')}\n` : settledLines.join('\n'),
    tail: tailLines.join('\n'),
  }
}
