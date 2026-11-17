// Text destined for the LLM's chat pane is deliberately bilingual — kanji/kana
// with a romaji + English gloss in parentheses, for teaching. Reading that
// gloss format aloud verbatim is what causes ElevenLabs to "translate twice"
// (say the Japanese, then the romaji, then the English) and produce garbled,
// rambling audio. The romaji is never spoken; each language goes to its own
// language-locked request instead.

const CJK = '぀-ヿ㐀-䶿一-鿿ｦ-ﾟ'
const CJK_CHAR_RE = new RegExp(`[${CJK}]`, 'g')
const LATIN_RE = /[a-zA-Z]/g

// A run of Japanese inside otherwise-English text. May contain digits and
// spaces between Japanese characters ("にほんご0はなした"), but starts and ends
// on Japanese so the surrounding English punctuation stays with the English.
const CJK_RUN_RE = new RegExp(`[${CJK}](?:[${CJK}0-9０-９、。！？・\\s]*[${CJK}、。！？])?`, 'g')

// Matches a run of CJK text (word or whole sentence, trailing punctuation
// allowed) followed by its parenthetical gloss, e.g. 完了 (kanryō — done),
// 「予定」（yotei — schedule）, or a full sentence ending in 。 before the
// paren. Group 1 is the CJK text, group 2 is the gloss body.
const GLOSS_RE = new RegExp(`[「『]?([${CJK}][${CJK}0-9０-９、。！？\\s]*?)[」』]?\\s*[（(]([^）)]*)[）)]`, 'g')
const BRACKET_RE = /[「」『』]/g
const SPACE_BETWEEN_CJK_RE = new RegExp(`([${CJK}、。！？])\\s+(?=[${CJK}])`, 'g')
const ENDS_IN_CJK_RE = new RegExp(`[${CJK}]$`)

/**
 * One ElevenLabs request's worth of text. Kept well under the API's per-request
 * limit: long single generations drift in prosody, and a reply cut at a fixed
 * character count used to stop mid-sentence.
 */
export const MAX_SEGMENT_CHARS = 800

/**
 * Failsafe against a runaway/hallucinating response being spoken in full —
 * roughly five minutes of speech. Truncation always lands on a sentence.
 */
export const MAX_TOTAL_CHARS = 6000

export interface SpeechSegment {
  text: string
  languageCode: 'ja' | 'en'
}

// Gloss body is "romaji — English"; take the segment after the last dash.
function englishFromGloss(gloss: string): string {
  const parts = gloss.split(/[—–-]/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Tables: read aloud they are a stream of pipes and cell fragments.
    .replace(/^[ \t]*\|.*$/gm, '')
    // Horizontal rules — before list markers, which would otherwise eat "- - -".
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<https?:\/\/[^>]*>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
}

/**
 * A line with no closing punctuation (a list item, a heading) is otherwise run
 * straight into the next one once newlines are flattened.
 */
function terminateLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;,…。！？、」』"')]$/.test(line) ? line : line + (ENDS_IN_CJK_RE.test(line) ? '。' : '.')))
    .join(' ')
}

