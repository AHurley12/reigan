import type Database from 'better-sqlite3'

/**
 * Forward-only, ordered, transactional schema migrations.
 *
 * Replaces the previous approach, where the entire schema was a blob of
 * `CREATE TABLE IF NOT EXISTS` maintained by hand in two places (schema.sql and
 * a duplicated `runInlineSchema()`), re-executed on every boot. That could
 * create tables but could never *alter* one: `IF NOT EXISTS` is a silent no-op
 * against a table that already exists, so adding a column to `tasks` would do
 * nothing at all on any machine that had already run the app.
 *
 * Rules:
 *  - Migrations are append-only. Never edit or renumber a shipped migration —
 *    databases in the wild have already recorded its version and will not re-run it.
 *  - `version` values are contiguous from 1 and must match array order.
 *  - Each migration runs inside its own transaction, together with the
 *    `user_version` bump, so a failure leaves the database exactly as it was.
 */

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

/**
 * Adds a column only if it isn't already present.
 *
 * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and a duplicate add
 * throws. Migrations are version-guarded so this shouldn't normally trigger, but
 * databases that predate the runner may already carry a column added by an
 * earlier hand-edited schema — this makes adoption of those non-fatal.
 */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'adopt-existing-schema',
    // Byte-for-byte the schema the app shipped before the runner existed, so an
    // existing database converges to version 1 without touching a single row,
    // and a fresh one lands in the identical state. Every statement is
    // `IF NOT EXISTS` precisely because this migration is an adoption step.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'backlog'
            CHECK (status IN ('backlog', 'active', 'review', 'done')),
          priority TEXT NOT NULL DEFAULT 'medium'
            CHECK (priority IN ('low', 'medium', 'high', 'critical')),
          due_date INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          completed_at INTEGER,
          tags TEXT DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New Conversation',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

        CREATE TABLE IF NOT EXISTS files_index (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          dir TEXT NOT NULL,
          ext TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0,
          mtime INTEGER NOT NULL DEFAULT 0,
          is_dir INTEGER NOT NULL DEFAULT 0,
          indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_files_ext ON files_index(ext);
        CREATE INDEX IF NOT EXISTS idx_files_mtime ON files_index(mtime);
        CREATE INDEX IF NOT EXISTS idx_files_dir ON files_index(dir);
        CREATE INDEX IF NOT EXISTS idx_files_indexed_at ON files_index(indexed_at);

        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          name, content='files_index', content_rowid='id', tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS files_index_ai AFTER INSERT ON files_index BEGIN
          INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
        END;
        CREATE TRIGGER IF NOT EXISTS files_index_ad AFTER DELETE ON files_index BEGIN
          INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', old.id, old.name);
        END;
        CREATE TRIGGER IF NOT EXISTS files_index_au AFTER UPDATE ON files_index BEGIN
          INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', old.id, old.name);
          INSERT INTO files_fts(rowid, name) VALUES (new.id, new.name);
        END;
      `)
    },
  },

  {
    version: 2,
    name: 'approval-audit-log',
    // Every approval decision, from any surface (agent tool call, UI action, or
    // a scheduled job queuing for later). Persisted because "did REIGAN ask me
    // before it touched my channel?" must be answerable after the fact — an
    // in-memory gate can't answer it.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          capability_id TEXT NOT NULL,
          risk TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          diff_json TEXT,
          args_json TEXT,
          requested_by TEXT NOT NULL DEFAULT 'agent',
          state TEXT NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
          requested_at INTEGER NOT NULL,
          resolved_at INTEGER,
          expires_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_approvals_state ON approvals(state);
        CREATE INDEX IF NOT EXISTS idx_approvals_requested_at ON approvals(requested_at);
      `)
    },
  },

  {
    version: 3,
    name: 'fileops-allowlisted-roots',
    // The folders Reigan is allowed to touch at all. Deliberately its own table
    // rather than rows in `settings`: `get_settings` hands the model every
    // settings key, and one careless addition to `updateSettingTool`'s
    // EDITABLE_KEYS enum would let the model widen its own filesystem access.
    // A separate table makes that structurally impossible instead of merely
    // discouraged — there is no tool that can write here.
    //
    // resolved_path is COLLATE NOCASE because Windows and macOS treat
    // C:\Users\Me\Docs and C:\Users\me\docs as the same folder; a case-sensitive
    // UNIQUE would happily store both and leave containment checks ambiguous.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS fileops_roots (
          id TEXT PRIMARY KEY,
          display_path TEXT NOT NULL,
          resolved_path TEXT NOT NULL UNIQUE COLLATE NOCASE,
          added_at INTEGER NOT NULL,
          is_protected INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_fileops_roots_added_at ON fileops_roots(added_at);
      `)
    },
  },

  {
    version: 4,
    name: 'job-engine',
    // The durable scheduler. `next_run_at` lives here rather than in a timer
    // because REIGAN is a desktop app: it is closed at night and asleep during
    // meetings, and an in-memory setInterval silently skips everything that fell
    // due while the process was not running.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          capability_id TEXT NOT NULL,
          args_json TEXT NOT NULL DEFAULT '{}',
          schedule_kind TEXT NOT NULL
            CHECK (schedule_kind IN ('interval', 'cron', 'daily_at', 'weekly_on', 'manual')),
          schedule_expr TEXT NOT NULL DEFAULT '',
          next_run_at INTEGER,
          last_run_at INTEGER,
          last_status TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          catch_up_policy TEXT NOT NULL DEFAULT 'run_once'
            CHECK (catch_up_policy IN ('run_once', 'run_all', 'skip')),
          max_retries INTEGER NOT NULL DEFAULT 3,
          timeout_ms INTEGER NOT NULL DEFAULT 300000,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          disabled_reason TEXT,
          system INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        -- The scheduler's hot query is "what is due?", run on every tick.
        CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, next_run_at);

        CREATE TABLE IF NOT EXISTS job_runs (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          status TEXT NOT NULL
            CHECK (status IN ('running', 'success', 'failure', 'skipped', 'deferred',
                              'awaiting_approval', 'cancelled', 'timeout')),
          result_json TEXT,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          triggered_by TEXT NOT NULL DEFAULT 'schedule'
            CHECK (triggered_by IN ('schedule', 'manual', 'catch_up', 'retry', 'approval')),
          scheduled_for INTEGER,
          approval_id TEXT,
          FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at);
      `)
    },
  },

  {
    version: 5,
    name: 'youtube-channel-manager',
    // Everything the UI reads comes from these tables, never from a live API
    // call: the Data API allows 10,000 units a day and a single careless
    // `search.list` costs 100 of them. Sync writes here; the UI reads here.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS yt_channel (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          custom_url TEXT,
          subscriber_count INTEGER NOT NULL DEFAULT 0,
          view_count INTEGER NOT NULL DEFAULT 0,
          video_count INTEGER NOT NULL DEFAULT 0,
          thumbnail_url TEXT,
          uploads_playlist_id TEXT,
          synced_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS yt_videos (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          description TEXT,
          published_at INTEGER,
          duration_s INTEGER,
          privacy_status TEXT,
          thumbnail_url TEXT,
          /* True only when the channel never uploaded a custom thumbnail — a
             metadata-hygiene signal, not a display concern. */
          has_custom_thumbnail INTEGER NOT NULL DEFAULT 1,
          tags_json TEXT NOT NULL DEFAULT '[]',
          category_id TEXT,
          view_count INTEGER NOT NULL DEFAULT 0,
          like_count INTEGER NOT NULL DEFAULT 0,
          comment_count INTEGER NOT NULL DEFAULT 0,
          synced_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_yt_videos_published ON yt_videos(published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_yt_videos_views ON yt_videos(view_count DESC);

        /* The foundation for every insight in the catalog audit. Synced for at
           least 365 days on first run, incrementally thereafter. */
        CREATE TABLE IF NOT EXISTS yt_daily_stats (
          video_id TEXT NOT NULL,
          date TEXT NOT NULL,
          views INTEGER NOT NULL DEFAULT 0,
          watch_time_minutes REAL NOT NULL DEFAULT 0,
          avg_view_duration_s REAL NOT NULL DEFAULT 0,
          avg_view_percentage REAL NOT NULL DEFAULT 0,
          subs_gained INTEGER NOT NULL DEFAULT 0,
          subs_lost INTEGER NOT NULL DEFAULT 0,
          impressions INTEGER NOT NULL DEFAULT 0,
          ctr REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (video_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_yt_daily_date ON yt_daily_stats(date);

        CREATE TABLE IF NOT EXISTS yt_traffic_sources (
          video_id TEXT NOT NULL,
          date TEXT NOT NULL,
          source_type TEXT NOT NULL,
          views INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (video_id, date, source_type)
        );

        CREATE INDEX IF NOT EXISTS idx_yt_traffic_video ON yt_traffic_sources(video_id);

        /* One row per quota day (Pacific). calls_json breaks the total down by
           endpoint so an unexpected spike can be traced to whatever caused it. */
        CREATE TABLE IF NOT EXISTS yt_quota_usage (
          date TEXT PRIMARY KEY,
          units_consumed INTEGER NOT NULL DEFAULT 0,
          calls_json TEXT NOT NULL DEFAULT '{}'
        );

        /* Audit findings are persisted rather than recomputed on every view:
           they are the input to "create a task from this", and a finding whose
           id changed between renders could not be actioned. */
        CREATE TABLE IF NOT EXISTS yt_audit_findings (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          video_id TEXT,
          severity TEXT NOT NULL DEFAULT 'info',
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '{}',
          recommendation TEXT NOT NULL,
          /* Set when the sample behind a finding is too small to trust. */
          low_confidence INTEGER NOT NULL DEFAULT 0,
          generated_at INTEGER NOT NULL,
          dismissed_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_yt_findings_kind ON yt_audit_findings(kind);
        CREATE INDEX IF NOT EXISTS idx_yt_findings_generated ON yt_audit_findings(generated_at DESC);
      `)
    },
  },
]

/** Applies every migration newer than the database's recorded `user_version`. */
export function runMigrations(db: Database.Database): { from: number; to: number; applied: string[] } {
  const from = (db.pragma('user_version', { simple: true }) as number) ?? 0
  const applied: string[] = []

  assertMigrationsWellFormed()

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue

    // better-sqlite3's transaction() wrapper can't contain the PRAGMA (it isn't
    // a statement it will prepare), so drive BEGIN/COMMIT directly and bump
    // user_version inside the same transaction as the DDL. A crash mid-migration
    // then rolls back both, and the next boot retries from a clean state.
    db.exec('BEGIN')
    try {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`
      )
    }

    applied.push(`${migration.version}:${migration.name}`)
  }

  const to = (db.pragma('user_version', { simple: true }) as number) ?? 0
  return { from, to, applied }
}

/**
 * Catches the two mistakes that corrupt a forward-only runner — a duplicated or
 * out-of-order version number, and a gap. Both would cause migrations to be
 * skipped on some databases and applied on others.
 */
function assertMigrationsWellFormed(): void {
  MIGRATIONS.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `Migration list is malformed: entry at index ${i} has version ${m.version}, expected ${i + 1}. ` +
          'Migrations must be contiguous from 1 and in array order.'
      )
    }
  })
}

/** Current schema version — the highest migration this build knows about. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length
