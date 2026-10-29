import { describe, expect, it, vi } from 'vitest'
import type { DeviceEntry } from '../runtime/device-entry'
import { DevnxControlError } from './devnx-control-http'
import {
  callerDeviceId,
  readerForViewer,
  RELOGIN_CODE,
  viewerForDevice,
  type OrcaPitControlRequest
} from './orca-pit-control-reader'
import type { OrcaPitUser } from './orca-pit-identity-types'

const FULANO: OrcaPitUser = {
  id: 7,
  name: 'Fulano de Tal',
  email: 'f@x',
  tenantId: 1,
  tenantIds: [1],
  orcaRole: 'member'
}
const CENTRAL = { baseUrl: 'https://control.example', token: 'central-jwt' }

function row(deviceId: string, extra: Partial<DeviceEntry> = {}): DeviceEntry {
  return { deviceId, name: deviceId, scope: 'runtime', pairedAt: 1, lastSeenAt: 1, ...extra }
}

const ROWS = new Map<string, DeviceEntry>([
  ['browser', row('browser', { orcaPitUser: FULANO, orcaPitControlToken: 'fulano-jwt' })],
  // A relayed phone and a device-key fork carry no identity of their own.
  ['phone', row('phone', { parentDeviceId: 'browser' })],
  ['fork', row('fork', { forkedFrom: 'browser' })],
  ['plain', row('plain')],
  ['no-token', row('no-token', { orcaPitUser: FULANO })],
  ['loop-a', row('loop-a', { parentDeviceId: 'loop-b' })],
  ['loop-b', row('loop-b', { parentDeviceId: 'loop-a' })]
])
const lookup = (deviceId: string): DeviceEntry | null => ROWS.get(deviceId) ?? null

function rejecting(status: number): OrcaPitControlRequest {
  return vi.fn(() =>
    Promise.reject(new DevnxControlError(`HTTP ${status}`, { code: 'HTTP_ERROR', status }))
  )
}

describe('Orca-Pit control reader: whose login answers', () => {
  it('reads with the central session for local callers and devices without the login', () => {
    expect(viewerForDevice(null, lookup)).toEqual({ kind: 'central' })
    expect(viewerForDevice('plain', lookup)).toEqual({ kind: 'central' })
    expect(viewerForDevice('unknown-device', lookup)).toEqual({ kind: 'central' })
    // Without the multi-user wiring (headless orcad) no device has a person.
    expect(viewerForDevice('browser', null)).toEqual({ kind: 'central' })
  })

  it("reads with the person's own JWT, also from a relayed phone or a forked key", () => {
    for (const deviceId of ['browser', 'phone', 'fork']) {
      expect(viewerForDevice(deviceId, lookup)).toEqual({
        kind: 'user',
        token: 'fulano-jwt',
        user: FULANO
      })
    }
  })

  it('asks to sign in again when the person is known but the JWT is not', () => {
    expect(viewerForDevice('no-token', lookup)).toEqual({ kind: 'relogin' })
  })

  it('stops on a parent cycle', () => {
    expect(viewerForDevice('loop-a', lookup)).toEqual({ kind: 'central' })
  })

  it('takes the device from the transport identity, never from params', () => {
    expect(callerDeviceId({ caller: { kind: 'paired-device', deviceId: 'browser' } })).toBe(
      'browser'
    )
    expect(callerDeviceId({ caller: { kind: 'desktop' } })).toBeNull()
    expect(callerDeviceId({ caller: { kind: 'local-cli' } })).toBeNull()
    expect(callerDeviceId({ pairedDeviceId: ' phone ' })).toBe('phone')
  })
})

describe('Orca-Pit control reader: the request', () => {
  it('sends the central token for the central viewer', async () => {
    const request = vi.fn<OrcaPitControlRequest>(() => Promise.resolve({ projects: [] }))
    const reader = readerForViewer({ kind: 'central' }, CENTRAL, request)
    await expect(reader?.getJson('/api/orca/projects')).resolves.toEqual({ projects: [] })
    expect(request).toHaveBeenCalledWith(CENTRAL.baseUrl, '/api/orca/projects', 'central-jwt')
  })

  it("sends the person's token to the central's panel", async () => {
    const request = vi.fn<OrcaPitControlRequest>(() => Promise.resolve({ tasks: [] }))
    const reader = readerForViewer(
      { kind: 'user', token: 'fulano-jwt', user: FULANO },
      CENTRAL,
      request
    )
    await reader?.getJson('/api/orca/projects/24/tasks?assignee=me')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      CENTRAL.baseUrl,
      '/api/orca/projects/24/tasks?assignee=me',
      'fulano-jwt'
    )
  })

  it('turns a 401 on the personal JWT into "sign in again", never a central retry', async () => {
    const request = rejecting(401)
    const reader = readerForViewer(
      { kind: 'user', token: 'old-jwt', user: FULANO },
      CENTRAL,
      request
    )
    await expect(reader?.getJson('/api/orca/projects')).rejects.toMatchObject({
      code: RELOGIN_CODE
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'central-jwt')
  })

  it('keeps a 403 (role refused by the Control) as it is', async () => {
    const reader = readerForViewer(
      { kind: 'user', token: 'fulano-jwt', user: FULANO },
      CENTRAL,
      rejecting(403)
    )
    await expect(reader?.getJson('/api/orca/projects')).rejects.toMatchObject({ status: 403 })
  })

  it('never calls the Control for a relogin viewer', async () => {
    const request = vi.fn<OrcaPitControlRequest>()
    const reader = readerForViewer({ kind: 'relogin' }, CENTRAL, request)
    await expect(reader?.getJson('/api/orca/projects')).rejects.toMatchObject({
      code: RELOGIN_CODE
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('has no reader without a central session, since the JWT is only good on its panel', () => {
    expect(
      readerForViewer({ kind: 'user', token: 'fulano-jwt', user: FULANO }, null, vi.fn())
    ).toBeNull()
  })
})
