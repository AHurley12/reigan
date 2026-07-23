// ── App State ──
export type ReiganState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'success';
export type AppModule = 'chat' | 'tasks' | 'files' | 'mail' | 'calendar' | 'automations' | 'dev';
export type JapaneseLevel = 0 | 1 | 2; // 0=off, 1=ambient, 2=learning

// ── Chat ──
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ── Tasks ──
export type TaskStatus = 'backlog' | 'active' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  tags?: string[];
}

// ── Settings ──
export interface AppSettings {
  anthropicApiKey: string;
  japaneseLevel: JapaneseLevel;
  showFurigana: boolean;
  showRomaji: boolean;
  voiceEnabled: boolean;
  particleCount: number;
  deepgramApiKey: string;
  elevenLabsApiKey: string;
  voiceId: string;
  pushToTalk: boolean;
  ttsStability: number;
  ttsSimilarity: number;
  googleClientId: string;
  googleClientSecret: string;
  showOrbColumn: boolean;
  reducedMotion: boolean;
}

// ── Voice ──
export type VoiceOrbAudioData = {
  amplitude: number;
  bass: number;
  mid: number;
  high: number;
};

// ── Calendar ──
export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  allDay: boolean;
}

// ── IPC Channel Names ──
export const IPC = {
  // LLM
  LLM_SEND: 'llm:send',
  LLM_STREAM: 'llm:stream',
  LLM_ABORT: 'llm:abort',
  // Tasks
  TASK_CREATE: 'task:create',
  TASK_LIST: 'task:list',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  // System
  SYSTEM_INFO: 'system:info',
  APP_OPEN: 'app:open',
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_LOAD_ALL: 'settings:load-all',
  // Voice
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_AUDIO_CHUNK: 'voice:audio-chunk',
  VOICE_AMPLITUDE: 'voice:amplitude',
  VOICE_TRANSCRIPT: 'voice:transcript',
  VOICE_AUDIO_PLAYBACK: 'voice:audio-playback',
  VOICE_STATE_CHANGE: 'voice:state-change',
  VOICE_ORB_AUDIO: 'voice:orb-audio',
  VOICE_ERROR: 'voice:error',
  VOICE_PTT_DOWN: 'voice:ptt-down',
  VOICE_PTT_UP: 'voice:ptt-up',
  // Google account
  GOOGLE_STATUS: 'google:status',
  GOOGLE_CONNECT: 'google:connect',
  GOOGLE_DISCONNECT: 'google:disconnect',
  // Calendar
  CALENDAR_LIST_EVENTS: 'calendar:list-events',
} as const;
