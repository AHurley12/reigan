import type { TaskStatus, ReiganState, FileTypeCategoryId } from './types';

export const APP_NAME = 'Shingan';
export const APP_NAME_JP = '心眼';
export const APP_TAGLINE = 'See beyond. Act within.';
export const APP_VERSION = '0.1.0';

// ── UI scale ──
// The whole interface renders 1.15x larger. This is applied as a Chromium zoom
// factor rather than by rewriting spacing tokens, so the renderer's CSS
// viewport stays at BASE_WINDOW_* and every layout calculation in the app is
// bit-for-bit what it was before — padding, gaps, fixed rail widths and the
// orb/avatar canvases all grow together, and nothing can drift out of step.
// The window itself is scaled by the same factor so the same content fits.
// Font sizes are NOT scaled by this: they step up one rung of the type scale
// instead (see tailwind.config.ts fontSize and each theme's type.scale), which
// keeps them on whole pixels.
export const UI_SCALE = 1.15;

export const BASE_WINDOW_WIDTH = 1200;
export const BASE_WINDOW_HEIGHT = 800;
export const BASE_WINDOW_MIN_WIDTH = 900;
export const BASE_WINDOW_MIN_HEIGHT = 600;

export const DEFAULT_SETTINGS = {
  anthropicApiKey: '',
  japaneseLevel: 1 as const,
  showFurigana: true,
  showRomaji: true,
  voiceResponseMode: 'conversational' as const,
  particleCount: 8000,
  deepgramApiKey: '',
  elevenLabsApiKey: '',
  voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
  pushToTalk: true,
  ttsStability: 0.7,
  ttsSimilarity: 0.75,
  googleClientId: '',
  googleClientSecret: '',
  showOrbColumn: true,
  reducedMotion: false,
  audioInputDeviceId: 'default',
  audioOutputDeviceId: 'default',
  personalityMode: 'standard' as const,
  unbridledModeAcknowledged: false,
  avatarModelChoice: 'riruka',
  avatarCustomModelLabel: '',
  voiceOrbStyle: 'nebula',
  theme: 'shingan',
};

/**
 * The colour that stands for each REIGAN state, as a CSS var reference rather
 * than a literal. These were six hardcoded hexes from the Shingan palette, so
 * the status ring and avatar spinner stayed vermillion/gold under every skin.
 * The vars are published by theme/applyTokens.ts from the active theme's
 * tokens; see SKIN_CONTRACT.md.
 *
 * Consumers must not string-concatenate alpha onto these (`${color}33` is
 * invalid against a var()) — use color-mix().
 */
export const STATE_COLORS: Record<ReiganState, string> = {
  idle: 'var(--status-idle)',
  listening: 'var(--status-listening)',
  processing: 'var(--status-processing)',
  speaking: 'var(--status-speaking)',
  error: 'var(--status-error)',
  success: 'var(--status-success)',
};

export const NAV_ITEMS = [
  { id: 'chat',        icon: 'MessageSquare', en: 'Chat',        ja: 'チャット',    romaji: 'chatto' },
  { id: 'tasks',       icon: 'CheckSquare',   en: 'Tasks',       ja: 'タスク',      romaji: 'tasuku' },
  { id: 'files',       icon: 'Folder',        en: 'Files',       ja: 'ファイル',    romaji: 'fairu' },
  { id: 'mail',        icon: 'Mail',          en: 'Mail',        ja: 'メール',      romaji: 'meeru' },
  { id: 'calendar',    icon: 'Calendar',      en: 'Calendar',    ja: 'カレンダー',  romaji: 'karendaa' },
  { id: 'performance', icon: 'Gauge',         en: 'Performance', ja: '性能',        romaji: 'seinou' },
  { id: 'automations', icon: 'Zap',           en: 'Automations', ja: '自動化',      romaji: 'jidouka' },
  { id: 'dev',         icon: 'Code',          en: 'Dev Tools',   ja: '開発',        romaji: 'kaihatsu' },
] as const;

export const TASK_COLUMNS = [
  { id: 'backlog', en: 'Backlog', ja: '待機',   romaji: 'taiki' },
  { id: 'active',  en: 'Active',  ja: '進行中', romaji: 'shinkou-chuu' },
  { id: 'review',  en: 'Review',  ja: '確認',   romaji: 'kakunin' },
  { id: 'done',    en: 'Done',    ja: '完了',   romaji: 'kanryou' },
] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = Object.fromEntries(
  TASK_COLUMNS.map((c) => [c.id, c.ja])
) as Record<TaskStatus, string>;

export const TASK_STATUS_LABELS_EN: Record<TaskStatus, string> = Object.fromEntries(
  TASK_COLUMNS.map((c) => [c.id, c.en])
) as Record<TaskStatus, string>;

/** Japanese only appears once japaneseLevel >= 1 (ambient) — English otherwise. */
export function taskStatusLabel(status: TaskStatus, japaneseLevel: number): string {
  return japaneseLevel >= 1 ? TASK_STATUS_LABELS[status] : TASK_STATUS_LABELS_EN[status];
}

