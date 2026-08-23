/**
 * Phase 0 gate for the context & memory layer (spec §2).
 *
 * Question: does `@langchain/anthropic`'s ChatAnthropic pass `context_management`
 * and Anthropic-defined tools (memory) through to the API unmodified, or does it
 * silently swallow them?
 *
 * Run:  ANTHROPIC_API_KEY=sk-... node scripts/verify-context-management.mjs
 *
 * The app's own key is DPAPI-encrypted via Electron safeStorage (db/secrets.ts),
 * so it can't be read from plain Node — pass the key in the environment instead.
 *
 * Probes 1, 2 and 4 are "error-as-oracle" tests: they send a deliberately invalid
 * value and read the API's complaint. If the server objects to the *contents* of a
 * parameter, that parameter demonstrably reached the server. This is far cheaper
 * and more decisive than trying to infer passthrough from a success response.
 */

import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY. The app stores its key encrypted, so this script cannot read it.')
  process.exit(1)
}

// Defaults to the model the app actually runs (agents/reigan.ts) — the point is to
// test the real configuration, not a hypothetical one.
const MODEL = process.env.VERIFY_MODEL ?? 'claude-sonnet-4-6'
const CONTEXT_MGMT_BETA = 'context-management-2025-06-27'

const results = []
function record(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}\n`)
}

/** ChatAnthropic configured the way the app does, plus whatever we're testing. */
function makeModel({ contextManagement, betaHeader } = {}) {
  return new ChatAnthropic({
    apiKey,
    model: MODEL,
    streaming: true,
    temperature: null,
    topP: 1,
    maxTokens: 64,
    ...(contextManagement ? { contextManagement } : {}),
    clientOptions: betaHeader
      ? { defaultHeaders: { 'anthropic-beta': betaHeader } }
      : {},
  })
}

async function callAndCatch(model, messages) {
  try {
    const res = await model.invoke(messages)
    return { ok: true, res }
  } catch (err) {
    return { ok: false, err, message: String(err?.message ?? err) }
  }
}

// An intentionally invalid strategy. If the API validates and rejects this, the
// parameter reached the server; if the call succeeds, it was dropped en route.
const INVALID_CONTEXT_MGMT = {
  edits: [{ type: 'clear_tool_uses_20250919', keep: { type: 'tool_uses', value: -5 } }],
}

// ---------------------------------------------------------------------------
// Probe 1 — does context_management reach the API with NO beta header?
// ---------------------------------------------------------------------------
async function probe1() {
  const model = makeModel({ contextManagement: INVALID_CONTEXT_MGMT })
  const r = await callAndCatch(model, [new HumanMessage('Say OK.')])

  if (r.ok) {
    record('1. context_management without beta header', false,
      'Request SUCCEEDED with an invalid context_management value. The parameter is ' +
      'being dropped before it reaches the API (by LangChain or by the server ignoring ' +
      'an unrecognised field). Layer 1 cannot work on this path as configured.')
    return
  }
  record('1. context_management without beta header', true,
    `Rejected, as expected without the beta opt-in. The parameter is being transmitted.\n      API said: ${r.message.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// Probe 2 — with the beta header injected via clientOptions.defaultHeaders.
// LangChain dispatches to the NON-beta client.messages.create and never sets
// `betas`, so this header is the only way to opt in. If the API now complains
// about the *value* rather than the beta, passthrough is proven.
// ---------------------------------------------------------------------------
async function probe2() {
  const model = makeModel({ contextManagement: INVALID_CONTEXT_MGMT, betaHeader: CONTEXT_MGMT_BETA })
  const r = await callAndCatch(model, [new HumanMessage('Say OK.')])

  if (r.ok) {
    record('2. context_management with beta header', false,
      'Request succeeded despite an invalid value — the parameter is not being validated, ' +
      'which suggests it is not reaching the API.')
    return
  }
  const mentionsValue = /keep|tool_uses|-5|invalid|greater|positive/i.test(r.message)
  record('2. context_management with beta header', mentionsValue,
    mentionsValue
      ? `API validated the context_management VALUE — passthrough confirmed.\n      API said: ${r.message.slice(0, 300)}`
      : `Rejected, but not clearly about the value. Read the message and judge.\n      API said: ${r.message.slice(0, 300)}`)
}

// ---------------------------------------------------------------------------
// Probe 3 — the real test: a valid strategy over a tool-heavy history, checking
// that applied_edits comes back populated (the spec's stated exit criterion).
// ---------------------------------------------------------------------------
async function probe3() {
  const model = makeModel({
    contextManagement: {
      edits: [{
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'input_tokens', value: 1000 },
        keep: { type: 'tool_uses', value: 1 },
      }],
    },
    betaHeader: CONTEXT_MGMT_BETA,
  })

  // Synthetic tool history, padded so the trigger is comfortably exceeded.
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(220)
  const messages = [new HumanMessage('Check the system a few times.')]
  for (let i = 0; i < 4; i++) {
    messages.push(new AIMessage({
      content: '',
      tool_calls: [{ id: `call_${i}`, name: 'get_system_info', args: { probe: i } }],
    }))
    messages.push(new ToolMessage({ tool_call_id: `call_${i}`, content: `Report ${i}: ${filler}` }))
  }
  messages.push(new HumanMessage('Now summarise in one word.'))

  const r = await callAndCatch(model, messages)
  if (!r.ok) {
    record('3. applied_edits returned', false, `Request failed: ${r.message.slice(0, 400)}`)
    return
  }

  const cm = r.res?.response_metadata?.context_management
  const edits = cm?.applied_edits
  const populated = Array.isArray(edits) && edits.length > 0

  record('3. applied_edits returned', populated,
    populated
      ? `Context editing fired and LangChain surfaced it: ${JSON.stringify(cm)}`
      : `No applied_edits on response_metadata. Either the trigger was not reached, or ` +
        `LangChain did not surface it. response_metadata.context_management = ${JSON.stringify(cm)}`)
}

