import { basename } from 'path'
import type { ProjectStatus, ReadmeStatus } from './types'

/**
 * Pure project-detection logic. No I/O — every function takes what it needs as
 * data, so the classification rules can be tested without a filesystem.
 */

/**
 * Directory names never descended into.
 *
 * Two distinct reasons, worth keeping straight. Dependency and build
 * directories (`node_modules`, `dist`, `target`) are pruned because they are
 * derived output: enormous, uninteresting, and they would swamp the language
 * census with vendored code. System directories (`Windows`, `AppData`) are
 * pruned because walking them is slow, permission-denied, and can never
 * contain a project the user is working on.
 */
export const PRUNE_DIRS = new Set([
  // Derived output
  'node_modules', 'bower_components', 'vendor', 'venv', '.venv', 'env',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit',
  '.parcel-cache', '.turbo', '.cache', 'coverage', '.gradle', 'bin', 'obj',
  // VCS internals — `.git` itself is detected as a marker before pruning.
  '.git', '.hg', '.svn',
  // System / platform
  'AppData', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
  '$Recycle.Bin', 'System Volume Information', 'OneDriveTemp',
  '.Trash', 'Library', 'Applications',
])

/** Files/dirs whose presence marks a directory as a project root. */
const MARKER_FILES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile',
  'composer.json', 'Makefile', 'CMakeLists.txt', 'pubspec.yaml',
]
const MARKER_DIRS = ['.git']
const MARKER_GLOB_EXTS = ['.csproj', '.sln', '.fsproj', '.vbproj']

export function isProjectMarker(entryName: string, isDir: boolean): boolean {
  if (isDir) return MARKER_DIRS.includes(entryName)
  if (MARKER_FILES.includes(entryName)) return true
  return MARKER_GLOB_EXTS.some((ext) => entryName.endsWith(ext))
}

/**
 * Directories that are containers of projects, never projects themselves.
 *
 * Found the hard way: a stray `package.json` in the home directory — left by
 * running `npm install` in the wrong terminal, which is extremely common —
 * made `C:\Users\<name>` match as a project. Because the outermost match wins,
 * discovery stopped at depth 0, reported the entire profile as one project,
 * found nothing beneath it, and spent forty seconds totalling 17 GB.
 *
 * These names are shell folders. Whatever marker file turns up in one, the
 * user's home directory is not a codebase.
 */
const CONTAINER_DIR_NAMES = new Set([
  'documents', 'desktop', 'downloads', 'pictures', 'videos', 'music',
  'onedrive', 'dropbox', 'google drive', 'public', 'users', 'home',
  'source', 'repos', 'projects', 'code', 'dev', 'src',
])

/**
 * True if this path must be descended into rather than reported.
 *
 * `homeDir` is compared directly because its basename is the account name and
 * cannot be listed above.
 */
export function isContainerDir(path: string, homeDir: string): boolean {
  // Separators are normalised on both sides before comparing. Windows paths
  // reach this from two directions — `path.join` produces backslashes while
  // anything the user or a config file supplies is as likely to use forward
  // slashes — and a raw string compare silently fails on the mismatch.
  const normalised = normalisePath(path)
  if (normalised === normalisePath(homeDir)) return true

  // A bare drive root ("C:/") has no basename to test.
  if (/^[a-z]:$/.test(normalised)) return true

  const leaf = normalised.split('/').pop() ?? ''
  return CONTAINER_DIR_NAMES.has(leaf)
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Extension → language. Only extensions worth counting toward a census. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.pyi': 'Python',
  '.rs': 'Rust', '.go': 'Go', '.rb': 'Ruby', '.php': 'PHP',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.scala': 'Scala',
  '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic',
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.swift': 'Swift', '.m': 'Objective-C', '.mm': 'Objective-C',
  '.dart': 'Dart', '.lua': 'Lua', '.r': 'R', '.jl': 'Julia', '.ex': 'Elixir',
  '.exs': 'Elixir', '.erl': 'Erlang', '.hs': 'Haskell', '.clj': 'Clojure',
  '.sh': 'Shell', '.bash': 'Shell', '.ps1': 'PowerShell', '.psm1': 'PowerShell',
  '.sql': 'SQL', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SCSS',
  '.less': 'Less', '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.zig': 'Zig', '.nim': 'Nim', '.sol': 'Solidity',
}

export function languageForExt(ext: string): string | null {
  return LANGUAGE_BY_EXT[ext.toLowerCase()] ?? null
}

/** True for extensions that count as source when dating "last modified". */
export function isSourceExt(ext: string): boolean {
  return ext.toLowerCase() in LANGUAGE_BY_EXT
}

/**
 * Byte-weighted census → percentages.
 *
 * Weighted by bytes rather than file count because a project with 200 tiny
 * config-ish `.js` files and 20 large `.py` modules is a Python project, and
 * counting files would call it JavaScript.
 */
export function toLanguagePercentages(bytesByLanguage: Record<string, number>): Record<string, number> {
  const total = Object.values(bytesByLanguage).reduce((a, b) => a + b, 0)
  if (total === 0) return {}
  const out: Record<string, number> = {}
  for (const [lang, bytes] of Object.entries(bytesByLanguage)) {
    const pct = Math.round((bytes / total) * 1000) / 10
    if (pct >= 0.1) out[lang] = pct
  }
  return out
}

export function primaryLanguage(percentages: Record<string, number>): string | null {
  let best: string | null = null
  let bestPct = 0
  for (const [lang, pct] of Object.entries(percentages)) {
    if (pct > bestPct) {
      best = lang
      bestPct = pct
    }
  }
  return best
}

