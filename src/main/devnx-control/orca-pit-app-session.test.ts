import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevnxControlError } from './devnx-control-http'
import { ORCA_PIT_OFFLINE_GRACE_MS, OrcaPitAppSession } from './orca-pit-app-session'
import type { OrcaPitControlCalls } from './orca-pit-control-me'
import type { OrcaPitMe } from './orca-pit-memberships'
import { readOrcaPitPublicAddress, writeOrcaPitPublicAddress } from './orca-pit-public-address'

const OWNER: OrcaPitMe = {
  id: 1,
  name: 'Dono',
  email: 'd@x',
  defaultTenantId: 1,
  tenants: [{ id: 1, orcaRole: 'admin' }]
}
const ANA: OrcaPitMe = {
  id: 7,
  name: 'Ana',
  email: 'ana@x',
  avatarUrl: 'https://s3.test/ana.png',
  defaultTenantId: 1,
  tenants: [{ id: 1, orcaRole: 'member' }]
}
const SESSION = { baseUrl: 'https://control.test', token: 'central' }

let dir: string
let now: number
let calls: OrcaPitControlCalls
let session: typeof SESSION | null

function make(): OrcaPitAppSession {
  return new OrcaPitAppSession({
    session: () => session,
    centralMe: async () => OWNER,
    filePath: join(dir, 'login.json'),
    calls,
    now: () => now
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-app-'))
  now = 1_000_000
  session = SESSION
  calls = {
    login: vi.fn(async (_base: string, _email: string, password: string) => {
      if (password !== 'certa') {
        throw new DevnxControlError('401', { code: 'HTTP_ERROR', status: 401 })
      }
      return 'jwt-ana'
    }),
    me: vi.fn(async () => ANA)
  }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const outage = (): DevnxControlError =>
  new DevnxControlError('rede', { code: 'NETWORK_ERROR', status: null })

describe('OrcaPitAppSession', () => {
  it('is not required on a machine without a Control session', async () => {
    session = null
    const app = make()
    expect(app.state()).toEqual({ kind: 'not-required' })
    expect(app.currentUser()).toBeNull()
  })

  it('signs the person in with photo and keeps the JWT in memory only', async () => {
    const app = make()
    expect(app.state()).toEqual({ kind: 'signed-out', rememberedEmail: null })
    const result = await app.login(' ana@x ', 'certa')
    expect(result).toEqual({
      ok: true,
      state: {
        kind: 'signed-in',
        offline: false,
        person: {
          id: 7,
          name: 'Ana',
          email: 'ana@x',
          avatarUrl: 'https://s3.test/ana.png',
          orcaRole: 'member'
        }
      }
    })
    expect(app.controlToken()).toBe('jwt-ana')
    const stored = readFileSync(join(dir, 'login.json'), 'utf8')
    expect(stored).not.toContain('jwt-ana')
    expect(stored).not.toContain('certa')
    expect(statSync(join(dir, 'login.json')).mode & 0o777).toBe(0o600)
    app.logout()
    expect(app.state()).toEqual({ kind: 'signed-out', rememberedEmail: 'ana@x' })
  })

  it('refuses a wrong password and a person of another company', async () => {
    const app = make()
    expect(await app.login('ana@x', 'errada')).toEqual({ ok: false, reason: 'bad-credentials' })
    vi.mocked(calls.me).mockResolvedValueOnce({
      ...ANA,
      tenants: [{ id: 9, orcaRole: 'admin' }],
      defaultTenantId: 9
    })
    expect(await app.login('ana@x', 'certa')).toEqual({ ok: false, reason: 'wrong-tenant' })
  })

  it('lets the last person back in offline for 12 hours, with the same password', async () => {
    await make().login('ana@x', 'certa')
    vi.mocked(calls.login).mockRejectedValue(outage())
    const later = make()
    expect(await later.login('ana@x', 'errada')).toEqual({ ok: false, reason: 'unavailable' })
    expect(await later.login('outra@x', 'certa')).toEqual({ ok: false, reason: 'unavailable' })
    const back = await later.login('ANA@x', 'certa')
    expect(back.ok && back.state).toMatchObject({ kind: 'signed-in', offline: true })
    expect(later.currentUser()?.id).toBe(7)
    expect(later.controlToken()).toBeNull()
    now += ORCA_PIT_OFFLINE_GRACE_MS + 1
    expect(await make().login('ana@x', 'certa')).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('orca-pit public address', () => {
  it('remembers a share address per machine and clears it', () => {
    const file = join(dir, 'address.json')
    expect(readOrcaPitPublicAddress(file)).toBeNull()
    expect(writeOrcaPitPublicAddress(file, ' wss://orca.devnx.com.br ')).toBe(
      'wss://orca.devnx.com.br'
    )
    expect(readOrcaPitPublicAddress(file)).toBe('wss://orca.devnx.com.br')
    expect(() => writeOrcaPitPublicAddress(file, 'https://x')).toThrow()
    expect(writeOrcaPitPublicAddress(file, '')).toBeNull()
    expect(readOrcaPitPublicAddress(file)).toBeNull()
  })
})
