import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useToastStore } from '../../../stores/toastStore'
import { SettingRow } from '../controls/SettingRow'
import { Select } from '../controls/Select'
import { Slider } from '../controls/Slider'
import { ApiKeyField } from '../controls/ApiKeyField'
import { listAudioDevices, onDeviceChange, type DeviceOption } from '../../../voice/audioDeviceManager'
import { startLevelMonitor } from '../../../voice/micLevelMonitor'
import { ORB_STYLES } from '../../Orb/engine/orbRegistry'

const ORB_STYLE_OPTIONS = Object.entries(ORB_STYLES).map(([value, def]) => ({
  value,
  label: def.label,
  labelJa: def.labelJa,
}))

// Voices offered in the picker. Every id here was probed against the
// ElevenLabs API on 2026-08-29 with this app's own key and TTS parameters:
// all of them return audio (HTTP 200, non-empty PCM). Adam and George are
// `premade`, Zenya is `cloned`, and the rest are `professional` — the
// professional ones are not gated on this account, so category is not a
// reason to drop a voice from this list.
const VOICE_OPTIONS = [
  { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (US)' },
  { value: 'JBFqnCBsd6RMkjVDRZzb', label: 'George (UK)' },
  { value: 'f5iYMGdlB5CJwK2vhzsS', label: 'Zenya' },
  { value: '6fZce9LFNG3iEITDfqZZ', label: 'Charlotte' },
  { value: 'aEO01A4wXwd1O8GPgGlF', label: 'Arabella (AU)' },
  { value: 'QeRkfdkzgy4CefJ3AcII', label: 'Sky (UK)' },
  { value: 'EST9Ui6982FZPSi7gCHi', label: 'Elise' },
  { value: 'wIzYfKZE8c87XZD7bDLH', label: 'Zibby' },
  { value: 'ut2XM2wJyIZLTtW6lFzZ', label: 'Eliza' },
]

const INPUT_MODE_OPTIONS = [
  { value: 'true', label: 'Push-to-talk' },
  { value: 'false', label: 'Toggle' },
]

const VOICE_RESPONSE_MODE_OPTIONS = [
  { value: 'always', label: 'Always speak replies' },
  { value: 'conversational', label: 'Voice input only' },
  { value: 'off', label: 'Off' },
]

const DEFAULT_OPTION = { value: 'default', label: 'System default' }

function toSelectOptions(devices: DeviceOption[]) {
  return [DEFAULT_OPTION, ...devices.map((d) => ({ value: d.deviceId, label: d.label }))]
}

type TestStatus = 'idle' | 'recording' | 'playing'

function MicTest({ inputDeviceId, outputDeviceId }: { inputDeviceId: string; outputDeviceId: string }) {
  const [status, setStatus] = useState<TestStatus>('idle')
  const [level, setLevel] = useState(0)
  const push = useToastStore((s) => s.push)

  const run = async () => {
    if (status !== 'idle') return

    let stream: MediaStream | null = null
    let stopMonitor: (() => void) | null = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: inputDeviceId !== 'default' ? { deviceId: { exact: inputDeviceId } } : true,
      })
      setStatus('recording')
      stopMonitor = startLevelMonitor(stream, setLevel)

      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.start()
      await new Promise((r) => setTimeout(r, 3000))
      recorder.stop()
      await stopped

      stopMonitor()
      stopMonitor = null
      stream.getTracks().forEach((t) => t.stop())
      stream = null
      setLevel(0)

      const blob = new Blob(chunks, { type: recorder.mimeType })
      const audio = new Audio(URL.createObjectURL(blob))
      const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (outputDeviceId !== 'default' && typeof audioWithSink.setSinkId === 'function') {
        try {
          await audioWithSink.setSinkId(outputDeviceId)
        } catch {
          push('Could not switch playback to the selected output device — using system default.', 'warning')
        }
      }

      setStatus('playing')
      audio.onended = () => setStatus('idle')
      await audio.play()
    } catch (err) {
      stopMonitor?.()
      stream?.getTracks().forEach((t) => t.stop())
      setLevel(0)
      setStatus('idle')
      const message = err instanceof DOMException ? err.message : 'Microphone test failed.'
      push(`Mic test failed: ${message}`, 'error')
    }
  }

  const label = status === 'idle' ? 'Test Mic' : status === 'recording' ? 'Recording… (3s)' : 'Playing back…'

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={status !== 'idle'}
        className="px-3 py-1.5 rounded-md text-xs border shrink-0 transition-colors disabled:opacity-60"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        {label}
      </button>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
        <div
          className="h-full transition-[width] duration-fast"
          style={{ width: `${Math.min(100, level * 220)}%`, background: 'var(--reigan-secondary)' }}
        />
      </div>
    </div>
  )
}

