import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { gmail_v1 } from 'googleapis'
import { withPermission } from './permission'

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

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function encodeRaw(lines: string[]): string {
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
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
    func: async ({ to, subject, body }) =>
      withPermission(
        'draft_email',
        `Save a draft email to ${to}: "${subject}"`,
        async () => {
          const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n')
          const encoded = encodeRaw(message.split('\n'))

          const response = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: { message: { raw: encoded } },
          })

          return `Draft created: "${subject}" to ${to}. Draft ID: ${response.data.id}`
        },
        body
      ),
  })

  const replyToEmail = new DynamicStructuredTool({
    name: 'reply_to_email',
    description:
      'Send a reply on an existing email thread — this actually sends, unlike draft_email. Use only when the user explicitly asks to send/reply now, not just to compose.',
    schema: z.object({
      threadId: z.string().describe('The Gmail thread ID to reply on'),
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe("The thread's subject (will be prefixed with Re: if not already)"),
      body: z.string().describe('Reply body text'),
    }),
    func: async ({ threadId, to, subject, body }) =>
      withPermission(
        'reply_to_email',
        `Send a reply to ${to} on "${subject}"`,
        async () => {
          const thread = await gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'metadata',
            metadataHeaders: ['Message-ID', 'References'],
          })
          const lastMessage = thread.data.messages?.[thread.data.messages.length - 1]
          const messageId = headerValue(lastMessage?.payload?.headers, 'Message-ID')
          const references = headerValue(lastMessage?.payload?.headers, 'References')

          const fullSubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
          const lines = [`To: ${to}`, `Subject: ${fullSubject}`]
          if (messageId) {
            lines.push(`In-Reply-To: ${messageId}`)
            lines.push(`References: ${[references, messageId].filter(Boolean).join(' ')}`)
          }
          lines.push('', body)

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: encodeRaw(lines), threadId },
          })

          return `Reply sent to ${to} on "${fullSubject}".`
        },
        body
      ),
  })

  const archiveEmail = new DynamicStructuredTool({
    name: 'archive_email',
    description: 'Archive an email thread (removes it from the inbox). Use when the user asks to archive or clear a message.',
    schema: z.object({
      threadId: z.string().describe('The Gmail thread ID to archive'),
    }),
    func: async ({ threadId }) =>
      withPermission('archive_email', `Archive email thread ${threadId}`, async () => {
        await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['INBOX'] } })
        return `Archived thread ${threadId}.`
      }),
  })

  const setEmailRead = new DynamicStructuredTool({
    name: 'set_email_read_status',
    description: 'Mark an email thread as read or unread.',
    schema: z.object({
      threadId: z.string().describe('The Gmail thread ID'),
      read: z.boolean().describe('True to mark read, false to mark unread'),
    }),
    func: async ({ threadId, read }) =>
      withPermission('set_email_read_status', `Mark thread ${threadId} as ${read ? 'read' : 'unread'}`, async () => {
        await gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
        })
        return `Marked thread ${threadId} as ${read ? 'read' : 'unread'}.`
      }),
  })

  return [checkEmail, readEmail, draftEmail, replyToEmail, archiveEmail, setEmailRead]
}
