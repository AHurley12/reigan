import { execFile } from 'child_process'
import { promisify } from 'util'
import { getDatabase } from '../../db/database'
import { recordAppError } from '../../errors/errorLog'

const execFileAsync = promisify(execFile)

/**
 * Listening-port inventory, joined to the user's own projects.
 *
 * "node.exe is listening on 3000" is not useful information — the user knows
 * something is on 3000, that is why they are looking. The value of this
 * feature is entirely in the join: resolving that process back to
 * "REIGAN — Vite — C:\dev\reigan". Everything below exists to make that join
 * possible.
 */

export interface PortEntry {
  port: number
  pid: number
  processName: string
  executablePath: string | null
  commandLine: string | null
  startedAt: number | null
  memBytes: number | null
  /** Recognised dev-server flavour, e.g. 'Vite', 'Next.js', 'Postgres'. */
  signature: string | null
  projectName: string | null
  projectPath: string | null
  /** Populated only when the HTTP probe is enabled. */
  httpStatus: number | null
  httpTitle: string | null
  httpServer: string | null
}

const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
const PS_TIMEOUT_MS = 15000

async function powershell(script: string): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', [...PS_FLAGS, script], {
    timeout: PS_TIMEOUT_MS,
    // Port tables on a busy machine comfortably exceed the 1MB default.
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

function parseJsonArray<T>(raw: string): T[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    // ConvertTo-Json emits a bare object, not an array, for a single result.
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

interface RawConnection {
  LocalPort: number
  OwningProcess: number
}

/**
 * Listening TCP ports.
 *
 * Get-NetTCPConnection with JSON output rather than parsing netstat: netstat's
 * column text is localised, so on a non-English Windows the parse silently
 * yields nothing. netstat remains as a fallback for machines where the
 * NetTCPIP module is unavailable, accepting the localisation risk only when
 * the structured path has already failed.
 */
async function listListeningPorts(): Promise<RawConnection[]> {
  try {
    const out = await powershell(
      "Get-NetTCPConnection -State Listen -ErrorAction Stop | " +
        'Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress'
    )
    const rows = parseJsonArray<RawConnection>(out)
    if (rows.length > 0) return rows
  } catch {
    // Fall through to netstat.
  }
  return listListeningPortsViaNetstat()
}

async function listListeningPortsViaNetstat(): Promise<RawConnection[]> {
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], {
      timeout: PS_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    const rows: RawConnection[] = []
    for (const line of stdout.split(/\r?\n/)) {
      // Matches the address/port column and the trailing PID, without relying
      // on the localised state word between them.
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+\S+\s+(\d+)\s*$/.exec(line)
      if (!match) continue
      if (!/LISTEN/i.test(line)) continue
      rows.push({ LocalPort: Number(match[1]), OwningProcess: Number(match[2]) })
    }
    return rows
  } catch {
    return []
  }
}

interface RawProcess {
  ProcessId: number
  Name: string
  ExecutablePath: string | null
  CommandLine: string | null
  CreationDate: string | null
  WorkingSetSize: number | null
}

async function listProcesses(pids: number[]): Promise<Map<number, RawProcess>> {
  const map = new Map<number, RawProcess>()
  if (pids.length === 0) return map

  // Filtering server-side keeps the payload proportional to the number of
  // listening processes rather than every process on the machine.
  const filter = pids.map((p) => `ProcessId=${p}`).join(' or ')
  try {
    const out = await powershell(
      `Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction Stop | ` +
        'Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate,WorkingSetSize | ' +
        'ConvertTo-Json -Compress'
    )
    for (const row of parseJsonArray<RawProcess>(out)) {
      map.set(row.ProcessId, row)
    }
  } catch (err) {
    // Leaves entries with just a port and pid, which still renders — so the
    // panel looks merely unhelpful rather than broken, and nobody would think
    // to report it. Logged as a warning for exactly that reason.
    recordAppError({
      source: 'localhost',
      operation: 'enrichProcesses',
      error: err,
      severity: 'warning',
      context: { consequence: 'ports listed without process name or path' },
    })
  }
  return map
}

/**
 * CIM returns either an ISO-ish string or a `/Date(…)/` wrapper depending on
 * how PowerShell serialised it.
 */
