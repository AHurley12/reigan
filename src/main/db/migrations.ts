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

  {
    // Was version 5 on the devtools branch, which collided with
    // youtube-channel-manager above. Renumbered on merge rather than
    // reordered: version 5 had already been published as the YouTube schema,
    // and a forward-only runner skips anything at or below a database's
    // recorded user_version. Slotting this in at 5 would have meant every
    // database already carrying the YouTube tables silently never created
    // capability_audit. Appending is the only resolution that leaves both
    // migration paths intact.
    version: 6,
    name: 'capability-audit-log',
    // The `approvals` table records decisions, which is not the same as
    // recording actions: a read capability, or a write the user has pre-approved,
    // leaves no trace there at all. This logs *every* dispatch, so "what did the
    // assistant actually do" has an answer that does not depend on whether the
    // action happened to need a prompt.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS capability_audit (
          id TEXT PRIMARY KEY,
          capability_id TEXT NOT NULL,
          /* 'ui' | 'agent' | 'job' — who initiated, not who owns the app. */
          invoked_by TEXT NOT NULL,
          args_json TEXT,
          outcome TEXT NOT NULL
            CHECK (outcome IN ('ok', 'error', 'denied', 'awaiting_approval')),
          error_code TEXT,
          error TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          invoked_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cap_audit_time ON capability_audit(invoked_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cap_audit_cap ON capability_audit(capability_id, invoked_at DESC);
      `)
    },
  },

  {
    version: 7,
    name: 'devtools-project-scanner',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          /* active <=14d, warm 15-60, dormant 61-180, abandoned 180+ */
          status TEXT NOT NULL DEFAULT 'dormant'
            CHECK (status IN ('active', 'warm', 'dormant', 'abandoned')),
          primary_language TEXT,
          languages_json TEXT NOT NULL DEFAULT '{}',
          frameworks_json TEXT NOT NULL DEFAULT '[]',
          package_manager TEXT,
          last_modified INTEGER,
          last_commit_at INTEGER,
          branch TEXT,
          is_dirty INTEGER NOT NULL DEFAULT 0,
          unpushed_count INTEGER NOT NULL DEFAULT 0,
          readme_status TEXT NOT NULL DEFAULT 'missing'
            CHECK (readme_status IN ('exists', 'missing', 'stub')),
          loc INTEGER NOT NULL DEFAULT 0,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          size_bytes_no_deps INTEGER NOT NULL DEFAULT 0,
          has_tests INTEGER NOT NULL DEFAULT 0,
          remote_url TEXT,
          github_repo_id TEXT,
          first_seen INTEGER NOT NULL,
          last_scanned INTEGER NOT NULL,
          notes TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_projects_modified ON projects(last_modified DESC);
        CREATE INDEX IF NOT EXISTS idx_projects_remote ON projects(remote_url);

        CREATE TABLE IF NOT EXISTS scan_runs (
          id TEXT PRIMARY KEY,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          roots_json TEXT NOT NULL DEFAULT '[]',
          dirs_walked INTEGER NOT NULL DEFAULT 0,
          projects_found INTEGER NOT NULL DEFAULT 0,
          error TEXT
        );

        /* Incremental rescan: skip a tree whose root mtime has not moved. */
        CREATE TABLE IF NOT EXISTS scan_root_state (
          root TEXT PRIMARY KEY,
          last_mtime INTEGER NOT NULL DEFAULT 0,
          last_scanned INTEGER NOT NULL DEFAULT 0
        );
      `)
    },
  },

  {
    version: 8,
    name: 'devtools-github',
    // Cached wholesale so every UI read is local and the tab works offline.
    // `synced_at` per row is what makes a conditional (ETag) refresh meaningful.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS github_repos (
          id TEXT PRIMARY KEY,
          full_name TEXT NOT NULL,
          name TEXT NOT NULL,
          private INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          default_branch TEXT,
          language TEXT,
          pushed_at INTEGER,
          open_issues INTEGER NOT NULL DEFAULT 0,
          stars INTEGER NOT NULL DEFAULT 0,
          forks INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          license TEXT,
          topics_json TEXT NOT NULL DEFAULT '[]',
          html_url TEXT,
          clone_url TEXT,
          local_project_id TEXT,
          synced_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_gh_repos_pushed ON github_repos(pushed_at DESC);

        CREATE TABLE IF NOT EXISTS github_issues (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          number INTEGER NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('issue', 'pr')),
          title TEXT NOT NULL,
          state TEXT NOT NULL,
          labels_json TEXT NOT NULL DEFAULT '[]',
          assignee TEXT,
          author TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          url TEXT,
          ci_status TEXT,
          review_state TEXT,
          draft INTEGER NOT NULL DEFAULT 0,
          synced_at INTEGER,
          FOREIGN KEY (repo_id) REFERENCES github_repos(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_gh_issues_repo ON github_issues(repo_id, state);
        CREATE INDEX IF NOT EXISTS idx_gh_issues_updated ON github_issues(updated_at DESC);

        CREATE TABLE IF NOT EXISTS github_commits (
          sha TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          message TEXT,
          author TEXT,
          committed_at INTEGER,
          additions INTEGER,
          deletions INTEGER,
          FOREIGN KEY (repo_id) REFERENCES github_repos(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_gh_commits_repo ON github_commits(repo_id, committed_at DESC);

        /* ETag store for conditional requests — an unchanged resource costs
           zero rate-limit quota, which is the difference between syncing
           hourly and burning the 5000/hr budget by lunchtime. */
        CREATE TABLE IF NOT EXISTS github_etags (
          url TEXT PRIMARY KEY,
          etag TEXT NOT NULL,
          fetched_at INTEGER NOT NULL
        );
      `)
    },
  },

  {
    version: 9,
    name: 'devtools-organizer',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizer_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          scope_path TEXT NOT NULL,
          recursive INTEGER NOT NULL DEFAULT 1,
          conditions_json TEXT NOT NULL DEFAULT '[]',
          actions_json TEXT NOT NULL DEFAULT '[]',
          schedule TEXT NOT NULL DEFAULT 'manual',
          last_run_at INTEGER,
          files_affected_total INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS organizer_runs (
          id TEXT PRIMARY KEY,
          rule_id TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'execute')),
          ops_planned INTEGER NOT NULL DEFAULT 0,
          ops_executed INTEGER NOT NULL DEFAULT 0,
          bytes_moved INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          error TEXT
        );

        /* The undo journal. One row per executed op, holding enough to reverse
           it. The checksum is what makes undo verifiable rather than hopeful —
           a restored file is compared by hash, not by filename. */
        CREATE TABLE IF NOT EXISTS organizer_journal (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          op_type TEXT NOT NULL,
          source_path TEXT NOT NULL,
          dest_path TEXT,
          executed_at INTEGER NOT NULL,
          reversed_at INTEGER,
          checksum TEXT,
          FOREIGN KEY (run_id) REFERENCES organizer_runs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_org_journal_run ON organizer_journal(run_id);

        /* Named organizer_file_index, not file_index: a files_index table
           already exists for the read-only Files tab and the two are
           unrelated. One character of difference between two table names is a
           bug waiting to happen. */
        CREATE TABLE IF NOT EXISTS organizer_file_index (
          path TEXT PRIMARY KEY,
          size INTEGER NOT NULL DEFAULT 0,
          mtime INTEGER NOT NULL DEFAULT 0,
          hash TEXT,
          phash TEXT,
          mime_family TEXT,
          indexed_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_org_files_size ON organizer_file_index(size);
        CREATE INDEX IF NOT EXISTS idx_org_files_hash ON organizer_file_index(hash);
      `)
    },
  },

  {
    version: 10,
    name: 'devtools-shell',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS shell_history (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          command TEXT NOT NULL,
          cwd TEXT NOT NULL,
          classification TEXT NOT NULL
            CHECK (classification IN ('allow', 'approval', 'block')),
          approved_by TEXT,
          exit_code INTEGER,
          duration_ms INTEGER,
          output_excerpt TEXT,
          ran_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_shell_hist_time ON shell_history(ran_at DESC);

        /* User-editable overrides layered on top of the built-in lists. */
        CREATE TABLE IF NOT EXISTS shell_rules (
          id TEXT PRIMARY KEY,
          pattern TEXT NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('allow', 'approval', 'block')),
          is_regex INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          created_at INTEGER NOT NULL
        );
      `)
    },
  },

  {
    version: 11,
    name: 'devtools-vault',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS snippets (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          language TEXT,
          body TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          is_secret INTEGER NOT NULL DEFAULT 0,
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          source_project_id TEXT
        );

        CREATE TABLE IF NOT EXISTS snippet_versions (
          id TEXT PRIMARY KEY,
          snippet_id TEXT NOT NULL,
          body TEXT NOT NULL,
          saved_at INTEGER NOT NULL,
          FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_snippet_versions ON snippet_versions(snippet_id, saved_at DESC);

        CREATE TABLE IF NOT EXISTS config_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          fields_json TEXT NOT NULL DEFAULT '[]',
          body TEXT NOT NULL DEFAULT '',
          is_secret INTEGER NOT NULL DEFAULT 0,
          builtin INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        /* Metadata only. Secret bodies are deliberately absent from the index:
           an FTS table stores its input verbatim, so indexing a secret body
           would write the plaintext back to disk in a second place, undoing
           the encryption it is stored with. */
        CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
          title, description, tags, body, tokenize='unicode61'
        );
      `)
    },
  },

  {
    version: 12,
    name: 'devtools-error-log',
    // `capability_audit` records dispatches, which only sees a failure that
    // propagates all the way out of a handler. The Dev Tools features fail
    // *partially* far more often than they fail outright: a scan walks
    // thousands of directories and hits a dozen EACCES, an organiser run
    // executes 197 of 200 ops, a port probe times out on one port. Those never
    // reach the dispatch boundary — execute.ts collects them into a local
    // array that is returned and then dropped — so nothing durable remembers
    // them. This is that record.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS devtools_errors (
          id TEXT PRIMARY KEY,
          feature TEXT NOT NULL
            CHECK (feature IN ('scanner', 'localhost', 'shell', 'organizer', 'vault', 'github')),
          /* The specific step, e.g. 'executeOp' — narrower than the feature so
             a failing step is identifiable without reading the message. */
          operation TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'error'
            CHECK (severity IN ('warning', 'error', 'fatal')),
          message TEXT NOT NULL,
          /* errno-style code where the platform gave one (EACCES, EXDEV). */
          code TEXT,
          /* What the failure was about: a path, a port, a command. */
          subject TEXT,
          context_json TEXT NOT NULL DEFAULT '{}',
          stack TEXT,
          /* Identical failures collapse onto one row and increment
             occurrences. A scan denied on one protected tree would otherwise
             write hundreds of rows that say the same thing and push every
             other error out of the retention window. */
          fingerprint TEXT NOT NULL,
          occurrences INTEGER NOT NULL DEFAULT 1,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_devtools_errors_fingerprint
          ON devtools_errors(fingerprint);
        CREATE INDEX IF NOT EXISTS idx_devtools_errors_seen
          ON devtools_errors(last_seen DESC);
        CREATE INDEX IF NOT EXISTS idx_devtools_errors_feature
          ON devtools_errors(feature, last_seen DESC);
      `)
    },
  },

  {
    version: 13,
    name: 'app-wide-error-log',
    // Migration 12 built this table for the Dev Tools tab alone, and its CHECK
    // constraint says so. But the failures that actually reach a user are not
    // confined to that tab: a scheduled job that fails four times in a row is
    // auto-disabled and explains itself in a notification and a `disabled_reason`
    // string, and `job_runs` — the only durable record — is pruned at 90 days
    // and is `ON DELETE CASCADE` from `jobs`. Delete the automation and its
    // entire failure history goes with it. Same shape of hole for a Google token
    // refresh, an LLM call, a TTS request: shown once, then gone.
    //
    // So the table stops being the Dev Tools log and becomes the app's log.
    // `feature` was always the wrong noun for that and is renamed `source`.
    //
    // SQLite cannot ALTER a CHECK constraint, so this is the 12-step table
    // rebuild rather than an ALTER. Rows carry over unchanged: every existing
    // value is still a valid source.
    //
    // The source list below is deliberately a hardcoded literal and NOT derived
    // from shared/errors.ts. A migration is history — if this read the live
    // constant, adding a source later would widen the CHECK on fresh databases
    // while every already-migrated database kept the old one, and the resulting
    // write failure is swallowed by the recorder's never-throw guarantee. New
    // sources need their own migration; `errorLog.test.ts` fails loudly if the
    // constant and the schema drift apart.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_errors (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL
            CHECK (source IN ('scanner', 'localhost', 'shell', 'organizer', 'vault', 'github',
                              'jobs', 'youtube', 'google', 'llm', 'voice',
                              'fileops', 'files', 'voiceauth')),
          /* The specific step, e.g. 'executeOp' — narrower than the source so
             a failing step is identifiable without reading the message. */
          operation TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'error'
            CHECK (severity IN ('warning', 'error', 'fatal')),
          message TEXT NOT NULL,
          /* errno-style code where the platform gave one (EACCES, EXDEV). */
          code TEXT,
          /* What the failure was about: a path, a port, a command, a job name. */
          subject TEXT,
          context_json TEXT NOT NULL DEFAULT '{}',
          stack TEXT,
          /* Identical failures collapse onto one row and increment
             occurrences. A scan denied on one protected tree would otherwise
             write hundreds of rows that say the same thing and push every
             other error out of the retention window. */
          fingerprint TEXT NOT NULL,
          occurrences INTEGER NOT NULL DEFAULT 1,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL
        );
      `)

      // Guarded rather than unconditional: `migrations.test.ts` rewinds
      // `user_version` and replays the whole list against an already-migrated
      // database, so every migration here has to survive being run twice. The
      // copy is the one step that cannot be expressed with IF NOT EXISTS.
      const legacy = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devtools_errors'`)
        .get()

      if (legacy) {
        db.exec(`
          INSERT OR IGNORE INTO app_errors
            (id, source, operation, severity, message, code, subject,
             context_json, stack, fingerprint, occurrences, first_seen, last_seen)
          SELECT
             id, feature, operation, severity, message, code, subject,
             context_json, stack, fingerprint, occurrences, first_seen, last_seen
          FROM devtools_errors;

          DROP TABLE devtools_errors;
        `)
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_errors_fingerprint
          ON app_errors(fingerprint);
        CREATE INDEX IF NOT EXISTS idx_app_errors_seen
          ON app_errors(last_seen DESC);
        CREATE INDEX IF NOT EXISTS idx_app_errors_source
          ON app_errors(source, last_seen DESC);
      `)
    },
  },

  {
    version: 14,
    name: 'yt-daily-engagement',
    // `yt_daily_stats` recorded reach (views, watch time, subscribers) but not
    // engagement: likes and comments existed only as the *lifetime* totals on
    // `yt_videos`, which are a running count and cannot be differenced into a
    // series. So there was no way to answer "did that upload get more comments
    // than usual", only "how many comments does it have in total, ever".
    //
    // Both metrics come back from the same Analytics `day` report the other
    // columns already use — same call, same quota, two more values in the
    // metrics list — so this costs nothing at sync time.
    //
    // Backfill is deliberately NOT attempted here. Existing rows keep the 0
    // default and stay honest about it: the daily figures were never fetched,
    // and the lifetime totals cannot be attributed to the days they happened
    // on. They fill in from the next full sync onward.
    up: (db) => {
      addColumnIfMissing(db, 'yt_daily_stats', 'likes', 'INTEGER NOT NULL DEFAULT 0')
      addColumnIfMissing(db, 'yt_daily_stats', 'comments', 'INTEGER NOT NULL DEFAULT 0')
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
