import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Boot-time guarantees, asserted at test time instead.
 *
 * `registerAllCapabilities()` throws on a duplicate id, a malformed id, a
 * mutating capability with no approval spec, or an unexplained uiOnly. Those
 * are exactly the mistakes that are easy to make while adding a feature and
 * that would otherwise surface as a crash on the user's next launch.
 */

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'reigan-reg-'))
  process.env.REIGAN_TEST_USERDATA = userData
})

afterEach(async () => {
  const { closeDatabase } = await import('../db/database')
  closeDatabase()
  rmSync(userData, { recursive: true, force: true })
})

async function loadRegistry() {
  const [{ getDatabase }, { runMigrations }, registry, register, tools] = await Promise.all([
    import('../db/database'),
    import('../db/migrations'),
    import('./registry'),
    import('./register'),
    import('./agentTools'),
  ])
  runMigrations(getDatabase())
  registry.clearRegistry()
  register.registerAllCapabilities()
  return { ...registry, ...tools }
}

describe('capability registration', () => {
  it('registers every capability without a collision or a rule violation', async () => {
    const { listCapabilities } = await loadRegistry()
    const all = listCapabilities()
    expect(all.length).toBeGreaterThan(20)
  })

  it('registers each Dev Tools family', async () => {
    const { listCapabilities } = await loadRegistry()
    const ids = listCapabilities().map((c) => c.id)

    for (const expected of [
      'devtools.scanProjects',
      'devtools.listProjects',
      'devtools.getProject',
      'devtools.openProject',
      'localhost.scan',
      'localhost.killProcess',
      'shell.run',
      'shell.classify',
      'files.planOrganize',
      'files.executePlan',
      'files.undoRun',
      'files.findDuplicates',
      'vault.search',
      'vault.get',
      'vault.create',
      'vault.writeToFile',
    ]) {
      expect(ids, expected).toContain(expected)
    }
  })

  it('gives every mutating capability an approval spec', async () => {
    const { listCapabilities, getCapability } = await loadRegistry()
    for (const info of listCapabilities()) {
      const cap = getCapability(info.id)!
      if (cap.risk === 'write' || cap.risk === 'destructive' || cap.dynamicRisk) {
        expect(cap.approval, `${info.id} must declare an approval spec`).toBeTruthy()
        expect(typeof cap.approval!.summary, `${info.id} approval.summary`).toBe('function')
      }
    }
  })

  it('classifies the destructive capabilities as destructive', async () => {
    const { getCapability } = await loadRegistry()
    for (const id of ['localhost.killProcess', 'files.executePlan', 'shell.run']) {
      expect(getCapability(id)!.risk, id).toBe('destructive')
    }
  })

  it('gives every capability a description long enough to be usable by the model', async () => {
    const { listCapabilities } = await loadRegistry()
    for (const cap of listCapabilities()) {
      // A one-line description is the difference between a tool the model
      // reaches for correctly and one it guesses at.
      expect(cap.description.length, `${cap.id} description`).toBeGreaterThan(40)
    }
  })

  it('produces a valid Anthropic tool name for every model-visible capability', async () => {
    const { listModelVisibleCapabilities, capabilityIdToToolName } = await loadRegistry()
    for (const cap of listModelVisibleCapabilities()) {
      const name = capabilityIdToToolName(cap.id)
      // ^[a-zA-Z0-9_-]{1,64}$ — a dot here is rejected by the API at runtime,
      // which would break the whole tool array rather than one tool.
      expect(name, cap.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    }
  })

  it('round-trips every id through the tool-name translation', async () => {
    const { listCapabilities, capabilityIdToToolName, toolNameToCapabilityId } = await loadRegistry()
    for (const cap of listCapabilities()) {
      expect(toolNameToCapabilityId(capabilityIdToToolName(cap.id))).toBe(cap.id)
    }
  })
})
