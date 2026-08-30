import { DynamicStructuredTool } from '@langchain/core/tools'
import { googleAuth } from '../auth/googleAuth'
import { invokeCapability } from './registry'
import { listModelVisibleCapabilities } from './registry'
import type { AnyCapability } from './types'

/**
 * Generates the model's tool surface from the capability registry.
 *
 * This is the only place tools are built. There is no hand-maintained array to
 * fall out of sync, and — critically — no way for a `uiOnly` capability to reach
 * the model, because the generator reads `listModelVisibleCapabilities()` and
 * `invokeCapability` refuses `uiOnly` ids from a non-UI source as a second line
 * of defence. Phase 7 depends on both.
 */

/**
 * Capability ids are dotted (`youtube.listVideos`); tool names in the Anthropic
 * API must match ^[a-zA-Z0-9_-]{1,64}$, which excludes `.`. Translating rather
 * than renaming the capabilities keeps the dotted namespace in the UI, the docs,
 * and the job table, where it reads better.
 */
export function capabilityIdToToolName(id: string): string {
  return id.replace(/\./g, '_')
}

export function toolNameToCapabilityId(name: string): string {
  return name.replace(/_/g, '.')
}

function buildTool(cap: AnyCapability): DynamicStructuredTool {
  const mutates = cap.risk === 'write' || cap.risk === 'destructive'

  // Told to the model, so it can set expectations before calling rather than
  // being surprised by a denial or a pending approval it doesn't understand.
  // The two cases are worded apart on purpose: telling the model that a web
  // search "modifies data" would be false, and it repeats such claims to the
  // user verbatim.
  let description = cap.description
  if (mutates) {
    description += "\n\nThis action modifies data and requires the user's approval before it runs."
  } else if (cap.approvalPolicy === 'always') {
    description += "\n\nThis action requires the user's approval every time it runs."
  } else if (cap.approvalPolicy === 'session') {
    description +=
      "\n\nThe first use in a conversation asks the user's approval; once they approve, " +
      'later uses in that same conversation run without asking again.'
  }

  return new DynamicStructuredTool({
    name: capabilityIdToToolName(cap.id),
    description,
    schema: cap.schema as never,
    func: async (args: unknown) => {
      const outcome = await invokeCapability(cap.id, args, { invokedBy: 'agent' })

      if (!outcome.ok) {
        // Returned as a string rather than thrown: a thrown error aborts the
        // agent turn, while this lets the model read the failure and tell the
        // user what went wrong, which is what Phase 10 asks for.
        return outcome.error ?? 'The action failed for an unknown reason.'
      }

      if (cap.formatResult) return cap.formatResult(outcome.result)
      if (typeof outcome.result === 'string') return outcome.result
      if (outcome.result === undefined || outcome.result === null) return 'Done.'
      return JSON.stringify(outcome.result)
    },
  })
}

export function buildAgentTools(): DynamicStructuredTool[] {
  const googleConnected = !!googleAuth.getClient()

  return listModelVisibleCapabilities()
    .filter((cap) => !cap.requiresGoogle || googleConnected)
    .map(buildTool)
}
