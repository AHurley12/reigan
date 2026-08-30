import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { STATE_COLORS } from '../../../../shared/constants'
import { Select } from '../Settings/controls/Select'
import { AvatarEngine } from './engine/AvatarEngine'
import {
  resolveModelChoice,
  UPLOAD_OPTION,
  CUSTOM_OPTION,
  NONE_OPTION,
} from './engine/modelChoice'

const PRESET_MODELS: Record<string, { label: string; url: string }> = {
  riruka: { label: 'Riruka', url: '/models/riruka.glb' },
  'anime-girl': { label: 'Anime Girl', url: '/models/anime-girl.glb' },
  'anime-girl-3d-model': { label: 'anime+girl+3d+model', url: '/models/anime-girl-3d-model.glb' },
}

const PRESET_IDS = Object.keys(PRESET_MODELS)

export function AvatarPanel() {
  const reiganState = useAppStore((s) => s.reiganState)
  const color = STATE_COLORS[reiganState]

  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const savedModelChoice = useSettingsStore((s) => s.settings.avatarModelChoice)
  const savedCustomLabel = useSettingsStore((s) => s.settings.avatarCustomModelLabel)
  const setSetting = useSettingsStore((s) => s.set)

  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<AvatarEngine | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const customUrlRef = useRef<string | null>(null)
  const restoredRef = useRef(false)

  // null means "the persisted choice hasn't been resolved yet". Seeding this
  // with a default instead is what put an avatar on screen with None selected:
  // the default's load fired in the same commit that restored the saved
  // choice, and the GLB landed a beat after the stage had been cleared.
  const [modelChoice, setModelChoice] = useState<string | null>(null)
  const [customModel, setCustomModel] = useState<{ url: string; label: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)

  // Restore the persisted choice once settings have loaded — including pulling
  // a previously-uploaded custom model's bytes back off disk.
  useEffect(() => {
    if (!settingsLoaded || restoredRef.current) return
    restoredRef.current = true

    let cancelled = false

    void (async () => {
      // Pull an uploaded model back off disk on every launch, not only when it
      // happens to be the active choice: picking a preset and restarting used
      // to drop it out of the list entirely, leaving re-uploading as the only
      // way back to bytes that were sitting on disk the whole time.
      let readFailed = false
      const data = await window.reigan?.avatar.loadModel().catch(() => {
        readFailed = true
        return null
      })
      if (cancelled) return

      let hasCustom = false
      if (data) {
        hasCustom = true
        if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current)
        const url = URL.createObjectURL(new Blob([data.slice()], { type: 'model/gltf-binary' }))
        customUrlRef.current = url
        setCustomModel({ url, label: savedCustomLabel || 'Custom model' })
      }

      // Reconcile the stored choice with what actually exists — see
      // modelChoice.ts for the rule and its tests. The select, the stage and
      // the stored setting all end up saying the same thing.
      const { choice, persist } = resolveModelChoice({
        saved: savedModelChoice,
        hasCustomOnDisk: hasCustom,
        presetIds: PRESET_IDS,
        readFailed,
      })

      if (persist) setSetting('avatarModelChoice', choice)
      setModelChoice(choice)
    })()

    return () => {
      cancelled = true
    }
  }, [settingsLoaded, savedModelChoice, savedCustomLabel, setSetting])

  const activeUrl =
    modelChoice === null || modelChoice === NONE_OPTION
      ? undefined
      : modelChoice === CUSTOM_OPTION
        ? customModel?.url
        : PRESET_MODELS[modelChoice]?.url

  // Init the engine once on mount.
  useEffect(() => {
    if (!containerRef.current) return
    const engine = new AvatarEngine(containerRef.current)
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Mic capture shares the main thread with this render loop while
  // listening — throttle so heavy frames can't starve audio chunks.
  useEffect(() => {
    engineRef.current?.setThrottled(reiganState === 'listening')
  }, [reiganState])

  // Load whichever model is active. Nothing is fetched until the persisted
  // choice has actually been resolved, so no load can be started on behalf of a
  // choice the user never made.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || modelChoice === null) return

    if (!activeUrl) {
      engine.clearModel()
      setLoading(false)
      setProgress(0)
      setError(null)
      return
    }

    setLoading(true)
    setProgress(0)
    setError(null)

    engine.onLoadProgress = (p) => setProgress(Math.round(p * 100))
    engine.onLoadComplete = () => setLoading(false)
    engine.onLoadError = (err) => {
      setError({ title: 'failed to load model', detail: err.message })
      setLoading(false)
    }

    engine.loadModel(activeUrl).catch(() => {
      /* handled via onLoadError */
    })
  }, [activeUrl, modelChoice])

  // Clean up blob URLs when replaced or on unmount.
  useEffect(() => {
    return () => {
      if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current)
    }
  }, [])

  const handleSelectChange = (value: string) => {
    if (value === UPLOAD_OPTION) {
      fileInputRef.current?.click()
      return
    }
    setModelChoice(value)
    setSetting('avatarModelChoice', value)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current)
    const url = URL.createObjectURL(file)
    customUrlRef.current = url

    setCustomModel({ url, label: file.name })
    setModelChoice(CUSTOM_OPTION)

    // The choice is only written once the bytes are safely on disk — recording
    // "custom" for an upload that failed to save would point the next launch at
    // a model that isn't there.
    try {
      const buffer = await file.arrayBuffer()
      await window.reigan?.avatar.saveModel(buffer)
      setSetting('avatarCustomModelLabel', file.name)
      setSetting('avatarModelChoice', CUSTOM_OPTION)
    } catch (err) {
      setError({
        title: 'failed to save model',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const selectOptions = [
    { value: NONE_OPTION, label: 'None' },
    ...Object.entries(PRESET_MODELS).map(([value, m]) => ({ value, label: m.label })),
    ...(customModel ? [{ value: CUSTOM_OPTION, label: customModel.label }] : []),
    { value: UPLOAD_OPTION, label: 'Upload model…' },
  ]

  return (
    <div className="w-full flex flex-col gap-2">
      {/* Border is the shared hairline, not a state-tinted one: state is
          already read from the orb, the viewfinder corners and the status
          label directly above, and a fourth colour here was the odd line out
          in a column of otherwise uniform edges. */}
      <div
        className="ornate relative w-full overflow-hidden"
        style={{ height: 240, background: 'var(--bg-elevated)' }}
      >
        <div ref={containerRef} className="w-full h-full" />

        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <div
              className="w-6 h-6 rounded-full animate-spin"
              style={{ border: `2px solid color-mix(in srgb, ${color} 20%, transparent)`, borderTopColor: color }}
            />
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {progress > 0 ? `loading… ${progress}%` : 'loading…'}
            </span>
          </div>
        )}

        {error && !loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <span className="text-[11px] font-mono" style={{ color: 'var(--critical)' }}>
              {error.title}
            </span>
            <span className="text-[10px] font-mono truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
              {error.detail}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Select
          value={modelChoice ?? NONE_OPTION}
          options={selectOptions}
          onChange={handleSelectChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Upload model"
          className="flex items-center justify-center rounded-md p-1.5 transition-colors"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <Upload size={12} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
