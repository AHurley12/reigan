import * as fs from 'fs'
import git from 'isomorphic-git'
import { PRUNE_DIRS } from './detect'

/**
 * Git metadata for a scanned project.
 *
 * Uses isomorphic-git rather than spawning `git` once per repository. On a
 * drive with sixty repositories that is sixty process creations, which on
 * Windows is the single most expensive thing a scan could do. It also means
 * the scan works when git is not on PATH at all.
 */

export interface GitMeta {
  branch: string | null
  lastCommitAt: number | null
  isDirty: boolean
  unpushedCount: number
  remoteUrl: string | null
}

export const EMPTY_GIT_META: GitMeta = {
  branch: null,
  lastCommitAt: null,
  isDirty: false,
  unpushedCount: 0,
  remoteUrl: null,
}

/** Beyond this many commits ahead we stop counting and report the cap. */
const UNPUSHED_WALK_CAP = 100

/**
 * Per-repository budget for the dirty check.
 *
 * `statusMatrix` is the only genuinely expensive call here — it stats every
 * tracked file. A repository large enough to exceed this is one where the
 * answer is not worth stalling the whole scan for, so it reports `false` and
 * moves on rather than blocking.
 */
const DIRTY_CHECK_BUDGET_MS = 4000

export async function readGitMeta(dir: string): Promise<GitMeta> {
  const meta: GitMeta = { ...EMPTY_GIT_META }

  try {
    // Returns undefined on a detached HEAD, which is a real state, not a failure.
    meta.branch = (await git.currentBranch({ fs, dir, fullname: false })) ?? null
  } catch {
    // Not a repository, or a HEAD we cannot parse. Everything below needs a
    // branch or a commit, so there is nothing left to try.
    return meta
  }

  meta.remoteUrl = await readRemoteUrl(dir)

  const head = await resolveOrNull(dir, 'HEAD')
  if (!head) {
    // A repository with no commits yet. Real, and worth surfacing as
    // "never-committed" rather than treated as an error.
    return meta
  }

  meta.lastCommitAt = await readHeadCommitTime(dir)
  meta.unpushedCount = await countUnpushed(dir, head, meta.branch)
  meta.isDirty = await isWorkingTreeDirty(dir)

  return meta
}

async function resolveOrNull(dir: string, ref: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref })
  } catch {
    return null
  }
}

async function readRemoteUrl(dir: string): Promise<string | null> {
  try {
    const remotes = await git.listRemotes({ fs, dir })
    if (remotes.length === 0) return null
    const origin = remotes.find((r) => r.remote === 'origin')
    return (origin ?? remotes[0]).url ?? null
  } catch {
    return null
  }
}

async function readHeadCommitTime(dir: string): Promise<number | null> {
  try {
    const [commit] = await git.log({ fs, dir, depth: 1 })
    if (!commit) return null
    // isomorphic-git reports committer time in seconds.
    return commit.commit.committer.timestamp * 1000
  } catch {
    return null
  }
}

/**
 * Commits on the local branch that its upstream does not have.
 *
 * Deliberately compares against `refs/remotes/origin/<branch>`, the last known
 * state of the remote, rather than fetching. A scan must never touch the
 * network — it runs across every repository on the drive, and sixty silent
 * fetches is both slow and a surprising thing for a read-only scan to do.
 * The number is therefore "unpushed as of your last fetch", which is what the
 * user's local git would also tell them.
 */
async function countUnpushed(dir: string, head: string, branch: string | null): Promise<number> {
  if (!branch) return 0

  const remoteSha = await resolveOrNull(dir, `refs/remotes/origin/${branch}`)
  // No tracking ref: either never pushed, or a branch that only exists locally.
  // Counting the entire history as "unpushed" would be technically true and
  // practically useless, so report the cap only when there is something to
  // compare against.
  if (!remoteSha) return 0
  if (remoteSha === head) return 0

  try {
    const commits = await git.log({ fs, dir, ref: head, depth: UNPUSHED_WALK_CAP })
    const index = commits.findIndex((c) => c.oid === remoteSha)
    return index === -1 ? UNPUSHED_WALK_CAP : index
  } catch {
    return 0
  }
}

async function isWorkingTreeDirty(dir: string): Promise<boolean> {
  const deadline = Date.now() + DIRTY_CHECK_BUDGET_MS
  try {
    const matrix = await git.statusMatrix({
      fs,
      dir,
      // Pruning here is what makes this affordable. Without it the walk
      // descends node_modules on every repository, which is both enormous and
      // gitignored anyway.
      filter: (filepath) => {
        const first = filepath.split('/')[0]
        return !PRUNE_DIRS.has(first)
      },
    })

    if (Date.now() > deadline) return false

    // [filepath, head, workdir, stage]. Anything where workdir or stage
    // disagrees with head is a change — modified, staged, added, or deleted.
    return matrix.some(([, head, workdir, stage]) => head !== workdir || head !== stage)
  } catch {
    return false
  }
}
