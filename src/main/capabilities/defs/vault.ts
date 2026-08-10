import { z } from 'zod'
import { promises as fsp } from 'fs'
import { dirname } from 'path'
import { clipboard } from 'electron'
import { getGuardContext } from '../../fileops/allowlist'
import { guardPath } from '../../fileops/pathGuard'
import {
  createSnippet,
  getSnippet,
  markUsed,
  redact,
  searchSnippets,
  updateSnippet,
  type RedactedSnippet,
} from '../../devtools/vault/store'
import { getTemplate, listTemplates, renderTemplate, type ConfigTemplate } from '../../devtools/vault/templates'
import { CapabilityError, type AnyCapability } from '../types'

/**
 * Vault capabilities.
 *
 * The privacy rule, and why it is written into the tool descriptions: a
 * snippet marked secret is searchable and retrievable by the model as
 * *metadata*, but its body is replaced with a redaction notice. The value can
 * still be put on the clipboard or written to a file, because those paths run
 * entirely in the main process. Telling the model *why* it cannot see the
 * value stops it treating the redaction as an error and retrying.
 */

function describeSnippet(s: RedactedSnippet): string {
  const tags = s.tags.length ? ` [${s.tags.join(', ')}]` : ''
  const secret = s.isSecret ? ' (secret)' : ''
  return `${s.title}${secret}${tags}${s.description ? ` — ${s.description}` : ''}\n    id: ${s.id}`
}

