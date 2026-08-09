/**
 * Speech feature extraction — MFCC front-end, dependency-free.
 *
 * Why hand-rolled DSP instead of TensorFlow.js + a speaker model:
 *
 *   - Startup cost. The brief caps the embedding model at 15 MB; @tensorflow/tfjs
 *     plus a WASM/WebGL backend spends most of that budget before any weights
 *     load, and it loads on the lock screen — the one place a cold start is
 *     most visible.
 *   - Availability. There is no drop-in, offline, permissively-licensed
 *     text-dependent speaker-verification checkpoint we can vendor and trust.
 *     Wiring one up is a research task, not an integration task.
 *   - Honesty. A classical MFCC + DTW pipeline is weaker than an ECAPA/x-vector
 *     embedding at rejecting a determined impostor, but it is *predictable*,
 *     auditable in a few hundred lines, and costs ~5 ms per second of audio.
 *
 * The whole front-end is therefore hidden behind the FeatureExtractor shape in
 * embedding.ts, so a neural extractor can replace it without touching storage,
 * crypto, IPC or UI. If this app ever needs real biometric strength, that swap
 * is the intended path — not tuning the constants below.
 */

export const SAMPLE_RATE = 16_000
const FRAME_MS = 25
const HOP_MS = 10
export const FRAME_LEN = (SAMPLE_RATE * FRAME_MS) / 1000 // 400
export const HOP_LEN = (SAMPLE_RATE * HOP_MS) / 1000 // 160
const N_FFT = 512
const N_MEL = 26
export const N_CEPS = 13
const F_MIN = 80
const F_MAX = 7600
const PRE_EMPHASIS = 0.97

/** Frames quieter than this many dB below the utterance peak are not speech. */
const VAD_RANGE_DB = 35
/** Absolute floor — guards against an all-silence buffer having a "peak". */
const VAD_ABS_FLOOR_DB = -62
const CLIP_THRESHOLD = 0.985
const CLIP_FRACTION_LIMIT = 0.01

/** Cepstra kept for the speaker embedding: c1..c12, i.e. everything but c0. */
export const SPEAKER_DIM = N_CEPS - 1

export interface FeatureFrames {
  /**
   * [frames][N_CEPS * 3] — MFCC + delta + delta-delta, mean/variance
   * normalised. Feeds DTW only.
   */
  frames: Float32Array[]
  /**
   * [frames][SPEAKER_DIM] — c1..c12, per-frame L2 normalised. Feeds the pooled
   * speaker embedding.
   *
   * Kept as a separate view because CMVN destroys the speaker signal: it
   * forces every utterance to zero mean and unit variance per dimension, so
   * pooling mean and stddev off those frames returns the constant vector
   * [0…0, 1…1] for everyone. Discriminative power would silently collapse to
   * whatever DTW alone provides.
   *
   * Per-frame L2 normalisation instead removes overall gain — the nuisance
   * that actually varies shot to shot — while preserving the spectral envelope
   * shape, which is where vocal-tract identity lives. c0 is dropped for the
   * same reason: it is pure frame energy.
   */
  speakerFrames: Float32Array[]
  quality: {
    durationMs: number
    snrDb: number
    clipped: boolean
    speechFrames: number
  }
}

// ── Resampling ──

/**
 * Linear resample to 16 kHz. Speech features tolerate the mild aliasing far
 * better than they tolerate the latency of a windowed-sinc pass, and the mel
 * filterbank tops out at 7.6 kHz anyway.
 */
export function resample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input
  const ratio = fromRate / SAMPLE_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

// ── FFT ──

/** Precomputed twiddles + bit-reversal table for a fixed N. Built once. */
class FFT {
  private readonly n: number
  private readonly levels: number
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly rev: Uint32Array

  constructor(n: number) {
    this.n = n
    this.levels = Math.log2(n)
    if (!Number.isInteger(this.levels)) throw new Error('FFT size must be a power of two')
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((2 * Math.PI * i) / n)
    }
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let x = i
      let r = 0
      for (let b = 0; b < this.levels; b++) {
        r = (r << 1) | (x & 1)
        x >>= 1
      }
      this.rev[i] = r
    }
  }

  /** In-place iterative radix-2. `re`/`im` are length n and are overwritten. */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cos, sin } = this
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half
          const tre = re[l] * cos[k] + im[l] * sin[k]
          const tim = -re[l] * sin[k] + im[l] * cos[k]
          re[l] = re[j] - tre
          im[l] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}

