import { describe, expect, it, vi } from 'vitest'
import type { RouterCache, RouterDeps, RouterEnv } from './env'
import { handleRequest } from './index'
import { routePath } from './routing'
import { whatsappKey } from './whatsapp'

const ENV: RouterEnv = { CONTROL_BASE_URL: 'https://bcontrol.test/', ORCA_ROUTER_KEY: 'router-key' }
const KEY = 'k'.repeat(48)
const EVENT = JSON.stringify({ EventType: 'messages', token: 'instance-token', message: { text: '@orca oi' } })

function memoryCache(): RouterCache {
  const entries = new Map<string, Response>()
  return {
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => {
      entries.set(request.url, response)
    }
  }
}

type ControlAnswer = { status: number; body?: unknown } | 'throw'

function setup(webhook: ControlAnswer, machine?: { status: number; body?: unknown }, wakeFails = false) {
  const calls: Request[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push(request.clone())
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/whatsapp/webhook/')) {
      if (webhook === 'throw') throw new Error('Control fora do ar')
      return new Response(webhook.body === undefined ? null : JSON.stringify(webhook.body), { status: webhook.status })
    }
    if (url.pathname.startsWith('/api/orca/router/machines/')) {
      const answer = machine ?? { status: 404 }
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status })
    }
    if (wakeFails) throw new Error('túnel caído')
    return new Response(null, { status: 204 })
  })
  const waits: Promise<unknown>[] = []
  const deps: RouterDeps = { fetch: fetchMock as typeof fetch, cache: memoryCache(), now: () => Date.now() }
  const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) }
  const send = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await handleRequest(new Request(`https://orca.devnx.com.br${path}`, init), ENV, ctx, deps)
    await Promise.all(waits)
    return response
  }
  const post = (path = `/whatsapp/${KEY}`) =>
    send(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: EVENT })
  return { send, post, calls }
}

const NITRO5 = {
  status: 200,
  body: { status: 'approved', origin_host: 'orca-nitro5-a1b2c3.devnx.com.br', origin_secret: 'origin-secret', online: true }
}

describe('webhook do WhatsApp', () => {
  it('repassa o corpo ao Control com a chave do roteador e acorda a máquina do grupo', async () => {
    const { post, calls } = setup({ status: 200, body: { wake: 'nitro5' } }, NITRO5)
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ wake: 'nitro5' })

    const [toControl, lookup, wake] = calls
    expect(toControl!.url).toBe(`https://bcontrol.test/api/whatsapp/webhook/${KEY}`)
    expect(toControl!.method).toBe('POST')
    expect(toControl!.headers.get('X-Orca-Router-Key')).toBe('router-key')
    expect(toControl!.headers.get('User-Agent')).toBe('orca-devnx-router/1')
    expect(await toControl!.text()).toBe(EVENT)

    expect(new URL(lookup!.url).pathname).toBe('/api/orca/router/machines/nitro5')
    expect(wake!.url).toBe('https://orca-nitro5-a1b2c3.devnx.com.br/orca-pit/whatsapp/wake')
    expect(wake!.method).toBe('POST')
    expect(wake!.headers.get('X-Orca-Origin-Secret')).toBe('origin-secret')
    // O token da instância não vai para a máquina.
    expect(await wake!.text()).toBe('{}')
  })

  it('aceita subcaminhos (addUrlEvents) com a mesma chave', async () => {
    const { post, calls } = setup({ status: 200, body: { wake: null } })
    await post(`/whatsapp/${KEY}/messages/text`)
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([`/api/whatsapp/webhook/${KEY}`])
  })

  it('não acorda ninguém sem wake, nem máquina pendente', async () => {
    const semWake = setup({ status: 200, body: { wake: null } }, NITRO5)
    await semWake.post()
    expect(semWake.calls).toHaveLength(1)

    const pendente = setup({ status: 200, body: { wake: 'mirella' } }, { status: 200, body: { status: 'pending' } })
    expect((await pendente.post()).status).toBe(200)
    expect(pendente.calls.map((c) => new URL(c.url).host)).toEqual(['bcontrol.test', 'bcontrol.test'])
  })

  it('responde 200 vazio sem chamar o Control quando a chave é inválida ou não é POST', async () => {
    for (const path of ['/whatsapp/chave-invalida', '/whatsapp/', '/whatsapp', '/whatsapp/curta']) {
      const { post, calls } = setup({ status: 200, body: { wake: 'nitro5' } })
      const response = await post(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(calls).toHaveLength(0)
    }
    const { send, calls } = setup({ status: 200 })
    expect((await send(`/whatsapp/${KEY}`)).status).toBe(200)
    expect(calls).toHaveLength(0)
  })

  it('responde 200 à uazapi mesmo quando o Control recusa, falha ou cai', async () => {
    for (const answer of [{ status: 404, body: { wake: null } }, { status: 403 }, { status: 500 }, 'throw'] as const) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const response = await setup(answer).post()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      warn.mockRestore()
    }
  })

  it('engole a falha do acordar: a máquina busca sozinha', async () => {
    const response = await setup({ status: 200, body: { wake: 'nitro5' } }, NITRO5, true).post()
    expect(response.status).toBe(200)
  })

  it('ignora um wake que não é slug', async () => {
    const { post, calls } = setup({ status: 200, body: { wake: '../api' } }, NITRO5)
    expect(await (await post()).json()).toEqual({ wake: null })
    expect(calls).toHaveLength(1)
  })
})

describe('caminho /whatsapp', () => {
  it('nunca é máquina e só aceita a chave como o Control a gera', () => {
    expect(routePath('/whatsapp/')).toEqual({ kind: 'not-found' })
    expect(whatsappKey(`/whatsapp/${KEY}`)).toBe(KEY)
    expect(whatsappKey('/whatsapp/abc')).toBeNull()
    expect(whatsappKey('/whatsapp/a-b'.padEnd(40, 'c'))).toBeNull()
  })
})
