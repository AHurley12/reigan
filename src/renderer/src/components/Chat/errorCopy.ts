export interface ErrorPresentation {
  /** Short headline naming the problem. */
  title: string
  /** What to do about it. Never a restatement of the title. */
  guidance: string
  /** Whether pressing Retry, unchanged, could plausibly succeed. */
  retryable: boolean
}

interface Rule {
  match: RegExp
  title: string
  guidance: string
  retryable: boolean
}

/**
 * An error message should state the problem *and* the way out of it. "Invalid
 * API key" tells someone nothing they can act on; "your key was rejected, check
 * it in Settings" does.
 *
 * Order matters — the first match wins, so narrower patterns come first.
 */
const RULES: Rule[] = [
  {
    match: /context[ _-]?length|prompt is too long|too many tokens|maximum context/i,
    title: 'This conversation is too long',
    guidance:
      'The history no longer fits in the model’s context window. Start a new chat, or edit an earlier message to shorten what gets sent.',
    // Nothing about resending the same thing changes the size of the context.
    retryable: false,
  },
  {
    match: /\b401\b|unauthorized|invalid[ _-]?api[ _-]?key|authentication[ _-]?error|x-api-key/i,
    title: 'Your API key was rejected',
    guidance:
      'The key is missing, expired, or from a different account. Add a working key in Settings (Ctrl+,) and try again.',
    retryable: false,
  },
  {
    match: /\b403\b|permission[ _-]?error|not[ _-]?allowed/i,
    title: 'That request was not permitted',
    guidance:
      'Your API key does not have access to this model. Check the model selection in Settings (Ctrl+,).',
    retryable: false,
  },
  {
    match: /credit balance|billing|insufficient[ _-]?quota|payment/i,
    title: 'Billing stopped the request',
    guidance:
      'Your Anthropic account cannot cover this request. Check your plan and credit balance at console.anthropic.com.',
    retryable: false,
  },
  {
    match: /\b429\b|rate[ _-]?limit/i,
    title: 'Rate limited',
    guidance: 'You have sent requests faster than your plan allows. Wait a few seconds, then retry.',
    retryable: true,
  },
  {
    match: /\b529\b|overloaded/i,
    title: 'The model is overloaded',
    guidance: 'Anthropic’s servers are busy right now. Retrying in a moment usually works.',
    retryable: true,
  },
  {
    match: /\b5\d\d\b|internal[ _-]?server[ _-]?error|api[ _-]?error/i,
    title: 'The API returned an error',
    guidance: 'Something failed on Anthropic’s side rather than here. Retrying is worth a try.',
    retryable: true,
  },
  {
    match: /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|offline/i,
    title: 'Could not reach the API',
    guidance:
      'Reigan could not open a connection to Anthropic. Check your internet connection, then retry.',
    retryable: true,
  },
  {
    match: /ETIMEDOUT|timed? ?out/i,
    title: 'The request timed out',
    guidance: 'The model took too long to respond. Retrying often succeeds.',
    retryable: true,
  },
]

export function describeChatError(raw: string): ErrorPresentation {
  const message = raw?.trim()
  if (!message) {
    return {
      title: 'That did not work',
      guidance: 'The request failed without saying why. Retrying is the only way to learn more.',
      retryable: true,
    }
  }

  const rule = RULES.find((r) => r.match.test(message))
  if (rule) return { title: rule.title, guidance: rule.guidance, retryable: rule.retryable }

  // Unrecognised failures surface verbatim. Replacing an unknown message with
  // "Something went wrong" throws away the only part anyone could act on, and
  // guarantees the next unmatched error is undebuggable too.
  return { title: 'That did not work', guidance: message, retryable: true }
}
