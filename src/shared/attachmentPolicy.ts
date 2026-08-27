/**
 * What may be attached to a message, and why something was refused.
 *
 * Lives in shared/ because both sides need it: the renderer to refuse a file
 * the moment it is dropped, and main to enforce the same rule on the way in.
 * The renderer's copy is a courtesy; main's is the one that counts.
 *
 * The byte ceilings mirror the Anthropic API's documented limits for image and
 * PDF blocks. They are named constants rather than inline numbers so that when
 * those limits change there is exactly one place to correct.
 */

/** Image formats the Anthropic API accepts as `image` blocks. */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** Document formats accepted as `document` blocks. */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf'] as const

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 32 * 1024 * 1024

/**
 * Base64 inflates payloads by about a third, and the whole turn travels as one
 * request, so a per-file limit alone is not enough to keep a turn sendable.
 */
export const MAX_TURN_BYTES = 32 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_TURN = 10

export type AttachmentKind = 'image' | 'document'

export interface AttachmentCandidate {
  name: string
  mimeType: string
  byteSize: number
}

export type PolicyVerdict =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; reason: string }

/**
 * U+00A0. Held in a named constant because it is indistinguishable from a plain
 * space on screen, and an editor that silently "fixes" it would break the
 * assertions in attachmentPolicy.test.ts rather than fail quietly.
 */
const NBSP = ' '

function formatMb(bytes: number): string {
  // A number and its unit should not be split across a line break, so they are
  // glued. Every limit here is a whole number of MB.
  return `${Math.round(bytes / (1024 * 1024))}${NBSP}MB`
}

export function classify(mimeType: string): AttachmentKind | null {
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) return 'image'
  if ((ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(mimeType)) return 'document'
  return null
}

/**
 * Judges one candidate against the already-accepted set.
 *
 * Every rejection names the limit, because "unsupported file" leaves someone
 * guessing at which of several rules they broke.
 */
export function checkAttachment(
  candidate: AttachmentCandidate,
  existing: AttachmentCandidate[] = []
): PolicyVerdict {
  const kind = classify(candidate.mimeType)
  if (!kind) {
    return {
      ok: false,
      reason: `${candidate.name} is a ${candidate.mimeType || 'unknown'} file. Attach a PNG, JPEG, GIF, WebP, or PDF.`,
    }
  }

  if (candidate.byteSize <= 0) {
    return { ok: false, reason: `${candidate.name} is empty.` }
  }

  if (existing.length >= MAX_ATTACHMENTS_PER_TURN) {
    return {
      ok: false,
      reason: `A message can carry ${MAX_ATTACHMENTS_PER_TURN} attachments. Send these, then attach the rest.`,
    }
  }

  const perFileLimit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES
  if (candidate.byteSize > perFileLimit) {
    return {
      ok: false,
      reason: `${candidate.name} is ${formatMb(candidate.byteSize)}. The limit for ${kind === 'image' ? 'images' : 'PDFs'} is ${formatMb(perFileLimit)}.`,
    }
  }

  const turnTotal = existing.reduce((sum, a) => sum + a.byteSize, 0) + candidate.byteSize
  if (turnTotal > MAX_TURN_BYTES) {
    return {
      ok: false,
      reason: `That would put this message over ${formatMb(MAX_TURN_BYTES)} of attachments. Send what you have first.`,
    }
  }

  return { ok: true, kind }
}
