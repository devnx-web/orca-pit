import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./devnx-control-service', () => ({ getDevnxControlService: () => null }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: { store: null } }))

import type { DeviceEntry } from '../runtime/device-entry'
import {
  OrcaPitDevnxProjectsParams,
  OrcaPitDevnxTaskParams,
  OrcaPitDevnxTasksParams
} from '../../shared/rpc-contract/orca-pit-devnx-params'
import { RPC_PARAMS_BY_METHOD } from '../../shared/rpc-contract/rpc-params-catalog.generated'
import { DevnxControlError } from './devnx-control-http'
import { reloginError, type OrcaPitControlViewer } from './orca-pit-control-reader'
import { assertOrcaPitMayChangeRepoLink } from './orca-pit-devnx-link-guard'
import {
  devnxStatusForCaller,
  ORCA_PIT_DEVNX_RPC_METHODS,
  withCallerReader,
  type OrcaPitDevnxRpcDeps
} from './orca-pit-devnx-rpc'
import { setOrcaPitIdentitySource } from './orca-pit-identity'
import type { OrcaPitUser } from './orca-pit-identity-types'

const SESSION = { baseUrl: 'https://control.example', token: 'central-jwt' }
const MEMBER: OrcaPitUser = {
  id: 7,
  name: 'Fulano',
  email: 'f@x',
  tenantId: 1,
  tenantIds: [1],
  orcaRole: 'member'
}
const ADMIN: OrcaPitUser = { ...MEMBER, id: 8, name: 'Beltrana', orcaRole: 'admin' }
const DEVICES: Record<string, Partial<DeviceEntry>> = {
  member: { orcaPitUser: MEMBER, orcaPitControlToken: 'm' },
  admin: { orcaPitUser: ADMIN, orcaPitControlToken: 'a' },
  plain: {}
}

function deps(viewer: OrcaPitControlViewer, getJson: () => Promise<unknown>): OrcaPitDevnxRpcDeps {
  return {
    session: () => SESSION,
    viewer: () => viewer,
    reader: () => ({ getJson })
  }
}

const AS = (deviceId: string) => ({ caller: { kind: 'paired-device' as const, deviceId } })

afterEach(() => setOrcaPitIdentitySource(null))

function installDevices(): void {
  setOrcaPitIdentitySource({
    getDevice: (deviceId) =>
      DEVICES[deviceId]
        ? ({
            deviceId,
            name: deviceId,
            scope: 'runtime',
            pairedAt: 1,
            lastSeenAt: 1,
            ...DEVICES[deviceId]
          } as DeviceEntry)
        : null,
    centralUser: () => null
  })
}

describe('orcaPit.devnx* params', () => {
  it('binds every method to the shared schema with the workspace permission', () => {
    const byName = new Map(ORCA_PIT_DEVNX_RPC_METHODS.map((method) => [method.name, method]))
    expect([...byName.keys()].sort()).toEqual([
      'orcaPit.devnxProjects',
      'orcaPit.devnxStatus',
      'orcaPit.devnxTask',
      'orcaPit.devnxTasks'
    ])
    for (const method of byName.values()) {
      expect(method.permission).toBe('workspace')
      expect(RPC_PARAMS_BY_METHOD[method.name]).toBe(method.params)
    }
  })

  it('accepts the filters the Tasks page sends', () => {
    expect(
      OrcaPitDevnxTasksParams.parse({
        projectId: 24,
        search: 'relatório',
        statuses: ['pending', 'in_progress'],
        mine: true,
        limit: 100
      })
    ).toEqual({
      projectId: 24,
      search: 'relatório',
      statuses: ['pending', 'in_progress'],
      mine: true,
      limit: 100
    })
    expect(OrcaPitDevnxProjectsParams.parse({})).toEqual({})
    expect(OrcaPitDevnxTaskParams.parse({ taskId: 311 })).toEqual({ taskId: 311 })
  })

  it.each([
    { projectId: 0 },
    { projectId: -1 },
    { projectId: 2.5 },
    { projectId: '24' },
    { projectId: 24, statuses: ['pending,completed'] },
    { projectId: 24, statuses: ['Pending'] },
    { projectId: 24, limit: 0 },
    { projectId: 24, limit: 201 },
    { projectId: 24, mine: 'yes' },
    { projectId: 24, search: 'x'.repeat(1001) }
  ])('refuses tasks params %j', (params) => {
    expect(OrcaPitDevnxTasksParams.safeParse(params).success).toBe(false)
  })

  it('refuses a task id that is not a positive integer', () => {
    for (const taskId of [0, -3, 1.5, '311', null]) {
      expect(OrcaPitDevnxTaskParams.safeParse({ taskId }).success).toBe(false)
    }
    expect(OrcaPitDevnxProjectsParams.safeParse({ repoId: '' }).success).toBe(false)
  })
})

