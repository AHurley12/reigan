import { describe, expect, it } from 'vitest'
import {
  FILE_TYPE_CATEGORIES,
  categorizeExt,
  matchesCategory,
} from './constants'
import type { FileTypeCategoryId } from './types'

/**
 * The Files panel's type tabs are only as good as this table, and its failure
 * mode is quiet: a plausible extension nobody listed lands in Other, and the
 * tab looks broken rather than incomplete. Windows shipped exactly that bug —
 * .divx and .flv were missing from `kind:video` for years.
 *
 * So the mapping is pinned rather than trusted.
 */

const TABS = FILE_TYPE_CATEGORIES.map((c) => c.id)

describe('file type taxonomy', () => {
  it('exposes the tabs the panel renders, All first and Other last', () => {
    expect(TABS).toEqual(['all', 'documents', 'images', 'code', 'media', 'archives', 'other'])
  })

  it('gives All and Other no extension list — both are computed, not enumerated', () => {
    expect(FILE_TYPE_CATEGORIES.find((c) => c.id === 'all')?.exts).toBeUndefined()
    expect(FILE_TYPE_CATEGORIES.find((c) => c.id === 'other')?.exts).toBeUndefined()
  })

  it('never lets two categories claim the same extension', () => {
    // The map is built with Object.fromEntries, so a duplicate does not throw —
    // the last category listed silently wins. .ts (TypeScript vs MPEG transport
    // stream) and .mts are the live collisions; code owns both deliberately.
    const owners = new Map<string, FileTypeCategoryId[]>()
    for (const c of FILE_TYPE_CATEGORIES) {
      for (const ext of c.exts ?? []) {
        owners.set(ext, [...(owners.get(ext) ?? []), c.id])
      }
    }
    const contested = [...owners.entries()].filter(([, ids]) => ids.length > 1)
    expect(contested).toEqual([])
  })

  it('stores extensions the way the indexer produces them: lowercase, no dot', () => {
    // fileIndexer derives ext via extname(name).slice(1).toLowerCase(); anything
    // stored here with a dot or a capital simply never matches.
    for (const c of FILE_TYPE_CATEGORIES) {
      for (const ext of c.exts ?? []) {
        expect(ext, `${c.id} → ${ext}`).toBe(ext.toLowerCase())
        expect(ext.startsWith('.'), `${c.id} → ${ext}`).toBe(false)
        expect(ext.length, `${c.id} → ${ext}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('categorizeExt', () => {
  const cases: Array<[FileTypeCategoryId, string[]]> = [
    ['documents', ['pdf', 'docx', 'txt', 'md', 'markdown', 'rtf', 'xlsx', 'csv', 'tsv', 'pptx', 'epub', 'log', 'tex', 'pages', 'key', 'odt']],
    ['images', ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'svg', 'heic', 'tif', 'tiff', 'ico', 'psd', 'cr2', 'nef', 'dng']],
    ['code', ['ts', 'tsx', 'mts', 'js', 'mjs', 'py', 'ipynb', 'java', 'kt', 'swift', 'go', 'rs', 'html', 'css', 'scss', 'vue', 'svelte', 'json', 'yaml', 'toml', 'xml', 'ini', 'cfg', 'conf', 'sql', 'sh', 'ps1', 'bat', 'cmd']],
    ['media', ['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus', 'wma', 'mid', 'mp4', 'mov', 'mkv', 'webm', 'flv', 'divx', 'mpeg', 'm2ts', 'ogv']],
    ['archives', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso', 'dmg', 'jar']],
  ]

  for (const [category, exts] of cases) {
    it(`files ${category} extensions correctly`, () => {
      const wrong = exts.filter((e) => categorizeExt(e) !== category)
      expect(wrong).toEqual([])
    })
  }

  it('is case-insensitive, so a .PNG from a camera is still an image', () => {
    expect(categorizeExt('PNG')).toBe('images')
    expect(categorizeExt('JPEG')).toBe('images')
    expect(categorizeExt('DOCX')).toBe('documents')
  })

  it('falls back to other for unknown and extensionless files', () => {
    expect(categorizeExt('')).toBe('other')
    expect(categorizeExt('qqq')).toBe('other')
    // Executables and installers have no tab of their own — Windows would call
    // these Program. Other is the honest home for them, not Archives.
    expect(categorizeExt('exe')).toBe('other')
    expect(categorizeExt('dll')).toBe('other')
    expect(categorizeExt('msi')).toBe('other')
  })

  it('keeps .ts as code — TypeScript beats MPEG transport stream in a home directory', () => {
    expect(categorizeExt('ts')).toBe('code')
    expect(categorizeExt('mts')).toBe('code')
    expect(categorizeExt('m2ts')).toBe('media')
  })
})

describe('matchesCategory', () => {
  const file = (ext: string) => ({ ext, isDir: false })
  const dir = { ext: '', isDir: true }

  it('puts folders under All and nowhere else', () => {
    // Folder is its own System.Kind in Windows — a sibling of document/picture/
    // music/video, not a member of each. `kind:=picture` returns no folders.
    expect(matchesCategory(dir, 'all')).toBe(true)
    for (const id of TABS.filter((t) => t !== 'all')) {
      expect(matchesCategory(dir, id), `folder should not match ${id}`).toBe(false)
    }
  })

  it('accepts every file under All', () => {
    for (const ext of ['png', 'ts', 'zip', 'qqq', '']) {
      expect(matchesCategory(file(ext), 'all')).toBe(true)
    }
  })

  it('routes a file to exactly one type tab', () => {
    const typed = TABS.filter((t) => t !== 'all')
    for (const ext of ['png', 'ts', 'zip', 'mp4', 'pdf', 'qqq', '']) {
      const hits = typed.filter((t) => matchesCategory(file(ext), t))
      expect(hits, `.${ext || '(none)'} matched ${hits.join(', ')}`).toHaveLength(1)
    }
  })
})
