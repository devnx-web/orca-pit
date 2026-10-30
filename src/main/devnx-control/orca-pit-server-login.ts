// Orca-Pit: "Add server" by Control login. The app signs in on the other Orca-Pit's
// `/orca-pit/login` (the browser's endpoint) and gets back its pairing link, which then takes the
// same verify-and-save path as a pasted access link. With a person signed in to this app their
// Control session goes along, so nobody types a password twice.
import type {
  OrcaPitServerLoginInput,
  OrcaPitServerLoginResult
} from '../../shared/orca-pit-app-session'

const LOGIN_PATH = '/orca-pit/login'
const PROBE_TIMEOUT_MS = 10_000
// Why longer: the server itself asks the Control before answering.
const LOGIN_TIMEOUT_MS = 30_000
const MAX_REPLY_CHARS = 16_384

export type OrcaPitServerAddress = {
  /** `https://orca.devnx.com.br` (with any proxy prefix): where `/orca-pit/login` lives. */
  httpBase: string
  /** `wss://orca.devnx.com.br`: what the pairing link should point at. */
  endpoint: string
  host: string
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * `orca.devnx.com.br`, `https://…`, `wss://…`, `host:port` or an IP. A bare name is HTTPS (a
 * tunnel or proxy); a bare IP, `localhost` or an explicit port is the plain LAN server.
 */
export function parseOrcaPitServerAddress(input: string): OrcaPitServerAddress | null {
  const trimmed = input.trim()
  if (!trimmed || /\s/.test(trimmed)) {
    return null
  }
  const schemeMatch = /^([a-z]+):\/\//i.exec(trimmed)
  let secure: boolean
  let rest: string
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (!['http', 'https', 'ws', 'wss'].includes(scheme)) {
      return null
    }
    secure = scheme === 'https' || scheme === 'wss'
    rest = trimmed.slice(schemeMatch[0].length)
  } else {
    rest = trimmed
    const hostPart = rest.split('/')[0] ?? ''
    const hasPort = /:\d+$/.test(hostPart) && !hostPart.startsWith('[')
    const bareHost = hostPart.replace(/:\d+$/, '')
    secure = !(hasPort || IPV4.test(bareHost) || bareHost === 'localhost')
  }
  let url: URL
  try {
    url = new URL(`${secure ? 'https' : 'http'}://${rest}`)
  } catch {
    return null
  }
  if (!url.hostname || url.username || url.password) {
    return null
  }
  const prefix = url.pathname.replace(/\/+$/, '')
  const httpBase = `${url.protocol}//${url.host}${prefix}`
  return {
    httpBase,
    endpoint: `${secure ? 'wss' : 'ws'}://${url.host}${prefix}`,
    host: url.hostname
  }
}

export type OrcaPitServerLoginDeps = {
  /** The JWT of the person signed in to this app, or null. */
  controlToken: () => string | null
  fetch?: typeof fetch
}

async function timedFetch(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    return await fetcher(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

const HEADERS = { Accept: 'application/json', 'User-Agent': 'Orca-Pit' }

const FAILURE_BY_STATUS: Record<number, 'bad-credentials' | 'wrong-tenant' | 'no-login'> = {
  400: 'bad-credentials',
  401: 'bad-credentials',
  403: 'wrong-tenant',
  404: 'no-login'
}

export async function loginToOrcaPitServer(
  deps: OrcaPitServerLoginDeps,
  input: OrcaPitServerLoginInput
): Promise<OrcaPitServerLoginResult> {
  const fetcher = deps.fetch ?? fetch
  const address = parseOrcaPitServerAddress(input.address)
  if (!address) {
    return { ok: false, reason: 'invalid-address' }
  }
  const email = input.email?.trim() ?? ''
  const password = input.password ?? ''
  const token = email ? null : deps.controlToken()
  if (!token && (!email || !password)) {
    return { ok: false, reason: 'needs-credentials' }
  }
  const url = `${address.httpBase}${LOGIN_PATH}`
  try {
    const probe = await timedFetch(fetcher, url, { headers: HEADERS }, PROBE_TIMEOUT_MS)
    if (probe.status !== 204) {
      return { ok: false, reason: probe.status === 404 ? 'no-login' : 'unreachable' }
    }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  const credentials = token ? { controlToken: token } : { email, password }
  let response: Response
  try {
    response = await timedFetch(
      fetcher,
      url,
      {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, client: 'app', endpoint: address.endpoint })
      },
      LOGIN_TIMEOUT_MS
    )
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'))
    return {
      ok: false,
      reason: 'too-many',
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: seconds } : {})
    }
  }
  if (!response.ok) {
    return { ok: false, reason: FAILURE_BY_STATUS[response.status] ?? 'unavailable' }
  }
  const text = (await response.text().catch(() => '')).slice(0, MAX_REPLY_CHARS)
  let pairingUrl: unknown = null
  try {
    pairingUrl = (JSON.parse(text) as { pairingUrl?: unknown } | null)?.pairingUrl
  } catch {
    pairingUrl = null
  }
  return typeof pairingUrl === 'string' && pairingUrl
    ? { ok: true, pairingUrl, suggestedName: address.host }
    : { ok: false, reason: 'unavailable' }
}
