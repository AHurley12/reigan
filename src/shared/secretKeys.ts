/**
 * Which setting keys are credentials.
 *
 * Split out of `main/db/secrets.ts` so it can be read without pulling in
 * Electron's `safeStorage`. The encryption code is main-only by necessity; the
 * *list* is a fact about the settings schema, and both the agent's editable-key
 * boundary (`shared/settingsCatalog.ts`) and its tests need it. Duplicating it
 * would mean a new credential could be added to one copy and quietly exposed
 * by the other.
 *
 * `googleClientId` is deliberately absent: it is transmitted in the consent URL
 * and is not a secret. Encrypting it would imply a confidentiality guarantee
 * that OAuth itself does not make.
 */
export const SECRET_SETTING_KEYS = new Set([
  'anthropicApiKey',
  'tavilyApiKey',
  'deepgramApiKey',
  'elevenLabsApiKey',
  'googleClientSecret',
  'googleTokens',
])

export function isSecretKey(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key)
}
