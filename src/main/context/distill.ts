import { ChatAnthropic } from '@langchain/anthropic'
import { CONTEXT_FACT_KINDS, type ContextFactKind } from '../../shared/types'
import { getDecodedSetting } from '../db/queries'
import { recordAppError } from '../errors/errorLog'
import { listFacts, upsertFact, type FactInput } from './store'

const TURNS_PER_RUN = 4
const MIN_EXCHANGE_CHARS = 200
const MAX_FACTS_PER_PASS = 12
const DISTILL_MODEL = 'claude-haiku-4-5-20251001'

const turnCounters = new Map<string, number>()

/** Test seam — module state would otherwise leak between cases. */
export function resetDistillCounters(): void {
  turnCounters.clear()
}

/**
 * Debounce gate.
 *
 * Trivial exchanges deliberately do not advance the counter: four
 * "thanks"/"yep" turns in a row carry nothing to learn, and letting them tick
 * the counter would buy a paid model call that can only produce noise.
 */
export function shouldDistill(conversationId: string, exchange: string): boolean {
  if (exchange.length < MIN_EXCHANGE_CHARS) return false

  const next = (turnCounters.get(conversationId) ?? 0) + 1
  if (next < TURNS_PER_RUN) {
    turnCounters.set(conversationId, next)
    return false
  }

  turnCounters.set(conversationId, 0)
  return true
}

/**
 * Builds the distillation prompt via template-literal interpolation rather
 * than placeholder `.replace()`.
 *
 * `String.prototype.replace(searchString, replaceString)` scans the
 * *replacement* string for `$$`, `$&`, `` $` `` and `$'` even when the
 * pattern is a plain string — and `conversation` is raw user/assistant text
 * from a finance-heavy app, where a literal `$&` in a message is not
 * hypothetical. Chaining two `.replace()` calls also has an ordering hazard:
 * a model-generated fact body that happens to contain the literal text
 * `{conversation}` would consume the second placeholder, leaving the real
 * conversation unsubstituted. Both corrupt the model's *input*, producing
 * structurally-valid-but-false facts that pass parsing cleanly and get
 * written. Template interpolation has neither hazard.
 */
function buildDistillPrompt(existing: string, conversation: string): string {
  return `You maintain a factual profile of one person, used by their personal assistant.

From the conversation below, extract only DURABLE facts about the person — their duties, roles, active projects, stated goals, and behavioural tendencies. A durable fact is still true next month.

Do NOT extract: anything about the current task, one-off questions, your own suggestions, or transient moods.

Return ONLY a JSON array, no prose. Each element:
  { "kind": "duty" | "role" | "project" | "goal" | "tendency",
    "key": "stable-kebab-slug",
    "body": "one sentence, third person",
    "confidence": 0.0-1.0 }

Reuse an existing key verbatim when you are updating that same fact. Return [] if nothing durable appeared.

EXISTING FACTS:
${existing}

CONVERSATION:
${conversation}`
}

/**
 * Parses the model's reply, discarding anything malformed.
 *
 * Deliberately strict and silent: a distillation that returns prose, or a row
 * with an invented `kind`, must write nothing at all. A garbage fact does not
 * stay garbage — it gets rendered into the digest and recited back to the user
 * as something the assistant believes about them.
 */
export function parseDistillResponse(raw: string): FactInput[] {
  const text = stripFence(raw).trim()
  if (!text) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: FactInput[] = []
  for (const entry of parsed) {
    if (out.length >= MAX_FACTS_PER_PASS) break
    if (typeof entry !== 'object' || entry === null) continue

    const e = entry as Record<string, unknown>
    const kind = e.kind
    const key = typeof e.key === 'string' ? e.key.trim() : ''
    const body = typeof e.body === 'string' ? e.body.trim() : ''

    if (typeof kind !== 'string') continue
    if (!CONTEXT_FACT_KINDS.includes(kind as ContextFactKind)) continue
    if (!key || !body) continue

    const rawConfidence = typeof e.confidence === 'number' ? e.confidence : 0.5
    const confidence = Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0.5

    out.push({ kind: kind as ContextFactKind, key, body, confidence, source: 'distilled' })
  }

  return out
}

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return fenced ? fenced[1] : raw
}

export async function runDistillation(
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
): Promise<number> {
  const existing = listFacts()
    .map((f) => `- [${f.kind}/${f.key}] ${f.body}`)
    .join('\n')

  const conversation = turns
    .slice(-8)
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join('\n\n')

  const llm = new ChatAnthropic({
    apiKey,
    model: DISTILL_MODEL,
    temperature: null,
    topP: 1,
    maxTokens: 1024,
  })

  const reply = await llm.invoke([
    {
      role: 'user',
      content: buildDistillPrompt(existing || '(none yet)', conversation),
    },
  ])

  const raw = typeof reply.content === 'string'
    ? reply.content
    : reply.content
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text) : ''))
        .join('')

  let written = 0
  for (const fact of parseDistillResponse(raw)) {
    if (upsertFact(fact)) written++
  }
  return written
}

/**
 * Fire-and-forget entry point for the chat path.
 *
 * Never awaited by the caller and never throws: the reply is already on screen
 * by the time this runs, so a failure here must not touch the user's turn. It
 * is still recorded rather than swallowed — a learning layer that quietly
 * stopped learning would present as no symptom at all.
 */
export function maybeDistill(
  conversationId: string,
  exchange: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
): void {
  if (getDecodedSetting('contextLearningPaused') === 'true') return
  if (!apiKey) return
  if (!shouldDistill(conversationId, exchange)) return

  void runDistillation(turns, apiKey).catch((err) => {
    recordAppError({
      source: 'llm',
      operation: 'contextDistillation',
      error: err,
      severity: 'warning',
      context: { conversationId, consequence: 'context layer did not learn from this exchange' },
    })
  })
}
