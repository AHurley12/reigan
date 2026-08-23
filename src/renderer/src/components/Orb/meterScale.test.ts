import { describe, it, expect } from 'vitest'
import { meterHeight, METER_FLOOR_PCT } from './meterScale'

/**
 * The regression these guard: the meter used to render `max(12, level * 100)`,
 * which treated the floor as a clamp over the bottom 12% of a range the signal
 * never left. Speech RMS lives around 0.05–0.3, and OrbColumn attenuates three
 * of its five bars further (×0.8 / ×0.6 / ×0.3), so those bars were pinned to
 * the floor at every volume and only the centre bar moved — by about 3px.
 */
describe('meterHeight', () => {
  it('rests at the floor for silence', () => {
    expect(meterHeight(0)).toBe(METER_FLOOR_PCT)
  })

  it('fills the bar at full scale', () => {
    expect(meterHeight(1)).toBe(100)
  })

  it('spans floor to full across the range speech actually occupies', () => {
    // Anything at or above the gain's reciprocal is full scale.
    expect(meterHeight(0.5)).toBe(100)
    const quiet = meterHeight(0.02)
    expect(quiet).toBeGreaterThan(METER_FLOOR_PCT)
    expect(quiet).toBeLessThan(30)
  })

  it('lifts every attenuated band clear of the floor at a speaking level', () => {
    // A representative speech RMS, run through OrbColumn's own band weights.
    const rms = 0.15
    for (const weight of [0.8, 0.6, 0.3]) {
      expect(meterHeight(rms * weight)).toBeGreaterThan(METER_FLOOR_PCT)
    }
  })

  it('keeps distinct band levels visually distinct', () => {
    const rms = 0.15
    const [bass, mid, high] = [0.8, 0.6, 0.3].map((w) => meterHeight(rms * w))
    expect(bass).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
  })

  it('rises monotonically with level', () => {
    expect(meterHeight(0.05)).toBeLessThan(meterHeight(0.1))
    expect(meterHeight(0.1)).toBeLessThan(meterHeight(0.2))
  })

  it('never renders outside the bar for junk input', () => {
    // NaN reaches the DOM as `height: NaN%`, which drops the declaration and
    // freezes the bar at its last height.
    for (const junk of [NaN, Infinity, -1, -0.5]) {
      const h = meterHeight(junk)
      expect(Number.isFinite(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(METER_FLOOR_PCT)
      expect(h).toBeLessThanOrEqual(100)
    }
  })
})
