// Orca-Pit: `/orca-pit/login` on the server that hands out the web client, so the login shares the
// web client's origin. GET/HEAD say whether the login exists here (204, else 404); POST signs in.
// Without a DevNX Control session on this machine every method answers 404, as plain Orca would.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OrcaPitLoginInput, OrcaPitLoginOutcome } from './orca-pit-login'

export type OrcaPitLoginHandler = {
  isActive: () => boolean
  login: (input: OrcaPitLoginInput) => Promise<OrcaPitLoginOutcome>
  rateLimit: OrcaPitLoginRateLimit
}

const LOGIN_PATH = '/orca-pit/login'
const MAX_BODY_BYTES = 4096
// Why 5 per 15 min: a person who forgot the password retries a few times; a guesser gets nowhere.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000
const MAX_TRACKED_ADDRESSES = 1000

/** Failed attempts per client address. An attempt counts when it starts, so parallel guesses do too. */
export class OrcaPitLoginRateLimit {
  private readonly attempts = new Map<string, { count: number; since: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until the address may try again, or null when it may try now (and that try counts). */
  take(address: string): number | null {
    const now = this.now()
    this.prune(now)
    const entry = this.attempts.get(address)
    if (!entry || now - entry.since >= WINDOW_MS) {
      this.attempts.set(address, { count: 1, since: now })
      return null
    }
    if (entry.count >= MAX_ATTEMPTS) {
      return Math.max(1, Math.ceil((entry.since + WINDOW_MS - now) / 1000))
    }
    entry.count += 1
    return null
  }

  succeeded(address: string): void {
    this.attempts.delete(address)
  }

  private prune(now: number): void {
    if (this.attempts.size < MAX_TRACKED_ADDRESSES) {
      return
    }
    for (const [address, entry] of this.attempts) {
      if (now - entry.since >= WINDOW_MS) {
        this.attempts.delete(address)
      }
    }
  }
}

let handler: OrcaPitLoginHandler | null = null

export function setOrcaPitLoginHandler(next: OrcaPitLoginHandler | null): void {
  handler = next
}

/** Also under a proxy prefix, like the web client's own files. */
export function isOrcaPitLoginUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false
  }
  try {
    const { pathname } = new URL(rawUrl, 'http://127.0.0.1')
    return pathname === LOGIN_PATH || pathname.endsWith(LOGIN_PATH)
  } catch {
    return false
  }
}

function reply(response: ServerResponse, status: number, body?: Record<string, unknown>): void {
  if (response.destroyed) {
    return
  }
  response.statusCode = status
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (!body) {
    response.end()
    return
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(null))
  })
}

// The web client sends the endpoint it sees (scheme and proxy prefix included); Host is the fallback.
function parseInput(text: string | null, host: string | undefined): OrcaPitLoginInput | null {
  let value: unknown
  try {
    value = text ? JSON.parse(text) : null
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { email, password, endpoint } = value as Record<string, unknown>
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return null
  }
  return {
    email: email.trim().slice(0, 254),
    password,
    endpoint: typeof endpoint === 'string' && endpoint ? endpoint.slice(0, 512) : (host ?? null)
  }
}

// Why: JSON forces a CORS preflight this server never grants, and Sec-Fetch-Site names a
// cross-site page outright; together a foreign page can neither post nor read the offer.
function isSameOriginJson(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  const type = request.headers['content-type'] ?? ''
  return (
    (site === undefined || site === 'same-origin') &&
    /^application\/json(\s*;|$)/i.test(type.trim())
  )
}

const FAILURE_STATUS: Record<Exclude<OrcaPitLoginOutcome['kind'], 'ok'>, [number, string]> = {
  'bad-credentials': [401, 'E-mail ou senha inválidos.'],
  'wrong-tenant': [403, 'Este usuário não pertence à empresa deste Orca.'],
  inactive: [404, 'Not found'],
  unavailable: [503, 'Não foi possível falar com o DevNX Control. Tente de novo.']
}

export async function handleOrcaPitLoginRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const active = handler?.isActive() ? handler : null
  if (!active) {
    reply(response, 404)
    return
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    reply(response, 204)
    return
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, HEAD, POST')
    reply(response, 405)
    return
  }
  if (!isSameOriginJson(request)) {
    reply(response, 403, { message: 'Origem não permitida.' })
    return
  }
  const address = request.socket.remoteAddress ?? 'unknown'
  const retryAfter = active.rateLimit.take(address)
  if (retryAfter !== null) {
    response.setHeader('Retry-After', String(retryAfter))
    reply(response, 429, { message: 'Muitas tentativas. Aguarde alguns minutos.' })
    return
  }
  const input = parseInput(await readBody(request), request.headers.host)
  if (!input) {
    reply(response, 400, { message: 'Informe e-mail e senha.' })
    return
  }
  const outcome = await active.login(input).catch((error: unknown): OrcaPitLoginOutcome => {
    console.warn('[orca-pit] login failed:', error instanceof Error ? error.name : 'error')
    return { kind: 'unavailable' }
  })
  if (outcome.kind === 'ok') {
    active.rateLimit.succeeded(address)
    reply(response, 200, { pairingUrl: outcome.pairingUrl, name: outcome.user.name })
    return
  }
  const [status, message] = FAILURE_STATUS[outcome.kind]
  reply(response, status, { message })
}
