import { describe, expect, it, vi } from 'vitest'
import type { RouterCache, RouterDeps, RouterEnv } from './env'
import { DEFAULT_MACHINE, ROOT_REDIRECT_UNTIL_MS, handleRequest } from './index'

const ENV: RouterEnv = {
  CONTROL_BASE_URL: 'https://bcontrol.test',
  ORCA_ROUTER_KEY: 'router-key'
}
const BEFORE_CUTOFF = Date.parse('2026-11-01T12:00:00-03:00')
const AFTER_CUTOFF = ROOT_REDIRECT_UNTIL_MS + 1

function memoryCache(): RouterCache & { size: () => number } {
  const entries = new Map<string, Response>()
  return {
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => {
      entries.set(request.url, response)
    },
    size: () => entries.size
  }
}

type Machines = Record<string, { status: number; body?: unknown }>

function setup(machines: Machines, now = BEFORE_CUTOFF, origin?: (request: Request) => Response) {
  const cache = memoryCache()
  const originRequests: Request[] = []
  const controlCalls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.host === 'bcontrol.test') {
      controlCalls.push(url.pathname)
      expect(request.headers.get('X-Orca-Router-Key')).toBe('router-key')
      const slug = url.pathname.split('/').pop() ?? ''
      const answer = machines[slug] ?? { status: 404 }
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status
      })
    }
    originRequests.push(request)
    return origin ? origin(request) : new Response('from origin', { status: 200 })
  })
  const waits: Promise<unknown>[] = []
  const deps: RouterDeps = { fetch: fetchMock as typeof fetch, cache, now: () => now }
  const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) }
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await handleRequest(new Request(`https://orca.devnx.com.br${path}`, init), ENV, ctx, deps)
    await Promise.all(waits)
    return response
  }
  return { send, originRequests, controlCalls, cache }
}

const NITRO5 = {
  nitro5: {
    status: 200,
    body: {
      origin_host: 'orca-nitro5-a1b2c3.devnx.com.br',
      origin_secret: 'origin-secret',
      online: true,
      status: 'approved'
    }
  }
}

describe('router', () => {
  it("strips the prefix and proves itself with the machine's origin secret", async () => {
    const { send, originRequests } = setup(NITRO5)
    const response = await send('/nitro5/assets/web.js?v=1', {
      headers: {
        'CF-Connecting-IP': '203.0.113.9',
        'X-Orca-Client-IP': '6.6.6.6',
        'X-Orca-Origin-Secret': 'forged'
      }
    })
    expect(await response.text()).toBe('from origin')
    const sent = originRequests[0]!
    expect(sent.url).toBe('https://orca-nitro5-a1b2c3.devnx.com.br/assets/web.js?v=1')
    expect(sent.headers.get('X-Orca-Origin-Secret')).toBe('origin-secret')
    expect(sent.headers.get('X-Orca-Client-IP')).toBe('203.0.113.9')
    expect(sent.headers.get('X-Forwarded-Prefix')).toBe('/nitro5')
    expect(sent.redirect).toBe('manual')
  })

  it('caches the Control answer for a minute', async () => {
    const { send, controlCalls } = setup(NITRO5)
    await send('/nitro5/')
    await send('/nitro5/web-index.html')
    expect(controlCalls).toEqual(['/api/orca/router/machines/nitro5'])
  })

  it('does not cache when the Control fails, so the next request asks again', async () => {
    const { send, controlCalls } = setup({ mirella: { status: 503 } }, AFTER_CUTOFF)
    const first = await send('/mirella/', { headers: { Accept: 'text/html' } })
    expect(first.status).toBe(502)
    await send('/mirella/', { headers: { Accept: 'text/html' } })
    expect(controlCalls).toHaveLength(2)
  })

  it('hands a WebSocket answer back untouched and forwards the bare machine path as /', async () => {
    const upgraded = new Response(null, { status: 200, headers: { 'X-Upgraded': 'yes' } })
    const { send, originRequests } = setup(NITRO5, BEFORE_CUTOFF, () => upgraded)
    const response = await send('/nitro5', { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } })
    expect(response).toBe(upgraded)
    expect(new URL(originRequests[0]!.url).pathname).toBe('/')
    expect(originRequests[0]!.headers.get('Upgrade')).toBe('websocket')
  })

  it('moves a page under the trailing slash so relative URLs keep the prefix', async () => {
    const { send } = setup(NITRO5)
    const response = await send('/Nitro5?x=1')
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('/nitro5/?x=1')
  })

  it('forwards a POST body (the Control login) to the machine', async () => {
    const { send, originRequests } = setup(NITRO5)
    await send('/nitro5/orca-pit/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c' })
    })
    expect(new URL(originRequests[0]!.url).pathname).toBe('/orca-pit/login')
    expect(await originRequests[0]!.text()).toBe('{"email":"a@b.c"}')
  })

  it('opens the central from the bare domain until the cutoff, then shows the picker', async () => {
    const before = await setup({}).send('/')
    expect(before.status).toBe(302)
    expect(before.headers.get('Location')).toBe(`/${DEFAULT_MACHINE}/`)
    const after = await setup({}, AFTER_CUTOFF).send('/')
    expect(after.status).toBe(200)
    expect(await after.text()).toContain('Escolha a máquina')
    const picked = await setup({}, AFTER_CUTOFF).send('/?maquina=Nitro5')
    expect(picked.headers.get('Location')).toBe('/nitro5/')
  })

  it('keeps clients paired with the bare domain on the central', async () => {
    const { send, originRequests } = setup({}, BEFORE_CUTOFF)
    await send('/', { headers: { Upgrade: 'websocket' } })
    await send('/web-index.html')
    expect(originRequests.map((request) => request.url)).toEqual([
      'https://orca.devnx.com.br/',
      'https://orca.devnx.com.br/web-index.html'
    ])
    // The hand-made tunnel has no origin secret.
    expect(originRequests[0]!.headers.get('X-Orca-Origin-Secret')).toBeNull()
  })

  it('answers PT-BR pages for missing, pending and offline machines', async () => {
    const html = { headers: { Accept: 'text/html' } }
    const missing = await setup({}, AFTER_CUTOFF).send('/fulano/', html)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('Máquina não encontrada')

    const pending = await setup({ mirella: { status: 200, body: { status: 'pending', origin_host: null } } }).send('/mirella/', html)
    expect(pending.status).toBe(403)
    expect(await pending.text()).toContain('aprovação')

    const offline = await setup(NITRO5, BEFORE_CUTOFF, () => new Response(null, { status: 530 })).send('/nitro5/', html)
    expect(offline.status).toBe(503)
    expect(await offline.text()).toContain('Máquina desligada')
  })

  it('refuses an origin host outside the hidden tunnel names, or one without a secret', async () => {
    const { send, originRequests } = setup(
      {
        evil: {
          status: 200,
          body: { status: 'approved', origin_host: 'example.com', origin_secret: 's', online: true }
        },
        bare: {
          status: 200,
          body: { status: 'approved', origin_host: 'orca-bare-a1b2c3.devnx.com.br', online: true }
        }
      },
      AFTER_CUTOFF
    )
    expect((await send('/evil/', { headers: { Accept: 'text/html' } })).status).toBe(403)
    expect((await send('/bare/', { headers: { Accept: 'text/html' } })).status).toBe(403)
    expect(originRequests).toHaveLength(0)
  })
})