// ---------------------------------------------------------------------------
// Probe 4 — the memory tool. LangChain's formatStructuredToolToAnthropic has an
// isBuiltinTool() check listing the `memory_` prefix, so the schema-less
// Anthropic-defined descriptor should pass through untouched. Verify against
// the live API rather than trusting the source read.
// ---------------------------------------------------------------------------
async function probe4() {
  const model = makeModel()
  let bound
  try {
    bound = model.bindTools([{ type: 'memory_20250818', name: 'memory' }])
  } catch (err) {
    record('4. memory tool passthrough', false,
      `bindTools threw — LangChain rejected the descriptor locally: ${String(err?.message ?? err)}`)
    return
  }

  const r = await callAndCatch(bound, [
    new HumanMessage('Check your memory directory before answering: what do you know about me?'),
  ])

  if (!r.ok) {
    record('4. memory tool passthrough', false,
      `API rejected the request carrying the memory tool: ${r.message.slice(0, 400)}`)
    return
  }

  const calls = r.res?.tool_calls ?? []
  const usedMemory = calls.some((c) => c.name === 'memory')
  record('4. memory tool passthrough', true,
    usedMemory
      ? 'Accepted by the API and the model issued a `memory` tool call. Note: LangChain ' +
        'formats it correctly, but AgentExecutor has no handler for a builtin tool — ' +
        'execution routing is the remaining design question.'
      : `Accepted by the API (no rejection), though the model did not call it this turn. ` +
        `tool_calls=${JSON.stringify(calls)}`)
}

// ---------------------------------------------------------------------------
// Probe 5 — control. Same strategy, same history, but through the raw Anthropic
// SDK. Probe 3 only tells us LangChain surfaced nothing; it cannot distinguish
// "the API applied no edits" from "the API applied edits and LangChain dropped
// them on the floor". This probe is the control that separates the two.
// ---------------------------------------------------------------------------
async function probe5() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const raw = new Anthropic({ apiKey })

  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(220)
  const messages = [{ role: 'user', content: 'Check the system a few times.' }]
  for (let i = 0; i < 4; i++) {
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `call_${i}`, name: 'get_system_info', input: { probe: i } }],
    })
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `call_${i}`, content: `Report ${i}: ${filler}` }],
    })
  }
  messages.push({ role: 'user', content: 'Now summarise in one word.' })

  let res
  try {
    res = await raw.beta.messages.create({
      model: MODEL,
      max_tokens: 64,
      betas: [CONTEXT_MGMT_BETA],
      context_management: {
        edits: [{
          type: 'clear_tool_uses_20250919',
          trigger: { type: 'input_tokens', value: 1000 },
          keep: { type: 'tool_uses', value: 1 },
        }],
      },
      tools: [{
        name: 'get_system_info',
        description: 'Returns a system report.',
        input_schema: { type: 'object', properties: { probe: { type: 'number' } } },
      }],
      messages,
    })
  } catch (err) {
    record('5. raw SDK control', false, `Raw SDK request failed: ${String(err?.message ?? err).slice(0, 400)}`)
    return
  }

  const cm = res.context_management
  const edits = cm?.applied_edits
  const populated = Array.isArray(edits) && edits.length > 0

  record('5. raw SDK control', populated,
    populated
      ? `The API DID apply edits: ${JSON.stringify(cm)}\n      ` +
        `=> combined with probe 3, the edits are real and @langchain/anthropic is not ` +
        `surfacing them. Read applied_edits from the raw stream, not response_metadata.`
      : `The API applied no edits either (context_management=${JSON.stringify(cm)}). ` +
        `=> probe 3's failure is the trigger not firing, not a LangChain bug. ` +
        `usage.input_tokens=${res.usage?.input_tokens}`)
}

