import { z } from 'zod'
import { runFullIndex } from '../../files/fileIndexer'
import type { AnyCapability } from '../types'

/**
 * The file index, as a schedulable capability.
 *
 * Previously this ran as a bare `runFullIndex().catch(() => {})` at boot — a
 * fire-and-forget side effect with no history, no failure surface, and no way to
 * see when it last succeeded. Expressed as a capability it becomes a job like
 * any other, visible and debuggable from the Jobs view.
 */
export const fileCapabilities: AnyCapability[] = [
  {
    id: 'files.reindex',
    title: 'Rebuild the file index',
    description:
      'Rebuild the local file search index. Runs in the background and can take a while on a large drive.',
    // Local disk work, not a network call, and it replaces its own index rather
    // than mutating anything the user authored.
    risk: 'read',
    schema: z.object({}),
    handler: async () => {
      const startedAt = Date.now()
      const result = await runFullIndex()
      return { ...(result ?? {}), durationMs: Date.now() - startedAt }
    },
    formatResult: (r: { durationMs: number }) =>
      `File index rebuilt in ${(r.durationMs / 1000).toFixed(1)}s.`,
  },
]
