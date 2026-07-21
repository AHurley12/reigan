import React, { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Check } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useIPC } from '../../hooks/useIPC'
import { SectionHeader } from '../shared/SectionHeader'
import { Button } from '../shared/Button'

const VOICE_OPTIONS = [
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
]

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen } = useAppStore()
  const { settings, updateSetting } = useSettingsStore()
  const ipc = useIPC()

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const [deepgramKeyInput, setDeepgramKeyInput] = useState('')
  const [elevenLabsKeyInput, setElevenLabsKeyInput] = useState('')
  const [showVoiceKeys, setShowVoiceKeys] = useState(false)
  const [voiceSaved, setVoiceSaved] = useState(false)

  const [googleClientIdInput, setGoogleClientIdInput] = useState('')
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState('')
  const [googleSaved, setGoogleSaved] = useState(false)
  const [googleStatus, setGoogleStatus] = useState<{ configured: boolean; connected: boolean }>({
    configured: false,
    connected: false,
  })
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState('')

  useEffect(() => {
    if (!settingsOpen || !ipc) return
    ipc.getSetting('anthropicApiKey').then((key) => { if (key) setApiKeyInput(key) })
    ipc.getSetting('deepgramApiKey').then((key) => { if (key) setDeepgramKeyInput(key) })
    ipc.getSetting('elevenLabsApiKey').then((key) => { if (key) setElevenLabsKeyInput(key) })
    ipc.getSetting('googleClientId').then((v) => { if (v) setGoogleClientIdInput(v) })
    ipc.getSetting('googleClientSecret').then((v) => { if (v) setGoogleClientSecretInput(v) })
    ipc.google.getStatus().then(setGoogleStatus)
  }, [settingsOpen])

  const handleSaveKey = async () => {
    await ipc?.setSetting('anthropicApiKey', apiKeyInput)
    updateSetting('anthropicApiKey', apiKeyInput)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveVoiceKeys = async () => {
    await ipc?.setSetting('deepgramApiKey', deepgramKeyInput)
    await ipc?.setSetting('elevenLabsApiKey', elevenLabsKeyInput)
    updateSetting('deepgramApiKey', deepgramKeyInput)
    updateSetting('elevenLabsApiKey', elevenLabsKeyInput)
    setVoiceSaved(true)
    setTimeout(() => setVoiceSaved(false), 2000)
  }

  const handleVoiceIdChange = async (voiceId: string) => {
    updateSetting('voiceId', voiceId)
    await ipc?.setSetting('voiceId', voiceId)
  }

  const handlePushToTalkChange = async (pushToTalk: boolean) => {
    updateSetting('pushToTalk', pushToTalk)
    await ipc?.setSetting('pushToTalk', String(pushToTalk))
  }

  const handleSaveGoogleCreds = async () => {
    await ipc?.setSetting('googleClientId', googleClientIdInput)
    await ipc?.setSetting('googleClientSecret', googleClientSecretInput)
    setGoogleSaved(true)
    setTimeout(() => setGoogleSaved(false), 2000)
    if (ipc) setGoogleStatus(await ipc.google.getStatus())
  }

  const handleGoogleConnect = async () => {
    if (!ipc) return
    setGoogleBusy(true)
    setGoogleError('')
    const result = await ipc.google.connect()
    if (!result.connected && result.error) setGoogleError(result.error)
    setGoogleStatus(await ipc.google.getStatus())
    setGoogleBusy(false)
  }

  const handleGoogleDisconnect = async () => {
    if (!ipc) return
    setGoogleBusy(true)
    await ipc.google.disconnect()
    setGoogleStatus(await ipc.google.getStatus())
    setGoogleBusy(false)
  }

  if (!settingsOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => setSettingsOpen(false)}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[400px] flex flex-col animate-slide-right"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <SectionHeader en="Settings" ja="設定" />
          <button
            onClick={() => setSettingsOpen(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center
              transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          {/* API Key */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Anthropic API Key
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Required to activate REIGAN. Your key is stored locally.
              </p>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-elevated rounded-md px-3 py-2 pr-10 text-sm
                    placeholder:text-txt-muted text-txt-primary
                    border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                    font-mono transition-colors"
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <Button size="sm" variant={saved ? 'primary' : 'ghost'} onClick={handleSaveKey}>
                {saved ? <Check size={14} /> : 'Save'}
              </Button>
            </div>
          </div>

          {/* Voice APIs */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Voice APIs
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Deepgram (speech-to-text) and ElevenLabs (text-to-speech) keys.
              </p>
            </div>

            <div className="space-y-2">
              <input
                type={showVoiceKeys ? 'text' : 'password'}
                value={deepgramKeyInput}
                onChange={(e) => setDeepgramKeyInput(e.target.value)}
                placeholder="Deepgram API key"
                className="w-full bg-elevated rounded-md px-3 py-2 text-sm
                  placeholder:text-txt-muted text-txt-primary
                  border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                  font-mono transition-colors"
              />
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showVoiceKeys ? 'text' : 'password'}
                    value={elevenLabsKeyInput}
                    onChange={(e) => setElevenLabsKeyInput(e.target.value)}
                    placeholder="ElevenLabs API key"
                    className="w-full bg-elevated rounded-md px-3 py-2 pr-10 text-sm
                      placeholder:text-txt-muted text-txt-primary
                      border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                      font-mono transition-colors"
                  />
                  <button
                    onClick={() => setShowVoiceKeys((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {showVoiceKeys ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <Button size="sm" variant={voiceSaved ? 'primary' : 'ghost'} onClick={handleSaveVoiceKeys}>
                  {voiceSaved ? <Check size={14} /> : 'Save'}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <select
                value={settings.voiceId}
                onChange={(e) => handleVoiceIdChange(e.target.value)}
                className="flex-1 bg-elevated rounded-md px-3 py-2 text-sm text-txt-primary
                  border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <button
                onClick={() => handlePushToTalkChange(!settings.pushToTalk)}
                className="px-3 py-2 rounded-md text-xs border transition-colors"
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                {settings.pushToTalk ? 'Push-to-talk' : 'Toggle'}
              </button>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Ctrl+Shift+Space starts/stops listening from anywhere in the app.
            </p>
          </div>

          {/* Google Account */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Google Account
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Connects Calendar and Gmail tools. Requires a Google Cloud OAuth Client ID/Secret.
              </p>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={googleClientIdInput}
                onChange={(e) => setGoogleClientIdInput(e.target.value)}
                placeholder="Google Client ID"
                className="w-full bg-elevated rounded-md px-3 py-2 text-sm
                  placeholder:text-txt-muted text-txt-primary
                  border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                  font-mono transition-colors"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  value={googleClientSecretInput}
                  onChange={(e) => setGoogleClientSecretInput(e.target.value)}
                  placeholder="Google Client Secret"
                  className="flex-1 bg-elevated rounded-md px-3 py-2 text-sm
                    placeholder:text-txt-muted text-txt-primary
                    border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                    font-mono transition-colors"
                />
                <Button size="sm" variant={googleSaved ? 'primary' : 'ghost'} onClick={handleSaveGoogleCreds}>
                  {googleSaved ? <Check size={14} /> : 'Save'}
                </Button>
              </div>
            </div>

            <div
              className="rounded-lg p-3 flex items-center justify-between"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: googleStatus.connected ? 'var(--active)' : 'var(--text-muted)' }}
                />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {googleStatus.connected ? 'Connected — Calendar, Gmail' : 'Not connected'}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={googleBusy || (!googleStatus.connected && !googleClientIdInput)}
                onClick={googleStatus.connected ? handleGoogleDisconnect : handleGoogleConnect}
              >
                {googleStatus.connected ? 'Disconnect' : 'Sign in with Google'}
              </Button>
            </div>
            {googleError && (
              <p className="text-[10px]" style={{ color: 'var(--critical, #EF4444)' }}>{googleError}</p>
            )}
          </div>

          {/* Japanese Level */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Japanese Display
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Controls ambient Japanese text throughout the UI.
              </p>
            </div>
            <div className="flex gap-2">
              {[
                { level: 0, label: 'Off', ja: 'オフ' },
                { level: 1, label: 'Ambient', ja: '環境' },
                { level: 2, label: 'Learning', ja: '学習' },
              ].map(({ level, label, ja }) => (
                <button
                  key={level}
                  onClick={() => updateSetting('japaneseLevel', level as 0 | 1 | 2)}
                  className={`flex-1 py-2 rounded-md text-xs transition-colors
                    ${settings.japaneseLevel === level
                      ? 'bg-reigan-primary/20 border border-reigan-primary/40 text-txt-primary'
                      : 'bg-elevated border border-[var(--border)] text-txt-muted hover:text-txt-secondary'
                    }`}
                >
                  <div>{label}</div>
                  <div className="font-kanji text-[10px] mt-0.5" style={{ color: 'var(--text-kanji)' }}>{ja}</div>
                </button>
              ))}
            </div>
          </div>

          {/* App info */}
          <div
            className="rounded-lg p-4 space-y-2"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="font-display font-semibold"
                style={{
                  background: 'var(--reigan-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                REIGAN 霊眼
              </span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>v0.1.0</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              See beyond. Act within.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
