import { z } from 'zod'
import {
  listConversations,
  getConversation,
  getMessages,
  renameConversation,
  deleteConversation,
  type ConversationSummary,
  type StoredMessage,
  getToolCallsForConversation,
  type StoredToolCall,
} from '../../db/queries'
import { getAttachmentsForConversation } from '../../files/attachmentStore'
import { CapabilityError, type AnyCapability } from '../types'
import type { ChatAttachmentMeta } from '../../../shared/types'

/**
 * Conversation history, as capabilities rather than as four new IPC channels.
 *
 * Streaming has to stay on `llm:stream` — a capability is request/response and
 * cannot push tokens — but everything around it is ordinary CRUD, and the
 * registry already supplies argument validation, a risk tier, the approval
 * gate and an audit row for each call. Deleting a conversation is destructive,
 * so it inherits the confirmation dialog without any new UI being written for
 * it.
 */
export const chatCapabilities: AnyCapability[] = [
  {
    id: 'chat.listConversations',
    title: 'List conversations',
    description:
      'List past conversations, newest first. Optionally filter by a substring of the title. Returns titles and message counts, not message bodies.',
    risk: 'read',
    schema: z.object({
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
      search: z.string().max(200).optional(),
    }),
    handler: (args: { limit?: number; offset?: number; search?: string }) => listConversations(args),
    formatResult: (rows: ConversationSummary[]) =>
      rows.length === 0
        ? 'No conversations found.'
        : `${rows.length} conversation${rows.length === 1 ? '' : 's'}: ${rows.map((r) => r.title).join('; ')}`,
  },

  {
    id: 'chat.getConversation',
    title: 'Open a conversation',
    description:
      'Fetch one conversation with its full message history, oldest message first.',
    risk: 'read',
    schema: z.object({ id: z.string().min(1) }),
    handler: (args: { id: string }): {
      conversation: ConversationSummary
      messages: StoredMessage[]
      attachments: ChatAttachmentMeta[]
      toolCalls: StoredToolCall[]
    } => {
      const conversation = getConversation(args.id)
      if (!conversation) throw new CapabilityError(`No conversation with id "${args.id}".`, 'not_found')
      // Metadata only — never the bytes. This crosses IPC and is also rendered
      // into the model's tool result, and a base64 PDF has no business in either.
      return {
        conversation,
        messages: getMessages(args.id),
        attachments: getAttachmentsForConversation(args.id),
        toolCalls: getToolCallsForConversation(args.id),
      }
    },
    formatResult: (r: { conversation: ConversationSummary; messages: StoredMessage[] }) =>
      `"${r.conversation.title}" — ${r.messages.length} message${r.messages.length === 1 ? '' : 's'}.`,
  },

  {
    id: 'chat.renameConversation',
    title: 'Rename a conversation',
    description:
      'Change the title of a past conversation. Titles are otherwise derived from the opening message, so this is how a conversation gets a name that reflects what it turned into.',
    risk: 'write',
    schema: z.object({
      id: z.string().min(1),
      // Bounded so a title cannot be used to smuggle an essay into the sidebar.
      title: z.string().trim().min(1).max(200),
    }),
    approval: {
      summary: (args: { id: string; title: string }) => `Rename a conversation to "${args.title}".`,
    },
    handler: (args: { id: string; title: string }) => {
      if (!renameConversation(args.id, args.title)) {
        throw new CapabilityError(`No conversation with id "${args.id}".`, 'not_found')
      }
      return { id: args.id, title: args.title }
    },
    formatResult: (r: { title: string }) => `Renamed to "${r.title}".`,
  },

  {
    id: 'chat.deleteConversation',
    title: 'Delete a conversation',
    description:
      'Permanently delete a conversation and every message in it. This cannot be undone.',
    risk: 'destructive',
    schema: z.object({ id: z.string().min(1) }),
    approval: {
      // Resolved before the prompt is shown, so the card names what will die
      // rather than showing an opaque id — the same reason localhost.killProcess
      // resolves its process first.
      summary: (args: { id: string }) => {
        const conversation = getConversation(args.id)
        if (!conversation) return `Delete conversation "${args.id}" (not found).`
        const count = conversation.messageCount
        return `Permanently delete "${conversation.title}" and its ${count} message${count === 1 ? '' : 's'}.`
      },
    },
    handler: (args: { id: string }) => {
      if (!deleteConversation(args.id)) {
        throw new CapabilityError(`No conversation with id "${args.id}".`, 'not_found')
      }
      return { id: args.id }
    },
    formatResult: () => 'Conversation deleted.',
  },
]
