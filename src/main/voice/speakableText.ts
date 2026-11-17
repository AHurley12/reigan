// Cuts a reply into speakable pieces while it is still being generated, so the
// voice can start on the first sentence instead of waiting for the last.
//
// Works on the raw markdown the model emits, before `planSpeech` cleans it.
// That ordering matters: several of planSpeech's rules need to see a whole
// construct at once — a code fence, a table row, a Japanese phrase and its
// parenthetical gloss — so a cut is only ever made where none of those can be
// open. Anything uncertain waits for more text, or for `flush()` at the end.

const LATIN_TERMINATORS = new Set(['.', '!', '?', '…'])
const CJK_TERMINATORS = new Set(['。', '！', '？'])
// Allowed between a terminator and the cut: closing quotes and markdown
// emphasis, so `**Done.**` is cut after the asterisks, not between them.
const CLOSERS = new Set(['"', "'", '”', '’', '」', '』', '*', '_'])
const OPEN_PARENS = new Set(['(', '（'])
const CLOSE_PARENS = new Set([')', '）'])

// "e.g. this" is not two sentences. Not exhaustive — a wrong cut only costs a
// slightly early request boundary, and previous_text smooths that over.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'approx'])

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/** The word immediately before index `end`, lowercased, without leading punctuation. */
function wordBefore(text: string, end: number): string {
  let start = end
  while (start > 0 && !isSpace(text[start - 1])) start--
  return text.slice(start, end).replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
}

/** Index of the next non-whitespace character at or after `from`, or -1 if none has arrived yet. */
function nextVisible(text: string, from: number): number {
  for (let i = from; i < text.length; i++) if (!isSpace(text[i])) return i
  return -1
}

/**
 * The furthest point in `text` where it is safe to cut, or 0 if there is none
 * yet. `text` must itself start outside any code fence, which holds because
 * every cut this returns is outside one.
 */
export function findSafeCut(text: string): number {
  let cut = 0
  let inFence = false
  let parenDepth = 0
  let lineIsTable = false
  let inlineTicks = 0
  let atLineStart = true

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (atLineStart && !isSpace(ch)) {
      lineIsTable = ch === '|'
      atLineStart = false
    }

    if (ch === '`') {
      if (text.startsWith('```', i)) {
        inFence = !inFence
        i += 2
        continue
      }
      if (!inFence) inlineTicks++
      continue
    }

    if (ch === '\n') {
      // A line end is always a boundary planSpeech can handle on either side —
      // its markdown rules are all line-anchored. Parentheses do not survive a
      // line break, so an unclosed one cannot hold speech back forever.
      parenDepth = 0
      inlineTicks = 0
      lineIsTable = false
      atLineStart = true
      if (!inFence) cut = i + 1
      continue
    }

    if (inFence) continue
    if (OPEN_PARENS.has(ch)) {
      parenDepth++
      continue
    }
    if (CLOSE_PARENS.has(ch)) {
      parenDepth = Math.max(0, parenDepth - 1)
      continue
    }

    const cjk = CJK_TERMINATORS.has(ch)
    if (!cjk && !LATIN_TERMINATORS.has(ch)) continue
    // Mid-line inside a table row, an inline code span or a parenthetical, a
    // cut would hand planSpeech half a construct it can no longer recognise.
    if (lineIsTable || parenDepth > 0 || inlineTicks % 2 === 1) continue

    let end = i + 1
    while (end < text.length && (CLOSERS.has(text[end]) || LATIN_TERMINATORS.has(text[end]) || CJK_TERMINATORS.has(text[end]))) end++
    // The terminator run may still be growing ("..." arriving a dot at a time).
    if (end >= text.length) break

    if (!cjk) {
      // "3.5", "file.ts", "Node.js": a full stop with no space after it.
      if (!isSpace(text[end])) continue
      if (ch === '.') {
        const word = wordBefore(text, i)
        // List numbers ("1. Install") and single initials ("J. Smith").
        if (/^\d+$/.test(word) || /^\p{L}$/u.test(word) || ABBREVIATIONS.has(word)) continue
      }
    }

    // A Japanese phrase ending in 。 is followed by its gloss in parentheses;
    // planSpeech has to see both together to drop the romaji. So the cut waits
    // until the next visible character has arrived and is not an opening paren.
    const next = nextVisible(text, end)
    if (next === -1) break
    if (OPEN_PARENS.has(text[next])) continue

    cut = end
  }

  return cut
}

/** Accumulates streamed tokens and releases them in speakable pieces. */
export class SpeakableTextBuffer {
  private pending = ''

  /** Adds streamed text; returns whatever is now complete, or '' if nothing is. */
  push(text: string): string {
    this.pending += text
    const cut = findSafeCut(this.pending)
    if (cut === 0) return ''
    const ready = this.pending.slice(0, cut)
    this.pending = this.pending.slice(cut)
    return ready
  }

  /** Everything still held back — called once the reply is complete. */
  flush(): string {
    const rest = this.pending
    this.pending = ''
    return rest
  }
}
