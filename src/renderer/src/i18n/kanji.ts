const KANJI_RANGE = /[一-鿿]/

/** True if the string contains at least one CJK kanji glyph (as opposed to
 *  pure kana, which doesn't need a furigana reading). */
export function hasKanji(text: string): boolean {
  return KANJI_RANGE.test(text)
}
