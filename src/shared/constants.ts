export const APP_NAME = 'REIGAN';
export const APP_NAME_JP = '霊眼';
export const APP_TAGLINE = 'See beyond. Act within.';
export const APP_VERSION = '0.1.0';

export const DEFAULT_SETTINGS = {
  anthropicApiKey: '',
  japaneseLevel: 1 as const,
  voiceEnabled: false,
  particleCount: 1000,
  theme: 'dark' as const,
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
