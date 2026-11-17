import { describe, it, expect, vi, beforeEach } from 'vitest'

// What each ElevenLabs request was asked to say, in order.
const requests: Array<{ text: string; previousText?: string; nextText?: string }> = []
let failNext = false

vi.mock('./textToSpeech', () => ({
  TextToSpeech: class {
    setVoiceSettings() {}
    async *speakStream(text: string, _lang: string, context: { previousText?: string; nextText?: string }) {
      requests.push({ text, ...context })
      if (failNext) {
        failNext = false
        throw new Error('boom')
      }
      yield Buffer.from([1, 2])
    }
  },
}))
vi.mock('./speechToText', () => ({ SpeechToText: class {} }))
vi.mock('../errors/errorLog', () => ({ recordAppError: vi.fn() }))

const { VoiceManager, STREAM_BATCH_MIN_CHARS } = await import('./voiceManager')

const flush = () => new Promise((r) => setTimeout(r, 0))
const config = { elevenLabsApiKey: 'key' }

function setup() {
  const manager = new VoiceManager()
  const states: string[] = []
  const errors: string[] = []
  manager.setCallbacks({
    onTranscript: () => {},
    onAudio: () => {},
    onStateChange: (s) => states.push(s),
    onError: (e) => errors.push(e.message),
  })
  return { manager, states, errors }
}

beforeEach(() => {
  requests.length = 0
  failNext = false
})

describe('VoiceManager.beginSpokenReply', () => {
  it('starts speaking the first sentence before the reply has finished generating', async () => {
    const { manager, states } = setup()
    const reply = manager.beginSpokenReply(config)
    reply.push('Hello there. ')
    reply.push('The rest')
    await flush()
    expect(requests.map((r) => r.text)).toEqual(['Hello there.'])
    expect(states).toEqual(['speaking'])

    reply.push(' arrives later.')
    await reply.finish()
    expect(requests.map((r) => r.text)).toEqual(['Hello there.', 'The rest arrives later.'])
    expect(requests[1].previousText).toBe('Hello there.')
    expect(states).toEqual(['speaking', 'idle'])
  })

  it('batches later sentences instead of one request per sentence', async () => {
    const { manager } = setup()
    const reply = manager.beginSpokenReply(config)
    reply.push('Opening line. ')
    await flush()
    const sentence = 'This is a reasonably ordinary sentence. '
    for (let i = 0; i < 4; i++) reply.push(sentence)
    await flush()
    // Under the batch size, held back for more.
    expect(requests).toHaveLength(1)
    for (let i = 0; i < Math.ceil(STREAM_BATCH_MIN_CHARS / sentence.length); i++) reply.push(sentence)
    reply.push('Next')
    await flush()
    expect(requests).toHaveLength(2)
    expect(requests[1].text.length).toBeGreaterThanOrEqual(STREAM_BATCH_MIN_CHARS - 10)
    await reply.finish()
  })

  it('stops requesting speech once skipped, and returns to idle', async () => {
    const { manager, states } = setup()
    const reply = manager.beginSpokenReply(config)
    reply.push('First. Second')
    await flush()
    manager.stopSpeaking()
    reply.push(' sentence. Third sentence.')
    await reply.finish()
    expect(requests.map((r) => r.text)).toEqual(['First.'])
    expect(states).toEqual(['speaking', 'idle'])
  })

  it('a newer reply displaces an older one without the old one reporting idle over it', async () => {
    const { manager, states } = setup()
    const first = manager.beginSpokenReply(config)
    first.push('Old reply. More')
    await flush()
    const second = manager.beginSpokenReply(config)
    first.push(' old text. And more.')
    await first.finish()
    second.push('New reply.')
    await second.finish()
    expect(requests.map((r) => r.text)).toEqual(['Old reply.', 'New reply.'])
    expect(states).toEqual(['speaking', 'speaking', 'idle'])
  })

  it('reports a TTS failure once and speaks nothing further', async () => {
    const { manager, states, errors } = setup()
    failNext = true
    const reply = manager.beginSpokenReply(config)
    reply.push('Fails here. Never')
    await flush()
    reply.push(' spoken. At all.')
    await reply.finish()
    expect(requests).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(states).toEqual(['speaking', 'error'])
  })

  it('never goes to speaking for a reply with nothing to say', async () => {
    const { manager, states } = setup()
    const reply = manager.beginSpokenReply(config)
    reply.push('```\ncode only\n```\n')
    await reply.finish()
    expect(requests).toHaveLength(0)
    expect(states).toEqual([])
  })

  it('without a key, reports it and stays silent', async () => {
    const { manager, errors } = setup()
    const reply = manager.beginSpokenReply({ elevenLabsApiKey: '' })
    reply.push('Hello. World.')
    await reply.finish()
    expect(requests).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })
})
