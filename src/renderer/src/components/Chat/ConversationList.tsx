import React, { useCallback, useEffect, useState } from 'react'
import { MessageSquarePlus, Search, Trash2 } from 'lucide-react'
import { useCapability } from '../DevTools/useCapability'
import { AsyncPane } from '../DevTools/shared/AsyncPane'
import { VirtualList } from '../DevTools/shared/VirtualList'
import { useChatStore } from '../../stores/chatStore'

interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

const ROW_HEIGHT = 54
const SEARCH_DEBOUNCE_MS = 200

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

export function ConversationList() {
  const list = useCapability<Conversation[]>('chat.listConversations')
  const remove = useCapability<{ id: string }>('chat.deleteConversation')
  const activeId = useChatStore((s) => s.conversationId)
  const loadConversation = useChatStore((s) => s.loadConversation)
  const newConversation = useChatStore((s) => s.newConversation)
  const [search, setSearch] = useState('')

  const { run: runList } = list
  const refresh = useCallback(() => {
    void runList({ search: search || undefined })
  }, [runList, search])

  // Debounced so typing in the filter does not fire a query per keystroke —
  // the same shape ProjectsView uses for its search box.
  useEffect(() => {
    const timer = setTimeout(refresh, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [refresh])

  // A send creates the conversation row in main, so the sidebar only learns
  // about a new conversation once its id comes back on the stream.
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const conversations = list.data ?? []

  const handleDelete = async (id: string) => {
    // No confirm() here: the capability is tagged destructive, so dispatch
    // raises the app's own approval dialog before the handler ever runs.
    const outcome = await remove.run({ id })
    if (!outcome) return
    if (id === activeId) newConversation()
    refresh()
  }

  return (
    <div className="rule-r flex flex-col shrink-0 w-[232px] h-full" style={{ background: 'var(--bg-void)' }}>
      <div className="rule-b flex items-center gap-2 px-3 py-2.5 shrink-0">
        <button
          onClick={newConversation}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs flex-1 transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <MessageSquarePlus size={13} />
          New chat
        </button>
      </div>

      <div className="px-3 py-2 shrink-0 relative">
        <Search
          size={12}
          className="absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-muted)' }}
          aria-hidden="true"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles…"
          aria-label="Search conversations by title"
          spellCheck={false}
          className="ornate ornate-focus w-full bg-elevated pl-6 pr-2 py-1.5 text-xs
            placeholder:text-txt-muted text-txt-primary focus:outline-none"
          style={{ fontFamily: 'var(--font-body)' }}
        />
      </div>

      <div className="flex-1 min-h-0 px-1 pb-2">
        <AsyncPane
          loading={list.loading && conversations.length === 0}
          error={list.error}
          empty={!list.loading && conversations.length === 0}
          emptyTitle={search ? 'No matches' : 'No conversations yet'}
          emptyHint={search ? 'Nothing here matches that title.' : 'Your first message starts one.'}
          onRetry={refresh}
          skeletonRows={5}
        >
          <VirtualList
            items={conversations}
            rowHeight={ROW_HEIGHT}
            className="h-full"
            renderRow={(conversation) => (
              <ConversationRow
                conversation={conversation}
                isActive={conversation.id === activeId}
                onOpen={() => void loadConversation(conversation.id)}
                onDelete={() => void handleDelete(conversation.id)}
              />
            )}
          />
        </AsyncPane>
      </div>
    </div>
  )
}

function ConversationRow({
  conversation,
  isActive,
  onOpen,
  onDelete,
}: {
  conversation: Conversation
  isActive: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    // `focus-within` and not hover alone: the delete control has to be
    // reachable by keyboard, not only by pointer.
    <div
      className="group relative h-full mx-1 rounded-sm transition-colors"
      style={{
        background: isActive ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)' : 'transparent',
        border: isActive ? '1px solid var(--reigan-primary)' : '1px solid transparent',
      }}
    >
      <button
        onClick={onOpen}
        className="w-full h-full text-left px-2.5 py-1.5 flex flex-col justify-center gap-0.5 focus:outline-none"
        aria-current={isActive ? 'true' : undefined}
      >
        <span
          className="text-xs truncate pr-6"
          style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          {conversation.title}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {conversation.messageCount} · {formatAge(conversation.updatedAt)}
        </span>
      </button>

      <button
        onClick={onDelete}
        aria-label={`Delete conversation "${conversation.title}"`}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-sm
          flex items-center justify-center opacity-0
          group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100
          transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
