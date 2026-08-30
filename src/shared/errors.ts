/**
 * The error log's vocabulary: every subsystem allowed to record a failure.
 *
 * This list is the single source of truth for four things that must agree or
 * the log silently breaks:
 *
 *   1. the `CHECK (source IN (...))` constraint on `app_errors` (migration 13)
 *   2. the {@link ErrorSource} type the recorder accepts
 *   3. the zod enums the `devtools.listErrors` / `devtools.clearErrors`
 *      capabilities validate against
 *   4. the filter chips in ErrorsView
 *
 * They used to be four hand-maintained copies of the same six strings. Adding a
 * seventh meant editing four files and finding out you missed one at runtime,
 * when a write hit the CHECK constraint and was swallowed by the recorder's
 * never-throw guarantee — i.e. the error about the error vanished too. Adding a
 * source is now one line here.
 *
 * This module must stay dependency-free. It is imported by the main-process
 * recorder, which `architecture.test.ts` pins as a leaf.
 */

/** Sources belonging to the Dev Tools tab, each one a sub-section of it. */
export const DEVTOOLS_ERROR_SOURCES = [
  'scanner',
  'localhost',
  'shell',
  'organizer',
  'vault',
  'github',
] as const;

/**
 * Sources from the rest of the app.
 *
 * A source earns its place here by having failures that are otherwise *lost* —
 * shown once in a toast, folded into a job's `disabledReason`, or caught and
 * turned into a fallback nobody sees. Sources whose failures are already
 * durable and visible elsewhere do not belong; this log is for what would
 * otherwise have no record.
 *
 * `fileops`, `files` and `voiceauth` are registered but deliberately have no
 * write sites yet. A path-guard denial is the guard *working*, and logging
 * every one would bury the failures this table exists to surface. They are
 * listed so that the first genuine dropped failure in one of them is a
 * one-line change rather than another migration.
 */
export const APP_ERROR_SOURCES = [
  'jobs',
  'youtube',
  'google',
  'llm',
  'voice',
  'fileops',
  'files',
  'voiceauth',
] as const;

export const ERROR_SOURCES = [...DEVTOOLS_ERROR_SOURCES, ...APP_ERROR_SOURCES] as const;

export type DevToolsErrorSource = (typeof DEVTOOLS_ERROR_SOURCES)[number];
export type AppErrorSource = (typeof APP_ERROR_SOURCES)[number];
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_SEVERITIES = ['warning', 'error', 'fatal'] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

/**
 * How each source names itself in the UI.
 *
 * Only the ones whose identifier is not already the label appear here; the view
 * falls back to the raw source, so a newly added source renders sensibly before
 * anyone writes it a label.
 */
export const ERROR_SOURCE_LABELS: Partial<Record<ErrorSource, string>> = {
  localhost: 'Localhost',
  github: 'GitHub',
  youtube: 'YouTube',
  google: 'Google',
  llm: 'LLM',
  jobs: 'Automations',
  voiceauth: 'Voice Auth',
  fileops: 'File Ops',
};

export function errorSourceLabel(source: string): string {
  return (
    ERROR_SOURCE_LABELS[source as ErrorSource] ?? source.charAt(0).toUpperCase() + source.slice(1)
  );
}

/** True when the source is one of the Dev Tools sub-sections. */
export function isDevToolsSource(source: string): source is DevToolsErrorSource {
  return (DEVTOOLS_ERROR_SOURCES as readonly string[]).includes(source);
}