describe('orcaPit.devnx* results', () => {
  it('answers not_connected without a central session, without calling anyone', async () => {
    const getJson = vi.fn()
    const result = await withCallerReader({}, () => getJson(), {
      ...deps({ kind: 'central' }, getJson),
      session: () => null
    })
    expect(result).toMatchObject({ ok: false, code: 'not_connected' })
    expect(getJson).not.toHaveBeenCalled()
  })

  it('maps an expired personal login to relogin and a refused role to forbidden', async () => {
    const failWith = (error: unknown) =>
      withCallerReader(
        AS('member'),
        (reader) => reader.getJson('/api/orca/projects'),
        deps({ kind: 'user', token: 'm', user: MEMBER }, () => Promise.reject(error))
      )
    await expect(failWith(reloginError())).resolves.toMatchObject({ ok: false, code: 'relogin' })
    await expect(
      failWith(new DevnxControlError('HTTP 403', { status: 403 }))
    ).resolves.toMatchObject({ ok: false, code: 'forbidden' })
    await expect(failWith(new Error('boom'))).resolves.toMatchObject({
      ok: false,
      code: 'unavailable'
    })
  })

  it('returns the value read with the chosen reader', async () => {
    const getJson = vi.fn(() => Promise.resolve({ tasks: [] }))
    const result = await withCallerReader(
      AS('member'),
      (reader) => reader.getJson('/api/orca/tasks'),
      deps({ kind: 'user', token: 'm', user: MEMBER }, getJson)
    )
    expect(result).toEqual({ ok: true, value: { tasks: [] } })
  })

  it('tells the client whose login reads and whether it may change the link', () => {
    installDevices()
    const central = deps({ kind: 'central' }, vi.fn())
    expect(devnxStatusForCaller({ caller: { kind: 'desktop' } }, central)).toEqual({
      connected: true,
      viewer: 'central',
      needsLogin: false,
      canLink: true
    })
    expect(
      devnxStatusForCaller(AS('member'), deps({ kind: 'user', token: 'm', user: MEMBER }, vi.fn()))
    ).toEqual({ connected: true, viewer: 'user', needsLogin: false, canLink: false })
    expect(devnxStatusForCaller(AS('admin'), deps({ kind: 'relogin' }, vi.fn()))).toEqual({
      connected: true,
      viewer: null,
      needsLogin: true,
      canLink: true
    })
    expect(devnxStatusForCaller(AS('plain'), { ...central, session: () => null })).toMatchObject({
      connected: false,
      canLink: false
    })
  })
})

describe('repo.update link guard', () => {
  it('lets admins, local callers and devices without the login change the link', () => {
    installDevices()
    const updates = { devnxControlProject: { id: 24, name: 'SouLog' } }
    expect(() => assertOrcaPitMayChangeRepoLink(updates, AS('admin'))).not.toThrow()
    expect(() => assertOrcaPitMayChangeRepoLink(updates, AS('plain'))).not.toThrow()
    expect(() =>
      assertOrcaPitMayChangeRepoLink(updates, { caller: { kind: 'desktop' } })
    ).not.toThrow()
  })

  it('refuses a member, also when clearing the link, and leaves other fields alone', () => {
    installDevices()
    expect(() =>
      assertOrcaPitMayChangeRepoLink({ devnxControlProject: { id: 24, name: 'S' } }, AS('member'))
    ).toThrow(/administrator/)
    expect(() =>
      assertOrcaPitMayChangeRepoLink({ devnxControlProject: null }, AS('member'))
    ).toThrow()
    expect(() => assertOrcaPitMayChangeRepoLink({ displayName: 'x' }, AS('member'))).not.toThrow()
  })
})
