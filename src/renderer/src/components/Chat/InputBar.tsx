import React, { useRef, KeyboardEvent } from 'react'
import { Send, Mic, Square } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useVoiceControls } from '../../hooks/useVoice'

interface Props {
  onSend: (text: string) => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
}

export function InputBar({ onSend, inputRef }: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? internalRef
  const { reiganState } = useAppStore()
  const { isActive: isVoiceActive, startVoice, stopVoice } = useVoiceControls()
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
      className="flex items-end gap-3 px-4 py-3 shrink-0"
      style={{
        height: 'var(--inputbar-height)',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
      }}
    >
      <textarea
        ref={ref}
        onKeyDown={handleKeyDown}
        placeholder="Ask Shingan anything... (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={isDisabled}
        className="flex-1 resize-none bg-elevated rounded-md px-3 py-2 text-sm
          placeholder:text-txt-muted text-txt-primary
          border border-[var(--border)] focus:border-[var(--border-accent)]
          focus:outline-none transition-colors duration-fast
          disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ fontFamily: 'var(--font-body)', maxHeight: '120px' }}
      />

      {/* Mic button */}
      <div className="relative group">
        <button
          onClick={() => (isVoiceActive ? stopVoice() : startVoice())}
          disabled={isDisabled}
          className="w-9 h-9 rounded-md flex items-center justify-center
            transition-all duration-fast disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isVoiceActive ? 'var(--reigan-gradient)' : 'var(--bg-elevated)',
            color: isVoiceActive ? 'white' : 'var(--text-muted)',
          }}
          aria-label={isVoiceActive ? 'Stop listening' : 'Start voice input'}
        >
          {isVoiceActive ? <Square size={14} /> : <Mic size={16} />}
        </button>
        <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block
          px-2 py-1 rounded text-[10px] whitespace-nowrap pointer-events-none"
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
          color: 'white',
        }}
        aria-label="Send"
      >
        <Send size={15} />
      </button>
    </div>
  )
}