function tidy(text: string, languageCode: 'ja' | 'en'): string {
  let out = text
    .replace(BRACKET_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?、。])/g, '$1') // no space before punctuation left behind by a removed gloss
    .replace(/([.,!?、。])\s*\1+/g, '$1') // collapse duplicate punctuation, e.g. ". ."
    .trim()
  if (languageCode === 'ja') out = out.replace(SPACE_BETWEEN_CJK_RE, '$1')
  return out
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?。！？]+(?:[.!?。！？]+["'」』)]*|$)/g) ?? []).map((s) => s.trim()).filter(Boolean)
}

/** A sentence longer than the limit is broken at the last space or comma that fits. */
function hardSplit(sentence: string): string[] {
  const out: string[] = []
  let rest = sentence
  while (rest.length > MAX_SEGMENT_CHARS) {
    const window = rest.slice(0, MAX_SEGMENT_CHARS)
    const cut = Math.max(window.lastIndexOf(' '), window.lastIndexOf(','), window.lastIndexOf('、'))
    const at = cut > MAX_SEGMENT_CHARS / 2 ? cut + 1 : MAX_SEGMENT_CHARS
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Packs whole sentences into pieces of at most MAX_SEGMENT_CHARS. */
function chunk(text: string): string[] {
  if (text.length <= MAX_SEGMENT_CHARS) return [text]
  const pieces: string[] = []
  let current = ''
  for (const sentence of splitSentences(text).flatMap(hardSplit)) {
    if (current && current.length + 1 + sentence.length > MAX_SEGMENT_CHARS) {
      pieces.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) pieces.push(current)
  return pieces
}

/** Splits English-dominant text into alternating English and Japanese runs. */
function splitByScript(text: string): SpeechSegment[] {
  const segments: SpeechSegment[] = []
  const push = (raw: string, languageCode: 'ja' | 'en') => {
    const t = tidy(raw, languageCode)
    // A run that is only punctuation ("(", "—") has nothing to say.
    if (!/[\p{L}\p{N}]/u.test(t)) return
    const last = segments.at(-1)
    if (last && last.languageCode === languageCode) last.text = tidy(`${last.text} ${t}`, languageCode)
    else segments.push({ text: t, languageCode })
  }
  let cursor = 0
  for (const match of text.matchAll(CJK_RUN_RE)) {
    push(text.slice(cursor, match.index), 'en')
    push(match[0], 'ja')
    cursor = match.index! + match[0].length
  }
  push(text.slice(cursor), 'en')
  return segments
}

function capTotal(segments: SpeechSegment[], limit: number): SpeechSegment[] {
  const out: SpeechSegment[] = []
  let budget = limit
  for (const seg of segments) {
    if (seg.text.length <= budget) {
      out.push(seg)
      budget -= seg.text.length
      continue
    }
    let partial = ''
    for (const sentence of splitSentences(seg.text)) {
      const next = partial ? `${partial} ${sentence}` : sentence
      if (next.length > budget) break
      partial = next
    }
    if (partial) out.push({ ...seg, text: partial })
    break
  }
  return out
}

/**
 * Reduces an LLM response — or, while it streams, one completed piece of it —
 * to the ordered list of requests ElevenLabs should speak.
 *
 * A Japanese-dominant reply stays Japanese throughout, with glosses dropped.
 * An English-dominant reply — the usual shape of a lesson — speaks each
 * Japanese phrase in a Japanese-locked request followed by its English meaning,
 * rather than forcing the phrase through the English model, which mangles it,
 * or replacing it with the translation, which removes the thing being taught.
 */
export function planSpeech(raw: string, budget: number = MAX_TOTAL_CHARS): SpeechSegment[] {
  // `budget` is what remains of MAX_TOTAL_CHARS when a reply is spoken in
  // pieces as it streams, so the cap still applies to the reply as a whole.
  if (budget <= 0) return []
  let text = stripMarkdown(raw)

  // Decide dominant language from the text outside any parenthetical gloss —
  // a long English translation aside would otherwise outvote a Japanese
  // sentence it's merely explaining.
  const withoutGlosses = text.replace(/[（(][^）)]*[）)]/g, '')
  const cjkCount = (withoutGlosses.match(CJK_CHAR_RE) || []).length
  const latinCount = (withoutGlosses.match(LATIN_RE) || []).length
  const dominant: 'ja' | 'en' = cjkCount > latinCount ? 'ja' : 'en'

  if (dominant === 'ja') {
    // Keep the Japanese term, drop the romaji/English gloss.
    text = text.replace(GLOSS_RE, '$1')
  } else {
    // Japanese term, then its English meaning — never the romaji.
    text = text.replace(GLOSS_RE, (_m, jp: string, gloss: string) => {
      const english = englishFromGloss(gloss)
      return english ? `${jp.trim()} ${english}` : jp.trim()
    })
  }

  text = terminateLines(text)

  const segments =
    dominant === 'ja'
      ? [{ text: tidy(text, 'ja'), languageCode: 'ja' as const }].filter((s) => s.text)
      : splitByScript(text)

  return capTotal(segments, budget).flatMap((seg) => chunk(seg.text).map((t) => ({ text: t, languageCode: seg.languageCode })))
}
