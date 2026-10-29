import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistry } from '../runtime/device-registry'
import { DevnxControlError } from './devnx-control-http'
import { OrcaPitCentral, type OrcaPitControlCalls } from './orca-pit-control-me'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { revalidateOrcaPitDevices, type OrcaPitRevalidationDeps } from './orca-pit-revalidation'
import { mintOrcaPitUserDevice, updateOrcaPitUser } from './orca-pit-user-devices'

const OWNER: OrcaPitUser = { id: 1, name: 'Dono', email: 'd@x', tenantId: 1, orcaRole: 'admin' }
const FULANO: OrcaPitUser = { id: 7, name: 'Fulano', email: 'f@x', tenantId: 1, orcaRole: 'member' }
const SESSION = { baseUrl: 'https://control.test', token: 'central-token' }
const PUBLIC_KEY = Buffer.alloc(32, 5).toString('base64')

let dir: string
let registry: DeviceRegistry
let answers: Map<string, OrcaPitUser | DevnxControlError>
let deps: OrcaPitRevalidationDeps

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-revalidation-'))
  registry = new DeviceRegistry(dir)
  answers = new Map([['central-token', OWNER]])
  const calls: OrcaPitControlCalls = {
    login: vi.fn(),
    me: vi.fn(async (_base: string, token: string) => {
      const answer = answers.get(token) ?? new DevnxControlError('401', { status: 401 })
      if (answer instanceof DevnxControlError) {
        throw answer
      }
      return answer
    })
  }
  deps = {
    central: new OrcaPitCentral(() => SESSION, calls),
    calls,
    listDevices: () => registry.listDevices(),
    revoke: (deviceId) => registry.removeDevice(deviceId),
    updateUser: (deviceId, user) => updateOrcaPitUser(registry, deviceId, user)
  }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function signIn(token: string, user: OrcaPitUser = FULANO): string {
  return mintOrcaPitUserDevice(registry, { user, controlToken: token }).deviceId
}

describe('revalidating browser logins', () => {
  it('revokes the token row and its device-key forks when the JWT is rejected', async () => {
    const row = signIn('jwt-expirado')
    const fork = registry.forkDeviceKey(row, PUBLIC_KEY, 'Chrome').deviceId
    const plain = registry.addDevice('Link', 'runtime').deviceId
    const report = await revalidateOrcaPitDevices(deps)
    expect(report.checked).toBe(1)
    expect(report.revoked.sort()).toEqual([row, fork].sort())
    expect(registry.getDevice(plain)).not.toBeNull()
  })

  it('revokes a person who moved to another company', async () => {
    answers.set('jwt-fulano', { ...FULANO, tenantId: 2 })
    const row = signIn('jwt-fulano')
    expect((await revalidateOrcaPitDevices(deps)).revoked).toEqual([row])
  })

  it('keeps every device when the panel is unreachable', async () => {
    const row = signIn('jwt-fulano')
    answers.set(
      'jwt-fulano',
      new DevnxControlError('offline', { code: 'NETWORK_ERROR', status: null })
    )
    expect((await revalidateOrcaPitDevices(deps)).revoked).toEqual([])
    answers.set('jwt-fulano', new DevnxControlError('500', { status: 500 }))
    expect((await revalidateOrcaPitDevices(deps)).revoked).toEqual([])
    expect(registry.getDevice(row)).not.toBeNull()
  })

  it('skips the pass when the central cannot learn its own company', async () => {
    answers.set('central-token', new DevnxControlError('offline', { code: 'NETWORK_ERROR' }))
    const row = signIn('jwt-expirado')
    expect((await revalidateOrcaPitDevices(deps)).checked).toBe(0)
    expect(registry.getDevice(row)).not.toBeNull()
  })

  it('applies a new role from the panel to the stored person', async () => {
    const row = signIn('jwt-fulano')
    answers.set('jwt-fulano', { ...FULANO, orcaRole: 'admin' })
    expect((await revalidateOrcaPitDevices(deps)).updated).toEqual([row])
    expect(new DeviceRegistry(dir).getDevice(row)?.orcaPitUser?.orcaRole).toBe('admin')
  })
})
