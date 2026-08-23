/**
 * Maps a 0–1 audio level onto the orb meter's bar height, as a percentage.
 *
 * Kept pure and separate from OrbColumn so the arithmetic is testable without
 * rendering, the same way playbackLevel.ts splits the level maths away from the
 * AnalyserNode that feeds it.
 *
 * Both feeds — the mic path (ipc/voice.ts, VOICE_ORB_AUDIO) and the playback
 * path (playbackLevel.ts) — hand over raw RMS, which is why the scaling belongs
 * here rather than in either source: one mapping, so the meter keeps the same
 * character whether Reigan is listening or speaking.
 */

/**
 * Resting height. The bars are a row of capsules; collapsing them to nothing
 * during silence reads as a rendering fault rather than as quiet.
 */
export const METER_FLOOR_PCT = 12

/**
 * Speech RMS occupies roughly 0.05–0.3, not 0–1, so a raw level drives a bar
 * through a fraction of its travel. 2.2 puts a normal speaking volume near the
 * top of the bar and matches the gain the Settings input meter already applies
 * (`level * 220` in VoiceSettings.tsx), so the two meters agree about what
 * "loud" looks like.
 */
const GAIN = 2.2

export function meterHeight(level: number): number {
  // NaN reaches the DOM as `height: NaN%`, which drops the declaration and
  // leaves the bar frozen at whatever height it last held.
  if (!Number.isFinite(level) || level <= 0) return METER_FLOOR_PCT

  const scaled = Math.min(1, level * GAIN)

  // The floor is an offset, not a clamp. Clamping cost the meter the bottom
  // 12% of its range — which, after OrbColumn's band weights, was most of the
  // range the signal ever reached.
  return METER_FLOOR_PCT + scaled * (100 - METER_FLOOR_PCT)
}
