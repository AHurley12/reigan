import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-reporting-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { closeDatabase } = await import('../db/database')
const { reportingCall } = await import('./api')
const { CapabilityError } = await import('../capabilities/types')

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('reportingCall', () => {
  it('passes a successful call straight through', async () => {
    await expect(reportingCall('jobs.list', async () => 'ok')).resolves.toBe('ok')
  })

  it('turns a dead grant into a not_connected error rather than a raw failure', async () => {
    // The whole point of the wrapper: every Google surface routes invalid_grant
    // to one place, so the user gets one "reconnect" prompt instead of N.
    const dead = Object.assign(new Error('invalid_grant'), {
      response: { data: { error: 'invalid_grant' } },
    })

    const err = await reportingCall('jobs.list', async () => {
      throw dead
    }).catch((e) => e)

    expect(err).toBeInstanceOf(CapabilityError)
    expect((err as InstanceType<typeof CapabilityError>).code).toBe('not_connected')
    expect((err as Error).message).toMatch(/Reconnect your Google account/)
  })

  it('reports any other failure with its own message intact', async () => {
    // Google's "API has not been used in project ..." text contains the
    // enablement link; wrapping it in something friendlier would throw away the
    // only actionable part.
    const err = await reportingCall('jobs.list', async () => {
      throw new Error('YouTube Reporting API has not been used in project 220819498258 before')
    }).catch((e) => e)

    expect((err as Error).message).toMatch(/has not been used in project 220819498258/)
  })
})
