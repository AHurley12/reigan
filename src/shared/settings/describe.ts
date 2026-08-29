import { DEFAULT_SETTINGS } from '../constants'
import { SETTING_DESCRIPTORS, displayValue, type SettingKey } from './descriptors'

/**
 * Renders the complete active settings state as a compact block.
 *
 * Merges over `DEFAULT_SETTINGS` deliberately: `getAllSettings()` returns only
 * rows that exist, so anything still at its default had no row and was simply
 * absent from what the model saw. A setting the model cannot see is one it will
 * happily contradict — it was reporting nothing at all about most of the app.
 *
 * Secrets are reduced to (set)/(not set) here rather than at each call site, so
 * no caller can forget. Values are never echoed.
 */
/**
 * The settings block as it goes into the agent's system prompt.
 *
 * `ChatPromptTemplate` parses f-string placeholders, so a brace inside a stored
 * value — a custom avatar label like `my {weird} name`, say — would be read as
 * a template variable and throw at construction, taking the whole agent down.
 * Doubling braces is how f-string escapes a literal one.
 *
 * Kept here beside `describeSettings` rather than inline at the call site so it
 * can be tested without standing up an executor.
 */
export function settingsPromptBlock(stored: Record<string, unknown>): string {
  return describeSettings(stored).replace(/\{/g, '{{').replace(/\}/g, '}}')
}

export function describeSettings(stored: Record<string, unknown>): string {
  const keys = Object.keys(SETTING_DESCRIPTORS) as SettingKey[]
  return keys
    .map((key) => {
      const d = SETTING_DESCRIPTORS[key]
      const has = Object.prototype.hasOwnProperty.call(stored, key)
      const raw = has ? stored[key] : (DEFAULT_SETTINGS as Record<string, unknown>)[key]
      const shown = displayValue(key, raw)
      // Secrets have no meaningful "default", so the marker would be noise.
      const origin = has || d.kind === 'secret' ? '' : ' [default]'
      return `- ${d.label}: ${shown}${origin} — ${d.summary}`
    })
    .join('\n')
}
