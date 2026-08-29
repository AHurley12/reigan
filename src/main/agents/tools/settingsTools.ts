import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getAllDecodedSettings, setSetting, getDecodedSetting, InvalidSettingError } from '../../db/queries'
import { describeSettings } from '../../../shared/settings/describe'
import { AGENT_EDITABLE_KEYS, descriptorFor } from '../../../shared/settings/descriptors'
import { withPermission } from './permission'

// The editable allowlist and the credential mask both used to be hand-written
// here, and both had drifted from reality — `theme` was missing from the
// allowlist, and `googleTokens` was missing from the mask, which meant this
// tool would hand the model a stored Google refresh token. Both now derive
// from the descriptor table, which is typed for completeness.

export const getSettingsTool = new DynamicStructuredTool({
  name: 'get_settings',
  description:
    "Read the user's current app settings — every setting, including ones still at their " +
    'default value. Credentials are reported only as set/not set, never their value.',
  schema: z.object({}),
  func: async () => describeSettings(getAllDecodedSettings()),
})

/**
 * Legal values, spelled out in the tool description.
 *
 * Without this the model had to guess and discover the constraint by failing —
 * which is how a voice *name* ended up saved where an id belonged.
 */
const EDITABLE_SUMMARY = AGENT_EDITABLE_KEYS.map((key) => {
  const d = descriptorFor(key)!
  const legal =
    d.kind === 'enum'
      ? Object.entries(d.options ?? {})
          .map(([id, label]) => `${id} (${label})`)
          .join(', ')
      : d.kind === 'toggle'
        ? 'true or false'
        : d.kind === 'number'
          ? `number ${d.min ?? '-inf'}..${d.max ?? 'inf'}`
          : 'text'
  return `${key} — ${d.label}: ${legal}`
}).join('\n')

export const updateSettingTool = new DynamicStructuredTool({
  name: 'update_setting',
  description:
    'Change one app setting. Credentials cannot be touched — those are set in the Settings UI.\n' +
    'A voice, theme, or orb style may be given by name rather than id ("Zenya", "Frutiger Aero").\n\n' +
    EDITABLE_SUMMARY,
  schema: z.object({
    key: z.enum(AGENT_EDITABLE_KEYS as [string, ...string[]]).describe('The setting to change'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('The new value'),
  }),
  func: async ({ key, value }) =>
    withPermission('update_setting', `Change setting "${key}" to ${JSON.stringify(value)}`, () => {
      try {
        setSetting(key, JSON.stringify(value))
      } catch (err) {
        // Hand the reason back as tool output rather than throwing: the model
        // can correct itself from the message (it lists the legal values),
        // whereas an exception just aborts the turn.
        if (err instanceof InvalidSettingError) {
          return `Could not update ${key}: ${err.message}`
        }
        throw err
      }
      // Read back: the guard may have normalised the value (a voice name is
      // stored as its id), so echoing the input would misreport what was saved.
      return `Updated ${key} to ${JSON.stringify(getDecodedSetting(key))}.`
    }),
})
