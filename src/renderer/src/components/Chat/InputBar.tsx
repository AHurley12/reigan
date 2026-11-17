import React, { useLayoutEffect, useRef, useState, KeyboardEvent } from 'react'
import { Send, Mic, Square, Flame, CircleStop, Paperclip, FileText, Image as ImageIcon, X, Sparkles } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVoiceControls } from '../../hooks/useVoice'
import { useAttachments, type PendingAttachment } from './useAttachments'
import { ALLOWED_DOCUMENT_TYPES, ALLOWED_IMAGE_TYPES } from '../../../../shared/attachmentPolicy'
import { resolveModel } from '../../../../shared/models'

/** Mirrors the policy, so the picker cannot offer what the policy would refuse. */
const ACCEPT = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES].join(',')

/** How tall the composer may grow before it scrolls instead. */
const MAX_VISIBLE_LINES = 3

/**
 * Sizes the composer to its content, from one line up to MAX_VISIBLE_LINES,
 * then lets it scroll. Measured from the computed style rather than hardcoded
 * pixels, so a theme that changes the font, padding or frame width still gets
 * exactly three lines.
 */
function fitToContent(el: HTMLTextAreaElement) {
  const cs = getComputedStyle(el)
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25
  const chrome =
    parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
    parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
  const max = lineHeight * MAX_VISIBLE_LINES + chrome
  // Collapse first, or scrollHeight can never report less than the current
  // height and the box would grow but never shrink back.
  el.style.height = 'auto'
  // scrollHeight covers padding but not border; the box is border-box.
  const wanted = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
  el.style.height = `${Math.min(wanted, max)}px`
  el.style.overflowY = wanted > max ? 'auto' : 'hidden'
}

interface Props {
  onSend: (text: string, attachments?: PendingAttachment[]) => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
}