function parseCimDate(value: string | null): number | null {
  if (!value) return null
  const epoch = /\/Date\((\d+)\)\//.exec(value)
  if (epoch) return Number(epoch[1])
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Port-based hints, used only when the command line says nothing better. */
const PORT_SIGNATURES: Record<number, string> = {
  3000: 'Node dev server',
  3306: 'MySQL',
  5173: 'Vite',
  5432: 'Postgres',
  6379: 'Redis',
  8000: 'Python dev server',
  8080: 'HTTP server',
  1433: 'SQL Server',
  27017: 'MongoDB',
}

const CMDLINE_SIGNATURES: Array<[RegExp, string]> = [
  [/\bvite\b/i, 'Vite'],
  [/\bnext(\s|\/|\\)/i, 'Next.js'],
  [/react-scripts/i, 'Create React App'],
  [/webpack-dev-server/i, 'Webpack Dev Server'],
  [/\bnuxt\b/i, 'Nuxt'],
  [/\bastro\b/i, 'Astro'],
  [/electron/i, 'Electron'],
  [/uvicorn/i, 'Uvicorn'],
  [/gunicorn/i, 'Gunicorn'],
  [/flask/i, 'Flask'],
  [/manage\.py\s+runserver/i, 'Django'],
  [/\bnodemon\b/i, 'nodemon'],
  [/\bexpress\b/i, 'Express'],
  [/docker/i, 'Docker'],
  [/postgres/i, 'Postgres'],
  [/redis/i, 'Redis'],
  [/mongod/i, 'MongoDB'],
]

function detectSignature(port: number, commandLine: string | null, processName: string): string | null {
  if (commandLine) {
    for (const [re, label] of CMDLINE_SIGNATURES) {
      if (re.test(commandLine)) return label
    }
  }
  for (const [re, label] of CMDLINE_SIGNATURES) {
    if (re.test(processName)) return label
  }
  return PORT_SIGNATURES[port] ?? null
}

/**
 * Matches a process back to an indexed project by looking for a project path
 * inside its command line.
 *
 * Longest path wins, so a nested project is preferred over the parent that
 * also happens to be a prefix of the same command line.
 */
function resolveProjectForCommandLine(
  commandLine: string | null,
  projects: Array<{ name: string; path: string }>
): { name: string; path: string } | null {
  if (!commandLine) return null
  const haystack = commandLine.replace(/\//g, '\\').toLowerCase()

  let best: { name: string; path: string } | null = null
  for (const project of projects) {
    const needle = project.path.replace(/\//g, '\\').toLowerCase()
    if (!haystack.includes(needle)) continue
    if (!best || needle.length > best.path.length) best = project
  }
  return best
}

async function probeHttp(port: number): Promise<Pick<PortEntry, 'httpStatus' | 'httpTitle' | 'httpServer'>> {
  const empty = { httpStatus: null, httpTitle: null, httpServer: null }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1000)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: controller.signal,
        redirect: 'manual',
      })
      const server =
        response.headers.get('server') ?? response.headers.get('x-powered-by') ?? null

      let title: string | null = null
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        const body = (await response.text()).slice(0, 4096)
        title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(body)?.[1]?.trim() ?? null
      }
      return { httpStatus: response.status, httpTitle: title, httpServer: server }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Not HTTP, or it refused to answer in a second. Both are ordinary for a
    // database or a socket server, so this is not an error worth surfacing.
    return empty
  }
}

export async function scanPorts(options: { probeHttp?: boolean } = {}): Promise<PortEntry[]> {
  const connections = await listListeningPorts()

  // One row per port; a process listening on both IPv4 and IPv6 appears twice
  // in the raw table and would otherwise be shown twice.
  const byPort = new Map<number, RawConnection>()
  for (const c of connections) {
    if (!byPort.has(c.LocalPort)) byPort.set(c.LocalPort, c)
  }

  const processes = await listProcesses([...new Set([...byPort.values()].map((c) => c.OwningProcess))])
  const projects = getDatabase()
    .prepare('SELECT name, path FROM projects')
    .all() as Array<{ name: string; path: string }>

  const entries: PortEntry[] = []
  for (const [port, conn] of byPort) {
    const proc = processes.get(conn.OwningProcess)
    const commandLine = proc?.CommandLine ?? null
    const matched = resolveProjectForCommandLine(commandLine, projects)

    entries.push({
      port,
      pid: conn.OwningProcess,
      processName: proc?.Name ?? 'unknown',
      executablePath: proc?.ExecutablePath ?? null,
      commandLine,
      startedAt: parseCimDate(proc?.CreationDate ?? null),
      memBytes: proc?.WorkingSetSize ?? null,
      signature: detectSignature(port, commandLine, proc?.Name ?? ''),
      projectName: matched?.name ?? null,
      projectPath: matched?.path ?? null,
      httpStatus: null,
      httpTitle: null,
      httpServer: null,
    })
  }

  if (options.probeHttp) {
    // Concurrently — each probe already has its own 1s ceiling, and doing
    // thirty of them in series would take longer than the whole scan.
    await Promise.all(
      entries.map(async (entry) => {
        Object.assign(entry, await probeHttp(entry.port))
      })
    )
  }

  return entries.sort((a, b) => a.port - b.port)
}

/**
 * Executables that must never be killed from here.
 *
 * Checked by resolved path rather than by name so a user process called
 * `svchost.exe` sitting in a project folder is not protected by its name, and
 * — more importantly — so nothing under System32 can be terminated by asking
 * for it under a different name.
 */
export function isProtectedExecutable(executablePath: string | null): boolean {
  if (!executablePath) {
    // Unknown path means the process is almost certainly running at higher
    // privilege than we are. Refusing is the safe reading of that.
    return true
  }
  const normalised = executablePath.replace(/\//g, '\\').toLowerCase()
  return (
    normalised.startsWith('c:\\windows\\') ||
    normalised.startsWith('c:\\program files\\windowsapps\\') ||
    normalised.includes('\\system32\\') ||
    normalised.includes('\\syswow64\\')
  )
}

export async function killProcess(pid: number): Promise<void> {
  await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    timeout: PS_TIMEOUT_MS,
    windowsHide: true,
  })
}
