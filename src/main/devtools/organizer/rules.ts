import { extname } from 'path'

/**
 * The rules engine: what a rule matches, and what it does about it.
 *
 * Conditions and actions are plain data so a rule round-trips through SQLite
 * and through the model's tool schema unchanged. Nothing here touches the
 * filesystem — matching is tested against described files, and the planner
 * supplies the descriptions.
 */

export type MimeFamily = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'installer' | 'other'

export interface DescribedFile {
  path: string
  name: string
  ext: string
  sizeBytes: number
  createdAt: number
  modifiedAt: number
  mimeFamily: MimeFamily
  /** Set by the planner when duplicate detection has run. */
  duplicateOf?: string
}

export type Condition =
  | { kind: 'extension'; values: string[] }
  | { kind: 'nameMatches'; pattern: string }
  | { kind: 'sizeGreaterThan'; bytes: number }
  | { kind: 'sizeLessThan'; bytes: number }
  | { kind: 'olderThan'; days: number; field: 'created' | 'modified' }
  | { kind: 'newerThan'; days: number; field: 'created' | 'modified' }
  | { kind: 'mimeFamily'; values: MimeFamily[] }
  | { kind: 'isDuplicate' }

export type Action =
  | { kind: 'moveTo'; destination: string }
  | { kind: 'renameTo'; pattern: string }
  | { kind: 'copyTo'; destination: string }
  | { kind: 'trash' }
  | { kind: 'tag'; tag: string }
  | { kind: 'flagForReview' }

export type CollisionPolicy = 'skip' | 'rename' | 'overwrite'

export interface Rule {
  id: string
  name: string
  enabled: boolean
  scopePath: string
  recursive: boolean
  conditions: Condition[]
  actions: Action[]
  collisionPolicy: CollisionPolicy
  schedule: 'manual' | 'on-file-added' | 'interval'
}

const EXT_FAMILIES: Array<[MimeFamily, string[]]> = [
  ['image', ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tiff', '.avif', '.ico']],
  ['video', ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.flv', '.m4v']],
  ['audio', ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']],
  ['document', ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.rtf', '.odt', '.csv', '.epub']],
  ['archive', ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']],
  ['installer', ['.exe', '.msi', '.msix', '.appx', '.dmg', '.pkg', '.deb', '.rpm']],
  ['code', ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.json', '.yml', '.yaml', '.toml', '.sql', '.html', '.css']],
]

export function mimeFamilyFor(fileName: string): MimeFamily {
  const ext = extname(fileName).toLowerCase()
  for (const [family, exts] of EXT_FAMILIES) {
    if (exts.includes(ext)) return family
  }
  return 'other'
}

const DAY_MS = 24 * 60 * 60 * 1000

export function matchesCondition(file: DescribedFile, condition: Condition, now = Date.now()): boolean {
  switch (condition.kind) {
    case 'extension':
      return condition.values.some((v) => file.ext.toLowerCase() === normaliseExt(v))
    case 'nameMatches':
      try {
        return new RegExp(condition.pattern, 'i').test(file.name)
      } catch {
        // A rule with a broken regex must match nothing rather than
        // everything — the failure mode of "matches everything" is a plan
        // that moves the user's entire Downloads folder.
        return false
      }
    case 'sizeGreaterThan':
      return file.sizeBytes > condition.bytes
    case 'sizeLessThan':
      return file.sizeBytes < condition.bytes
    case 'olderThan': {
      const stamp = condition.field === 'created' ? file.createdAt : file.modifiedAt
      return now - stamp > condition.days * DAY_MS
    }
    case 'newerThan': {
      const stamp = condition.field === 'created' ? file.createdAt : file.modifiedAt
      return now - stamp < condition.days * DAY_MS
    }
    case 'mimeFamily':
      return condition.values.includes(file.mimeFamily)
    case 'isDuplicate':
      return !!file.duplicateOf
    default:
      return false
  }
}

/** All conditions must hold. An empty condition list matches nothing. */
export function matchesRule(file: DescribedFile, conditions: Condition[], now = Date.now()): boolean {
  if (conditions.length === 0) return false
  return conditions.every((c) => matchesCondition(file, c, now))
}

function normaliseExt(value: string): string {
  const lower = value.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

/**
 * Expands `{token}` placeholders in a destination or rename pattern.
 *
 * Supported: {yyyy} {MM} {dd} for the file's modified date, {name} {ext}
 * {family} for its identity, and {counter} which the planner fills in when
 * resolving a collision.
 */
export function expandTokens(
  pattern: string,
  file: DescribedFile,
  extra: Record<string, string> = {}
): string {
  const date = new Date(file.modifiedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')

  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    name: file.name.replace(/\.[^.]+$/, ''),
    ext: file.ext.replace(/^\./, ''),
    family: file.mimeFamily,
    ...extra,
  }

  return pattern.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens ? tokens[key] : whole
  )
}

/**
 * Shipped presets.
 *
 * `scopePath` is left empty: it is filled in from the user's chosen folder
 * when the preset is instantiated, because hardcoding a Downloads path here
 * would be wrong on any machine with a relocated profile.
 */
export function builtinPresets(): Array<Omit<Rule, 'id'>> {
  return [
    {
      name: 'Downloads triage',
      enabled: false,
      scopePath: '',
      recursive: false,
      conditions: [{ kind: 'mimeFamily', values: ['image', 'video', 'audio', 'document', 'archive'] }],
      actions: [{ kind: 'moveTo', destination: '{family}s/{yyyy}/{MM}' }],
      collisionPolicy: 'rename',
      schedule: 'manual',
    },
    {
      name: 'Trash stale installers',
      enabled: false,
      scopePath: '',
      recursive: false,
      conditions: [
        { kind: 'mimeFamily', values: ['installer'] },
        { kind: 'olderThan', days: 30, field: 'modified' },
      ],
      // Trash, never delete: everything here goes to the Recycle Bin, so a
      // wrong match costs a restore rather than a file.
      actions: [{ kind: 'trash' }],
      collisionPolicy: 'skip',
      schedule: 'manual',
    },
    {
      name: 'Duplicate sweep (report only)',
      enabled: false,
      scopePath: '',
      recursive: true,
      conditions: [{ kind: 'isDuplicate' }],
      // Deliberately flag-only. Choosing which copy of a file to keep needs
      // context this engine does not have, so it reports and the user decides.
      actions: [{ kind: 'flagForReview' }],
      collisionPolicy: 'skip',
      schedule: 'manual',
    },
  ]
}
