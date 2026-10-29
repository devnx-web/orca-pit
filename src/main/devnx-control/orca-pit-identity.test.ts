import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceRegistry, type DeviceEntry } from '../runtime/device-registry'
import { callerScopeOf } from '../runtime/device-principal'
import { denyRpcMethodForCaller } from '../runtime/rpc/rpc-caller-scope'
import { DEVICE_REGISTRY_FILENAME } from '../runtime/mobile-pairing-files'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist'
import {
  orcaPitUserForDevice,
  publicOrcaPitUser,
  resolveOrcaPitUser,
  setOrcaPitIdentitySource
} from './orca-pit-identity'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { mintOrcaPitUserDevice } from './orca-pit-user-devices'

const FULANO: OrcaPitUser = {
  id: 7,
  name: 'Fulano',
  email: 'f@x',
  tenantId: 1,
  tenantIds: [1],
  orcaRole: 'member'
}
const PUBLIC_KEY = Buffer.alloc(32, 3).toString('base64')

let dir: string | null = null
afterEach(() => {
  setOrcaPitIdentitySource(null)
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }
  dir = null
})

function registry(): DeviceRegistry {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-identity-'))
  return new DeviceRegistry(dir)
}

describe('the person behind a device', () => {
  it('stamps a fresh, already-seen runtime row that New Link never hands out', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    expect(row).toMatchObject({ name: 'Fulano · navegador', scope: 'runtime' })
    expect(row.lastSeenAt).toBeGreaterThan(0)
    expect(devices.getOrCreatePendingDevice('Link', 'runtime').deviceId).not.toBe(row.deviceId)
    const reloaded = new DeviceRegistry(dir!).getDevice(row.deviceId)
    expect(reloaded?.orcaPitUser).toEqual(FULANO)
    expect(reloaded?.orcaPitControlToken).toBe('jwt-7')
  })

  it('resolves device-key forks and relayed phones to the parent user', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    const fork = devices.forkDeviceKey(row.deviceId, PUBLIC_KEY, 'Chrome')
    // The fork carries its own copy, so revoking the token row keeps the person on it.
    expect(fork.orcaPitUser).toEqual(FULANO)
    expect(fork.orcaPitControlToken).toBe('jwt-7')
    const [phone] = devices.upsertDelegatedMobileDevices(row, [{ phoneKey: 'p1', name: 'Phone' }])
    expect(phone.orcaPitUser).toBeUndefined()
    const getDevice = (id: string): DeviceEntry | null => devices.getDevice(id)
    expect(resolveOrcaPitUser(phone.deviceId, getDevice)).toEqual(FULANO)
    devices.removeDevice(row.deviceId)
    expect(resolveOrcaPitUser(fork.deviceId, getDevice)).toEqual(FULANO)
  })

  it('answers null for plain pairings and the central owner for local callers', () => {
    const devices = registry()
    const plain = devices.addDevice('Link', 'runtime')
    const owner: OrcaPitUser = { ...FULANO, id: 1, name: 'Dono', orcaRole: 'admin' }
    expect(orcaPitUserForDevice(plain.deviceId)).toBeNull()
    setOrcaPitIdentitySource({ getDevice: (id) => devices.getDevice(id), centralUser: () => owner })
    expect(orcaPitUserForDevice(plain.deviceId)).toBeNull()
    expect(orcaPitUserForDevice(undefined)).toEqual(owner)
    expect(orcaPitUserForDevice('missing')).toBeNull()
  })

  it('survives a parent cycle in a hand-edited file', () => {
    const rows = new Map<string, DeviceEntry>([
      ['a', { deviceId: 'a', parentDeviceId: 'b' } as DeviceEntry],
      ['b', { deviceId: 'b', parentDeviceId: 'a' } as DeviceEntry]
    ])
    expect(resolveOrcaPitUser('a', (id) => rows.get(id) ?? null)).toBeNull()
  })

  it('keeps a row with a damaged user a member instead of dropping its person', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    const path = join(dir!, DEVICE_REGISTRY_FILENAME)
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
    const edited = rows.map((entry) =>
      entry.deviceId === row.deviceId
        ? { ...entry, orcaPitUser: { id: 'x', orcaRole: 'admin' } }
        : entry
    )
    writeFileSync(path, JSON.stringify(edited))
    const loaded = new DeviceRegistry(dir!).getDevice(row.deviceId)
    expect(loaded?.orcaPitUser?.orcaRole).toBe('member')
    expect(loaded?.orcaPitControlToken).toBe('jwt-7')
  })

  it('reads a row stored before tenantIds existed as its one company', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    const path = join(dir!, DEVICE_REGISTRY_FILENAME)
    const rows = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[]
    const older = rows.map((entry) =>
      entry.deviceId === row.deviceId
        ? { ...entry, orcaPitUser: { id: 7, name: 'Fulano', tenantId: 4, orcaRole: 'admin' } }
        : entry
    )
    writeFileSync(path, JSON.stringify(older))
    const loaded = new DeviceRegistry(dir!).getDevice(row.deviceId)?.orcaPitUser
    expect(loaded).toMatchObject({ tenantId: 4, tenantIds: [4], orcaRole: 'admin' })
  })

  it('shows Settings the name and role, never the JWT', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    expect(JSON.stringify(publicOrcaPitUser(row))).not.toContain('jwt-7')
    expect(publicOrcaPitUser(row)).toEqual({ name: 'Fulano', email: 'f@x', orcaRole: 'member' })
  })
})

