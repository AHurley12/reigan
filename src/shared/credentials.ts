/**
 * Cleans a credential pasted into a settings field.
 *
 * Credentials are copied out of JSON blobs, `.env` lines, and terminal output,
 * and all three routinely bring punctuation along: `"abc"`, `'abc'`, a trailing
 * newline from a shell heredoc. Stored verbatim they look right in the UI and
 * fail somewhere far away — a quoted OAuth client ID passes every API call,
 * because those carry only the bearer token, and then breaks the *token
 * refresh* an hour later as `invalid_client`. The symptom is "it signed me out
 * for no reason", which points nowhere near the paste that caused it.
 *
 * Strips one balanced layer of wrapping quotes only. Unbalanced quotes and
 * interior ones are left alone: no real credential ends in a quote, but if one
 * ever does, silently eating half of it would be worse than storing it as
 * typed.
 */
export function sanitizeCredential(raw: string): string {
  const trimmed = raw.trim()
  const first = trimmed[0]
  if (
    trimmed.length >= 2 &&
    (first === '"' || first === "'") &&
    trimmed[trimmed.length - 1] === first
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}
