import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { shell } from 'electron'

export const getTimeTool = new DynamicStructuredTool({
  name: 'get_time',
  description: 'Get the current date and time.',
  schema: z.object({}),
  func: async () => {
    const now = new Date()
    return `Current date/time: ${now.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    })}`
  },
})

export const getSystemInfoTool = new DynamicStructuredTool({
  name: 'get_system_info',
  description: 'Get basic system information including platform and memory.',
  schema: z.object({}),
  func: async () => {
    const { platform, arch } = process
    const memTotal = Math.round((process as any).getSystemMemoryInfo?.()?.total / 1024 / 1024 || 0)
    return `Platform: ${platform} (${arch}), Node: ${process.version}, Memory: ~${memTotal}MB total`
  },
})

export const openAppTool = new DynamicStructuredTool({
  name: 'open_app',
  description: 'Open an application or URL on the user\'s computer.',
  schema: z.object({
    target: z.string().describe('Application name, file path, or URL to open'),
  }),
  func: async ({ target }) => {
    try {
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target)
      } else {
        const err = await shell.openPath(target)
        if (err) throw new Error(err)
      }
      return `Opened: ${target}`
    } catch (err) {
      return `Could not open "${target}": ${err}`
    }
  },
})
