import { ChatAnthropic } from '@langchain/anthropic'
import { CONTEXT_FACT_KINDS, type ContextFactKind } from '../../shared/types'
import { getDecodedSetting } from '../db/queries'
import { recordAppError } from '../errors/errorLog'
import { listFacts, upsertFact, type FactInput } from './store'

const TURNS_PER_RUN = 4
const MIN_EXCHANGE_CHARS = 200
const MAX_FACTS_PER_PASS = 12
const DISTILL_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Bounds on the two fact lists handed to the model.
 *
 * Both are unbounded by nature: nothing is ever hard-deleted, so the active
 * table and the dismissed table only grow. The digest gets a hard 4800-char
 * (~1200 token) cap for exactly this reason and this sibling input needs the
 * same discipline — an uncapped `EXISTING FACTS` block would eventually cost
 * more per pass than the conversation it is meant to interpret.
 *
 * Half the digest's budget for existing facts (they carry a full sentence
 * each) and a quarter for rejected keys (a `kind/key` pair is short). Both
 * lists arrive confidence-ranked, so the cap drops the least-supported entries
 * first — the same rule the digest truncates by.
 */
const MAX_EXISTING_FACTS = 40
const MAX_EXISTING_CHARS = 2400
const MAX_REJECTED_KEYS = 40
const MAX_REJECTED_CHARS = 1200

const turnCounters = new Map<string, number>()
let warnedMissingKey = false

/** Test seam — module state would otherwise leak between cases. */
export function resetDistillCounters(): void {
  turnCounters.clear()
  warnedMissingKey = false
}

/** Takes lines in rank order until either bound is reached. */
export function boundedLines(lines: string[], maxCount: number, maxChars: number): string {
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (kept.length >= maxCount) break
    if (used + line.length + 1 > maxChars) break
    kept.push(line)
    used += line.length + 1
  }
  return kept.join('\n')
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
function buildDistillPrompt(existing: string, rejected: string, conversation: string): string {
  return `You maintain a factual profile of one person, used by their personal assistant.

From the conversation below, extract only DURABLE facts about the person — their duties, roles, active projects, stated goals, and behavioural tendencies. A durable fact is still true next month.

Do NOT extract: anything about the current task, one-off questions, your own suggestions, or transient moods.

Return ONLY a JSON array, no prose. Each element:
  { "kind": "duty" | "role" | "project" | "goal" | "tendency",
    "key": "stable-kebab-slug",
    "body": "one sentence, third person",
    "confidence": 0.0-1.0 }

Reuse an existing key verbatim when you are updating that same fact. Return [] if nothing durable appeared.

The user has already rejected the facts listed under REJECTED. Never return one of those kind/key pairs, and do not restate the same claim under a different key or wording.

EXISTING FACTS:
${existing}

REJECTED (do not re-derive these):
${rejected}

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
  // Dismissed facts are fed back as a do-not-derive list. Suppressing the
  // write alone was not enough: the model never learned the fact had been
  // rejected, re-derived the same stable slug from the same conversation, and
  // handed it back on every pass — burning a paid call each time to produce
  // something that is discarded on arrival.
  const existing = boundedLines(
    listFacts().map((f) => `- [${f.kind}/${f.key}] ${f.body}`),
    MAX_EXISTING_FACTS,
    MAX_EXISTING_CHARS,
  )

  const rejected = boundedLines(
    listFacts({ status: 'dismissed' }).map((f) => `- ${f.kind}/${f.key}`),
    MAX_REJECTED_KEYS,
    MAX_REJECTED_CHARS,
  )

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
      content: buildDistillPrompt(existing || '(none yet)', rejected || '(none)', conversation),
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

  if (!apiKey) {
    // Learning that never starts is the failure mode with no symptom this
    // module exists to avoid: chat works, the digest stays empty forever, and
    // nothing anywhere says why. Recorded once per process — a per-turn entry
    // would bury the error log.
    if (!warnedMissingKey) {
      warnedMissingKey = true
      recordAppError({
        source: 'llm',
        operation: 'contextDistillation',
        error: new Error('No Anthropic API key available to the context layer'),
        severity: 'warning',
        context: { consequence: 'context layer is not learning anything at all' },
      })
    }
    return
  }

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
