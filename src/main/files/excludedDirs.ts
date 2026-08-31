/**
 * Directory names the file index skips, matched by *name* at any depth.
 *
 * Its own module so the indexer and anything else that needs the rule share one
 * copy. A second hand-maintained copy of a list like this is how the credential
 * masking in agents/tools/settingsTools.ts drifted out of agreement with
 * db/secrets.ts and disclosed a live OAuth refresh token.
 *
 * (Migration 20 is the deliberate exception: it holds a frozen snapshot of
 * CACHE_DIR_NAMES, because a shipped migration must keep doing exactly what it
 * did the day it shipped even after this list grows.)
 */

/**
 * Build artefacts, dependency trees, and Windows profile junctions.
 *
 * AppData and the legacy junctions are excluded outright — mostly app
 * config/cache/credentials rather than the user's own files, and junctions can
 * otherwise loop.
 */
export const EXCLUDED_DIR_NAMES = new Set([
  'AppData', 'Application Data', 'Cookies', 'Local Settings', 'My Documents',
  'NetHood', 'PrintHood', 'Recent', 'SendTo', 'Templates', 'Start Menu', 'History',
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache',
  'venv', '.venv', '__pycache__', '.tox',
  '$RECYCLE.BIN', 'System Volume Information',
])

/**
 * Media and application caches: machine-generated, opaque, and worthless to search.
 *
 * `CacheClip` is the measured reason this list exists. A single video-editor
 * cache tree held 89,180 `.dvcc` files — 71% of every row in the index — under
 * GUID-named directories, none of it anything a person would ever search for.
 * It alone accounted for the bulk of an 86 MB database.
 *
 * Excluded by *directory*, deliberately not by file extension. The same scan
 * held 12,882 `.str` and 6,188 `.meta` files, and those turned out to be an
 * extracted application's resource files rather than cache — an extension
 * denylist would have thrown away real files (`.meta` is also Unity project
 * metadata) while missing the actual problem, which is whole cache trees.
 */
export const CACHE_DIR_NAMES = new Set([
  'CacheClip',
  'Cache', 'Caches', 'CachedData', 'cache2',
  'GPUCache', 'ShaderCache', 'Code Cache', 'DawnCache', 'GrShaderCache',
  'CrashDumps', 'Crashpad',
  'Thumbnails', 'thumbnails',
])

/**
 * Hidden (dot-prefixed) directories are skipped wholesale — that covers .git,
 * .ssh, .aws, .gnupg and friends without an exhaustive denylist of every
 * location a secret might live.
 */
export function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIR_NAMES.has(name) || CACHE_DIR_NAMES.has(name)
}
