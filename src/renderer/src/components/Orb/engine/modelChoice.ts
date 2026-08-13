/**
 * The avatar select's vocabulary, and the one rule that decides what a stored
 * choice actually means at startup.
 *
 * This lives apart from AvatarPanel deliberately. The panel can only be
 * exercised with a WebGL context and a DOM, but the startup reconciliation is
 * where the "avatar appears even though None is selected" class of bug lives —
 * so it is kept as a pure function that can be tested directly.
 */

/** Opens the file picker; never persisted as a choice. */
export const UPLOAD_OPTION = '__upload__'
/** The model whose bytes are saved to disk via the avatar IPC channel. */
export const CUSTOM_OPTION = '__custom__'
/** Empty stage — the frame stays, nothing is loaded into it. */
export const NONE_OPTION = '__none__'

export interface ResolveInput {
  /** Whatever `avatarModelChoice` held in settings. */
  saved: string | undefined
  /** Did the on-disk custom model actually come back? */
  hasCustomOnDisk: boolean
  /** Ids of the presets currently shipped in the build. */
  presetIds: readonly string[]
  /** Did the disk read throw, as opposed to returning nothing? */
  readFailed: boolean
}

export interface ResolveResult {
  /** What the select shows and the stage loads — always in agreement. */
  choice: string
  /** Whether the stored setting should be rewritten to match `choice`. */
  persist: boolean
}

/**
 * Resolve a persisted choice against what exists right now.
 *
 * Anything that no longer names something loadable falls back to the empty
 * stage rather than to some other avatar: silently substituting a different
 * model is how a user ends up staring at a face they never picked.
 */
export function resolveModelChoice({
  saved,
  hasCustomOnDisk,
  presetIds,
  readFailed,
}: ResolveInput): ResolveResult {
  const resolvable =
    saved === NONE_OPTION ||
    (saved === CUSTOM_OPTION && hasCustomOnDisk) ||
    (saved !== undefined && presetIds.includes(saved))

  const choice = resolvable ? (saved as string) : NONE_OPTION

  // A failed read is not evidence the model is gone. Persisting the fallback on
  // the strength of a transient IPC error would throw away a selection that is
  // still perfectly valid on the next launch.
  const persist = choice !== saved && !readFailed

  return { choice, persist }
}
