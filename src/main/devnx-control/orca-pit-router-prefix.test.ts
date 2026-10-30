// Orca-Pit: the web client and the Control login behind `orca.devnx.com.br/<machine>`, end to
// end on this machine. A small Node proxy stands in for the Worker and the managed tunnel: it
// uses the Worker's own path rule, strips the prefix, and reaches the Orca from loopback with the
// headers the router sends.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { routePath } from '../../../cloud/apps/devnx-router/src/routing'
import { WebSocketTransport } from '../runtime/rpc/ws-transport'
import { OrcaPitLoginRateLimit, setOrcaPitLoginHandler } from './orca-pit-login-route'
import { setOrcaPitManagedOrigin } from './orca-pit-managed-origin'

const ORIGIN_HOST = 'orca-nitro5-a1b2c3.devnx.com.br'

let dir: string
// The real runtime server: static web client, Control login and WebSocket upgrade.
let origin: WebSocketTransport
let proxy: Server
let proxyBase: string
let routedIp: string
let secret: string | null

function port(server: Server): number {
  return (server.address() as AddressInfo).port
}

function originPort(): number {
  return origin.resolvedPort
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-router-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(
    join(dir, 'web-index.html'),
    '<script type="module" src="./assets/web.js"></script>'
  )
  writeFileSync(join(dir, 'assets', 'web.js'), 'export {}')
  routedIp = '203.0.113.1'
  setOrcaPitManagedOrigin({ host: ORIGIN_HOST, secret: 'origin-secret' })
  secret = 'origin-secret'
  setOrcaPitLoginHandler({
    rateLimit: new OrcaPitLoginRateLimit(),
    isActive: () => true,
    login: async (input) =>
      'password' in input && input.password === 'certa'
        ? {
            kind: 'ok',
            pairingUrl: `offer|${input.endpoint}`,
            user: {
              id: 7,
              name: 'Fulano',
              email: 'f@x',
              tenantId: 1,
              tenantIds: [1],
              orcaRole: 'member',
              avatarUrl: null
            }
          }
        : { kind: 'bad-credentials' }
  })
  origin = new WebSocketTransport({ host: '127.0.0.1', port: 0, staticRoot: dir })
  await origin.start()

  const routerHeaders = (headers: Record<string, string | string[] | undefined>) => {
    // What cloudflared delivers: the hidden hostname as Host, the router's headers kept.
    const next = { ...headers, host: ORIGIN_HOST, 'x-orca-client-ip': routedIp }
    if (secret) {
      next['x-orca-origin-secret'] = secret
    }
    return next
  }
  proxy = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://proxy')
    const route = routePath(url.pathname)
    if (route.kind === 'machine-bare') {
      res.writeHead(301, { Location: `/${route.slug}/${url.search}` }).end()
      return
    }
    if (route.kind !== 'machine') {
      res.writeHead(404).end()
      return
    }
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: originPort(),
        method: req.method,
        path: `${route.originPath}${url.search}`,
        headers: routerHeaders(req.headers)
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      }
    )
    req.pipe(upstream)
  })
  proxy.on('upgrade', (req, socket, head) => {
    const route = routePath(new URL(req.url ?? '/', 'http://proxy').pathname)
    const path =
      route.kind === 'machine' ? route.originPath : route.kind === 'machine-bare' ? '/' : null
    if (!path) {
      socket.destroy()
      return
    }
    const upstream = connect(originPort(), '127.0.0.1', () => {
      const headers = routerHeaders(req.headers)
      const lines = Object.entries(headers).flatMap(([name, value]) =>
        value === undefined ? [] : [`${name}: ${Array.isArray(value) ? value.join(', ') : value}`]
      )
      upstream.write(`GET ${path} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
      upstream.write(head)
      upstream.pipe(socket).pipe(upstream)
    })
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  proxyBase = `http://127.0.0.1:${port(proxy)}`
})

afterEach(async () => {
  setOrcaPitLoginHandler(null)
  setOrcaPitManagedOrigin(null)
  proxy.closeAllConnections()
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
  await origin.stop()
  rmSync(dir, { recursive: true, force: true })
})

function login(password: string): Promise<Response> {
  return fetch(`${proxyBase}/nitro5/orca-pit/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'f@x', password, endpoint: 'wss://orca.devnx.com.br/nitro5' })
  })
}

describe('Orca under /<machine>/', () => {
  it('moves to the trailing slash, loads the page and its relative assets', async () => {
    const bare = await fetch(`${proxyBase}/nitro5`, { redirect: 'manual' })
    expect(bare.status).toBe(301)
    expect(bare.headers.get('location')).toBe('/nitro5/')

    const page = await fetch(`${proxyBase}/nitro5/`)
    const html = await page.text()
    expect(page.status).toBe(200)
    const src = /src="([^"]+)"/.exec(html)?.[1] ?? ''
    const asset = await fetch(new URL(src, `${proxyBase}/nitro5/`))
    expect(asset.status).toBe(200)
    expect(new URL(asset.url).pathname).toBe('/nitro5/assets/web.js')
  })

  it('signs in through the prefix and hands back an offer for the prefixed endpoint', async () => {
    expect((await fetch(`${proxyBase}/nitro5/orca-pit/login`)).status).toBe(204)
    const response = await login('certa')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { pairingUrl: string }).pairingUrl).toBe(
      'offer|wss://orca.devnx.com.br/nitro5'
    )
  })

  it("counts failed logins per person's IP when the router proves the request is its own", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('errada')
    }
    expect((await login('certa')).status).toBe(429)
    routedIp = '203.0.113.2'
    expect((await login('certa')).status).toBe(200)
  })

  it('refuses the hidden hostname without the origin secret, page, login and WebSocket', async () => {
    secret = 'guess'
    expect((await fetch(`${proxyBase}/nitro5/`)).status).toBe(403)
    expect((await login('certa')).status).toBe(403)
    const socket = new WebSocket(`ws://127.0.0.1:${port(proxy)}/nitro5`)
    const failure = await new Promise<string>((resolve) => {
      socket.once('open', () => resolve('open'))
      socket.once('unexpected-response', (_request, response) =>
        resolve(String(response.statusCode))
      )
      socket.once('error', () => resolve('error'))
    })
    expect(failure).not.toBe('open')
  })

  it('still serves other hostnames (LAN, hand-made tunnel) as before', async () => {
    const direct = await fetch(`http://127.0.0.1:${originPort()}/web-index.html`)
    expect(direct.status).toBe(200)
  })

  it('opens the runtime WebSocket through the bare and the slashed machine path', async () => {
    for (const path of ['/nitro5', '/nitro5/']) {
      const socket = new WebSocket(`ws://127.0.0.1:${port(proxy)}${path}`)
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      socket.close()
    }
  })
})
