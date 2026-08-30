import { describe, it, expect } from 'vitest'
import { findEditableSetting } from '../../../../shared/settingsCatalog'
import { VOICE_CATALOGUE } from '../../../../shared/voices'
import { ORB_STYLES } from '../Orb/engine/orbRegistry'
import { THEMES } from '../../theme/registry'

/**
 * Keeps the assistant's view of the world in step with the renderer's.
 *
 * `shared/settingsCatalog.ts` lists the themes, orb styles and avatars the
 * assistant may choose between. Those are *owned* by renderer registries, and
 * main cannot import renderer code — the two tsconfig projects are separate on
 * purpose. So the lists are declared twice, and this is what stops the copies
 * drifting: add a theme and forget the catalogue, and the assistant would keep
 * insisting the theme does not exist while it sits in the user's dropdown.
 *
 * It lives on the renderer side because this is the only project that may see
 * both halves.
 */

describe('the assistant’s option lists match the registries that own them', () => {
  it('offers exactly the themes the renderer registers', () => {
    const declared = findEditableSetting('theme')!.options!.map((o) => o.value).sort()
    expect(declared).toEqual(Object.keys(THEMES).sort())
  })

  it('offers exactly the orb styles the renderer registers', () => {
    const declared = findEditableSetting('voiceOrbStyle')!.options!.map((o) => o.value).sort()
    expect(declared).toEqual(Object.keys(ORB_STYLES).sort())
  })

  it('keeps the voice catalogue non-empty, since voice.set resolves names against it', () => {
    expect(VOICE_CATALOGUE.length).toBeGreaterThan(0)
  })
})