export function InputBar({ onSend, inputRef }: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? internalRef
  const { attachments, add, remove, clear } = useAttachments()
  const [dragging, setDragging] = useState(false)
  const activeModel = resolveModel(useSettingsStore((s) => s.settings.model))
  // Read unconditionally: putting the hook on the right of a || would skip
  // the call whenever the left side is true, which is a hooks violation.
  const thinkingEnabled = useSettingsStore((s) => s.settings.thinkingEnabled)
  // Opus 5 and Sonnet 5 think on every turn whatever the toggle says, so the
  // indicator reflects what will actually happen, not what was configured.
  const alwaysThinks = !activeModel.acceptsSampling && activeModel.thinkingMode === 'adaptive'
  const thinkingOn = alwaysThinks || thinkingEnabled
  const { reiganState, setSettingsOpen } = useAppStore()
  const isUnbridled = useSettingsStore((s) => s.settings.personalityMode === 'unbridled')
  const { isActive: isVoiceActive, startVoice, stopVoice, skipVoiceResponse } = useVoiceControls()
  const isStreaming = useChatStore((s) => s.isStreaming)
  const abort = useChatStore((s) => s.abort)
  const isSpeaking = reiganState === 'speaking'
  // Voice capture is the one control that genuinely cannot overlap a
  // generation. The composer itself stays live, so the next message can be
  // drafted while this one is still answering.
  const micDisabled = reiganState === 'processing'

  // Re-fit when the composer's width changes — a window resize or the
  // Unbridled badge appearing rewraps the same text onto a different number
  // of lines. Only width is watched: fitting changes the height, and reacting
  // to that would just repeat the same answer.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    fitToContent(el)
    let lastWidth = el.offsetWidth
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === lastWidth) return
      lastWidth = el.offsetWidth
      fitToContent(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, isUnbridled])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends and Shift+Enter newlines — the chat convention, and the
    // muscle memory this app already had. Ctrl/Cmd+Enter is accepted as an
    // alias for people arriving from editors that bind submit that way.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const val = ref.current?.value.trim()
    // An attachment on its own is a legitimate message — "what is this?" is
    // implied. Requiring text would refuse the most obvious use of a paste.
    if ((val || attachments.length > 0) && !isStreaming) {
      onSend(val ?? '', attachments)
      clear()
      if (ref.current) {
        ref.current.value = ''
        fitToContent(ref.current)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    // Only when the clipboard actually carries files. Pasting text must never
    // be intercepted.
    e.preventDefault()
    void add(files)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void add(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      className="rule flex flex-col gap-2 px-4 py-3 shrink-0"
      style={{
        minHeight: 'var(--inputbar-height)',
        background: 'var(--bg-surface)',
        // Keeps a drop that misses the target from scrolling the transcript
        // behind it.
        overscrollBehavior: 'contain',
        outline: dragging ? '1px dashed var(--reigan-primary)' : undefined,
        outlineOffset: '-4px',
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        // Only when the pointer leaves the bar itself, not when it crosses onto
        // a child — otherwise the outline flickers as it moves across.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[11px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {attachment.kind === 'image' ? <ImageIcon size={10} /> : <FileText size={10} />}
              <span className="max-w-[160px] truncate">{attachment.filename}</span>
              <button
                onClick={() => remove(attachment.id)}
                aria-label={`Remove ${attachment.filename}`}
                className="w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
      <div className="flex-1 relative">
        <textarea
          ref={ref}
          onKeyDown={handleKeyDown}
          onInput={(e) => fitToContent(e.currentTarget)}
          onPaste={handlePaste}
          placeholder="Ask Shingan anything… (Enter to send, Shift+Enter for newline)"
          rows={1}
          className="ornate ornate-focus w-full resize-none bg-elevated px-3 py-2 text-sm
            placeholder:text-txt-muted text-txt-primary
            focus:outline-none transition-colors duration-fast
            disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--font-body)', overflowY: 'hidden', paddingRight: isUnbridled ? 84 : undefined }}
        />
        {isUnbridled && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="Unbridled Mode is active — click to open Settings"
            className="absolute right-2 bottom-[9px] flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-opacity hover:opacity-80"
            style={{ background: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)', color: 'var(--reigan-primary)' }}
          >
            <Flame size={10} />
            Unbridled
          </button>
        )}
      </div>

      {/* Stop audio output — only while REIGAN is actually speaking */}
      {isSpeaking && (
        <div className="relative group">
          <button
            onClick={skipVoiceResponse}
            className="w-9 h-9 rounded-md flex items-center justify-center
              transition-all duration-fast hover:border-[var(--reigan-primary)]"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
            aria-label="Stop audio output"
          >
            <CircleStop size={16} className="transition-colors duration-fast group-hover:text-[var(--reigan-primary)]" />
          </button>
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block
            px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Stop audio output
          </div>
        </div>
      )}

      {/* Which model is about to answer. A setting that changes what you get
          back should not be two panels away with nothing on screen saying so. */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="h-9 px-2 rounded-md flex items-center gap-1 text-[11px] shrink-0 transition-colors"
        style={{ color: 'var(--text-muted)' }}
        aria-label={`Model: ${activeModel.label}. Open Settings to change it.`}
      >
        {activeModel.label}
        {thinkingOn && <Sparkles size={10} aria-hidden="true" />}
      </button>

      {/* Attach */}
      <div className="relative group">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []))
            // Reset, or picking the same file twice in a row fires no change.
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-9 h-9 rounded-md flex items-center justify-center transition-all duration-fast"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          aria-label="Attach an image or PDF"
        >
          <Paperclip size={15} />
        </button>
        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block
          px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Attach an image or PDF — or paste, or drop one here
        </div>
      </div>

      {/* Mic button */}
      <div className="relative group">
        <button
          onClick={() => (isVoiceActive ? stopVoice() : startVoice())}
          disabled={micDisabled}
          className="w-9 h-9 rounded-md flex items-center justify-center
            transition-all duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isVoiceActive ? 'var(--reigan-gradient)' : 'var(--bg-elevated)',
            color: isVoiceActive ? 'var(--text-on-accent)' : 'var(--text-muted)',
          }}
          aria-label={isVoiceActive ? 'Stop listening' : 'Start voice input'}
        >
          {isVoiceActive ? <Square size={14} /> : <Mic size={16} />}
        </button>
        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block
          px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {isVoiceActive ? 'Listening — click to stop' : 'Voice (or Ctrl+Shift+Space)'}
        </div>
      </div>

      {/* Send, or Stop while a reply is streaming. One slot, so the control the
          user reaches for does not move the moment generation starts. */}
      {isStreaming ? (
        <div className="relative group">
          <button
            onClick={() => void abort()}
            className="w-9 h-9 rounded-md flex items-center justify-center transition-all duration-fast"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-hover)',
            }}
            aria-label="Stop generating"
          >
            <Square size={13} />
          </button>
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block
            px-2 py-1 rounded text-[11px] whitespace-nowrap pointer-events-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Stop generating (Esc)
          </div>
        </div>
      ) : (
        <button
          onClick={submit}
          className="w-9 h-9 rounded-md flex items-center justify-center
            transition-all duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'var(--reigan-gradient)',
            color: 'var(--text-on-accent)',
          }}
          aria-label="Send"
        >
          <Send size={15} />
        </button>
      )}
      </div>
    </div>
  )
}
