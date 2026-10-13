// Loopback endpoints the terminals talk to. Provider tokens stay in this
// process: Claude gets a local capability plus this proxy, Codex gets a
// placeholder refresh token that this server exchanges with the panel.
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { DevnxControlError, isRecord, publicErrorMessage } from './devnx-control-http'
import { expiresInSeconds } from './devnx-control-payloads'
import type { DevnxControlClient } from './devnx-control-client'

const MAX_JSON_BYTES = 64 * 1024
const MAX_PROXY_BYTES = 64 * 1024 * 1024
const FORWARDED_REQUEST_HEADER =
  /^(?:accept|content-type|anthropic-version|anthropic-beta|user-agent|x-app|x-stainless-[a-z0-9-]+)$/i
const FORWARDED_RESPONSE_HEADER =
  /^(?:content-type|request-id|retry-after|anthropic-ratelimit-[a-z0-9-]+|x-ratelimit-[a-z0-9-]+)$/i

export const CLAUDE_PROXY_PATH = '/devnx/claude'
export const CODEX_REFRESH_PATH = '/devnx/openai/oauth/token'

function secretsEqual(left: string | null, right: string): boolean {
  if (!left) {
    return false
  }
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function httpError(status: number, message: string): DevnxControlError {
  return new DevnxControlError(message, {
    code: 'BROKER_REQUEST_REJECTED',
    status
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(JSON.stringify(payload))
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
        reject(httpError(413, 'Corpo grande demais.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks, total)))
    req.on('error', reject)
  })
}

// Streams Claude's SSE output as it arrives; a client that hangs up cancels the upstream read.
async function pipeToResponse(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse
): Promise<void> {
  const reader = body.getReader()
  const cancel = (): void => void reader.cancel().catch(() => {})
  res.once('close', cancel)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!res.write(value)) {
        await once(res, 'drain')
      }
    }
    res.end()
  } catch {
    res.destroy()
  } finally {
    res.off('close', cancel)
  }
}

export class DevnxControlBrokerServer {
  private server: Server | null = null
  private port: number | null = null

  constructor(private readonly client: DevnxControlClient) {}

  /** Base URL for terminal env, e.g. http://127.0.0.1:41234 — null until listening. */
  baseUrl(): string | null {
    return this.port === null ? null : `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    if (this.server) {
      return
    }
    // Why the remembered port first: panes in the PTY daemon outlive the app and keep the old URL.
    const preferred = this.client.runtime.port
    this.server = createServer((req, res) => void this.handle(req, res))
    this.port = await this.listen(preferred ?? 0).catch(() => this.listen(0))
    this.client.rememberPort(this.port)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.port = null
  }

  private listen(port: number): Promise<number> {
    const server = this.server
    if (!server) {
      return Promise.reject(new Error('broker server not created'))
    }
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
  }

  private assertLocal(req: IncomingMessage): void {
    if (req.headers.host !== `127.0.0.1:${this.port}`) {
      throw httpError(403, 'Host local inválido.')
    }
    // Why: only CLIs call this server; anything browser-shaped is a cross-site attempt.
    if (req.headers.origin || req.headers.referer || req.headers['sec-fetch-site']) {
      throw httpError(403, 'Origem não permitida.')
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      this.assertLocal(req)
      if (url.pathname === CODEX_REFRESH_PATH && req.method === 'POST') {
        sendJson(res, 200, await this.refreshCodex(req))
        return
      }
      if (url.pathname.startsWith(`${CLAUDE_PROXY_PATH}/`)) {
        await this.proxyClaude(req, res, url)
        return
      }
      throw httpError(404, 'Rota não encontrada.')
    } catch (error) {
      const status = error instanceof DevnxControlError && error.status ? error.status : 502
      if (!res.headersSent) {
        sendJson(res, status, {
          error: {
            type: 'devnx_broker_error',
            message: publicErrorMessage(error)
          }
        })
      } else {
        res.destroy()
      }
    }
  }

  private async refreshCodex(req: IncomingMessage): Promise<Record<string, unknown>> {
    let body: unknown
    try {
      body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8'))
    } catch {
      throw httpError(400, 'Corpo OAuth inválido.')
    }
    if (
      !isRecord(body) ||
      body.grant_type !== 'refresh_token' ||
      typeof body.refresh_token !== 'string'
    ) {
      throw httpError(400, 'Grant OAuth inválido.')
    }
    const accountId = this.client.accountForOpenAiCapability(body.refresh_token)
    if (!accountId) {
      throw httpError(401, 'Capability OAuth inválida ou expirada.')
    }
    const client = await this.client.refreshOpenAi(accountId)
    return {
      access_token: client.accessToken,
      id_token: client.idToken,
      account_id: client.accountId,
      refresh_token: body.refresh_token,
      token_type: 'Bearer',
      expires_in: expiresInSeconds(client.expiresAt)
    }
  }

  private async proxyClaude(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const bearer =
      /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1] ?? null
    if (!secretsEqual(bearer, this.client.runtime.claudeCapability)) {
      throw httpError(401, 'Capability Claude inválida.')
    }
    const method = String(req.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') {
      throw httpError(405, 'Método Claude não permitido.')
    }
    // Why strip /anthropic: some SDK clients only accept a base URL ending in it.
    const rest = url.pathname.slice(CLAUDE_PROXY_PATH.length).replace(/^\/anthropic(?=\/|$)/, '')
    const target = new URL(`${rest}${url.search}`, 'https://api.anthropic.com')
    if (target.origin !== 'https://api.anthropic.com' || !target.pathname.startsWith('/v1/')) {
      throw httpError(404, 'Rota Claude não permitida.')
    }
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (FORWARDED_REQUEST_HEADER.test(key) && typeof value === 'string') {
        headers[key] = value
      }
    }
    const body = method === 'POST' ? await readBody(req, MAX_PROXY_BYTES) : null

    const send = async (): Promise<{ response: Response; token: string }> => {
      const token = this.client.getSelection('claude')?.client.oauthToken
      if (!token) {
        throw httpError(503, 'Nenhuma conta Claude foi selecionada no DevNX Control.')
      }
      const response = await fetch(target, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        ...(body ? { body: Uint8Array.from(body) } : {}),
        cache: 'no-store',
        redirect: 'error'
      })
      return { response, token }
    }

    let attempt = await send()
    if (attempt.response.status === 401) {
      await attempt.response.body?.cancel().catch(() => {})
      await this.client.recoverClaude(attempt.token)
      attempt = await send()
    }
    const upstream = attempt.response
    const responseHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': upstream.headers.get('cache-control') ?? 'no-store'
    }
    upstream.headers.forEach((value, key) => {
      if (FORWARDED_RESPONSE_HEADER.test(key)) {
        responseHeaders[key] = value
      }
    })
    res.writeHead(upstream.status, responseHeaders)
    if (!upstream.body) {
      res.end()
      return
    }
    await pipeToResponse(upstream.body, res)
  }
}
