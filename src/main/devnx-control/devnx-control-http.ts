// Transport to the DevNX Control panel: URL rules, bounded JSON requests and
// redaction, so no credential reaches a log or an error shown in the UI.

export const DEVNX_CONTROL_API_PATHS = {
  login: '/api/login',
  deviceTokens: '/api/cockpit-ai/device-tokens',
  revokeDeviceToken: '/api/cockpit-ai/device-token',
  accounts: '/api/cockpit-ai/accounts',
  select: '/api/cockpit-ai/select',
  syncUsage: '/api/cockpit-ai/sync-usage',
  refresh: (accountId: string): string =>
    `/api/cockpit-ai/accounts/${encodeURIComponent(accountId)}/refresh`
} as const

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 1_048_576

export class DevnxControlError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(
    message: string,
    options: { code?: string; status?: number | null; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DevnxControlError'
    this.code = options.code ?? 'DEVNX_CONTROL_ERROR'
    this.status = options.status ?? null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLoopbackHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname)
}

/** HTTPS always; plain HTTP only to loopback while developing against a local panel. */
export function normalizeDevnxBaseUrl(input: unknown, isPackaged: boolean): string {
  let url: URL
  try {
    url = new URL(String(input ?? '').trim())
  } catch {
    throw new DevnxControlError('URL do DevNX Control inválida.', {
      code: 'INVALID_BASE_URL'
    })
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DevnxControlError(
      'A URL do DevNX Control não pode conter credenciais, query ou fragmento.',
      { code: 'INVALID_BASE_URL' }
    )
  }
  const isHttps = url.protocol === 'https:'
  const isDevLoopback = !isPackaged && url.protocol === 'http:' && isLoopbackHost(url.hostname)
  if (!isHttps && !isDevLoopback) {
    throw new DevnxControlError('O DevNX Control deve usar HTTPS.', {
      code: 'INSECURE_BASE_URL'
    })
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function apiUrl(baseUrl: string, apiPath: string): string {
  const base = new URL(baseUrl)
  const route = new URL(apiPath, 'https://devnx.invalid')
  const basePath = base.pathname.replace(/\/+$/, '')
  let suffix = route.pathname
  // Why: accept both https://control.example and https://control.example/api.
  if (basePath.endsWith('/api') && suffix.startsWith('/api/')) {
    suffix = suffix.slice(4)
  }
  base.pathname = `${basePath}${suffix}`.replace(/\/{2,}/g, '/')
  base.search = route.search
  return base.toString()
}

export function redactText(input: unknown): string {
  return String(input ?? '')
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(
      /((?:access|refresh|id|device)[_-]?token|password|api[_-]?key|client[_-]?secret)(\s*[=:]\s*)[^\s,;}]+/gi,
      '$1$2[redacted]'
    )
    .replace(/\b(?:sk|sess|eyJ)[-_A-Za-z0-9.]{16,}\b/g, '[redacted]')
    .slice(0, 240)
}

function serverMessage(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.message !== 'string') {
    return ''
  }
  return redactText(payload.message)
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

async function readLimitedText(response: Response): Promise<string> {
  const advertised = Number(response.headers.get('content-length'))
  const tooLarge = (): DevnxControlError =>
    new DevnxControlError('Resposta grande demais do DevNX Control.', {
      code: 'RESPONSE_TOO_LARGE',
      status: response.status
    })
  if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  if (!response.body) {
    return ''
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, total).toString('utf8')
  } finally {
    reader.releaseLock()
  }
}

export type DevnxRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  token?: string | null
  timeoutMs?: number
}

export async function requestDevnxControl(
  baseUrl: string,
  apiPath: string,
  options: DevnxRequestOptions = {}
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await fetch(apiUrl(baseUrl, apiPath), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    const text = await readLimitedText(response)
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        throw new DevnxControlError('Resposta inválida do DevNX Control.', {
          code: 'INVALID_SERVER_RESPONSE',
          status: response.status
        })
      }
    }
    if (!response.ok) {
      const detail = serverMessage(payload)
      throw new DevnxControlError(
        `DevNX Control respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        { code: 'HTTP_ERROR', status: response.status }
      )
    }
    return payload
  } catch (error) {
    if (error instanceof DevnxControlError) {
      throw error
    }
    if (controller.signal.aborted) {
      throw new DevnxControlError('Tempo limite ao contatar o DevNX Control.', {
        code: 'REQUEST_TIMEOUT'
      })
    }
    throw new DevnxControlError('Não foi possível contatar o DevNX Control.', {
      code: 'NETWORK_ERROR',
      cause: error
    })
  } finally {
    clearTimeout(timer)
  }
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof DevnxControlError) {
    return error.message
  }
  return redactText(error instanceof Error ? error.message : error) || 'Erro desconhecido.'
}
