// Text destined for the LLM's chat pane is deliberately bilingual — kanji/kana
// with a romaji + English gloss in parentheses, for teaching. Reading that
// gloss format aloud verbatim is what causes ElevenLabs to "translate twice"
// (say the Japanese, then the romaji, then the English) and produce garbled,
// rambling audio. Speech gets one language, decided by whichever script
// dominates the response, with markdown and glosses stripped first.

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/g
const LATIN_RE = /[a-zA-Z]/g

// Matches a run of CJK text (word or whole sentence, trailing punctuation
// allowed) followed by its parenthetical gloss, e.g. 完了 (kanryō — done),
// 「予定」（yotei — schedule）, or a full sentence ending in 。 before the
// paren. Group 1 is the CJK text, group 2 is the gloss body.
const GLOSS_RE = /[「『]?([぀-ヿ一-鿿][぀-ヿ一-鿿、。！？\s]*?)[」』]?\s*[（(]([^）)]*)[）)]/g
const BRACKET_RE = /[「」『』]/g

// Gloss body is "romaji — English"; take the segment after the last dash.
function englishFromGloss(gloss: string): string {
  const parts = gloss.split(/[—–-]/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

export interface PreparedSpeech {
  text: string
  languageCode: 'ja' | 'en'
}

/**
 * Reduces an LLM response to plain, single-language text suitable for TTS.
 * Detects the dominant script by character count, then drops the other
 * language's gloss entirely rather than reading both.
 */
export function prepareForSpeech(raw: string): PreparedSpeech {
  let text = stripMarkdown(raw)

  // Decide dominant language from the text outside any parenthetical gloss —
  // a long English translation aside would otherwise outvote a Japanese
  // sentence it's merely explaining.
  const withoutGlosses = text.replace(/[（(][^）)]*[）)]/g, '')
  const cjkCount = (withoutGlosses.match(CJK_RE) || []).length
  const latinCount = (withoutGlosses.match(LATIN_RE) || []).length
  const languageCode: 'ja' | 'en' = cjkCount > latinCount ? 'ja' : 'en'

  if (languageCode === 'ja') {
    // Keep the Japanese term, drop the romaji/English gloss.
    text = text.replace(GLOSS_RE, '$1')
  } else {
    // English response — swap the CJK term for its English meaning instead
    // of speaking the term, then the romaji, then the translation back to
    // back (the "possessed" rambling). Falls back to deleting it if no
    // English meaning was present in the gloss.
    text = text.replace(GLOSS_RE, (_m, _kanji: string, gloss: string) => englishFromGloss(gloss))
  }

  text = text
    .replace(BRACKET_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+([.,!?、。])/g, '$1') // no space before punctuation left behind by a removed gloss
    .replace(/([.,!?、。])\s*\1+/g, '$1') // collapse duplicate punctuation, e.g. ". ."
    .trim()

  return { text, languageCode }
}
