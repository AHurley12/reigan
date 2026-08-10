import { z } from 'zod'
import { shell } from 'electron'
import { isProtectedExecutable, killProcess, scanPorts, type PortEntry } from '../../devtools/localhost/scan'
import { CapabilityError, type AnyCapability } from '../types'

function uptime(startedAt: number | null): string {
  if (!startedAt) return 'unknown uptime'
  const mins = Math.floor((Date.now() - startedAt) / 60000)
  if (mins < 1) return 'just started'
  if (mins < 60) return `up ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `up ${hours}h ${mins % 60}m`
  return `up ${Math.floor(hours / 24)}d`
}

function describePort(p: PortEntry): string {
  // Leads with the project when we know it — the whole point of the feature
  // is answering "what is this?", and the process name rarely does.
  const who = p.projectName
    ? `${p.projectName}${p.signature ? ` — ${p.signature}` : ''}`
    : p.signature ?? p.processName

  const bits = [`pid ${p.pid}`, uptime(p.startedAt)]
  if (p.memBytes) bits.push(`${(p.memBytes / 1048576).toFixed(0)} MB`)
  if (p.httpStatus) bits.push(`HTTP ${p.httpStatus}${p.httpTitle ? ` "${p.httpTitle}"` : ''}`)

  const where = p.projectPath ? `\n    ${p.projectPath}` : ''
  return `${p.port} — ${who} (${bits.join(', ')})${where}`
}

export const localhostCapabilities: AnyCapability[] = [
  {
    id: 'localhost.scan',
    title: 'List listening ports',
    description:
      "List every TCP port currently listening on this machine, with the process that owns it and — where it can be worked out — which of the user's projects it belongs to. Use for 'what's running on my ports', 'what's on 3000', or to find an orphaned dev server. Read-only.",
    risk: 'read',
    schema: z.object({
      probeHttp: z
        .boolean()
        .optional()
        .describe(
          'Also make a 1-second HTTP request to each port to capture status, Server header and page title. Off by default because some dev servers log noisily on every request.'
        ),
    }),
    handler: async (args: { probeHttp?: boolean }) => ({
      ports: await scanPorts({ probeHttp: args.probeHttp }),
    }),
    formatResult: (r: { ports: PortEntry[] }) => {
      if (r.ports.length === 0) return 'Nothing is listening on any TCP port.'
      const resolved = r.ports.filter((p) => p.projectName).length
      const header = `${r.ports.length} listening port(s)${resolved ? `, ${resolved} matched to a known project` : ''}:`
      return `${header}\n${r.ports.map((p) => `  • ${describePort(p)}`).join('\n')}`
    },
  },

  {
    id: 'localhost.getPort',
    title: 'Inspect one port',
    description:
      'Details for a single listening port: owning process, executable, full command line, uptime, memory, and the project it resolves to. Use when the user asks what specifically is on a given port.',
    risk: 'read',
    schema: z.object({
      port: z.number().int().min(1).max(65535),
      probeHttp: z.boolean().optional(),
    }),
    handler: async (args: { port: number; probeHttp?: boolean }) => {
      const ports = await scanPorts({ probeHttp: args.probeHttp })
      const match = ports.find((p) => p.port === args.port)
      if (!match) {
        throw new CapabilityError(`Nothing is listening on port ${args.port}.`, 'not_found')
      }
      return match
    },
    formatResult: (p: PortEntry) =>
      [
        describePort(p),
        p.executablePath ? `Executable: ${p.executablePath}` : null,
        p.commandLine ? `Command: ${p.commandLine.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
  },

  {
    id: 'localhost.openInBrowser',
    title: 'Open a port in the browser',
    description: "Open http://localhost:<port> in the user's default browser.",
    risk: 'read',
    schema: z.object({ port: z.number().int().min(1).max(65535) }),
    handler: async (args: { port: number }) => {
      const url = `http://localhost:${args.port}`
      await shell.openExternal(url)
      return { url }
    },
    formatResult: (r: { url: string }) => `Opened ${r.url}.`,
  },

  {
    id: 'localhost.killProcess',
    title: 'Kill a process on a port',
    description:
      'Terminate the process listening on a port, and its children. Use for an orphaned dev server holding a port the user wants back. This cannot be undone — the process is force-killed, so unsaved state in it is lost. Refuses to touch anything running from a Windows system directory.',
    risk: 'destructive',
    schema: z.object({
      port: z.number().int().min(1).max(65535).describe('The port whose owning process should be killed.'),
    }),
    approval: {
      summary: (args: { port: number }) =>
        `Force-kill the process listening on port ${args.port}, including any child processes.`,
      // Resolved before the prompt is shown, so the card names the actual
      // process rather than a port number the user then has to go and identify
      // themselves — which is how people end up killing the wrong thing.
      diff: async (args: { port: number }) => {
        const ports = await scanPorts()
        const match = ports.find((p) => p.port === args.port)
        if (!match) return null
        return {
          subject: `Port ${args.port}`,
          changes: [
            { field: 'Process', before: `${match.processName} (pid ${match.pid})`, after: 'terminated' },
            { field: 'Project', before: match.projectName ?? 'unrecognised', after: null },
            { field: 'Running for', before: uptime(match.startedAt), after: null },
            { field: 'Executable', before: match.executablePath ?? 'unknown', after: null },
          ],
        }
      },
    },
    handler: async (args: { port: number }) => {
      const ports = await scanPorts()
      const match = ports.find((p) => p.port === args.port)
      if (!match) {
        throw new CapabilityError(`Nothing is listening on port ${args.port}.`, 'not_found')
      }
      if (isProtectedExecutable(match.executablePath)) {
        throw new CapabilityError(
          `Refusing to kill pid ${match.pid} (${match.processName}) — it runs from a Windows system location` +
            `${match.executablePath ? ` (${match.executablePath})` : ' that could not be determined'}. ` +
            'Killing system processes can take the machine down.',
          'denied'
        )
      }

      await killProcess(match.pid)
      return { port: args.port, pid: match.pid, processName: match.processName }
    },
    formatResult: (r: { port: number; pid: number; processName: string }) =>
      `Killed ${r.processName} (pid ${r.pid}); port ${r.port} is free.`,
  },
]
