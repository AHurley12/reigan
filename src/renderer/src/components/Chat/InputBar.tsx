import React, { useRef, KeyboardEvent } from 'react'
import { Send, Mic, Square, Flame, CircleStop } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVoiceControls } from '../../hooks/useVoice'

interface Props {
  onSend: (text: string) => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
}

export function InputBar({ onSend, inputRef }: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? internalRef
  const { reiganState, setSettingsOpen } = useAppStore()
  const isUnbridled = useSettingsStore((s) => s.settings.personalityMode === 'unbridled')
  const { isActive: isVoiceActive, startVoice, stopVoice, skipVoiceResponse } = useVoiceControls()
  const isSpeaking = reiganState === 'speaking'
  const isDisabled = reiganState === 'processing'

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const submit = () => {
    const val = ref.current?.value.trim()
    if (val && !isDisabled) {
      onSend(val)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div
      className="rule flex items-end gap-3 px-4 py-3 shrink-0"
      style={{
        height: 'var(--inputbar-height)',
        background: 'var(--bg-surface)',
      }}
    >
      <div className="flex-1 relative">
        <textarea
          ref={ref}
          onKeyDown={handleKeyDown}
          placeholder="Ask Shingan anything... (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={isDisabled}
          className="ornate ornate-focus w-full resize-none bg-elevated px-3 py-2 text-sm
            placeholder:text-txt-muted text-txt-primary
            focus:outline-none transition-colors duration-fast
            disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: 'var(--font-body)', maxHeight: '120px', paddingRight: isUnbridled ? 84 : undefined }}
        />
        {isUnbridled && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="Unbridled Mode is active — click to open Settings"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-opacity hover:opacity-80"
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

      {/* Mic button */}
      <div className="relative group">
        <button
          onClick={() => (isVoiceActive ? stopVoice() : startVoice())}
          disabled={isDisabled}
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

      {/* Send button */}
      <button
        onClick={submit}
        disabled={isDisabled}
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
    </div>
  )
}
