import type { TaskStatus } from './types';

export const APP_NAME = 'Shingan';
export const APP_NAME_JP = '心眼';
export const APP_TAGLINE = 'See beyond. Act within.';
export const APP_VERSION = '0.1.0';

export const DEFAULT_SETTINGS = {
  anthropicApiKey: '',
  japaneseLevel: 1 as const,
  showFurigana: true,
  showRomaji: true,
  voiceEnabled: false,
  particleCount: 8000,
  deepgramApiKey: '',
  elevenLabsApiKey: '',
  voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam
  pushToTalk: true,
  ttsStability: 0.5,
  ttsSimilarity: 0.75,
  googleClientId: '',
  googleClientSecret: '',
  showOrbColumn: true,
  reducedMotion: false,
};

export const NAV_ITEMS = [
  { id: 'chat',        icon: 'MessageSquare', en: 'Chat',        ja: 'チャット',    romaji: 'chatto' },
  { id: 'tasks',       icon: 'CheckSquare',   en: 'Tasks',       ja: 'タスク',      romaji: 'tasuku' },
  { id: 'files',       icon: 'Folder',        en: 'Files',       ja: 'ファイル',    romaji: 'fairu' },
  { id: 'mail',        icon: 'Mail',          en: 'Mail',        ja: 'メール',      romaji: 'meeru' },
  { id: 'calendar',    icon: 'Calendar',      en: 'Calendar',    ja: 'カレンダー',  romaji: 'karendaa' },
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
