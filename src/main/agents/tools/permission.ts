import { requestPermission } from '../permissionGate'

/**
 * Gates a mutating tool action behind user approval. `summary` is shown in
 * the UI's approval card — keep it a plain-language description of exactly
 * what will happen (not the tool name or raw args).
 */
export async function withPermission(
  tool: string,
  summary: string,
  action: () => Promise<string> | string,
  detail?: string
): Promise<string> {
  const approved = await requestPermission(tool, summary, detail)
  if (!approved) return `Not done — the user denied permission for: ${summary}`
  return action()
}
