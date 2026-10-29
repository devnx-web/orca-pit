import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistry } from '../runtime/device-registry'
import { createStaticWebClientHandler } from '../runtime/rpc/static-web-client-handler'
import { DevnxControlError } from './devnx-control-http'
import { OrcaPitCentral, type OrcaPitControlCalls } from './orca-pit-control-me'
import type { OrcaPitMe } from './orca-pit-memberships'
import { performOrcaPitLogin } from './orca-pit-login'
import { OrcaPitLoginRateLimit, setOrcaPitLoginHandler } from './orca-pit-login-route'
import { mintOrcaPitUserDevice } from './orca-pit-user-devices'

// The central's owner works for DevNX (1, default) and Ailiv (2) in "Todas as empresas".
const OWNER: OrcaPitMe = {
  id: 1,
  name: 'Dono',
  email: 'd@x',
  defaultTenantId: 1,
  tenants: [
    { id: 1, orcaRole: 'admin' },
    { id: 2, orcaRole: 'admin' }
  ]
}
const FULANO: OrcaPitMe = {
  id: 7,
  name: 'Fulano',
  email: 'f@x',
  defaultTenantId: 1,
  tenants: [{ id: 1, orcaRole: 'member' }]
}
const SESSION = { baseUrl: 'https://control.test', token: 'central-token' }

function httpError(status: number): DevnxControlError {
  return new DevnxControlError(`HTTP ${status}`, { code: 'HTTP_ERROR', status })
}

let dir: string
let server: Server
let base: string
let registry: DeviceRegistry
let session: typeof SESSION | null
let calls: OrcaPitControlCalls

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-login-'))
  registry = new DeviceRegistry(dir)
  session = SESSION
  const users = new Map<string, OrcaPitMe>([
    ['central-token', OWNER],
    ['jwt-fulano', FULANO],
    [
      'jwt-outra',
      { ...FULANO, id: 9, defaultTenantId: 3, tenants: [{ id: 3, orcaRole: 'admin' }] }
    ],
    [
      'jwt-ailiv',
      { ...FULANO, id: 8, defaultTenantId: 2, tenants: [{ id: 2, orcaRole: 'member' }] }
    ]
  ])
  calls = {
    login: vi.fn(async (_base: string, email: string, password: string) => {
      if (password !== 'certa') {
        throw httpError(401)
      }
      return { 'outra@x': 'jwt-outra', 'ailiv@x': 'jwt-ailiv' }[email] ?? 'jwt-fulano'
    }),
    me: vi.fn(async (_base: string, token: string) => {
      const user = users.get(token)
      if (!user) {
        throw httpError(401)
      }
      return user
    })
  }
  const central = new OrcaPitCentral(() => session, calls)
  setOrcaPitLoginHandler({
    rateLimit: new OrcaPitLoginRateLimit(),
    isActive: () => session !== null,
    login: (input) =>
      performOrcaPitLogin(
        {
          central,
          calls,
          createOffer: (identity, endpoint) =>
            `offer|${mintOrcaPitUserDevice(registry, identity).deviceId}|${endpoint}`
        },
        input
      )
  })
  // The real static handler: the login hook must sit in front of its GET/HEAD-only rule.
  server = createServer(createStaticWebClientHandler(dir))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  setOrcaPitLoginHandler(null)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function login(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/orca-pit/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

describe('POST /orca-pit/login', () => {
  it('mints a runtime device for the person and returns its pairing offer', async () => {
    expect((await fetch(`${base}/orca-pit/login`)).status).toBe(204)
    const response = await login({ email: 'f@x', password: 'certa', endpoint: 'ws://h:1' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { pairingUrl: string; name: string }
    expect(body.name).toBe('Fulano')
    const [, deviceId, endpoint] = body.pairingUrl.split('|')
    expect(endpoint).toBe('ws://h:1')
    const device = registry.getDevice(deviceId)
    expect(device).toMatchObject({ name: 'Fulano · navegador' })
    expect(device?.orcaPitUser).toEqual({
      id: 7,
      name: 'Fulano',
      email: 'f@x',
      tenantId: 1,
      tenantIds: [1],
      orcaRole: 'member'
    })
    expect(device?.orcaPitControlToken).toBe('jwt-fulano')
    expect(JSON.stringify(body)).not.toContain('jwt-fulano')
  })

  it('answers a wrong password with a generic 401 and mints nothing', async () => {
    const response = await login({ email: 'f@x', password: 'errada' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: 'E-mail ou senha inválidos.' })
    expect(registry.listDevices()).toHaveLength(0)
  })

  it("accepts a person who shares only the owner's second company", async () => {
    const response = await login({ email: 'ailiv@x', password: 'certa' })
    expect(response.status).toBe(200)
    const [device] = registry.listDevices()
    expect(device.orcaPitUser).toMatchObject({ id: 8, tenantId: 2, tenantIds: [2] })
  })

  it('refuses a person who shares no company with the owner', async () => {
    const response = await login({ email: 'outra@x', password: 'certa' })
    expect(response.status).toBe(403)
    expect(registry.listDevices()).toHaveLength(0)
  })

  it('does not exist without a Control session on this machine', async () => {
    session = null
    expect((await fetch(`${base}/orca-pit/login`)).status).toBe(404)
    expect((await login({ email: 'f@x', password: 'certa' })).status).toBe(404)
    expect(calls.login).not.toHaveBeenCalled()
  })

  it('stops an address after five attempts, and a success clears it', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login({ email: 'f@x', password: 'errada' })).status).toBe(401)
    }
    const blocked = await login({ email: 'f@x', password: 'certa' })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(calls.login).toHaveBeenCalledTimes(5)
  })

  it('refuses cross-site posts and non-JSON bodies, and keeps other POSTs at 405', async () => {
    expect((await login({}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    const form = await fetch(`${base}/orca-pit/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"email":"f@x","password":"certa"}'
    })
    expect(form.status).toBe(403)
    expect((await fetch(`${base}/web-index.html`, { method: 'POST' })).status).toBe(405)
  })

  it('reports an unreachable panel as 503 without revealing why', async () => {
    vi.mocked(calls.login).mockRejectedValueOnce(
      new DevnxControlError('Não foi possível contatar o DevNX Control.', {
        code: 'NETWORK_ERROR'
      })
    )
    const response = await login({ email: 'f@x', password: 'certa' })
    expect(response.status).toBe(503)
  })
})

describe('OrcaPitLoginRateLimit', () => {
  it('lets an address try again once the window passes', () => {
    let now = 0
    const limit = new OrcaPitLoginRateLimit(() => now)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limit.take('1.2.3.4')).toBeNull()
    }
    expect(limit.take('1.2.3.4')).toBe(900)
    expect(limit.take('5.6.7.8')).toBeNull()
    now = 15 * 60_000
    expect(limit.take('1.2.3.4')).toBeNull()
  })
})
