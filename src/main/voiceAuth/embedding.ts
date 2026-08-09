/**
 * Speaker + phrase matching.
 *
 * Two independent signals, both required:
 *
 *   speaker score — cosine similarity between statistics-pooled embeddings
 *     (per-dimension mean and standard deviation over all frames). Order-free,
 *     so it answers "is this the same voice" without caring what was said.
 *
 *   phrase score — DTW alignment cost against the enrolled templates. Order is
 *     everything here, so it answers "was this the same phrase, said the same
 *     way". This is what makes the scheme text-*dependent*; drop it and a
 *     recording of the user saying anything at all would pass.
 *
 * Neither alone is sufficient. A good impersonator beats the first; a
 * text-to-speech clone of the wrong voice beats the second.
 */

import { N_CEPS, SPEAKER_DIM, type FeatureFrames } from './dsp'

const FRAME_DIM = N_CEPS * 3 // 39, the DTW view
const EMBED_DIM = SPEAKER_DIM * 2 // 24 — mean ‖ stddev over the speaker view

/** Templates are stored at 20 ms hop — halves storage and DTW cost, costs nothing measurable in accuracy. */
const TEMPLATE_STRIDE = 2
/** Sakoe-Chiba band as a fraction of the longer sequence. Bounds DTW to O(n·band). */
const DTW_BAND = 0.25
/** Maps mean per-frame DTW distance onto (0,1]. Larger = more forgiving. */
const DTW_SCALE = 6.0

const SPEAKER_WEIGHT = 0.55
const PHRASE_WEIGHT = 0.45

/**
 * Calibration constants. These are the honest weak point of the whole module:
 * without a labelled impostor set there is no principled way to pick them, so
 * they are deliberately conservative (biased towards false rejection, which
 * costs a retry, over false acceptance, which costs the lock). The threshold
 * is then personalised per user from enrolment spread — see calibrate().
 */
const THRESHOLD_SIGMA = 2.2
const THRESHOLD_FLOOR = 0.55
const THRESHOLD_CEILING = 0.88

export interface VoiceTemplate {
  version: 1
  /** L2-normalised pooled embedding averaged across enrolment samples. */
  centroid: Float32Array
  /** One frame matrix per enrolment sample, at TEMPLATE_STRIDE hop. */
  templates: Float32Array[][]
  threshold: number
  /** Mean pairwise score across enrolment samples — how repeatable the user is. */
  consistency: number
  createdAt: number
}

export interface MatchResult {
  speakerScore: number
  phraseScore: number
  combined: number
  /** Frame index in the trial where the enrolled phrase stops aligning. */
  phraseEndFrame: number
  trialFrames: number
}

// ── Pooling ──

/**
 * Mean ‖ stddev over the *speaker* frames, L2-normalised.
 *
 * Must be fed FeatureFrames.speakerFrames, never the CMVN'd DTW frames —
 * pooling those yields a constant vector for every speaker. See the note on
 * FeatureFrames in dsp.ts.
 */
export function poolEmbedding(speakerFrames: Float32Array[]): Float32Array {
  const out = new Float32Array(EMBED_DIM)
  if (speakerFrames.length === 0) return out

  for (const f of speakerFrames) {
    for (let k = 0; k < SPEAKER_DIM; k++) out[k] += f[k]
  }
  for (let k = 0; k < SPEAKER_DIM; k++) out[k] /= speakerFrames.length

  for (const f of speakerFrames) {
    for (let k = 0; k < SPEAKER_DIM; k++) {
      const d = f[k] - out[k]
      out[SPEAKER_DIM + k] += d * d
    }
  }
  for (let k = 0; k < SPEAKER_DIM; k++) {
    out[SPEAKER_DIM + k] = Math.sqrt(out[SPEAKER_DIM + k] / speakerFrames.length)
  }

  // Centre each half before normalising.
  //
  // Without this the stddev half is entirely positive, so every embedding
  // points into the same orthant and cosine similarity saturates: genuine and
  // impostor land at 1.00 and 0.93, a 0.07 spread. The speaker term would then
  // contribute almost nothing to the combined score regardless of the weight
  // it is nominally given. Centring removes that shared DC component and lets
  // cosine use its actual range.
  centre(out, 0, SPEAKER_DIM)
  centre(out, SPEAKER_DIM, EMBED_DIM)

  return l2Normalise(out)
}

/** Subtracts the mean of v[from..to) from that slice, in place. */
function centre(v: Float32Array, from: number, to: number): void {
  let mean = 0
  for (let i = from; i < to; i++) mean += v[i]
  mean /= to - from
  for (let i = from; i < to; i++) v[i] -= mean
}

