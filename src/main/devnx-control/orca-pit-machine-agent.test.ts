import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaPitMachine } from '../../shared/orca-pit-machines'
import { DevnxControlError } from './devnx-control-http'
import { OrcaPitMachineAgent, type OrcaPitMachineAgentDeps } from './orca-pit-machine-agent'
import type { OrcaPitMachineCalls, OrcaPitMachineReply } from './orca-pit-machines-api'
import { writeOrcaPitMachineSecrets } from './orca-pit-machine-secrets'

function machine(overrides: Partial<OrcaPitMachine> = {}): OrcaPitMachine {
  return {
    id: 5,
    tenant: { id: 1, name: 'DEVNX' },
    owner: { id: 7, name: 'Ana', avatarUrl: null },
    name: 'ftgkNote',
    slug: 'ftgknote',
    status: 'approved',
    private: false,
    platform: 'linux-x64',
    version: '1.4.214-pit14',
    online: true,
    lastSeenAt: null,
    publicUrl: 'wss://orca.devnx.com.br/ftgknote',
    webUrl: 'https://orca.devnx.com.br/ftgknote/',
    lanEndpoints: [],
    isMine: true,
    canManage: true,
    originHost: 'orca-ftgknote-a1b2c3.devnx.com.br',
    ...overrides
  }
}

