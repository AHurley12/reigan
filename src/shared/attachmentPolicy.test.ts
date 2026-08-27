import { describe, expect, it } from 'vitest'
import {
  checkAttachment,
  classify,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TURN_BYTES,
  type AttachmentCandidate,
} from './attachmentPolicy'

const png = (over: Partial<AttachmentCandidate> = {}): AttachmentCandidate => ({
  name: 'shot.png',
  mimeType: 'image/png',
  byteSize: 1024,
  ...over,
})

describe('classification', () => {
  it('recognises the image formats the API accepts', () => {
    expect(classify('image/png')).toBe('image')
    expect(classify('image/jpeg')).toBe('image')
    expect(classify('image/gif')).toBe('image')
    expect(classify('image/webp')).toBe('image')
  })

  it('recognises PDFs as documents', () => {
    expect(classify('application/pdf')).toBe('document')
  })

  it('refuses anything else', () => {
    expect(classify('image/svg+xml')).toBeNull()
    expect(classify('text/plain')).toBeNull()
    expect(classify('')).toBeNull()
  })
})

describe('rejections name the limit that was broken', () => {
  it('says which formats are allowed for an unsupported type', () => {
    const verdict = checkAttachment(png({ name: 'diagram.svg', mimeType: 'image/svg+xml' }))

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toContain('diagram.svg')
      expect(verdict.reason).toMatch(/PNG.*PDF/)
    }
  })

  it('states the size limit rather than just refusing', () => {
    const verdict = checkAttachment(png({ byteSize: MAX_IMAGE_BYTES + 1 }))

    expect(verdict.ok).toBe(false)
    // Non-breaking space between the number and the unit — asserted explicitly
    // so a future edit cannot quietly replace it with a plain space.
    if (!verdict.ok) expect(verdict.reason).toContain('5 MB')
  })

  it('holds PDFs to their own, larger limit', () => {
    const big = { name: 'spec.pdf', mimeType: 'application/pdf', byteSize: MAX_IMAGE_BYTES + 1 }

    // Over the image limit, well under the PDF one.
    expect(checkAttachment(big).ok).toBe(true)
    expect(checkAttachment({ ...big, byteSize: MAX_PDF_BYTES + 1 }).ok).toBe(false)
  })

  it('refuses an empty file', () => {
    expect(checkAttachment(png({ byteSize: 0 })).ok).toBe(false)
  })
})

describe('limits that depend on what is already attached', () => {
  it('caps the number of attachments on one turn', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS_PER_TURN }, () => png())

    const verdict = checkAttachment(png(), existing)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain(String(MAX_ATTACHMENTS_PER_TURN))
  })

  it('caps the total bytes on one turn, since they travel as a single request', () => {
    // Each is legal alone; together they exceed what one request can carry.
    const existing = [{ name: 'a.pdf', mimeType: 'application/pdf', byteSize: MAX_TURN_BYTES - 100 }]

    const verdict = checkAttachment(png({ byteSize: 500 }), existing)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('32 MB')
  })

  it('accepts a file that fits alongside what is already there', () => {
    expect(checkAttachment(png(), [png()])).toEqual({ ok: true, kind: 'image' })
  })
})

describe('acceptance', () => {
  it('reports the kind, so the caller does not classify a second time', () => {
    expect(checkAttachment(png())).toEqual({ ok: true, kind: 'image' })
    expect(checkAttachment({ name: 'a.pdf', mimeType: 'application/pdf', byteSize: 10 })).toEqual({
      ok: true,
      kind: 'document',
    })
  })

  it('accepts a file exactly at the limit', () => {
    expect(checkAttachment(png({ byteSize: MAX_IMAGE_BYTES })).ok).toBe(true)
  })
})