// ---------------------------------------------------------------------------
// Probe 6 — locate the surfacing bug. utils/message_outputs.js reads
// `data.delta.context_management` off the message_delta event. If the API
// actually puts the field one level up, on the event itself, that lookup can
// never hit and applied_edits is silently unobservable through LangChain.
// ---------------------------------------------------------------------------
async function probe6() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const raw = new Anthropic({ apiKey })

  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(220)
  const messages = [{ role: 'user', content: 'Check the system a few times.' }]
  for (let i = 0; i < 4; i++) {
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `call_${i}`, name: 'get_system_info', input: { probe: i } }],
    })
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `call_${i}`, content: `Report ${i}: ${filler}` }],
    })
  }
  messages.push({ role: 'user', content: 'Now summarise in one word.' })

  let messageDelta = null
  try {
    const stream = await raw.beta.messages.create({
      model: MODEL,
      max_tokens: 64,
      stream: true,
      betas: [CONTEXT_MGMT_BETA],
      context_management: {
        edits: [{
          type: 'clear_tool_uses_20250919',
          trigger: { type: 'input_tokens', value: 1000 },
          keep: { type: 'tool_uses', value: 1 },
        }],
      },
      tools: [{
        name: 'get_system_info',
        description: 'Returns a system report.',
        input_schema: { type: 'object', properties: { probe: { type: 'number' } } },
      }],
      messages,
    })
    for await (const event of stream) {
      if (event.type === 'message_delta') messageDelta = event
    }
  } catch (err) {
    record('6. locate the surfacing bug', false, `Raw stream failed: ${String(err?.message ?? err).slice(0, 300)}`)
    return
  }

  if (!messageDelta) {
    record('6. locate the surfacing bug', false, 'No message_delta event seen.')
    return
  }

  const onEvent = messageDelta.context_management !== undefined
  const onDelta = messageDelta.delta?.context_management !== undefined

  record('6. locate the surfacing bug', onEvent || onDelta,
    `message_delta top-level keys: ${JSON.stringify(Object.keys(messageDelta))}\n      ` +
    `delta keys: ${JSON.stringify(Object.keys(messageDelta.delta ?? {}))}\n      ` +
    `context_management on event: ${onEvent} | on event.delta: ${onDelta}\n      ` +
    (onEvent && !onDelta
      ? 'CONFIRMED: the field sits on the event, but message_outputs.js looks for it on ' +
        'event.delta — so the lookup never hits. Read it from the raw stream instead.'
      : `value: ${JSON.stringify(messageDelta.context_management ?? messageDelta.delta?.context_management)}`))
}

const probes = [probe1, probe2, probe3, probe4, probe5, probe6]
for (const p of probes) {
  try {
    await p()
  } catch (err) {
    record(p.name, false, `Probe threw: ${String(err?.stack ?? err)}`)
  }
}

console.log('─'.repeat(70))
console.log(`Model: ${MODEL}`)
for (const r of results) console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.name}`)
const allPassed = results.every((r) => r.passed)
console.log(
  allPassed
    ? '\nLangChain carries both parameters. Staying on ChatAnthropic is viable for Layers 1-2.'
    : '\nAt least one probe failed — read the detail above before choosing between ' +
      'patching ChatAnthropic and moving the loop to @anthropic-ai/sdk.',
)
process.exit(allPassed ? 0 : 1)