export const vaultCapabilities: AnyCapability[] = [
  {
    id: 'vault.search',
    title: 'Search the snippet vault',
    description:
      "Search saved snippets and config fragments by title, description, tags, and — for non-secret snippets — body text. Snippets marked secret are found by their metadata but their contents are never returned to you; use vault.copyToClipboard or vault.writeToFile to put a secret value somewhere useful without it passing through this conversation. Call this whenever the user refers to a snippet they have saved.",
    risk: 'read',
    schema: z.object({
      query: z.string().optional().describe('Search text. Omit for the most recently used snippets.'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    handler: async (args: { query?: string; limit?: number }) => ({
      snippets: searchSnippets(args.query ?? '', args.limit ?? 25).map(redact),
    }),
    formatResult: (r: { snippets: RedactedSnippet[] }) =>
      r.snippets.length === 0
        ? 'No snippets matched.'
        : `${r.snippets.length} snippet(s):\n${r.snippets.map((s) => `  • ${describeSnippet(s)}`).join('\n')}`,
  },

  {
    id: 'vault.get',
    title: 'Get a snippet',
    description:
      'Retrieve one snippet by id. For a non-secret snippet this returns the full body, ready to use or adapt. For a secret snippet the body comes back redacted — that is deliberate, not a failure: the value exists and can be copied to the clipboard or written to a file, it simply never enters this conversation.',
    risk: 'read',
    schema: z.object({ id: z.string() }),
    handler: async (args: { id: string }) => {
      const snippet = getSnippet(args.id)
      if (!snippet) throw new CapabilityError(`No snippet with id ${args.id}.`, 'not_found')
      markUsed(snippet.id)
      return redact(snippet)
    },
    formatResult: (s: RedactedSnippet) =>
      `${s.title}${s.isSecret ? ' (secret)' : ''}${s.language ? ` — ${s.language}` : ''}\n\n${s.body}`,
  },

  {
    id: 'vault.create',
    title: 'Save a snippet',
    description:
      'Save a new snippet to the vault. Set isSecret when the body contains a credential, connection string or token — secret bodies are encrypted at rest, excluded from the search index, and never shown back to you afterwards.',
    risk: 'write',
    schema: z.object({
      title: z.string().min(1),
      body: z.string(),
      description: z.string().optional(),
      language: z.string().optional(),
      tags: z.array(z.string()).optional(),
      isSecret: z.boolean().optional(),
    }),
    approval: {
      summary: (args: { title: string; isSecret?: boolean }) =>
        `Save ${args.isSecret ? 'a secret ' : 'a '}snippet titled "${args.title}" to the vault.`,
    },
    handler: async (args: any) => redact(createSnippet(args)),
    formatResult: (s: RedactedSnippet) => `Saved "${s.title}" (id ${s.id}).`,
  },

  {
    id: 'vault.update',
    title: 'Update a snippet',
    description:
      'Change a snippet. The previous body is kept as a version (the last 20 are retained), so an edit is recoverable.',
    risk: 'write',
    schema: z.object({
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      description: z.string().optional(),
      language: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    approval: {
      summary: (args: { id: string }) => `Update snippet ${args.id}. The previous version is kept.`,
    },
    handler: async (args: any) => {
      const { id, ...updates } = args
      return redact(updateSnippet(id, updates))
    },
    formatResult: (s: RedactedSnippet) => `Updated "${s.title}".`,
  },

  {
    id: 'vault.listTemplates',
    title: 'List config templates',
    description:
      'List the available config templates and the fields each one needs. Ships with .env, .gitignore, tsconfig.json, ESLint+Prettier, a GitHub Actions Node CI workflow, and a Postgres+Redis docker-compose.',
    risk: 'read',
    schema: z.object({}),
    handler: async () => ({ templates: listTemplates() }),
    formatResult: (r: { templates: ConfigTemplate[] }) =>
      r.templates
        .map((t) => {
          const fields = t.fields.length
            ? t.fields.map((f) => `${f.name}${f.required ? '*' : ''}${f.isSecret ? ' (secret)' : ''}`).join(', ')
            : 'no fields'
          return `  • ${t.name} [${t.kind}] — ${fields}`
        })
        .join('\n'),
  },

  {
    id: 'vault.renderTemplate',
    title: 'Render a config template',
    description:
      'Fill a config template with values and return the result. Reports any required field left unfilled rather than producing a half-finished file. If the template has secret fields and you supply them, prefer writing straight to a file with vault.writeToFile so the value does not sit in the conversation.',
    risk: 'read',
    schema: z.object({
      template: z.string().describe('Template id or name.'),
      values: z.record(z.string()).optional(),
    }),
    handler: async (args: { template: string; values?: Record<string, string> }) => {
      const template = getTemplate(args.template)
      if (!template) throw new CapabilityError(`No template called "${args.template}".`, 'not_found')
      return { template: template.name, ...renderTemplate(template, args.values ?? {}) }
    },
    formatResult: (r: { template: string; body: string; missing: string[] }) =>
      (r.missing.length
        ? `Rendered "${r.template}", but these required fields were not supplied and are still placeholders: ${r.missing.join(', ')}.\n\n`
        : `Rendered "${r.template}".\n\n`) + r.body,
  },

  {
    id: 'vault.writeToFile',
    title: 'Write a snippet or template to a file',
    description:
      "Write a snippet's contents, or a rendered template, to a file on disk. This is how a secret value reaches a file without passing through the conversation. The target must be inside an allowlisted managed root, and overwriting an existing file needs approval with the difference shown.",
    risk: 'write',
    schema: z
      .object({
        path: z.string().describe('Absolute destination path.'),
        snippetId: z.string().optional(),
        template: z.string().optional(),
        values: z.record(z.string()).optional(),
      })
      .refine((v) => !!v.snippetId !== !!v.template, {
        message: 'Provide exactly one of snippetId or template.',
      }),
    approval: {
      summary: (args: { path: string; snippetId?: string; template?: string }) =>
        `Write ${args.snippetId ? `snippet ${args.snippetId}` : `template "${args.template}"`} to ${args.path}.`,
      diff: async (args: { path: string }) => {
        let existing: string | null = null
        try {
          existing = await fsp.readFile(args.path, 'utf-8')
        } catch {
          existing = null
        }
        return {
          subject: args.path,
          changes: [
            {
              field: 'Existing file',
              // Only the size and first line: the current contents could
              // themselves be a credential file, and the approval card is
              // rendered in the renderer.
              before: existing === null ? '(none — will be created)' : `${existing.length} bytes, starts "${existing.split('\n')[0]?.slice(0, 60)}"`,
              after: existing === null ? 'new file' : 'overwritten',
            },
          ],
        }
      },
    },
    handler: async (args: { path: string; snippetId?: string; template?: string; values?: Record<string, string> }) => {
      const ctx = await getGuardContext()
      const guard = await guardPath(args.path, ctx)
      if (!guard.ok) {
        throw new CapabilityError(
          `Cannot write to ${args.path}: ${guard.error.message} Add the folder as a managed root if this is intended.`,
          'denied'
        )
      }

      let body: string
      if (args.snippetId) {
        const snippet = getSnippet(args.snippetId)
        if (!snippet) throw new CapabilityError(`No snippet with id ${args.snippetId}.`, 'not_found')
        body = snippet.body
        markUsed(snippet.id)
      } else {
        const template = getTemplate(args.template!)
        if (!template) throw new CapabilityError(`No template called "${args.template}".`, 'not_found')
        const rendered = renderTemplate(template, args.values ?? {})
        if (rendered.missing.length) {
          throw new CapabilityError(
            `Cannot write an incomplete config: ${rendered.missing.join(', ')} ${rendered.missing.length === 1 ? 'is' : 'are'} required and were not supplied.`,
            'invalid_args'
          )
        }
        body = rendered.body
      }

      await fsp.mkdir(dirname(args.path), { recursive: true })
      await fsp.writeFile(args.path, body, 'utf-8')
      return { path: args.path, bytes: Buffer.byteLength(body) }
    },
    formatResult: (r: { path: string; bytes: number }) => `Wrote ${r.bytes} bytes to ${r.path}.`,
  },

  {
    id: 'vault.copyToClipboard',
    title: 'Copy a snippet to the clipboard',
    description:
      "Put a snippet's contents on the system clipboard. The only way to get a secret snippet's value into the user's hands without it entering this conversation — you will be told it succeeded, not what was copied.",
    risk: 'write',
    schema: z.object({ id: z.string() }),
    approval: {
      summary: (args: { id: string }) => {
        const snippet = getSnippet(args.id)
        return `Copy ${snippet ? `"${snippet.title}"` : `snippet ${args.id}`} to the clipboard.`
      },
    },
    handler: async (args: { id: string }) => {
      const snippet = getSnippet(args.id)
      if (!snippet) throw new CapabilityError(`No snippet with id ${args.id}.`, 'not_found')
      clipboard.writeText(snippet.body)
      markUsed(snippet.id)
      // Returns nothing but the title — the body must not travel back through
      // the capability result, which is what the model sees.
      return { title: snippet.title, isSecret: snippet.isSecret, bytes: snippet.body.length }
    },
    formatResult: (r: { title: string; isSecret: boolean; bytes: number }) =>
      `Copied "${r.title}" to the clipboard (${r.bytes} characters)${r.isSecret ? ' — contents not shown, as it is a secret snippet' : ''}.`,
  },
]
