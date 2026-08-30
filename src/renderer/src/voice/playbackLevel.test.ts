import { describe, expect, it } from 'vitest'
import { computeLevels } from './playbackLevel'

/**
 * The orb's level meter is fed from two places that must agree. The mic path
 * derives its bands from an RMS amplitude in the main process
 * (`ipc/voice.ts`, VOICE_AMPLITUDE); this helper does the same job for TTS
 * playback, in the renderer, straight off an AnalyserNode.
 *
 * The meter reads as broken if the two disagree, so the band ratios are
 * asserted here against the same constants the listening path uses rather
 * than left as an implementation detail.
 */

/** Builds a square wave at ±`peak`, whose RMS is exactly `peak`. */
function squareWave(peak: number, length = 256): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) samples[i] = i % 2 === 0 ? peak : -peak
  return samples
}

describe('computeLevels', () => {
  it('reports zero amplitude for silence', () => {
    expect(computeLevels(new Float32Array(256)).amplitude).toBe(0)
  })

  it('reports the RMS of the samples as amplitude', () => {
    expect(computeLevels(squareWave(0.5)).amplitude).toBeCloseTo(0.5, 5)
  })

  it('reports full amplitude for a full-scale signal', () => {
    expect(computeLevels(squareWave(1)).amplitude).toBeCloseTo(1, 5)
  })

  it('derives the bands from amplitude using the listening path ratios', () => {
    const levels = computeLevels(squareWave(0.5))

    expect(levels.bass).toBeCloseTo(levels.amplitude * 0.8, 5)
    expect(levels.mid).toBeCloseTo(levels.amplitude * 0.6, 5)
    expect(levels.high).toBeCloseTo(levels.amplitude * 0.3, 5)
  })

  it('clamps amplitude to 1 when the signal overshoots full scale', () => {
    // Float time-domain data is not guaranteed to stay inside ±1. Unclamped,
    // the meter's bar height would exceed its track.
    expect(computeLevels(squareWave(1.8)).amplitude).toBe(1)
  })

  it('returns zeros rather than NaN for an empty buffer', () => {
    // A zero-length buffer divides by zero. NaN reaches the meter as
    // `height: NaN%`, which drops the CSS declaration and freezes the bar at
    // whatever height it last had.
    expect(computeLevels(new Float32Array(0))).toEqual({
      amplitude: 0,
      bass: 0,
      mid: 0,
      high: 0,
    })
  })
})
