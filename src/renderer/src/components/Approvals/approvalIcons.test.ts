import { describe, it, expect } from 'vitest'
import { Globe, Search, ShieldAlert } from 'lucide-react'
import { DEFAULT_APPROVAL_ICON, approvalIcon } from './approvalIcons'

/**
 * The card used one icon for everything, so a web search and a recursive delete
 * looked identical at the moment the glance matters most. What these tests
 * protect is the fallback chain — a capability with no entry must still render
 * something, and every existing approval must look exactly as it did before.
 */
describe('approvalIcon', () => {
  it('routes an exact capability id to its own icon', () => {
    expect(approvalIcon('web.search')).toBe(Search)
  })

  it('falls back to the namespace icon for an unlisted member of a family', () => {
    expect(approvalIcon('web.somethingAddedLater')).toBe(Globe)
  })

  it('falls back to the shield for a capability it knows nothing about', () => {
    expect(approvalIcon('vault.write')).toBe(DEFAULT_APPROVAL_ICON)
    expect(approvalIcon('vault.write')).toBe(ShieldAlert)
  })

  it('never returns undefined, however malformed the id', () => {
    for (const id of ['', '.', 'nodots', 'a.b.c.d']) {
      expect(approvalIcon(id)).toBeTruthy()
    }
  })

  it('leaves every pre-existing approval looking as it did', () => {
    for (const id of ['shell.run', 'files.trash', 'youtube.applyMetadata', 'jobs.upsert']) {
      expect(approvalIcon(id)).toBe(ShieldAlert)
    }
  })
})