// ── Files ──
/**
 * Extension → category map for the Files panel's type tabs.
 *
 * Modelled on the Windows shell's own taxonomy so the tabs agree with what the
 * OS would say about the same file:
 *
 *  - `PerceivedType` (HKCR\.ext) groups extensions into broad buckets — Text,
 *    Image, Audio, Video, Compressed, Document, Folder. Documents here merges
 *    Text + Document; Media merges Audio + Video, as consumer file managers do.
 *  - `System.Kind` (the KindMap registry) is the user-facing version of the
 *    same idea, and it is the reason folders are not listed below: Folder is
 *    its own Kind, a *sibling* of document/picture/music/video rather than a
 *    member of each. `kind:=picture` in Explorer returns no folders, and the
 *    same holds here — folders appear under All only. See `categorizeEntry`.
 *
 * The lists are deliberately broad. The classic failure of this design is the
 * one Windows itself hit with .divx/.flv missing from `kind:video`: a plausible
 * extension nobody registered silently lands in Other and the filter looks
 * broken. constants.test.ts pins the mapping and forbids duplicates.
 */
export const FILE_TYPE_CATEGORIES: Array<{ id: FileTypeCategoryId; en: string; ja: string; exts?: string[] }> = [
  { id: 'all', en: 'All', ja: '全て' },
  {
    id: 'documents',
    en: 'Documents',
    ja: '文書',
    exts: [
      // Word processing / PDF / plain text
      'pdf', 'doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'wpd', 'txt', 'text',
      'md', 'markdown', 'rst', 'tex', 'log', 'nfo',
      // Spreadsheets
      'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv',
      // Presentations
      'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'odp',
      // E-books, notes, fixed-layout
      'epub', 'mobi', 'azw3', 'djvu', 'xps', 'oxps', 'one',
      // Apple iWork
      'pages', 'numbers', 'key',
    ],
  },
  {
    id: 'images',
    en: 'Images',
    ja: '画像',
    exts: [
      'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'webp', 'avif', 'jxl',
      'svg', 'svgz', 'bmp', 'dib', 'heic', 'heif', 'tif', 'tiff', 'ico', 'cur', 'tga',
      // Editable / raw formats
      'psd', 'xcf', 'ai', 'eps', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf',
    ],
  },
  {
    id: 'code',
    en: 'Code',
    ja: 'コード',
    exts: [
      // General-purpose languages
      'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyw', 'ipynb',
      'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs',
      'rb', 'php', 'swift', 'm', 'mm', 'scala', 'dart', 'lua', 'pl', 'pm', 'r', 'jl',
      'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'vb', 'fs', 'asm', 's',
      // Markup and styling
      'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
      'vue', 'svelte', 'astro',
      // Data, config, schema
      'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'xml', 'ini', 'cfg', 'conf',
      'properties', 'gradle', 'cmake', 'mk',
      // Query and interface definition
      'sql', 'graphql', 'gql', 'proto',
      // Shell and scripting
      'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd',
    ],
  },
  {
    id: 'media',
    en: 'Media',
    ja: 'メディア',
    exts: [
      // Audio
      'mp3', 'wav', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wma',
      'aiff', 'aif', 'alac', 'ape', 'mka', 'amr', '3ga', 'mid', 'midi',
      // Video — .ts/.mts are claimed by TypeScript above, which wins in a home directory
      'mp4', 'm4v', 'mov', 'avi', 'mkv', 'wmv', 'webm', 'flv', 'f4v', 'divx',
      'mpeg', 'mpg', 'mpe', '3gp', '3g2', 'm2ts', 'vob', 'ogv', 'asf', 'rm', 'rmvb',
    ],
  },
  {
    id: 'archives',
    en: 'Archives',
    ja: '圧縮',
    exts: [
      'zip', 'zipx', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2',
      'xz', 'txz', 'zst', 'lz', 'lzma', 'lzh', 'z', 'arj', 'ace', 'sit', 'sitx', 'cab',
      // Disk images and zip-container formats users think of as archives
      'iso', 'dmg', 'jar', 'war', 'whl', 'xpi',
    ],
  },
  { id: 'other', en: 'Other', ja: 'その他' },
];

const EXT_TO_CATEGORY: Record<string, FileTypeCategoryId> = Object.fromEntries(
  FILE_TYPE_CATEGORIES.flatMap((c) => (c.exts ?? []).map((ext) => [ext, c.id]))
);

/** Classifies a lowercase, dot-free extension into a filter category (defaults to 'other'). */
export function categorizeExt(ext: string): FileTypeCategoryId {
  return EXT_TO_CATEGORY[ext.toLowerCase()] ?? 'other';
}

/**
 * True if an entry belongs under `category`. The single place that decides what
 * a type tab contains, so the browse view and the indexed search cannot drift.
 *
 * Folders match All and nothing else — see the note on FILE_TYPE_CATEGORIES.
 */
export function matchesCategory(
  entry: { ext: string; isDir: boolean },
  category: FileTypeCategoryId
): boolean {
  if (category === 'all') return true;
  if (entry.isDir) return false;
  return categorizeExt(entry.ext) === category;
}