const fft = new FFT(N_FFT)

// ── Filterbank (built once) ──

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

/** Triangular mel filters as [startBin, weights] pairs — sparse, so the inner loop is short. */
const MEL_FILTERS: Array<{ start: number; weights: Float32Array }> = (() => {
  const nBins = N_FFT / 2 + 1
  const melMin = hzToMel(F_MIN)
  const melMax = hzToMel(F_MAX)
  const points = new Float64Array(N_MEL + 2)
  for (let i = 0; i < points.length; i++) {
    const hz = melToHz(melMin + ((melMax - melMin) * i) / (N_MEL + 1))
    points[i] = Math.floor(((N_FFT + 1) * hz) / SAMPLE_RATE)
  }
  const filters: Array<{ start: number; weights: Float32Array }> = []
  for (let m = 1; m <= N_MEL; m++) {
    const left = points[m - 1]
    const centre = points[m]
    const right = points[m + 1]
    const start = Math.max(0, left)
    const end = Math.min(nBins - 1, right)
    const weights = new Float32Array(Math.max(0, end - start + 1))
    for (let bin = start; bin <= end; bin++) {
      let w = 0
      if (bin >= left && bin <= centre && centre !== left) w = (bin - left) / (centre - left)
      else if (bin > centre && bin <= right && right !== centre) w = (right - bin) / (right - centre)
      weights[bin - start] = w
    }
    filters.push({ start, weights })
  }
  return filters
})()

/** DCT-II basis, [N_CEPS][N_MEL]. */
const DCT_BASIS: Float64Array[] = (() => {
  const basis: Float64Array[] = []
  for (let k = 0; k < N_CEPS; k++) {
    const row = new Float64Array(N_MEL)
    for (let m = 0; m < N_MEL; m++) {
      row[m] = Math.cos((Math.PI * k * (m + 0.5)) / N_MEL)
    }
    basis.push(row)
  }
  return basis
})()

const HAMMING: Float64Array = (() => {
  const w = new Float64Array(FRAME_LEN)
  for (let i = 0; i < FRAME_LEN; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1))
  }
  return w
})()

// ── Pipeline ──

/**
 * PCM → normalised MFCC+delta frames, with silence trimmed from both ends.
 * Returns null when there is no usable speech at all.
 */
export function extractFeatures(pcmIn: Float32Array, sampleRate: number): FeatureFrames | null {
  const pcm = resample(pcmIn, sampleRate)
  const durationMs = (pcm.length / SAMPLE_RATE) * 1000
  if (pcm.length < FRAME_LEN * 2) return null

  let clippedSamples = 0
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) >= CLIP_THRESHOLD) clippedSamples++
  }
  const clipped = clippedSamples / pcm.length > CLIP_FRACTION_LIMIT

  // Pre-emphasis, out-of-place so the caller's buffer is untouched.
  const emph = new Float32Array(pcm.length)
  emph[0] = pcm[0]
  for (let i = 1; i < pcm.length; i++) emph[i] = pcm[i] - PRE_EMPHASIS * pcm[i - 1]

  const nFrames = 1 + Math.floor((emph.length - FRAME_LEN) / HOP_LEN)
  if (nFrames < 4) return null

  const cepstra: Float32Array[] = []
  const logEnergy = new Float64Array(nFrames)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const melEnergies = new Float64Array(N_MEL)

  for (let f = 0; f < nFrames; f++) {
    const offset = f * HOP_LEN

    let energy = 0
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < FRAME_LEN; i++) {
      const s = emph[offset + i]
      energy += s * s
      re[i] = s * HAMMING[i]
    }
    logEnergy[f] = 10 * Math.log10(energy / FRAME_LEN + 1e-10)

    fft.transform(re, im)

    for (let m = 0; m < N_MEL; m++) {
      const { start, weights } = MEL_FILTERS[m]
      let acc = 0
      for (let w = 0; w < weights.length; w++) {
        const bin = start + w
        const power = (re[bin] * re[bin] + im[bin] * im[bin]) / N_FFT
        acc += power * weights[w]
      }
      melEnergies[m] = Math.log(acc + 1e-10)
    }

    const c = new Float32Array(N_CEPS)
    for (let k = 0; k < N_CEPS; k++) {
      const row = DCT_BASIS[k]
      let acc = 0
      for (let m = 0; m < N_MEL; m++) acc += melEnergies[m] * row[m]
      c[k] = acc
    }
    cepstra.push(c)
  }

  // ── Voice activity: keep the contiguous span between first and last speech
  // frame. Trimming only the ends preserves intra-phrase timing, which is what
  // DTW keys on for the text-dependent half of the score.
  let peak = -Infinity
  for (let f = 0; f < nFrames; f++) peak = Math.max(peak, logEnergy[f])
  const vadFloor = Math.max(peak - VAD_RANGE_DB, VAD_ABS_FLOOR_DB)

  let first = -1
  let last = -1
  let speechFrames = 0
  let speechSum = 0
  let noiseSum = 0
  let noiseCount = 0
  for (let f = 0; f < nFrames; f++) {
    if (logEnergy[f] >= vadFloor) {
      if (first < 0) first = f
      last = f
      speechFrames++
      speechSum += logEnergy[f]
    } else {
      noiseSum += logEnergy[f]
      noiseCount++
    }
  }
  if (first < 0 || last - first < 4) return null

  const snrDb =
    noiseCount > 0 ? speechSum / speechFrames - noiseSum / noiseCount : VAD_RANGE_DB

  const trimmed = cepstra.slice(first, last + 1)

  // Build the speaker view *before* CMVN touches anything — see FeatureFrames.
  const speakerFrames = trimmed.map(gainNormalisedCepstra)

  const withDeltas = appendDeltas(trimmed)
  cmvn(withDeltas)

  return {
    frames: withDeltas,
    speakerFrames,
    quality: { durationMs, snrDb, clipped, speechFrames },
  }
}