function reply(overrides: Partial<OrcaPitMachine> = {}, extra: Partial<OrcaPitMachineReply> = {}) {
  return { machine: machine(overrides), tunnelToken: 'tt-1', originSecret: 'os-1', ...extra }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-machine-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup(
  overrides: Partial<OrcaPitMachineAgentDeps> = {},
  calls?: Partial<OrcaPitMachineCalls>
) {
  const tunnel = { start: vi.fn(async () => {}), stop: vi.fn() }
  const managedOrigin = vi.fn()
  const onPublicUrl = vi.fn()
  const fullCalls: OrcaPitMachineCalls = {
    register: vi.fn(async () => reply()),
    heartbeat: vi.fn(async () => reply()),
    list: vi.fn(async () => []),
    ...calls
  }
  const agent = new OrcaPitMachineAgent({
    controlSession: () => ({ baseUrl: 'https://bcontrol.test', token: 'device-token' }),
    personToken: () => 'person-jwt',
    binding: () => ({ host: '0.0.0.0', port: 6768 }),
    publicKey: () => 'PUBKEY',
    version: async () => '1.4.214-pit14',
    lanEndpoints: () => ['ws://192.168.15.10:6768'],
    hostname: 'ftgkNote',
    platform: 'linux-x64',
    stateFile: join(dir, 'machine.json'),
    secretsFile: join(dir, 'secrets.json'),
    managedOrigin,
    tunnel,
    onPublicUrl,
    onState: () => {},
    calls: fullCalls,
    setTimer: () => null,
    clearTimer: () => {},
    ...overrides
  })
  return { agent, tunnel, managedOrigin, onPublicUrl, calls: fullCalls }
}

describe('OrcaPitMachineAgent', () => {
  it('waits for a person to sign in before the first registration', async () => {
    const { agent, calls } = setup({ personToken: () => null })
    await agent.tick()
    expect(calls.register).not.toHaveBeenCalled()
    expect(agent.current()).toEqual({ kind: 'idle' })
  })

  it('registers with the person, then runs the tunnel and tells the server its origin', async () => {
    const { agent, calls, tunnel, managedOrigin, onPublicUrl } = setup()
    await agent.tick()
    expect(calls.register).toHaveBeenCalledWith('https://bcontrol.test', 'person-jwt', {
      machine_uid: expect.any(String),
      name: 'ftgkNote',
      platform: 'linux-x64',
      version: '1.4.214-pit14',
      local_port: 6768,
      public_key: 'PUBKEY'
    })
    expect(managedOrigin).toHaveBeenLastCalledWith({
      host: 'orca-ftgknote-a1b2c3.devnx.com.br',
      secret: 'os-1'
    })
    expect(tunnel.start).toHaveBeenCalledWith('tt-1')
    expect(onPublicUrl).toHaveBeenCalledWith('wss://orca.devnx.com.br/ftgknote')
    const secrets = join(dir, 'secrets.json')
    expect(statSync(secrets).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(secrets, 'utf8'))).toEqual({
      tunnelToken: 'tt-1',
      originHost: 'orca-ftgknote-a1b2c3.devnx.com.br',
      originSecret: 'os-1'
    })
  })

  it('heartbeats with the install secret and LAN addresses after registering', async () => {
    const { agent, calls } = setup()
    await agent.tick()
    await agent.tick()
    const uid = JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8')).uid
    expect(calls.heartbeat).toHaveBeenCalledWith('https://bcontrol.test', 'person-jwt', 5, {
      machine_uid: uid,
      version: '1.4.214-pit14',
      lan_endpoints: ['ws://192.168.15.10:6768']
    })
  })

  it('keeps no tunnel while pending, and drops origin and secrets when disabled', async () => {
    const register = vi.fn(async () => reply({ status: 'pending' }, { tunnelToken: null }))
    const { agent, tunnel, managedOrigin } = setup({}, { register })
    await agent.tick()
    expect(tunnel.start).not.toHaveBeenCalled()
    expect(managedOrigin).toHaveBeenLastCalledWith(null)
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false)
  })

  it('falls back to the device token when the person JWT expired', async () => {
    const register = vi.fn(async (_base: string, token: string) => {
      if (token === 'person-jwt') {
        throw new DevnxControlError('expirado', { status: 401 })
      }
      return reply()
    })
    const { agent, tunnel } = setup({}, { register })
    await agent.tick()
    expect(register).toHaveBeenLastCalledWith(
      'https://bcontrol.test',
      'device-token',
      expect.anything()
    )
    expect(tunnel.start).toHaveBeenCalledWith('tt-1')
  })

  it('keeps going without a person once registered (a central back at the sign-in screen)', async () => {
    let person: string | null = 'person-jwt'
    const { agent, calls } = setup({ personToken: () => person })
    await agent.tick()
    person = null
    await agent.tick()
    expect(calls.heartbeat).toHaveBeenLastCalledWith(
      'https://bcontrol.test',
      'device-token',
      5,
      expect.anything()
    )
  })

  it('forgets a machine removed in the Control and stops everything', async () => {
    const heartbeat = vi.fn(async () => {
      throw new DevnxControlError('removida', { status: 404 })
    })
    const { agent, tunnel, managedOrigin } = setup({}, { heartbeat })
    await agent.tick()
    await agent.tick()
    expect(tunnel.stop).toHaveBeenCalled()
    expect(managedOrigin).toHaveBeenLastCalledWith(null)
    expect(JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8')).machineId).toBeNull()
    expect(agent.current()).toEqual({ kind: 'idle' })
  })

  it('comes back with the saved tunnel while the Control is unreachable', async () => {
    const register = vi.fn(async () => {
      throw new DevnxControlError('fora do ar', { status: null })
    })
    const { agent, tunnel, managedOrigin } = setup({ personToken: () => null }, { register })
    writeOrcaPitMachineSecrets(join(dir, 'secrets.json'), {
      tunnelToken: 'tt-saved',
      originHost: 'orca-x.devnx.com.br',
      originSecret: 'os-saved'
    })
    writeFileSync(join(dir, 'machine.json'), JSON.stringify({ uid: 'u-1', machineId: 5 }))
    agent.start()
    expect(managedOrigin).toHaveBeenCalledWith({ host: 'orca-x.devnx.com.br', secret: 'os-saved' })
    expect(tunnel.start).toHaveBeenCalledWith('tt-saved')
    await agent.tick()
    expect(agent.current()).toMatchObject({ kind: 'error' })
    expect(tunnel.stop).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'secrets.json'))).toBe(true)
  })
})
