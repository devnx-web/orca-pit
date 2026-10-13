// Validates what the panel returns. Refresh tokens never leave the panel: a
// payload that carries one is refused instead of being written to disk.
import { isAbsolute, join, normalize } from 'node:path'
import type {
  DevnxControlAccount,
  DevnxControlProvider,
  DevnxControlUsageWindow
} from '../../shared/devnx-control-types'
import { DevnxControlError, isRecord } from './devnx-control-http'

export const GEMINI_TOKEN_RELATIVE_PATH = join(
  '.gemini',
  'antigravity-cli',
  'antigravity-oauth-token'
)

export type OpenAiClient = {
  authMode: string
  accessToken: string
  idToken: string
  accountId: string
  lastRefresh: string
  expiresAt: string | null
}

export type ClaudeClient = { oauthToken: string; expiresAt: string | null }

export type GeminiClient = {
  relativePath: string
  payload: string
  expiresAt: string | null
}

const PROVIDER_ALIASES: Record<string, DevnxControlProvider> = {
  openai: 'openai',
  codex: 'openai',
  claude: 'claude',
  anthropic: 'claude',
  gemini: 'gemini',
  antigravity: 'gemini',
  agy: 'gemini'
}

export function normalizeProvider(value: unknown): DevnxControlProvider | null {
  return (
    PROVIDER_ALIASES[
      String(value ?? '')
        .trim()
        .toLowerCase()
    ] ?? null
  )
}

function invalid(description: string): DevnxControlError {
  return new DevnxControlError(`Resposta sem ${description}.`, {
    code: 'INVALID_SERVER_RESPONSE'
  })
}

function unsafe(message: string): DevnxControlError {
  return new DevnxControlError(message, { code: 'UNSAFE_SERVER_RESPONSE' })
}

export function requireString(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalid(description)
  }
  return value
}

export function isoFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function usageWindow(value: unknown): DevnxControlUsageWindow {
  const window = isRecord(value) ? value : {}
  const percent = Number(window.percent)
  return {
    percent:
      window.percent === null || window.percent === undefined || !Number.isFinite(percent)
        ? null
        : percent,
    resetsAt: isoFromUnknown(window.resets_at)
  }
}

export function accountIdOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  const id = value.id ?? value.uuid ?? value.public_id ?? value.publicId
  return id === null || id === undefined ? null : String(id)
}

/** Keeps only display fields; anything credential-shaped stays out of the renderer. */
export function toPublicAccount(value: unknown, selected = false): DevnxControlAccount {
  const id = accountIdOf(value)
  const provider = isRecord(value) ? normalizeProvider(value.provider) : null
  if (!isRecord(value) || !id || !provider) {
    throw new DevnxControlError('Resposta de conta inválida do DevNX Control.', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  const usage = isRecord(value.usage) ? value.usage : {}
  return {
    id,
    provider,
    label: typeof value.label === 'string' && value.label.trim() ? value.label : id,
    plan: typeof value.plan === 'string' ? value.plan : null,
    status: typeof value.status === 'string' ? value.status : 'unknown',
    selected,
    fiveHour: usageWindow(usage.five_hour),
    weekly: usageWindow(usage.weekly)
  }
}

export function parseOpenAiClient(value: unknown): OpenAiClient {
  if (!isRecord(value)) {
    throw invalid('material de autenticação OpenAI')
  }
  // Why: the panel brokers refresh; a real refresh token here means the policy changed on the wrong side.
  const placeholder = requireString(value.refresh_token, 'placeholder de refresh OpenAI')
  if (!placeholder.startsWith('cockpit:')) {
    throw unsafe('O servidor tentou fornecer um refresh token OpenAI não brokerado.')
  }
  return {
    authMode: typeof value.auth_mode === 'string' ? value.auth_mode : 'chatgpt',
    accessToken: requireString(value.access_token, 'access token OpenAI'),
    idToken: requireString(value.id_token, 'ID token OpenAI'),
    accountId: requireString(value.account_id, 'account ID OpenAI'),
    lastRefresh: isoFromUnknown(value.last_refresh) ?? new Date().toISOString(),
    expiresAt: isoFromUnknown(value.expires_at)
  }
}

export function parseClaudeClient(value: unknown): ClaudeClient {
  if (!isRecord(value)) {
    throw invalid('material de autenticação Claude')
  }
  return {
    oauthToken: requireString(value.oauth_token ?? value.access_token, 'token OAuth Claude'),
    expiresAt: isoFromUnknown(value.expires_at)
  }
}

function safeRelativePath(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value : GEMINI_TOKEN_RELATIVE_PATH
  const escapes =
    isAbsolute(raw) ||
    /^[a-zA-Z]:/.test(raw) ||
    normalize(raw)
      .split(/[\\/]+/)
      .some((segment) => segment === '..')
  if (escapes) {
    throw unsafe('O servidor enviou um caminho de sessão fora do diretório do Orca.')
  }
  return normalize(raw)
}

export function parseGeminiClient(value: unknown): GeminiClient {
  if (!isRecord(value)) {
    throw invalid('material de autenticação Google')
  }
  const payload = requireString(value.payload, 'sessão do Antigravity')
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw invalid('sessão do Antigravity em formato válido')
  }
  const token = isRecord(parsed) ? parsed.token : null
  if (!isRecord(token)) {
    throw invalid('bloco de token do Antigravity')
  }
  requireString(token.access_token, 'access token Google')
  const brokeredRefresh = [value.refresh_token, token.refresh_token].some(
    (item) => typeof item === 'string' && item.trim()
  )
  if (brokeredRefresh) {
    throw unsafe('O servidor tentou fornecer um refresh token Google não brokerado.')
  }
  return {
    relativePath: safeRelativePath(value.path),
    payload,
    expiresAt: isoFromUnknown(value.expires_at)
  }
}

export function expiresInSeconds(value: string | null): number {
  if (!value) {
    return 3600
  }
  return Math.max(60, Math.floor((new Date(value).getTime() - Date.now()) / 1000))
}
