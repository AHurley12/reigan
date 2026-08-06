import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'

export interface DeviceOption {
  deviceId: string
  label: string
}

let cachedInputs: DeviceOption[] = []
let cachedOutputs: DeviceOption[] = []
let labelsPrimed = false

/**
 * enumerateDevices() returns unlabeled devices until getUserMedia has been
 * granted at least once (MDN/W3C spec) — so we prime it with a throwaway
 * stream the first time devices are listed.
 */
async function primeDeviceLabels(): Promise<void> {
  if (labelsPrimed) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    labelsPrimed = true
  } catch {
    // Permission not granted yet — enumerateDevices() will just come back unlabeled.
  }
}

export async function listAudioDevices(): Promise<{ inputs: DeviceOption[]; outputs: DeviceOption[] }> {
  await primeDeviceLabels()
  const devices = await navigator.mediaDevices.enumerateDevices()

  cachedInputs = devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  cachedOutputs = devices
    .filter((d) => d.kind === 'audiooutput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))

  return { inputs: cachedInputs, outputs: cachedOutputs }
}

/** Registers a devicechange listener (hot-plug/unplug) and returns an unsubscribe fn. */
export function onDeviceChange(handler: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', handler)
  return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
}

/**
 * Checks the persisted input/output device selections against what's
 * currently connected and falls back to 'default' (with a toast) for
 * anything that's disappeared — e.g. a USB mic unplugged since last launch.
 */
export async function validateStoredAudioDevices(): Promise<void> {
  const { inputs, outputs } = await listAudioDevices()
  const { settings, set } = useSettingsStore.getState()
  const push = useToastStore.getState().push

  if (
    settings.audioInputDeviceId &&
    settings.audioInputDeviceId !== 'default' &&
    !inputs.some((d) => d.deviceId === settings.audioInputDeviceId)
  ) {
    set('audioInputDeviceId', 'default')
    push('Saved microphone is no longer connected — switched to system default.', 'warning')
  }

  if (
    settings.audioOutputDeviceId &&
    settings.audioOutputDeviceId !== 'default' &&
    !outputs.some((d) => d.deviceId === settings.audioOutputDeviceId)
  ) {
    set('audioOutputDeviceId', 'default')
    push('Saved audio output is no longer connected — switched to system default.', 'warning')
  }
}
