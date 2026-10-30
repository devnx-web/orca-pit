import { describe, expect, it, vi } from 'vitest'
import { loginToOrcaPitServer, parseOrcaPitServerAddress } from './orca-pit-server-login'

describe('parseOrcaPitServerAddress', () => {
  it('reads a bare name as the HTTPS tunnel', () => {
    expect(parseOrcaPitServerAddress(' orca.devnx.com.br ')).toEqual({
      httpBase: 'https://orca.devnx.com.br',
      endpoint: 'wss://orca.devnx.com.br',
      host: 'orca.devnx.com.br'
    })
  })

  it('keeps the scheme given and any proxy prefix', () => {
    expect(parseOrcaPitServerAddress('wss://nitro5.devnx.com.br/')).toMatchObject({
      httpBase: 'https://nitro5.devnx.com.br',
      endpoint: 'wss://nitro5.devnx.com.br'
    })
    expect(parseOrcaPitServerAddress('https://x.test/orca')).toMatchObject({
      httpBase: 'https://x.test/orca',
      endpoint: 'wss://x.test/orca'
    })
  })

  it('reads a LAN address with a port as plain HTTP', () => {
    expect(parseOrcaPitServerAddress('192.168.15.22:6768')).toMatchObject({
      httpBase: 'http://192.168.15.22:6768',
      endpoint: 'ws://192.168.15.22:6768',
      host: '192.168.15.22'
    })
  })

  it('refuses what is not an address', () => {
    for (const bad of ['', 'ftp://x', 'a b', 'https://user:pw@x.test']) {
      expect(parseOrcaPitServerAddress(bad)).toBeNull()
    }
  })
})

describe('loginToOrcaPitServer', () => {
  it('passes on how long to wait after too many attempts', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '600' } })
        : new Response(null, { status: 204 })
    )
    const result = await loginToOrcaPitServer(
      { controlToken: () => 'jwt', fetch: fetcher as unknown as typeof fetch },
      { address: 'orca.devnx.com.br' }
    )
    expect(result).toEqual({ ok: false, reason: 'too-many', retryAfterSeconds: 600 })
    const [url, init] = fetcher.mock.calls[1]
    expect(url).toBe('https://orca.devnx.com.br/orca-pit/login')
    expect(JSON.parse(String(init?.body))).toEqual({
      controlToken: 'jwt',
      client: 'app',
      endpoint: 'wss://orca.devnx.com.br'
    })
  })

  it('sends e-mail and password, not the session, when they are typed', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ pairingUrl: 'orca://pair?code=x' }), { status: 200 })
        : new Response(null, { status: 204 })
    )
    const result = await loginToOrcaPitServer(
      { controlToken: () => 'jwt', fetch: fetcher as unknown as typeof fetch },
      { address: 'orca.devnx.com.br', email: 'a@x', password: 's' }
    )
    expect(result).toEqual({
      ok: true,
      pairingUrl: 'orca://pair?code=x',
      suggestedName: 'orca.devnx.com.br'
    })
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      email: 'a@x',
      password: 's',
      client: 'app'
    })
  })
})
