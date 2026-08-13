// ── App State ──
export type ReiganState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'success';
export type AppModule = 'chat' | 'tasks' | 'files' | 'mail' | 'calendar' | 'performance' | 'automations' | 'dev';
export type JapaneseLevel = 0 | 1 | 2; // 0=off, 1=ambient, 2=learning
export type PersonalityMode = 'standard' | 'unbridled';

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
  voiceResponseMode: 'always' | 'conversational' | 'off';
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
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  personalityMode: PersonalityMode;
  unbridledModeAcknowledged: boolean;
  avatarModelChoice: string;
  avatarCustomModelLabel: string;
  voiceOrbStyle: string;
  theme: string;
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

// ── Mail ──
// Matches Gmail's own inbox categories (category:primary/social/... search operators).
export type MailCategory = 'primary' | 'social' | 'promotions' | 'updates' | 'forums';

export interface MailThread {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  snippet: string;
  date: string; // RFC 2822 Date header, rendered client-side
  unread: boolean;
  starred: boolean;
  category: MailCategory;
  messageCount: number;
}

export interface MailMessageDetail {
  id: string;
  from: string;
  to: string;
  date: string;
  body: string;
  snippet: string;
}

export interface MailThreadDetail {
  id: string;
  subject: string;
  messages: MailMessageDetail[];
}

// ── Files ──
export type FileTypeCategoryId = 'all' | 'documents' | 'images' | 'code' | 'media' | 'archives' | 'other';

export interface FileEntry {
  path: string;
  name: string;
  dir: string;
  ext: string;
  size: number;
  mtime: number; // ms since epoch
  isDir: boolean;
}

export interface FileSearchParams {
  query: string;
  category?: FileTypeCategoryId;
  modifiedAfter?: number; // ms since epoch
  sortBy?: 'name' | 'modified' | 'size';
  sortDir?: 'asc' | 'desc';
  limit?: number;
}

export interface FileIndexStatus {
  indexing: boolean;
  filesIndexed: number;
  lastIndexedAt: number | null;
  error: string | null;
  homeDir: string;
}

/**
 * What a rebuild actually did. Stored on the job run record, so "it succeeded"
 * is always accompanied by the evidence — a run that indexed 0 files is
 * distinguishable from one that indexed 180,000.
 */
export interface FileIndexResult {
  filesIndexed: number;
  /** Rows dropped because the file no longer exists. */
  filesPruned: number;
  durationMs: number;
  /** Hit the entry ceiling — the index is a truncated view of the tree. */
  capped: boolean;
  /** Directories the walk could not read (permissions, or deleted mid-scan). */
  unreadableDirs: number;
  /** This call joined a rebuild already in flight rather than starting its own. */
  joinedExisting: boolean;
}

// ── Performance ──
export type PerfStatus = 'good' | 'warning' | 'critical';

export interface PerfStaticInfo {
  cpuModel: string;
  cpuCores: number;
  totalMemBytes: number;
  gpuModels: string[];
  volumes: { mount: string; totalBytes: number }[];
}

export interface PerfCpu {
  loadPercent: number;
  perCore: number[];
  temperatureC: number | null;
}

export interface PerfMemory {
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
}

export interface PerfGpu {
  model: string;
  utilizationPercent: number | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  temperatureC: number | null;
}

export interface PerfDiskVolume {
  mount: string;
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
}

