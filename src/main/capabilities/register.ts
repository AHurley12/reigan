import { registerCapabilities } from './registry'
import { chatCapabilities } from './defs/chat'
import { taskCapabilities } from './defs/tasks'
import { jobCapabilities } from './defs/jobs'
import { fileCapabilities } from './defs/files'
import { youtubeCapabilities } from './defs/youtube'
import { devtoolsCapabilities } from './defs/devtools'
import { localhostCapabilities } from './defs/localhost'
import { shellCapabilities } from './defs/shell'
import { fileorgCapabilities } from './defs/fileorg'
import { vaultCapabilities } from './defs/vault'
import { webCapabilities } from './defs/web'

/**
 * The one place every capability module is pulled in.
 *
 * Called once at startup, before the IPC surface is exposed. Registration throws
 * on a duplicate id, so a collision fails loudly at boot rather than silently
 * shadowing a capability at some later call.
 */
export function registerAllCapabilities(): void {
  registerCapabilities(chatCapabilities)
  registerCapabilities(taskCapabilities)
  registerCapabilities(fileCapabilities)
  registerCapabilities(youtubeCapabilities)
  registerCapabilities(devtoolsCapabilities)
  registerCapabilities(localhostCapabilities)
  registerCapabilities(shellCapabilities)
  registerCapabilities(fileorgCapabilities)
  registerCapabilities(vaultCapabilities)
  registerCapabilities(webCapabilities)
  // Registered after everything schedulable: jobs.upsert validates that its
  // target capability exists, so the targets must be present first.
  registerCapabilities(jobCapabilities)
}