function l2Normalise(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) + 1e-9
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/**
 * Cosine similarity, clamped to [0,1] rather than affinely remapped.
 *
 * The obvious `(cos + 1) / 2` rescale halves the usable dynamic range and
 * pushes every real comparison into the top of the scale, which is how the
 * speaker term ends up contributing far less than its nominal weight. Since
 * the embeddings are centred, a negative cosine already means "unrelated" —
 * folding those to 0 loses nothing and keeps the full spread.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Math.max(0, Math.min(1, dot))
}

// ── DTW ──

export function downsample(frames: Float32Array[], stride = TEMPLATE_STRIDE): Float32Array[] {
  if (stride <= 1) return frames
  const out: Float32Array[] = []
  for (let i = 0; i < frames.length; i += stride) out.push(frames[i])
  return out
}

function frameDistance(a: Float32Array, b: Float32Array): number {
  let acc = 0
  for (let k = 0; k < FRAME_DIM; k++) {
    const d = a[k] - b[k]
    acc += d * d
  }
  return Math.sqrt(acc)
}

/**
 * Open-end DTW: aligns the whole of `template` against a *prefix* of `trial`.
 *
 * Classic DTW forces both sequences to end together, which would penalise the
 * liveness suffix as a mismatch. Ending anywhere on the last row instead gives
 * us two things at once — the alignment cost for the phrase score, and the
 * frame where the phrase stops, which is where the challenge digits begin.
 */
function openEndDtw(
  template: Float32Array[],
  trial: Float32Array[]
): { cost: number; endIndex: number } {
  const n = template.length
  const m = trial.length
  if (n === 0 || m === 0) return { cost: Infinity, endIndex: 0 }

  const band = Math.max(8, Math.floor(Math.max(n, m) * DTW_BAND))
  const INF = Infinity

  // Two rolling rows of (accumulated cost, path length) — path length is
  // tracked so the final cost can be length-normalised, otherwise longer
  // alignments are unfairly penalised.
  let prevCost = new Float64Array(m + 1).fill(INF)
  let prevLen = new Float64Array(m + 1)
  let currCost = new Float64Array(m + 1)
  let currLen = new Float64Array(m + 1)
  prevCost[0] = 0

  for (let i = 1; i <= n; i++) {
    currCost.fill(INF)
    currLen.fill(0)
    // Band is anchored on the diagonal mapping i → i·m/n.
    const centre = Math.round((i * m) / n)
    const lo = Math.max(1, centre - band)
    const hi = Math.min(m, centre + band)

    for (let j = lo; j <= hi; j++) {
      const d = frameDistance(template[i - 1], trial[j - 1])

      let bestCost = prevCost[j - 1] // diagonal
      let bestLen = prevLen[j - 1]
      if (prevCost[j] < bestCost) {
        bestCost = prevCost[j]
        bestLen = prevLen[j]
      }
      if (currCost[j - 1] < bestCost) {
        bestCost = currCost[j - 1]
        bestLen = currLen[j - 1]
      }
      if (bestCost === INF) continue

      currCost[j] = bestCost + d
      currLen[j] = bestLen + 1
    }

    const swapCost = prevCost
    prevCost = currCost
    currCost = swapCost
    const swapLen = prevLen
    prevLen = currLen
    currLen = swapLen
  }

  // prevCost now holds the final row. Take the best normalised end point.
  let best = INF
  let endIndex = m
  for (let j = 1; j <= m; j++) {
    if (prevCost[j] === INF || prevLen[j] === 0) continue
    const normalised = prevCost[j] / prevLen[j]
    if (normalised < best) {
      best = normalised
      endIndex = j
    }
  }
  return { cost: best, endIndex }
}

/** Squashes mean per-frame DTW distance into (0,1]. */
function phraseScoreFromCost(cost: number): number {
  if (!Number.isFinite(cost)) return 0
  return Math.exp(-cost / DTW_SCALE)
}

// ── Matching ──

/**
 * Scores a trial utterance against an enrolled template. Takes the best
 * matching enrolment sample rather than an average — enrolment samples vary in
 * quality and one bad take should not drag every future verification down.
 */
