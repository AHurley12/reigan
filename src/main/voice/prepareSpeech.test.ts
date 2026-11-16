import { describe, it, expect } from 'vitest'
import { planSpeech, MAX_SEGMENT_CHARS, MAX_TOTAL_CHARS } from './prepareSpeech'

const spoken = (raw: string) => planSpeech(raw).map((s) => `${s.languageCode}:${s.text}`)
const allText = (raw: string) => planSpeech(raw).map((s) => s.text).join(' ')

describe('planSpeech — markdown that must not be read aloud', () => {
  it('drops tables entirely instead of reading the pipes', () => {
    const raw = "Here's where it goes:\n\n| Culprit | RAM |\n|---|---|\n| **Opera GX** | ~5.5GB |\n\nClose a few tabs."
    const text = allText(raw)
    expect(text).not.toMatch(/\|/)
    expect(text).not.toMatch(/Culprit|Opera/)
    expect(text).toMatch(/Here's where it goes/)
    expect(text).toMatch(/Close a few tabs/)
  })

  it('drops bare URLs but keeps markdown link text', () => {
    const text = allText('See [the docs](https://example.com/a) or https://example.com/b for more.')
    expect(text).not.toMatch(/https?:|example\.com/)
    expect(text).toMatch(/the docs/)
  })

  it('drops horizontal rules, emoji and code blocks', () => {
    const text = allText('Intro.\n\n---\n\n### 🔴 Errors\n\n```ts\nconst x = 1\n```\nDone.')
    expect(text).not.toMatch(/---|🔴|const x/)
    expect(text).toMatch(/Errors/)
  })

  it('ends list items with punctuation so they are not run together', () => {
    const text = allText('Two things:\n- **Multimodal AI** exists\n- Robotics is close')
    expect(text).toMatch(/exists\./)
  })
})

describe('planSpeech — bilingual replies', () => {
  it('speaks the Japanese phrase in Japanese, then its English meaning, never the romaji', () => {
    const raw = 'Formal beer order:\n\n**「ビールをください。」** *(Bīru wo kudasai — "Beer, please.")*\n\nThat works anywhere.'
    const out = spoken(raw)
    expect(out).toContainEqual(expect.stringMatching(/^ja:ビールをください。$/))
    expect(out.join(' ')).toMatch(/en:.*Beer, please/)
    expect(out.join(' ')).not.toMatch(/kudasai/)
  })

  it('does not leave Japanese inside an English-locked segment', () => {
    for (const raw of ['心眼 online. What do you need?', 'Add ね at the end for a soft tone.']) {
      for (const seg of planSpeech(raw)) {
        if (seg.languageCode === 'en') expect(seg.text).not.toMatch(/[぀-ヿ一-鿿]/)
      }
    }
    expect(spoken('心眼 online. What do you need?')).toEqual(['ja:心眼', 'en:online. What do you need?'])
  })

  it('keeps a Japanese phrase whole when it contains a digit', () => {
    const out = spoken('What you wrote: 「わたしがにほんご0はなした」*(Watashi ga Nihongo 0 hanashita)*')
    expect(out).toContainEqual(expect.stringMatching(/^ja:わたしがにほんご0はなした。?$/))
  })

  it('keeps a Japanese-dominant reply as one Japanese segment with glosses dropped', () => {
    const out = spoken('今日は晴れです。完了 (kanryō — done) しました。')
    expect(out).toEqual(['ja:今日は晴れです。完了しました。'])
  })

  it('merges adjacent segments of the same language', () => {
    const segs = planSpeech('Hello there. How are you today?')
    expect(segs).toHaveLength(1)
  })
})

describe('planSpeech — long replies', () => {
  const sentence = 'This sentence is here to make the reply long enough to need splitting. '

  it('splits at sentence boundaries instead of cutting mid-sentence', () => {
    const raw = sentence.repeat(40) // ~2,900 chars
    const segs = planSpeech(raw)
    expect(segs.length).toBeGreaterThan(1)
    for (const s of segs) {
      expect(s.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS)
      expect(s.text).toMatch(/splitting\.$/)
    }
    expect(segs.map((s) => s.text).join(' ').length).toBeGreaterThan(2000)
  })

  it('still caps a runaway reply, ending on a sentence', () => {
    const segs = planSpeech(sentence.repeat(400))
    const total = segs.reduce((n, s) => n + s.text.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS)
    expect(segs.at(-1)!.text).toMatch(/splitting\.$/)
  })

  it('hard-splits a single sentence longer than the segment limit', () => {
    const segs = planSpeech('word '.repeat(400))
    for (const s of segs) expect(s.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS)
  })

  it('returns nothing for a reply that is only markup', () => {
    expect(planSpeech('```\ncode\n```\n\n---')).toEqual([])
  })
})
