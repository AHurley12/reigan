// ── App State ──
export type ReiganState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
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
  voiceEnabled: boolean;
  particleCount: number;
  theme: 'dark';
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
} as const;