/** Drops c0 (frame energy) and L2-normalises the rest, cancelling overall gain. */
function gainNormalisedCepstra(frame: Float32Array): Float32Array {
  const out = new Float32Array(SPEAKER_DIM)
  let norm = 0
  for (let k = 0; k < SPEAKER_DIM; k++) {
    const v = frame[k + 1]
    out[k] = v
    norm += v * v
  }
  norm = Math.sqrt(norm) + 1e-9
  for (let k = 0; k < SPEAKER_DIM; k++) out[k] /= norm
  return out
}

/** Regression deltas (window ±2) and delta-deltas, concatenated onto each frame. */
function appendDeltas(frames: Float32Array[]): Float32Array[] {
  const d1 = regressionDelta(frames, N_CEPS)
  const d2 = regressionDelta(d1, N_CEPS)
  return frames.map((f, i) => {
    const out = new Float32Array(N_CEPS * 3)
    out.set(f, 0)
    out.set(d1[i], N_CEPS)
    out.set(d2[i], N_CEPS * 2)
    return out
  })
}

function regressionDelta(seq: Float32Array[], dim: number): Float32Array[] {
  const n = seq.length
  const W = 2
  const denom = 2 * (1 * 1 + 2 * 2) // 10
  const out: Float32Array[] = []
  for (let i = 0; i < n; i++) {
    const d = new Float32Array(dim)
    for (let k = 0; k < dim; k++) {
      let acc = 0
      for (let t = 1; t <= W; t++) {
        const ahead = seq[Math.min(n - 1, i + t)][k]
        const behind = seq[Math.max(0, i - t)][k]
        acc += t * (ahead - behind)
      }
      d[k] = acc / denom
    }
    out.push(d)
  }
  return out
}

/**
 * Per-utterance cepstral mean and variance normalisation, in place.
 *
 * This is the single most important step for cross-session robustness: it
 * cancels the fixed channel response of the microphone and room. Without it a
 * user who enrols on a headset and verifies on a laptop mic fails every time.
 */
function cmvn(frames: Float32Array[]): void {
  if (frames.length === 0) return
  const dim = frames[0].length
  const mean = new Float64Array(dim)
  const variance = new Float64Array(dim)

  for (const f of frames) for (let k = 0; k < dim; k++) mean[k] += f[k]
  for (let k = 0; k < dim; k++) mean[k] /= frames.length

  for (const f of frames) {
    for (let k = 0; k < dim; k++) {
      const d = f[k] - mean[k]
      variance[k] += d * d
    }
  }
  for (let k = 0; k < dim; k++) variance[k] = Math.sqrt(variance[k] / frames.length) + 1e-8

  for (const f of frames) {
    for (let k = 0; k < dim; k++) f[k] = (f[k] - mean[k]) / variance[k]
  }
}
