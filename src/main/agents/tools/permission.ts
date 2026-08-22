import { requestApproval } from '../../capabilities/approval'

/**
 * Gates a mutating tool action behind user approval. `summary` is shown in
 * the UI's approval card — keep it a plain-language description of exactly
 * what will happen (not the tool name or raw args).
 *
 * Routes through the capability framework's approval path, which is the one
 * with a live prompt on the other end. It previously used
 * `agents/permissionGate`, whose `agent:permission-request` channel no preload
 * or renderer ever listened on — so every gated mail, calendar, settings and
 * system action sat unanswered for two minutes and then reported itself to the
 * user as their own denial.
 *
 * These tools are not capabilities, so they carry the tool name as their
 * capability id. Registration's "a write must declare an approval spec" rule
 * does not reach them; the gate here is what stands in for it.
 */
export async function withPermission(
  tool: string,
  summary: string,
  action: () => Promise<string> | string,
  detail?: string
): Promise<string> {
  const outcome = await requestApproval({
    capabilityId: tool,
    title: humanizeToolName(tool),
    risk: 'write',
    summary,
    detail,
    requestedBy: 'agent',
  })

  if (outcome.status === 'approved') return action()

  if (outcome.status === 'queued') {
    return `Not done yet — this is waiting for your approval: ${summary}`
  }

  if (outcome.status === 'denied') {
    return `Not done — the user denied permission for: ${summary}`
  }

  // Never phrased as a denial: the user did not decide anything here.
  return `Not done — the approval prompt for "${summary}" went unanswered, so nothing was changed.`
}

/** `draft_email` → `Draft email`, for the card's heading. */
function humanizeToolName(tool: string): string {
  const spaced = tool.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
