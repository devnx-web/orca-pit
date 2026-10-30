import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaPitMachine } from '../../shared/orca-pit-machines'
import type { PersistedRuntimeEnvironment } from '../../shared/runtime-environments'
import {
  ORCA_PIT_LAN_ENDPOINT_PREFIX,
  OrcaPitFailoverTracker,
  orcaPitProbeUrl,
  withOrcaPitLanEndpoints
} from './orca-pit-endpoint-failover'
import { runOrcaPitFailoverRound } from './orca-pit-machine-directory'
import { orcaPitLanEndpoints } from './orca-pit-machine-lan'

const NITRO: OrcaPitMachine = {
  id: 9,
  tenant: { id: 1, name: 'DEVNX' },
  owner: { id: 1, name: 'Fabio', avatarUrl: null },
  name: 'Nitro5',
  slug: 'nitro5',
  status: 'approved',
  private: false,
  platform: 'linux-x64',
  version: '1.4.214-pit14',
  online: true,
  lastSeenAt: null,
  publicUrl: 'wss://orca.devnx.com.br/nitro5',
  webUrl: 'https://orca.devnx.com.br/nitro5/',
  lanEndpoints: ['ws://192.168.15.22:6768'],
  isMine: true,
  canManage: true,
  originHost: null
}

function server(): PersistedRuntimeEnvironment {
  return {
    id: 'env-nitro',
    name: 'Nitro5',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [
      {
        id: 'public',
        kind: 'websocket',
        label: 'Endereço público',
        endpoint: 'wss://orca.devnx.com.br/nitro5',
        deviceToken: 'dt',
        publicKeyB64: 'KEY'
      }
    ],
    preferredEndpointId: 'public'
  }
}

describe('withOrcaPitLanEndpoints', () => {
  it('adds the LAN addresses with the same device token and pinned key, keeping the preference', () => {
    const next = withOrcaPitLanEndpoints(server(), NITRO)
    expect(next?.preferredEndpointId).toBe('public')
    expect(next?.endpoints[1]).toEqual({
      id: `${ORCA_PIT_LAN_ENDPOINT_PREFIX}ws://192.168.15.22:6768`,
      kind: 'websocket',
      label: 'Rede local',
      endpoint: 'ws://192.168.15.22:6768',
      deviceToken: 'dt',
      publicKeyB64: 'KEY'
    })
    expect(withOrcaPitLanEndpoints(next as PersistedRuntimeEnvironment, NITRO)).toBeNull()
  })

  it('drops LAN addresses the machine no longer has, moving the preference back', () => {
    const withLan = withOrcaPitLanEndpoints(server(), NITRO) as PersistedRuntimeEnvironment
    const onLan = { ...withLan, preferredEndpointId: withLan.endpoints[1].id }
    const next = withOrcaPitLanEndpoints(onLan, { ...NITRO, lanEndpoints: [] })
    expect(next?.endpoints.map((entry) => entry.id)).toEqual(['public'])
    expect(next?.preferredEndpointId).toBe('public')
  })

  it('ignores a server that is not this machine', () => {
    expect(
      withOrcaPitLanEndpoints(server(), { ...NITRO, publicUrl: 'wss://orca.devnx.com.br/x' })
    ).toBeNull()
  })
})

describe('failover', () => {
  it('probes the login route under the prefix', () => {
    expect(orcaPitProbeUrl('wss://orca.devnx.com.br/nitro5')).toBe(
      'https://orca.devnx.com.br/nitro5/orca-pit/login'
    )
    expect(orcaPitProbeUrl('ws://192.168.15.22:6768')).toBe(
      'http://192.168.15.22:6768/orca-pit/login'
    )
  })

  it('switches to the LAN after two misses and back after two answers', async () => {
    let saved = server()
    let publicUp = false
    const invalidate = vi.fn(async () => {})
    const tracker = new OrcaPitFailoverTracker()
    const round = () =>
      runOrcaPitFailoverRound({
        machines: () => [NITRO],
        selfMachineId: () => null,
        readEnvironments: () => [saved],
        writeEnvironments: (changed) => {
          saved = changed[0]
        },
        invalidate,
        tracker,
        probe: async (endpoint) => (endpoint.startsWith('wss:') ? publicUp : true)
      })
    await round()
    expect(saved.endpoints).toHaveLength(2)
    expect(saved.preferredEndpointId).toBe('public')
    await round()
    expect(saved.preferredEndpointId).toBe(`${ORCA_PIT_LAN_ENDPOINT_PREFIX}ws://192.168.15.22:6768`)
    expect(invalidate).toHaveBeenCalledWith('env-nitro')
    publicUp = true
    await round()
    expect(saved.preferredEndpointId).not.toBe('public')
    await round()
    expect(saved.preferredEndpointId).toBe('public')
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('a single blip does not switch', async () => {
    const tracker = new OrcaPitFailoverTracker()
    const environment = withOrcaPitLanEndpoints(server(), NITRO) as PersistedRuntimeEnvironment
    expect(tracker.decide(environment, 'public', false, 'lan')).toBeNull()
    expect(tracker.decide(environment, 'public', true, null)).toBeNull()
    expect(tracker.decide(environment, 'public', false, 'lan')).toBeNull()
  })

  it('leaves this computer and machines without LAN alone', async () => {
    const writeEnvironments = vi.fn()
    await runOrcaPitFailoverRound({
      machines: () => [NITRO],
      selfMachineId: () => 9,
      readEnvironments: () => [server()],
      writeEnvironments,
      invalidate: vi.fn(),
      tracker: new OrcaPitFailoverTracker(),
      probe: async () => false
    })
    expect(writeEnvironments).not.toHaveBeenCalled()
  })
})

describe('orcaPitLanEndpoints', () => {
  const interfaces = {
    wlan0: [
      { address: '192.168.15.10', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false }
    ],
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    docker0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }],
    tailscale0: [{ address: '100.101.1.2', family: 'IPv4', internal: false }]
  } as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>

  it('lists private IPv4 addresses when the server listens on every interface', () => {
    expect(orcaPitLanEndpoints({ host: '0.0.0.0', port: 6768 }, interfaces)).toEqual([
      'ws://100.101.1.2:6768',
      'ws://192.168.15.10:6768'
    ])
  })

  it('lists none while the server listens on loopback only', () => {
    expect(orcaPitLanEndpoints({ host: '127.0.0.1', port: 6768 }, interfaces)).toEqual([])
    expect(orcaPitLanEndpoints(null, interfaces)).toEqual([])
  })
})