describe('roles narrow a paired runtime client', () => {
  const ADMIN_ONLY = ['settings-write', 'accounts-admin', 'skills-admin', 'host-admin'] as const

  it('denies the administrative tiers to a member and keeps workspace', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    const scope = callerScopeOf(row)
    for (const permission of ADMIN_ONLY) {
      expect(denyRpcMethodForCaller(scope, 'm', permission)).toMatch(/administrator/)
    }
    expect(denyRpcMethodForCaller(scope, 'm', 'workspace')).toBeNull()
    expect(denyRpcMethodForCaller(scope, 'm', 'device-self')).toBeNull()
    // A member's device-key fork is still a member.
    const fork = devices.forkDeviceKey(row.deviceId, PUBLIC_KEY, 'Chrome')
    expect(denyRpcMethodForCaller(callerScopeOf(fork), 'm', 'host-admin')).not.toBeNull()
  })

  it('holds a phone relayed by a member to the member, though settings.update is mobile-allowed', () => {
    const devices = registry()
    const row = mintOrcaPitUserDevice(devices, { user: FULANO, controlToken: 'jwt-7' })
    const [phone] = devices.upsertDelegatedMobileDevices(row, [{ phoneKey: 'p1', name: 'Phone' }])
    setOrcaPitIdentitySource({ getDevice: (id) => devices.getDevice(id), centralUser: () => null })
    const scope = callerScopeOf(phone)
    expect(denyRpcMethodForCaller(scope, 'settings.update', 'settings-write')).toMatch(
      /administrator/
    )
    const phoneMethod = [...MOBILE_RPC_METHOD_ALLOWLIST][0]
    expect(denyRpcMethodForCaller(scope, phoneMethod, 'workspace')).toBeNull()
  })

  it('leaves admins and plain pairings with every upstream permission', () => {
    const devices = registry()
    const admin = mintOrcaPitUserDevice(devices, {
      user: { ...FULANO, orcaRole: 'admin' },
      controlToken: 'jwt-admin'
    })
    const plain = devices.addDevice('Link', 'runtime')
    for (const row of [admin, plain]) {
      for (const permission of ADMIN_ONLY) {
        expect(denyRpcMethodForCaller(callerScopeOf(row), 'm', permission)).toBeNull()
      }
      expect(denyRpcMethodForCaller(callerScopeOf(row), 'm', 'pairing-admin')).not.toBeNull()
    }
  })
})