export interface PerfDisk {
  volumes: PerfDiskVolume[];
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface PerfNetworkInterface {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface PerfProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  memBytes: number;
}

export interface PerfSample {
  timestamp: number;
  cpu: PerfCpu;
  memory: PerfMemory;
  gpu: PerfGpu[];
  disk: PerfDisk;
  network: PerfNetworkInterface[];
  processes: PerfProcess[];
}

// ── Agent ──
/** A pending edit Shingan wants to make — surfaced in the UI for approve/deny before it runs. */
export interface AgentPermissionRequest {
  id: string;
  tool: string;
  summary: string;
  detail?: string;
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
  // Agent
  AGENT_PERMISSION_REQUEST: 'agent:permission-request',
  AGENT_PERMISSION_RESPOND: 'agent:permission-respond',
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_LOAD_ALL: 'settings:load-all',
  // Credential metadata (hasValue + last 4). The values themselves never
  // cross to the renderer — see db/queries.ts getSettingsForRenderer().
  SETTINGS_SECRET_PREVIEWS: 'settings:secret-previews',
  // Voice
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_STOP_SPEAKING: 'voice:stop-speaking',
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
  // Mail
  MAIL_LIST_THREADS: 'mail:list-threads',
  MAIL_CATEGORY_COUNTS: 'mail:category-counts',
  MAIL_GET_THREAD: 'mail:get-thread',
  MAIL_REPLY: 'mail:reply',
  MAIL_ARCHIVE: 'mail:archive',
  MAIL_SET_READ: 'mail:set-read',
  // Avatar
  AVATAR_SAVE_MODEL: 'avatar:save-model',
  AVATAR_LOAD_MODEL: 'avatar:load-model',
  // Files (read-only browse/search — see src/main/files/fileIndexer.ts for scope rules)
  FILES_LIST_DIR: 'files:list-dir',
  FILES_SEARCH: 'files:search',
  FILES_INDEX_STATUS: 'files:index-status',
  FILES_REINDEX: 'files:reindex',
  FILES_READ_CONTENT: 'files:read-content',
  FILES_OPEN: 'files:open',
  FILES_REVEAL: 'files:reveal',
  // Jobs — every non-success outcome the scheduler produces arrives here.
  JOBS_NOTIFICATION: 'jobs:notification',
  // Performance
  PERF_STATIC_INFO: 'perf:static-info',
  PERF_START: 'perf:start',
  PERF_STOP: 'perf:stop',
  PERF_SAMPLE: 'perf:sample',
} as const;

// ── Automations: jobs & approvals ──
// Shared so the renderer types the capability payloads without importing across
// the process boundary. Mirrors main/jobs/store.ts and main/capabilities/types.ts.

export type ScheduleKind = 'interval' | 'cron' | 'daily_at' | 'weekly_on' | 'manual';
export type CatchUpPolicy = 'run_once' | 'run_all' | 'skip';
export type RiskTier = 'read' | 'network' | 'write' | 'destructive';

export type JobRunStatus =
  | 'running' | 'success' | 'failure' | 'skipped'
  | 'deferred' | 'awaiting_approval' | 'cancelled' | 'timeout';

export type JobTriggeredBy = 'schedule' | 'manual' | 'catch_up' | 'retry' | 'approval';

export interface ScheduledJob {
  id: string;
  name: string;
  capabilityId: string;
  args: unknown;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  /** Human-readable, e.g. "Daily at 04:00" — the table never shows raw cron. */
  scheduleDescription: string;
  nextRunAt: number | null;
  nextRunRelative: string | null;
  lastRunAt: number | null;
  lastStatus: JobRunStatus | null;
  enabled: boolean;
  catchUpPolicy: CatchUpPolicy;
  maxRetries: number;
  timeoutMs: number;
  consecutiveFailures: number;
  disabledReason: string | null;
  system: boolean;
  running: boolean;
  createdAt: number;
}

/**
 * Why an automation is telling you something. Every value here is an outcome
 * that is *not* a clean success — the scheduler emits one for each, so no
 * non-success can pass without reaching the UI.
 */
export type JobAlertKind =
  | 'failure'
  | 'timeout'
  | 'skipped'
  | 'deferred'
  | 'cancelled'
  | 'awaiting_approval'
  | 'disabled'
  /** Succeeded, but the outcome is not what a green check implies. */
  | 'degraded';

export interface JobNotification {
  id: string;
  priority: 'urgent' | 'normal';
  kind: JobAlertKind;
  title: string;
  body: string;
  /** Empty for engine-level alerts that belong to no single job. */
  jobId: string;
  jobName: string;
  at: number;
}

export interface JobRunRecord {
  id: string;
  jobId: string;
  startedAt: number;
  finishedAt: number | null;
  status: JobRunStatus;
  result: unknown;
  error: string | null;
  attempt: number;
  triggeredBy: JobTriggeredBy;
  scheduledFor: number | null;
  approvalId: string | null;
}

export interface ApprovalDiff {
  subject: string;
  changes: Array<{ field: string; before: string | null; after: string | null }>;
}

export interface PendingApproval {
  id: string;
  capabilityId: string;
  /** Present on a live request; absent on rows read back from the store. */
  title?: string;
  risk: RiskTier;
  summary: string;
  detail?: string;
  diff: ApprovalDiff | null;
  requestedBy: 'ui' | 'agent' | 'job';
  requestedAt: number;
}

export interface CapabilityInvokeResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  errorCode?: string;
  awaitingApprovalId?: string;
}

// ── Automations: YouTube ──

export interface YtChannelStats {
  id: string;
  title: string;
  customUrl: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  thumbnailUrl: string | null;
  syncedAt: number | null;
}

export interface YtSeriesPoint {
  date: string;
  views: number;
  watchTimeMinutes: number;
  netSubs: number;
}

export type YtPerformanceTier = 'top' | 'solid' | 'underperforming' | 'dormant';

export interface YtVideoSummary {
  id: string;
  title: string;
  publishedAt: number | null;
  durationS: number | null;
  privacyStatus: string | null;
  thumbnailUrl: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  tags: string[];
  descriptionLength: number;
  hasCustomThumbnail: boolean;
  views28: number;
  tier: YtPerformanceTier;
}

export type YtFindingKind =
  | 'still_earning' | 'revival_thumbnail' | 'revival_content' | 'revival_remake'
  | 'metadata_hygiene' | 'cadence' | 'title_pattern';

export interface YtAuditFinding {
  id: string;
  kind: YtFindingKind;
  videoId: string | null;
  severity: 'info' | 'suggestion' | 'important';
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  lowConfidence: boolean;
  generatedAt: number;
}

export interface YtQuotaStatus {
  date: string;
  used: number;
  budget: number;
  limit: number;
  remaining: number;
  calls: Record<string, number>;
}
