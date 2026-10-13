// Turns a panel `select`/`refresh` payload into a typed selection with its CLI home.
import type { DevnxControlAccount, DevnxControlProvider } from '../../shared/devnx-control-types'
import { DevnxControlError, isRecord } from './devnx-control-http'
import {
  parseClaudeClient,
  parseGeminiClient,
  parseOpenAiClient,
  toPublicAccount,
  type ClaudeClient,
  type GeminiClient,
  type OpenAiClient
} from './devnx-control-payloads'
import { codexAccountHome, geminiAccountHome, type DevnxControlPaths } from './devnx-control-paths'

export type DevnxSelection =
  | { provider: 'claude'; account: DevnxControlAccount; client: ClaudeClient }
  | {
      provider: 'openai'
      account: DevnxControlAccount
      client: OpenAiClient
      home: string
    }
  | {
      provider: 'gemini'
      account: DevnxControlAccount
      client: GeminiClient
      home: string
    }

export function isSelectionOf<P extends DevnxControlProvider>(
  selection: DevnxSelection,
  provider: P
): selection is Extract<DevnxSelection, { provider: P }> {
  return selection.provider === provider
}

export function toSelection(
  paths: DevnxControlPaths,
  provider: DevnxControlProvider,
  payload: unknown
): DevnxSelection {
  const raw = isRecord(payload) ? payload : {}
  const account = toPublicAccount(raw.account, true)
  if (account.provider !== provider) {
    throw new DevnxControlError('Seleção retornou uma plataforma diferente da solicitada.', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  if (provider === 'openai') {
    const home = codexAccountHome(paths, account.id)
    return { provider, account, client: parseOpenAiClient(raw.client), home }
  }
  if (provider === 'gemini') {
    const home = geminiAccountHome(paths, account.id)
    return { provider, account, client: parseGeminiClient(raw.client), home }
  }
  return {
    provider: 'claude',
    account,
    client: parseClaudeClient(raw.client)
  }
}
