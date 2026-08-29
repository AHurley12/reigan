import type { AgentExecutor } from 'langchain/agents'
import type { PersonalityMode } from '../../shared/types'

/**
 * The cached agent executor, kept in its own module so anything that
 * invalidates it can say so without importing `reigan.ts`.
 *
 * That matters because `reigan.ts` imports the tools, so a tool importing
 * `reigan.ts` back would be a cycle. The agent's own `update_setting` writes
 * settings directly rather than through the IPC handler, and the system prompt
 * now embeds the live settings — so the tool has to be able to invalidate the
 * cache, or the agent keeps reading a prompt describing the settings as they
 * were before it changed them.
 */
let executor: AgentExecutor | null = null
let executorMode: PersonalityMode | null = null

export function getCachedExecutor(mode: PersonalityMode): AgentExecutor | null {
  return executor && executorMode === mode ? executor : null
}

export function setCachedExecutor(mode: PersonalityMode, next: AgentExecutor): void {
  executor = next
  executorMode = mode
}

export function resetExecutor(): void {
  executor = null
  executorMode = null
}
