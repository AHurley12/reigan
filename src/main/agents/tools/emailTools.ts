import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { gmail_v1 } from 'googleapis'

function getEmailBody(message: gmail_v1.Schema$Message): string {
  const parts = message.payload?.parts || []
  const textPart = parts.find((p) => p.mimeType === 'text/plain')

  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, 'base64').toString('utf-8')
  }
  if (message.payload?.body?.data) {
    return Buffer.from(message.payload.body.data, 'base64').toString('utf-8')
  }

  return message.snippet || '(no body)'
}

export function createEmailTools(auth: OAuth2Client): DynamicStructuredTool[] {
  const gmail = google.gmail({ version: 'v1', auth })

  const checkEmail = new DynamicStructuredTool({
    name: 'check_email',
    description:
      'Check the user\'s Gmail inbox. Use when the user says "check my email", "any new messages", "emails from [person]", etc. Supports Gmail search syntax in the query.',
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          'Gmail search query. Default: "is:unread". Examples: "from:boss@company.com", "is:unread newer_than:1d", "subject:meeting"'
        ),
      maxResults: z.number().optional().describe('Max threads to return. Default 5.'),
    }),
    func: async ({ query, maxResults }) => {
      const response = await gmail.users.threads.list({
        userId: 'me',
        q: query || 'is:unread',
        maxResults: maxResults || 5,
      })

      const threads = response.data.threads || []
      if (threads.length === 0) return 'No matching emails found.'

      const details = await Promise.all(
        threads.slice(0, 5).map(async (t) => {
          const thread = await gmail.users.threads.get({
            userId: 'me',
            id: t.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
          })

          const headers = thread.data.messages?.[0]?.payload?.headers || []
          const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)'
          const from = headers.find((h) => h.name === 'From')?.value || 'unknown'
          const date = headers.find((h) => h.name === 'Date')?.value || ''
          const snippet = thread.data.messages?.[0]?.snippet || ''

          return `- From: ${from}\n  Subject: ${subject}\n  Date: ${date}\n  Thread ID: ${t.id}\n  Preview: ${snippet.slice(0, 120)}...`
        })
      )

      return details.join('\n\n')
    },
  })

  const readEmail = new DynamicStructuredTool({
    name: 'read_email',
    description: 'Read the full content of a specific email thread by its thread ID.',
    schema: z.object({
      threadId: z.string().describe('The Gmail thread ID to read'),
    }),
    func: async ({ threadId }) => {
      const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })

      const messages = thread.data.messages || []
      return messages
        .map((msg) => {
          const headers = msg.payload?.headers || []
          const from = headers.find((h) => h.name === 'From')?.value || ''
          const date = headers.find((h) => h.name === 'Date')?.value || ''
          const body = getEmailBody(msg)
          return `From: ${from}\nDate: ${date}\n\n${body}`
        })
        .join('\n---\n')
    },
  })

  const draftEmail = new DynamicStructuredTool({
    name: 'draft_email',
    description:
      'Create a draft email in Gmail. Use when the user says "draft an email", "write a reply", "compose a message to". Always creates a DRAFT, never sends directly.',
    schema: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body text'),
    }),
    func: async ({ to, subject, body }) => {
      const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n')

      const encoded = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: encoded } },
      })

      return `Draft created: "${subject}" to ${to}. Draft ID: ${response.data.id}`
    },
  })

  return [checkEmail, readEmail, draftEmail]
}