export function match(template: VoiceTemplate, features: FeatureFrames): MatchResult {
  const trial = downsample(features.frames)
  const speakerScore = cosineSimilarity(template.centroid, poolEmbedding(features.speakerFrames))

  let bestPhrase = 0
  let bestEnd = trial.length
  for (const sample of template.templates) {
    const { cost, endIndex } = openEndDtw(sample, trial)
    const score = phraseScoreFromCost(cost)
    if (score > bestPhrase) {
      bestPhrase = score
      bestEnd = endIndex
    }
  }

  return {
    speakerScore,
    phraseScore: bestPhrase,
    combined: SPEAKER_WEIGHT * speakerScore + PHRASE_WEIGHT * bestPhrase,
    // Re-expressed at the trial's native frame rate for the caller's duration maths.
    phraseEndFrame: bestEnd * TEMPLATE_STRIDE,
    trialFrames: features.frames.length,
  }
}

/** Pairwise score between two utterances — used during enrolment calibration. */
export function pairScore(a: FeatureFrames, b: FeatureFrames): number {
  const speaker = cosineSimilarity(poolEmbedding(a.speakerFrames), poolEmbedding(b.speakerFrames))
  const { cost } = openEndDtw(downsample(a.frames), downsample(b.frames))
  return SPEAKER_WEIGHT * speaker + PHRASE_WEIGHT * phraseScoreFromCost(cost)
}

/**
 * Builds the stored template from enrolment samples and personalises the
 * decision threshold from how tightly the samples agree with each other.
 *
 * A user with a very steady voice gets a high threshold (tight, more secure);
 * a user whose takes vary gets a lower one (looser, or they could never get in).
 * Clamped at both ends so an unusually consistent — or unusably scattered —
 * enrolment cannot produce a threshold that is impossible or meaningless.
 */
export function calibrate(samples: FeatureFrames[]): VoiceTemplate {
  const scores: number[] = []
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      scores.push(pairScore(samples[i], samples[j]))
    }
  }

  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.75
  const variance = scores.length
    ? scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length
    : 0.01
  const std = Math.sqrt(variance)

  const threshold = Math.min(
    THRESHOLD_CEILING,
    Math.max(THRESHOLD_FLOOR, mean - THRESHOLD_SIGMA * std)
  )

  const centroid = new Float32Array(EMBED_DIM)
  for (const s of samples) {
    const e = poolEmbedding(s.speakerFrames)
    for (let k = 0; k < EMBED_DIM; k++) centroid[k] += e[k]
  }
  l2Normalise(centroid)

  return {
    version: 1,
    centroid,
    templates: samples.map((s) => downsample(s.frames)),
    threshold,
    consistency: mean,
    createdAt: Date.now(),
  }
}

// ── Serialisation ──
// Float arrays go to base64 rather than JSON number lists: a 300-frame template
// is ~47 KB raw but ~600 KB as JSON text, and all of it gets encrypted and
// written to SQLite on every enrolment.

interface SerialisedMatrix {
  rows: number
  dim: number
  data: string
}

function encodeMatrix(frames: Float32Array[]): SerialisedMatrix {
  const dim = frames[0]?.length ?? FRAME_DIM
  const flat = new Float32Array(frames.length * dim)
  frames.forEach((f, i) => flat.set(f, i * dim))
  return {
    rows: frames.length,
    dim,
    data: Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64'),
  }
}

function decodeMatrix(m: SerialisedMatrix): Float32Array[] {
  const buf = Buffer.from(m.data, 'base64')
  // Copy rather than view: Buffer.from(base64) has no alignment guarantee, and
  // an unaligned byteOffset makes the Float32Array constructor throw.
  const flat = new Float32Array(m.rows * m.dim)
  Buffer.from(flat.buffer).set(buf.subarray(0, flat.byteLength))
  const out: Float32Array[] = []
  for (let i = 0; i < m.rows; i++) out.push(flat.subarray(i * m.dim, (i + 1) * m.dim))
  return out
}

export function serialiseTemplate(t: VoiceTemplate): string {
  return JSON.stringify({
    version: t.version,
    centroid: Buffer.from(
      t.centroid.buffer,
      t.centroid.byteOffset,
      t.centroid.byteLength
    ).toString('base64'),
    templates: t.templates.map(encodeMatrix),
    threshold: t.threshold,
    consistency: t.consistency,
    createdAt: t.createdAt,
  })
}

export function deserialiseTemplate(json: string): VoiceTemplate | null {
  try {
    const raw = JSON.parse(json)
    if (raw.version !== 1) return null
    const centroidBuf = Buffer.from(raw.centroid, 'base64')
    const centroid = new Float32Array(EMBED_DIM)
    Buffer.from(centroid.buffer).set(centroidBuf.subarray(0, centroid.byteLength))
    return {
      version: 1,
      centroid,
      templates: raw.templates.map(decodeMatrix),
      threshold: raw.threshold,
      consistency: raw.consistency,
      createdAt: raw.createdAt,
    }
  } catch {
    return null
  }
}
