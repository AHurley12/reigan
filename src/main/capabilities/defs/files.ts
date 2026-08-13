import { z } from 'zod'
import { runFullIndex } from '../../files/fileIndexer'
import type { AnyCapability } from '../types'
import type { FileIndexResult } from '../../../shared/types'

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
    // Returned verbatim so the run record carries the evidence. The previous
    // version spread a `void` return and reported duration alone, which made a
    // scan that indexed nothing indistinguishable from a healthy one.
    handler: (): Promise<FileIndexResult> => runFullIndex(),
    formatResult: (r: FileIndexResult) => {
      if (r.joinedExisting) {
        return `A rebuild was already running; joined it. ${r.filesIndexed.toLocaleString()} entries indexed in ${(r.durationMs / 1000).toFixed(1)}s.`
      }
      const parts = [
        `${r.filesIndexed.toLocaleString()} entries indexed in ${(r.durationMs / 1000).toFixed(1)}s`,
      ]
      if (r.filesPruned > 0) parts.push(`${r.filesPruned.toLocaleString()} stale entries removed`)
      if (r.unreadableDirs > 0) parts.push(`${r.unreadableDirs.toLocaleString()} unreadable directories`)
      if (r.capped) parts.push('stopped at the entry ceiling — the index is incomplete')
      return `File index rebuilt: ${parts.join('; ')}.`
    },
    // A rebuild can succeed and still leave the index wrong. Each of these would
    // otherwise sit behind an unqualified green check.
    resultWarning: (r: FileIndexResult) => {
      if (r.capped) {
        return `The file index stopped at its ${r.filesIndexed.toLocaleString()}-entry ceiling. Search results are incomplete, and stale entries were not pruned.`
      }
      if (r.filesIndexed === 0) {
        return 'The file index rebuild finished but indexed nothing. Search will return no results.'
      }
      if (r.unreadableDirs > 0) {
        return `${r.unreadableDirs.toLocaleString()} directories could not be read during the file index rebuild, so their contents are missing from search.`
      }
      return null
    },
  },
]
