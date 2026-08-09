import { registerCapabilities } from './registry'
import { taskCapabilities } from './defs/tasks'
import { jobCapabilities } from './defs/jobs'
import { fileCapabilities } from './defs/files'
import { devtoolsCapabilities } from './defs/devtools'

/**
 * The one place every capability module is pulled in.
 *
 * Called once at startup, before the IPC surface is exposed. Registration throws
 * on a duplicate id, so a collision fails loudly at boot rather than silently
 * shadowing a capability at some later call.
 */
export function registerAllCapabilities(): void {
  registerCapabilities(taskCapabilities)
  registerCapabilities(fileCapabilities)
  registerCapabilities(devtoolsCapabilities)
  // Registered after everything schedulable: jobs.upsert validates that its
  // target capability exists, so the targets must be present first.
  registerCapabilities(jobCapabilities)
  // Phase 2 adds youtube.*, Phase 3 content.*, and so on.
}