/**
 * Framework detection from dependency manifests.
 *
 * Reads declared dependencies rather than guessing from directory shape: a
 * `pages/` folder means nothing on its own, while `next` in package.json is
 * unambiguous.
 */
interface ManifestInput {
  packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; workspaces?: unknown } | null
  pythonRequirements?: string | null
  pyprojectToml?: string | null
  cargoToml?: string | null
  goMod?: string | null
}

const NODE_FRAMEWORKS: Array<[string, string]> = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@remix-run/react', 'Remix'],
  ['@sveltejs/kit', 'SvelteKit'], ['svelte', 'Svelte'], ['astro', 'Astro'],
  ['react', 'React'], ['vue', 'Vue'], ['@angular/core', 'Angular'],
  ['solid-js', 'Solid'], ['preact', 'Preact'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['koa', 'Koa'],
  ['@nestjs/core', 'NestJS'], ['hono', 'Hono'],
  ['electron', 'Electron'], ['@tauri-apps/api', 'Tauri'],
  ['react-native', 'React Native'], ['expo', 'Expo'],
  ['vite', 'Vite'], ['webpack', 'Webpack'], ['tailwindcss', 'Tailwind'],
]

const PYTHON_FRAMEWORKS: Array<[RegExp, string]> = [
  [/^fastapi\b/im, 'FastAPI'], [/^django\b/im, 'Django'], [/^flask\b/im, 'Flask'],
  [/^streamlit\b/im, 'Streamlit'], [/^torch\b/im, 'PyTorch'],
  [/^tensorflow\b/im, 'TensorFlow'], [/^pandas\b/im, 'pandas'],
]

export function detectFrameworks(input: ManifestInput): string[] {
  const found = new Set<string>()

  const pkg = input.packageJson
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const [dep, label] of NODE_FRAMEWORKS) {
      if (dep in deps) found.add(label)
    }
  }

  const pythonText = `${input.pythonRequirements ?? ''}\n${input.pyprojectToml ?? ''}`
  if (pythonText.trim()) {
    for (const [re, label] of PYTHON_FRAMEWORKS) {
      if (re.test(pythonText)) found.add(label)
    }
  }

  if (input.cargoToml) {
    if (/^\s*axum\s*=/m.test(input.cargoToml)) found.add('Axum')
    if (/^\s*actix-web\s*=/m.test(input.cargoToml)) found.add('Actix')
    if (/^\s*tauri\s*=/m.test(input.cargoToml)) found.add('Tauri')
  }

  if (input.goMod) {
    if (/github\.com\/gin-gonic\/gin/.test(input.goMod)) found.add('Gin')
    if (/github\.com\/labstack\/echo/.test(input.goMod)) found.add('Echo')
  }

  return [...found].sort()
}

/** Lockfile → package manager. Order matters: npm's is the fallback. */
export function detectPackageManager(files: Set<string>): string | null {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('package-lock.json')) return 'npm'
  if (files.has('poetry.lock')) return 'poetry'
  if (files.has('uv.lock')) return 'uv'
  if (files.has('Pipfile.lock')) return 'pipenv'
  if (files.has('Cargo.lock')) return 'cargo'
  if (files.has('go.sum')) return 'go'
  if (files.has('composer.lock')) return 'composer'
  if (files.has('Gemfile.lock')) return 'bundler'
  if (files.has('requirements.txt')) return 'pip'
  return null
}

/** Under 200 characters is a stub — a title and a sentence, not documentation. */
export const README_STUB_MAX_CHARS = 200

export function classifyReadme(content: string | null): ReadmeStatus {
  if (content === null) return 'missing'
  return content.trim().length < README_STUB_MAX_CHARS ? 'stub' : 'exists'
}

const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e'])

export function hasTests(params: {
  dirNames: Set<string>
  fileNames: Set<string>
  packageScripts?: Record<string, string> | null
}): boolean {
  for (const dir of params.dirNames) {
    if (TEST_DIR_NAMES.has(dir.toLowerCase())) return true
  }
  for (const file of params.fileNames) {
    if (/\.(test|spec)\.[a-z]+$/i.test(file) || /^test_.*\.py$/i.test(file)) return true
  }
  const testScript = params.packageScripts?.test
  // "no test specified" is create-react-app's placeholder and means the
  // opposite of what its presence would otherwise imply.
  if (testScript && !/no test specified/i.test(testScript)) return true
  return false
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Activity classification from the most recent real signal.
 *
 * Uses the later of last-commit and last-source-modification. Commit date
 * alone misses uncommitted work in progress; mtime alone misreads a `git
 * clone` (every file freshly written) as active development.
 */
export function classifyStatus(
  lastModified: number,
  lastCommitAt: number | null,
  now = Date.now()
): ProjectStatus {
  const mostRecent = Math.max(lastModified || 0, lastCommitAt ?? 0)
  if (mostRecent === 0) return 'abandoned'
  const ageDays = (now - mostRecent) / DAY_MS
  if (ageDays <= 14) return 'active'
  if (ageDays <= 60) return 'warm'
  if (ageDays <= 180) return 'dormant'
  return 'abandoned'
}

export function projectNameFor(path: string, packageName?: string | null): string {
  return packageName?.trim() || basename(path)
}

/**
 * Monorepo detection. A workspace root indexes its children *as well as*
 * itself, where an ordinary nested project is absorbed by its parent.
 */
export function isMonorepoRoot(pkg: { workspaces?: unknown } | null, files: Set<string>): boolean {
  if (files.has('pnpm-workspace.yaml') || files.has('lerna.json') || files.has('nx.json')) return true
  if (!pkg?.workspaces) return false
  return Array.isArray(pkg.workspaces) || typeof pkg.workspaces === 'object'
}
