import { ipcMain } from 'electron'
import { google, gmail_v1 } from 'googleapis'
import { IPC, type MailCategory, type MailThread, type MailThreadDetail, type MailMessageDetail } from '../../shared/types'
import { googleAuth, isInvalidGrantError } from '../auth/googleAuth'

const CATEGORY_QUERY: Record<MailCategory, string> = {
  primary: 'category:primary',
  social: 'category:social',
  promotions: 'category:promotions',
  updates: 'category:updates',
  forums: 'category:forums',
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseFromHeader(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<(.+)>$/)
  if (match) {
    const name = match[1].replace(/"/g, '').trim()
    return { name: name || match[2], email: match[2] }
  }
  return { name: raw, email: raw }
}

function decodeBody(message: gmail_v1.Schema$Message): string {
  const parts = message.payload?.parts || []
  const textPart = parts.find((p) => p.mimeType === 'text/plain') || parts.find((p) => p.mimeType === 'text/html')
  const data = textPart?.body?.data || message.payload?.body?.data
  if (!data) return message.snippet || '(no body)'
  return Buffer.from(data, 'base64').toString('utf-8')
}

function encodeRaw(lines: string[]): string {
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function registerMailHandlers(): void {
  ipcMain.handle(
    IPC.MAIL_LIST_THREADS,
    async (_event, params: { category: MailCategory; unreadOnly?: boolean }) => {
      const client = googleAuth.getClient()
      if (!client) return { connected: false, threads: [] as MailThread[] }

      try {
        const gmail = google.gmail({ version: 'v1', auth: client })
        const q = [CATEGORY_QUERY[params.category], params.unreadOnly ? 'is:unread' : ''].filter(Boolean).join(' ')

        const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 30 })
        const refs = list.data.threads || []

        const threads = await Promise.all(
          refs.map(async (ref): Promise<MailThread> => {
            const thread = await gmail.users.threads.get({
              userId: 'me',
              id: ref.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'Date'],
            })
            const messages = thread.data.messages || []
            const last = messages[messages.length - 1]
            const headers = last?.payload?.headers
            const { name, email } = parseFromHeader(headerValue(headers, 'From'))
            const labelIds = last?.labelIds || []

            return {
              id: ref.id!,
              subject: headerValue(headers, 'Subject') || '(no subject)',
              from: email,
              fromName: name,
              snippet: last?.snippet || '',
              date: headerValue(headers, 'Date'),
              unread: labelIds.includes('UNREAD'),
              starred: labelIds.includes('STARRED'),
              category: params.category,
              messageCount: messages.length,
            }
          })
        )

        return { connected: true, threads }
      } catch (err) {
        if (isInvalidGrantError(err)) {
          googleAuth.disconnect()
          return { connected: false, threads: [] as MailThread[] }
        }
        throw err
      }
    }
  )

  ipcMain.handle(IPC.MAIL_CATEGORY_COUNTS, async () => {
    const client = googleAuth.getClient()
    const empty = { primary: 0, social: 0, promotions: 0, updates: 0, forums: 0 } as Record<MailCategory, number>
    if (!client) return { connected: false, counts: empty }

    try {
      const gmail = google.gmail({ version: 'v1', auth: client })
      const categories = Object.keys(CATEGORY_QUERY) as MailCategory[]

      const counts = await Promise.all(
        categories.map(async (category) => {
          const res = await gmail.users.threads.list({
            userId: 'me',
            q: `${CATEGORY_QUERY[category]} is:unread`,
            maxResults: 1,
          })
          return [category, res.data.resultSizeEstimate || 0] as const
        })
      )

      return { connected: true, counts: Object.fromEntries(counts) as Record<MailCategory, number> }
    } catch (err) {
      if (isInvalidGrantError(err)) {
        googleAuth.disconnect()
        return { connected: false, counts: empty }
      }
      throw err
    }
  })

  ipcMain.handle(IPC.MAIL_GET_THREAD, async (_event, threadId: string): Promise<MailThreadDetail | null> => {
    const client = googleAuth.getClient()
    if (!client) return null

    try {
      const gmail = google.gmail({ version: 'v1', auth: client })

      const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
      const messages: MailMessageDetail[] = (thread.data.messages || []).map((m) => ({
        id: m.id!,
        from: headerValue(m.payload?.headers, 'From'),
        to: headerValue(m.payload?.headers, 'To'),
        date: headerValue(m.payload?.headers, 'Date'),
        body: decodeBody(m),
        snippet: m.snippet || '',
      }))

      const subject = headerValue(thread.data.messages?.[0]?.payload?.headers, 'Subject') || '(no subject)'

      // Opening a thread implies reading it — mirrors normal mail-client behavior.
      await gmail.users.threads
        .modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['UNREAD'] } })
        .catch(() => {})

      return { id: threadId, subject, messages }
    } catch (err) {
      if (isInvalidGrantError(err)) {
        googleAuth.disconnect()
        return null
      }
      throw err
    }
  })

  ipcMain.handle(
    IPC.MAIL_REPLY,
    async (_event, params: { threadId: string; to: string; subject: string; body: string }) => {
      const client = googleAuth.getClient()
      if (!client) throw new Error('Google account not connected.')

      try {
        const gmail = google.gmail({ version: 'v1', auth: client })

        const thread = await gmail.users.threads.get({
          userId: 'me',
          id: params.threadId,
          format: 'metadata',
          metadataHeaders: ['Message-ID', 'References'],
        })
        const lastMessage = thread.data.messages?.[thread.data.messages.length - 1]
        const messageId = headerValue(lastMessage?.payload?.headers, 'Message-ID')
        const references = headerValue(lastMessage?.payload?.headers, 'References')

        const subject = params.subject.startsWith('Re:') ? params.subject : `Re: ${params.subject}`
        const lines = [`To: ${params.to}`, `Subject: ${subject}`]
        if (messageId) {
          lines.push(`In-Reply-To: ${messageId}`)
          lines.push(`References: ${[references, messageId].filter(Boolean).join(' ')}`)
        }
        lines.push('', params.body)

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encodeRaw(lines), threadId: params.threadId },
        })

        return { sent: true }
      } catch (err) {
        if (isInvalidGrantError(err)) {
          googleAuth.disconnect()
          throw new Error('Google account disconnected — reconnect in Settings.')
        }
        throw err
      }
    }
  )

  ipcMain.handle(IPC.MAIL_ARCHIVE, async (_event, threadId: string) => {
    const client = googleAuth.getClient()
    if (!client) throw new Error('Google account not connected.')
    try {
      const gmail = google.gmail({ version: 'v1', auth: client })
      await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['INBOX'] } })
      return { archived: true }
    } catch (err) {
      if (isInvalidGrantError(err)) {
        googleAuth.disconnect()
        throw new Error('Google account disconnected — reconnect in Settings.')
      }
      throw err
    }
  })

  ipcMain.handle(IPC.MAIL_SET_READ, async (_event, params: { threadId: string; read: boolean }) => {
    const client = googleAuth.getClient()
    if (!client) throw new Error('Google account not connected.')
    try {
      const gmail = google.gmail({ version: 'v1', auth: client })
      await gmail.users.threads.modify({
        userId: 'me',
        id: params.threadId,
        requestBody: params.read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
      })
      return { ok: true }
    } catch (err) {
      if (isInvalidGrantError(err)) {
        googleAuth.disconnect()
        throw new Error('Google account disconnected — reconnect in Settings.')
      }
      throw err
    }
  })
}
