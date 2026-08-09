import { registerCapabilities } from './registry'
import { taskCapabilities } from './defs/tasks'

/**
 * The one place every capability module is pulled in.
 *
 * Called once at startup, before the IPC surface is exposed. Registration throws
 * on a duplicate id, so a collision fails loudly at boot rather than silently
 * shadowing a capability at some later call.
 */
export function registerAllCapabilities(): void {
  registerCapabilities(taskCapabilities)
  // Phase 1 adds jobs.*, Phase 2 youtube.*, Phase 3 content.*, and so on.
}
