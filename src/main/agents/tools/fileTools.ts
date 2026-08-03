import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchFiles, listDirectory, readFileContent, getHomeDir } from '../../files/fileIndexer'

function formatEntries(entries: { name: string; path: string; isDir: boolean; size: number; mtime: number }[]): string {
  if (entries.length === 0) return 'No matching files or folders.'
  return entries
    .slice(0, 50)
    .map((e) => `${e.isDir ? '[folder]' : '[file]'} ${e.name} — ${e.path}`)
    .join('\n')
}

export const searchFilesTool = new DynamicStructuredTool({
  name: 'search_files',
  description:
    "Search the user's indexed files by name, across their whole home profile (Documents, Desktop, Downloads, Pictures, etc.). Read-only. Use when the user asks you to find a file.",
  schema: z.object({
    query: z.string().describe('Filename search text'),
    category: z.enum(['all', 'documents', 'images', 'code', 'media', 'archives', 'other']).optional(),
  }),
  func: async ({ query, category }) => {
    const results = searchFiles({ query, category, limit: 50 })
    return formatEntries(results)
  },
})

export const listDirectoryTool = new DynamicStructuredTool({
  name: 'list_directory',
  description:
    "List the contents of a folder in the user's home profile. Read-only. Omit path to list the home folder itself.",
  schema: z.object({
    path: z.string().optional().describe('Absolute folder path; defaults to the home folder'),
  }),
  func: async ({ path }) => {
    try {
      const entries = await listDirectory(path || getHomeDir())
      return formatEntries(entries)
    } catch (err) {
      return `Could not list that folder: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const readFileTool = new DynamicStructuredTool({
  name: 'read_file',
  description:
    "Read a text file's contents (for summarizing, answering questions about it, etc). Only works on text-like files (code, markdown, txt, json, csv, logs, etc.) within the user's home profile — binary files (images, video, executables) and files outside that scope return nothing. Read-only; this tool cannot edit, create, or delete files.",
  schema: z.object({
    path: z.string().describe('Absolute path to the file to read'),
  }),
  func: async ({ path }) => {
    const result = await readFileContent(path)
    if (!result) return "Couldn't read that file — it may be binary, outside the allowed scope, or not found."
    return result.truncated ? `${result.content}\n\n[Content truncated — file is larger than the preview limit.]` : result.content
  },
})
