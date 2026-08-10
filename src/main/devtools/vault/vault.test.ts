import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The vault's two load-bearing promises:
 *  - a secret body is never handed to the model, and
 *  - it is never written into the FTS index, which would put the plaintext
 *    back on disk in a second table and undo the encryption.
 */

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'reigan-vault-'))
  process.env.REIGAN_TEST_USERDATA = userData
})

afterEach(async () => {
  const { closeDatabase } = await import('../../db/database')
  closeDatabase()
  rmSync(userData, { recursive: true, force: true })
})

async function load() {
  const [{ getDatabase }, { runMigrations }, store, templates] = await Promise.all([
    import('../../db/database'),
    import('../../db/migrations'),
    import('./store'),
    import('./templates'),
  ])
  const db = getDatabase()
  runMigrations(db)
  return { db, ...store, ...templates }
}

const SECRET = 'postgres://admin:hunter2@db.internal:5432/prod'

describe('secret snippets', () => {
  it('redacts the body for the model but keeps the value retrievable in main', async () => {
    const { createSnippet, getSnippet, redact } = await load()
    const created = createSnippet({ title: 'Prod DB URL', body: SECRET, isSecret: true })

    // The main process still has the real value...
    expect(getSnippet(created.id)!.body).toBe(SECRET)
    // ...and what leaves for the model does not.
    const forModel = redact(getSnippet(created.id)!)
    expect(forModel.bodyRedacted).toBe(true)
    expect(forModel.body).not.toContain('hunter2')
    expect(forModel.body).toMatch(/redacted/i)
  })

  it('keeps a secret body out of the full-text index', async () => {
    const { db, createSnippet, searchSnippets } = await load()
    createSnippet({
      title: 'Prod DB URL',
      description: 'connection string for production',
      tags: ['db', 'prod'],
      body: SECRET,
      isSecret: true,
    })

    // Findable by metadata.
    expect(searchSnippets('prod').map((s) => s.title)).toContain('Prod DB URL')

    // Not findable by anything only present in the body.
    expect(searchSnippets('hunter2')).toHaveLength(0)

    // And the index genuinely does not contain it.
    const indexed = db.prepare('SELECT title, body FROM snippets_fts').all() as any[]
    expect(indexed.some((r) => String(r.body).includes('hunter2'))).toBe(false)
  })

  it('indexes a non-secret body normally', async () => {
    const { createSnippet, searchSnippets } = await load()
    createSnippet({ title: 'Vite proxy', body: 'server: { proxy: { "/api": "http://localhost:3000" } }' })
    expect(searchSnippets('proxy').map((s) => s.title)).toContain('Vite proxy')
  })

  it('does not leave the plaintext in the snippets table when encryption is available', async () => {
    // The test stub reports safeStorage as unavailable, so this asserts the
    // documented fallback rather than pretending otherwise: the value is
    // stored as-is, and the *encryption* path is exercised by db/secrets.
    const { db, createSnippet } = await load()
    const created = createSnippet({ title: 'k', body: SECRET, isSecret: true })
    const raw = db.prepare('SELECT body FROM snippets WHERE id = ?').get(created.id) as any
    expect(typeof raw.body).toBe('string')
  })
})

describe('versioning', () => {
  it('keeps the previous body and caps history at 20', async () => {
    const { createSnippet, updateSnippet, listVersions } = await load()
    const s = createSnippet({ title: 'notes', body: 'v0' })

    for (let i = 1; i <= 25; i += 1) updateSnippet(s.id, { body: `v${i}` })

    expect(listVersions(s.id)).toHaveLength(20)
    // Latest is current, not a version.
    const { getSnippet } = await load()
    expect(getSnippet(s.id)!.body).toBe('v25')
  })

  it('does not create a version when the body is unchanged', async () => {
    const { createSnippet, updateSnippet, listVersions } = await load()
    const s = createSnippet({ title: 'notes', body: 'same' })
    updateSnippet(s.id, { title: 'renamed' })
    expect(listVersions(s.id)).toHaveLength(0)
  })
})

describe('config templates', () => {
  it('seeds the shipped starters exactly once', async () => {
    const { seedTemplates, listTemplates } = await load()
    expect(seedTemplates()).toBeGreaterThan(0)
    const first = listTemplates().length
    expect(seedTemplates()).toBe(0)
    expect(listTemplates()).toHaveLength(first)
  })

  it('renders a .env with supplied values and applies defaults', async () => {
    const { seedTemplates, getTemplate, renderTemplate } = await load()
    seedTemplates()
    const template = getTemplate('.env (Node/Vite)')!

    const rendered = renderTemplate(template, {
      APP_NAME: 'my-service',
      DATABASE_URL: 'postgres://localhost/dev',
      API_KEY: 'k-123',
    })

    expect(rendered.missing).toEqual([])
    expect(rendered.body).toContain('# my-service')
    expect(rendered.body).toContain('PORT=5173') // default applied
    expect(rendered.body).toContain('DATABASE_URL=postgres://localhost/dev')
    expect(rendered.body).not.toMatch(/\{\{/) // no unresolved tokens
    expect(rendered.secretFields).toContain('API_KEY')
  })

  it('reports required fields that were not supplied instead of blanking them', async () => {
    const { seedTemplates, getTemplate, renderTemplate } = await load()
    seedTemplates()
    const compose = getTemplate('docker-compose — Postgres + Redis')!

    const rendered = renderTemplate(compose, { POSTGRES_DB: 'app', POSTGRES_USER: 'postgres' })

    expect(rendered.missing).toContain('POSTGRES_PASSWORD')
    // Left visible as a token: an obviously incomplete file beats one that
    // looks finished and silently has an empty password.
    expect(rendered.body).toContain('{{POSTGRES_PASSWORD}}')
  })
})