export function VoiceSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const push = useToastStore((s) => s.push)
  const [inputs, setInputs] = useState<DeviceOption[]>([])
  const [outputs, setOutputs] = useState<DeviceOption[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      listAudioDevices()
        .then(({ inputs, outputs }) => {
          if (cancelled) return
          setInputs(inputs)
          setOutputs(outputs)
        })
        .catch(() => {
          if (!cancelled) push('Could not list audio devices.', 'error')
        })
    }
    refresh()
    const unsubscribe = onDeviceChange(refresh)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [push])

  return (
    <div className="space-y-6">
      <div>
        <SettingRow
          label="Speech responses"
          labelJa="音声応答"
          description="Always: every reply is spoken, whether you typed or talked. Voice input only: replies are spoken back only when you spoke the message. Off: replies are never spoken."
        >
          <Select
            value={settings.voiceResponseMode}
            options={VOICE_RESPONSE_MODE_OPTIONS}
            onChange={(v) => set('voiceResponseMode', v as 'always' | 'conversational' | 'off')}
          />
        </SettingRow>
        <SettingRow label="Shingan voice" labelJa="音声選択">
          <Select value={settings.voiceId} options={VOICE_OPTIONS} onChange={(v) => set('voiceId', v)} />
        </SettingRow>
        <SettingRow label="Input mode" labelJa="入力モード" description="Ctrl+Shift+Space starts/stops listening from anywhere.">
          <Select
            value={String(settings.pushToTalk)}
            options={INPUT_MODE_OPTIONS}
            onChange={(v) => set('pushToTalk', v === 'true')}
          />
        </SettingRow>
        <SettingRow label="Voice orb" labelJa="オーブ" description="Visual style of the orb shown while listening/speaking." last>
          <Select
            value={settings.voiceOrbStyle}
            options={ORB_STYLE_OPTIONS}
            onChange={(v) => set('voiceOrbStyle', v)}
          />
        </SettingRow>
      </div>

      <div>
        <SettingRow label="Microphone" labelJa="マイク" description="Which input device to capture for voice recognition.">
          <Select
            value={settings.audioInputDeviceId}
            options={toSelectOptions(inputs)}
            onChange={(v) => set('audioInputDeviceId', v)}
          />
        </SettingRow>
        <SettingRow label="Audio output" labelJa="出力" description="Which device REIGAN's spoken replies play through.">
          <Select
            value={settings.audioOutputDeviceId}
            options={toSelectOptions(outputs)}
            onChange={(v) => set('audioOutputDeviceId', v)}
          />
        </SettingRow>
        <SettingRow label="Check devices" labelJa="確認" description="Records 3s from the selected mic, then plays it back through the selected output." last>
          <div className="w-[220px]">
            <MicTest inputDeviceId={settings.audioInputDeviceId} outputDeviceId={settings.audioOutputDeviceId} />
          </div>
        </SettingRow>
      </div>

      <div>
        <SettingRow label="Stability" labelJa="安定性" description="Higher = more consistent. Lower = more expressive.">
          <Slider min={0} max={1} step={0.05} value={settings.ttsStability} onChange={(v) => set('ttsStability', v)} formatLabel={(v) => v.toFixed(2)} />
        </SettingRow>
        <SettingRow label="Similarity" labelJa="類似度" description="How closely the output matches the reference voice." last>
          <Slider min={0} max={1} step={0.05} value={settings.ttsSimilarity} onChange={(v) => set('ttsSimilarity', v)} formatLabel={(v) => v.toFixed(2)} />
        </SettingRow>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Deepgram API Key</p>
          <ApiKeyField settingKey="deepgramApiKey" placeholder="Deepgram API key" />
        </div>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>ElevenLabs API Key</p>
          <ApiKeyField settingKey="elevenLabsApiKey" placeholder="ElevenLabs API key" />
        </div>
      </div>
    </div>
  )
}
