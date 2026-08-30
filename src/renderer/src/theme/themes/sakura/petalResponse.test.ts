import { describe, it, expect } from 'vitest'
import { responseFor, approach, PULL_TAU } from './petalResponse'

describe('sakura petal response', () => {
  it('pulls petals toward the response area only while a reply is being produced', () => {
    expect(responseFor('processing').pull).toBe(1)
    expect(responseFor('speaking').pull).toBeGreaterThan(0)
    // Nothing has been generated yet, so there is nowhere to pull toward.
    expect(responseFor('listening').pull).toBe(0)
    expect(responseFor('idle').pull).toBe(0)
  })

  it('stills the field on error without stopping it', () => {
    const { calm } = responseFor('error')
    expect(calm).toBeLessThan(0.5)
    // A layer frozen at exactly zero reads as a crash, not as atmosphere.
    expect(calm).toBeGreaterThan(0)
  })

  it('quickens slightly while listening', () => {
    expect(responseFor('listening').calm).toBeGreaterThan(responseFor('idle').calm)
  })

  it('treats unknown-but-benign states as idle', () => {
    expect(responseFor('success')).toEqual(responseFor('idle'))
  })

  it('eases toward a target instead of snapping to it', () => {
    const afterOneFrame = approach(0, 1, 16)
    expect(afterOneFrame).toBeGreaterThan(0)
    // One 16ms frame must cover only a sliver of an 800ms transition — this is
    // the assertion that would fail if the easing were replaced by a hard set.
    expect(afterOneFrame).toBeLessThan(0.05)
  })

  it('converges on the target and stops there', () => {
    let v = 0
    // 1000 frames at 16ms is 20 time constants, which is convergence to well
    // under the tolerance; 400 frames is only 8 and still leaves 3e-4 on the
    // table, which is a fact about the exponential, not a defect.
    for (let i = 0; i < 1000; i++) v = approach(v, 1, 16)
    expect(v).toBeCloseTo(1, 4)
    expect(approach(1, 1, 16)).toBe(1)
  })

  it('is frame-rate independent', () => {
    // The layer is throttled to 60fps on a display that may run at 180, so the
    // same elapsed time must produce the same result however it is subdivided.
    const oneBigStep = approach(0, 1, 32)
    const twoSmallSteps = approach(approach(0, 1, 16), 1, 16)
    expect(twoSmallSteps).toBeCloseTo(oneBigStep, 10)
  })

  it('falls back to a real time constant', () => {
    expect(PULL_TAU).toBeGreaterThan(0)
    expect(approach(0, 1, PULL_TAU)).toBeCloseTo(1 - Math.exp(-1), 10)
  })
})
