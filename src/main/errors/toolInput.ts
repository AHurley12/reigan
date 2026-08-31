/**
 * Making a tool-schema rejection say which tool it was.
 *
 * LangChain validates a tool call's arguments against the tool's zod schema and,
 * on a mismatch, throws one fixed sentence: "Received tool input did not match
 * expected schema". The call it rejected is attached to the exception as
 * `output` — a JSON string of the whole tool call, name and arguments included —
 * and nothing here read it.
 *
 * That left the least useful possible record. The message is identical for every
 * tool, and the error log fingerprints on the message, so a schema bug in one
 * tool and a schema bug in another collapsed onto the same row; the row named no
 * tool, held no arguments, and gave nobody anywhere to start.
 */

export interface ToolInputFailure {
  /** The tool the model called, or 'unknown' if the payload was unreadable. */
  toolName: string
  /** Names the tool, so each one fingerprints as its own row in the error log. */
  message: string
  /** The arguments as sent, truncated. */
  input: string
}

const LANGCHAIN_MESSAGE = /Received tool input did not match expected schema/

/** Long enough to see the shape of a bad call, short enough not to store a document. */
const MAX_INPUT_CHARS = 2000

/**
 * Reads a LangChain tool-input rejection, or returns null for anything else.
 *
 * Matched on the message rather than the class because `ToolInputParsingException`
 * is not exported from `@langchain/core` and does not set `name`, so it arrives
 * indistinguishable from a plain `Error` apart from its text and `output`.
 */
export function describeToolInputFailure(err: unknown): ToolInputFailure | null {
  if (!(err instanceof Error) || !LANGCHAIN_MESSAGE.test(err.message)) return null

  const raw = (err as { output?: unknown }).output
  const call = typeof raw === 'string' ? safeParse(raw) : null

  const toolName = typeof call?.name === 'string' && call.name ? call.name : 'unknown'
  const details = err.message.split('\nDetails:')[1]?.trim()

  return {
    toolName,
    message:
      `Tool "${toolName}" was called with input that did not match its schema` +
      (details ? `: ${details}` : '.'),
    input: truncate(call ? JSON.stringify(call.args ?? {}) : String(raw ?? '')),
  }
}

function safeParse(text: string): { name?: unknown; args?: unknown } | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function truncate(text: string): string {
  return text.length <= MAX_INPUT_CHARS
    ? text
    : `${text.slice(0, MAX_INPUT_CHARS)}… (truncated, ${text.length} chars)`
}
