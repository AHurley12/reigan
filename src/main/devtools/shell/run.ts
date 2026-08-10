import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app } from 'electron'
import { getDatabase } from '../../db/database'
import { recordDevToolsError } from '../errorLog'
import type { Tier, UserRule } from './classify'

/**
 * One-shot command execution.
 *
 * Deliberately *not* an interactive terminal. node-pty cannot be built on this
 * machine (no MSVC toolchain), so xterm.js-backed sessions are absent; see
 * docs/CAPABILITIES.md. Everything the agent needs — run a command, capture
 * its output, know whether it worked — is served by this, and the safety
 * classification that matters is identical either way.
 */

export const DEFAULT_TIMEOUT_MS = 60_000
export const MAX_TIMEOUT_MS = 600_000

/**
 * Output beyond this is truncated with a note.
 *
 * A runaway `npm install --verbose` produces megabytes. Unbounded, that lands
 * in the model's context window and evicts the conversation that prompted it.
 */
export const OUTPUT_CAP_BYTES = 100 * 1024

export interface RunResult {
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  durationMs: number
  timedOut: boolean
}

/** PowerShell 7 if installed, else Windows PowerShell, else cmd. */
export function resolveShell(): { file: string; argsFor: (command: string) => string[] } {
  const pwsh = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
  ].find((p) => existsSync(p))

  if (pwsh) {
    return {
      file: pwsh,
      argsFor: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
    }
  }

  const windowsPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  if (existsSync(windowsPowerShell)) {
    return {
      file: windowsPowerShell,
      argsFor: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
    }
  }

  return { file: 'cmd.exe', argsFor: (command) => ['/d', '/s', '/c', command] }
}

function capture(cap: number): { push: (chunk: string) => void; text: () => string; truncated: boolean } {
  let text = ''
  let truncated = false
  return {
    push(chunk) {
      if (truncated) return
      const remaining = cap - text.length
      if (chunk.length <= remaining) {
        text += chunk
        return
      }
      text += chunk.slice(0, Math.max(0, remaining))
      truncated = true
    },
    text: () => text,
    get truncated() {
      return truncated
    },
  } as { push: (chunk: string) => void; text: () => string; truncated: boolean }
}

export function runCommand(params: {
  command: string
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<RunResult> {
  const cwd = params.cwd && existsSync(params.cwd) ? params.cwd : app.getPath('home')
  const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const { file, argsFor } = resolveShell()
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    // `shell: false` with an explicit interpreter: the command string is
    // handed to PowerShell as a single -Command argument rather than being
    // re-parsed by a second shell layer, so what runs is exactly what was
    // classified.
    const child = spawn(file, argsFor(params.command), {
      cwd,
      windowsHide: true,
      shell: false,
    })

    const stdout = capture(OUTPUT_CAP_BYTES)
    const stderr = capture(OUTPUT_CAP_BYTES)
    let timedOut = false
    let settled = false

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', onAbort)
      resolve({
        command: params.command,
        cwd,
        exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        truncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - startedAt,
        timedOut,
      })
    }

    const kill = (): void => {
      // /T kills the process tree. Killing only the shell would leave the
      // actual long-running child (a dev server, a compiler) orphaned and
      // still holding the port or the file lock the timeout was meant to free.
      if (child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
      // Resolve rather than reject: a timeout is a real outcome with real
      // partial output, and the model should be told what it managed to
      // produce rather than only that it failed.
      setTimeout(() => finish(null), 250)
    }, timeoutMs)

    const onAbort = (): void => {
      kill()
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(Object.assign(new Error('Command cancelled.'), { name: 'AbortError' }))
      }
    }
    params.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (d: Buffer) => stdout.push(d.toString('utf-8')))
    child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString('utf-8')))
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => finish(code))
  })
}

export function loadUserRules(): UserRule[] {
  try {
    const rows = getDatabase()
      .prepare('SELECT pattern, tier, is_regex FROM shell_rules')
      .all() as Array<{ pattern: string; tier: Tier; is_regex: number }>
    return rows.map((r) => ({ pattern: r.pattern, tier: r.tier, isRegex: !!r.is_regex }))
  } catch (err) {
    // Returning [] falls back to the built-in lists, which is the safe
    // direction for `allow` rules but silently discards the user's `block`
    // ones — a command they had explicitly forbidden would be classified on
    // built-ins alone and could run. Never let that happen quietly.
    recordDevToolsError({
      feature: 'shell',
      operation: 'loadUserRules',
      error: err,
      severity: 'fatal',
      context: { consequence: 'user shell rules ignored; built-in classification only' },
    })
    return []
  }
}

export function recordHistory(params: {
  command: string
  cwd: string
  classification: Tier
  approvedBy: string | null
  exitCode: number | null
  durationMs: number
  output: string
}): void {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO shell_history
           (id, session_id, command, cwd, classification, approved_by, exit_code, duration_ms, output_excerpt, ran_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        params.command,
        params.cwd,
        params.classification,
        params.approvedBy,
        params.exitCode,
        Math.round(params.durationMs),
        params.output.slice(0, 4000),
        Date.now()
      )
  } catch {
    // History is a convenience; losing a row must not fail the command.
  }
}

export interface HistoryRow {
  id: string
  command: string
  cwd: string
  classification: Tier
  exitCode: number | null
  durationMs: number | null
  outputExcerpt: string | null
  ranAt: number
}

export function listHistory(limit = 100): HistoryRow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM shell_history ORDER BY ran_at DESC LIMIT ?')
    .all(Math.min(limit, 500)) as any[]
  return rows.map((r) => ({
    id: r.id,
    command: r.command,
    cwd: r.cwd,
    classification: r.classification,
    exitCode: r.exit_code ?? null,
    durationMs: r.duration_ms ?? null,
    outputExcerpt: r.output_excerpt ?? null,
    ranAt: r.ran_at,
  }))
}
