/**
 * Level maths for the orb meter during TTS playback.
 *
 * Kept as a pure function, separate from the AnalyserNode that feeds it, so
 * the arithmetic is testable without standing up Web Audio.
 *
 * The mic path computes RMS in the renderer and splits the bands in the main
 * process (`ipc/voice.ts`, VOICE_AMPLITUDE). Playback has no reason to make
 * that round trip, so it does both here — but it must land on the same numbers,
 * or the meter would visibly change character between listening and speaking.
 */

export interface Levels {
  amplitude: number
  bass: number
  mid: number
  high: number
}

/**
 * Band weights, matching the listening path's approximation. A real FFT split
 * is available now that playback runs through an AnalyserNode, but it would
 * only apply to speech — the two states would then disagree, which is the one
 * thing this file exists to avoid.
 */
const BAND_WEIGHTS = { bass: 0.8, mid: 0.6, high: 0.3 } as const

const SILENT: Levels = { amplitude: 0, bass: 0, mid: 0, high: 0 }

export function computeLevels(samples: Float32Array): Levels {
  // Guards a divide by zero: NaN reaches the meter as `height: NaN%`, which
  // drops the declaration and leaves the bar frozen at its last height.
  if (samples.length === 0) return { ...SILENT }

  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i]

  // Float time-domain data is not clamped to ±1, so neither is its RMS.
  const amplitude = Math.min(1, Math.sqrt(sumSquares / samples.length))

  return {
    amplitude,
    bass: amplitude * BAND_WEIGHTS.bass,
    mid: amplitude * BAND_WEIGHTS.mid,
    high: amplitude * BAND_WEIGHTS.high,
  }
}
