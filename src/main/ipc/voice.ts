import { ipcMain, BrowserWindow, globalShortcut } from 'electron'
import { IPC } from '../../shared/types'
import { getSetting } from '../db/queries'
import { voiceManager, type VoiceState } from '../voice/voiceManager'

const PUSH_TO_TALK_ACCELERATOR = 'CommandOrControl+Shift+Space'

export function registerVoiceHandlers(mainWindow: BrowserWindow): void {
  voiceManager.setCallbacks({
    onTranscript: (text, isFinal) => {
      mainWindow.webContents.send(IPC.VOICE_TRANSCRIPT, { text, isFinal })
    },
    onAudio: (audioBuffer) => {
      mainWindow.webContents.send(IPC.VOICE_AUDIO_PLAYBACK, audioBuffer)
    },
    onStateChange: (state: VoiceState) => {
      mainWindow.webContents.send(IPC.VOICE_STATE_CHANGE, state)
    },
    onError: (error) => {
      mainWindow.webContents.send(IPC.VOICE_ERROR, error.message)
    },
  })

  ipcMain.handle(IPC.VOICE_START, () => {
    voiceManager.startListening(getSetting('deepgramApiKey') ?? '')
  })

  ipcMain.handle(IPC.VOICE_STOP, () => {
    voiceManager.stopListening()
  })

  ipcMain.on(IPC.VOICE_AUDIO_CHUNK, (_event, buffer: ArrayBuffer) => {
    voiceManager.sendAudioChunk(Buffer.from(buffer))
  })

  // Approximate frequency-band energy from renderer-computed RMS amplitude,
  // forwarded back out as data the orb's Web Audio–style visualizer expects.
  // A real FFT split would need renderer-side AnalyserNode work — out of
  // scope for v1.
  ipcMain.on(IPC.VOICE_AMPLITUDE, (event, rms: number) => {
    event.sender.send(IPC.VOICE_ORB_AUDIO, {
      amplitude: rms,
      bass: rms * 0.8,
      mid: rms * 0.6,
      high: rms * 0.3,
    })
  })

  // Electron's globalShortcut has no key-up event, so true hold-to-talk
  // isn't available without a native keyboard hook. The shortcut toggles
  // listening on/off instead, in both push-to-talk and toggle settings modes.
  globalShortcut.register(PUSH_TO_TALK_ACCELERATOR, () => {
    if (voiceManager.getIsListening()) {
      voiceManager.stopListening()
    } else {
      voiceManager.startListening(getSetting('deepgramApiKey') ?? '')
    }
  })

  mainWindow.on('closed', () => {
    globalShortcut.unregister(PUSH_TO_TALK_ACCELERATOR)
  })
}
