// Talks to the DevNX Control panel: pairs this machine with e-mail and password,
// asks which account each provider uses and keeps that session on disk.
import { hostname } from 'node:os'
import {
  DEVNX_CONTROL_DEFAULT_BASE_URL,
  DEVNX_CONTROL_PROVIDERS,
  type DevnxControlAccount,
  type DevnxControlConnectInput,
  type DevnxControlProvider,
  type DevnxControlStatus
} from '../../shared/devnx-control-types'
import {
  DEVNX_CONTROL_API_PATHS as API,
  DevnxControlError,
  isRecord,
  normalizeDevnxBaseUrl,
  publicErrorMessage,
  requestDevnxControl,
  type DevnxRequestOptions
} from './devnx-control-http'
import {
  accountIdOf,
  parseOpenAiClient,
  requireString,
  toPublicAccount,
  type OpenAiClient
} from './devnx-control-payloads'
import { codexAccountHome, type DevnxControlPaths } from './devnx-control-paths'
import { isSelectionOf, toSelection, type DevnxSelection } from './devnx-control-selection'
import {
  clearConnection,
  loadConnection,
  loadRuntimeState,
  makeOpenAiCapability,
  saveConnection,
  saveRuntimeState,
  type DevnxConnection,
  type DevnxRuntimeState
} from './devnx-control-store'
import {
  prepareClaudeHome,
  prepareCodexHome,
  removeBrokeredSessions,
  writeCodexAuth,
  writeGeminiSession
} from './devnx-control-homes'

export class DevnxControlClient {
  readonly paths: DevnxControlPaths
  readonly runtime: DevnxRuntimeState
  private readonly isPackaged: boolean
  private connection: DevnxConnection | null
  private readonly selections = new Map<DevnxControlProvider, DevnxSelection>()
  private lastSyncAt: string | null = null
  private warnings: string[] = []

  constructor(paths: DevnxControlPaths, isPackaged: boolean) {
    this.paths = paths
    this.isPackaged = isPackaged
    this.connection = loadConnection(paths)
    this.runtime = loadRuntimeState(paths)
    saveRuntimeState(paths, this.runtime)
  }

  isConnected(): boolean {
    return this.connection !== null
  }

  getSelection<P extends DevnxControlProvider>(
    provider: P
  ): Extract<DevnxSelection, { provider: P }> | null {
    const selection = this.selections.get(provider)
    return selection && isSelectionOf(selection, provider) ? selection : null
  }

  status(): DevnxControlStatus {
    const selected: DevnxControlStatus['selected'] = {}
    for (const [provider, selection] of this.selections) {
      selected[provider] = selection.account
    }
    return {
      connected: this.isConnected(),
      baseUrl: this.connection?.baseUrl ?? DEVNX_CONTROL_DEFAULT_BASE_URL,
      selected,
      lastSyncAt: this.lastSyncAt,
      warnings: [...this.warnings]
    }
  }

  private request(apiPath: string, options: DevnxRequestOptions = {}): Promise<unknown> {
    const connection = this.connection
    if (!connection) {
      throw new DevnxControlError('Orca não está conectado ao DevNX Control.', {
        code: 'NOT_CONNECTED'
      })
    }
    return requestDevnxControl(connection.baseUrl, apiPath, {
      ...options,
      token: connection.deviceToken
    })
  }

  async connect(input: DevnxControlConnectInput): Promise<DevnxControlStatus> {
    const baseUrl = normalizeDevnxBaseUrl(
      input.baseUrl || DEVNX_CONTROL_DEFAULT_BASE_URL,
      this.isPackaged
    )
    if (!input.email.trim() || !input.password) {
      throw new DevnxControlError('E-mail e senha são obrigatórios.', {
        code: 'INVALID_LOGIN'
      })
    }
    const login = await requestDevnxControl(baseUrl, API.login, {
      method: 'POST',
      body: { email: input.email.trim(), password: input.password }
    })
    const jwt = requireString(
      isRecord(login) ? (login.access_token ?? login.token) : null,
      'JWT de login'
    )
    const issued = await requestDevnxControl(baseUrl, API.deviceTokens, {
      method: 'POST',
      token: jwt,
      body: { name: `Orca-Pit · ${hostname()}`.slice(0, 120) }
    })
    const deviceToken = requireString(
      isRecord(issued) ? (issued.token ?? issued.plain_text_token ?? issued.access_token) : null,
      'token do dispositivo'
    ).replace(/^Bearer\s+/i, '')

    const previous = this.connection
    this.connection = { baseUrl, deviceToken }
    saveConnection(this.paths, this.connection)
    if (previous) {
      // Best effort: the new token is already stored; the old one only needs revoking.
      await requestDevnxControl(previous.baseUrl, API.revokeDeviceToken, {
        method: 'DELETE',
        token: previous.deviceToken
      }).catch(() => {})
    }
    this.clearSessions()
    await this.bootstrap()
    return this.status()
  }

  async logout(): Promise<DevnxControlStatus> {
    if (this.connection) {
      await this.request(API.revokeDeviceToken, { method: 'DELETE' }).catch(() => {})
    }
    this.connection = null
    clearConnection(this.paths)
    this.clearSessions()
    return this.status()
  }

  async listAccounts(): Promise<DevnxControlAccount[]> {
    const payload = await this.request(API.accounts)
    const accounts = Array.isArray(payload) ? payload : isRecord(payload) ? payload.accounts : null
    if (!Array.isArray(accounts)) {
      throw new DevnxControlError('Resposta de contas inválida do DevNX Control.', {
        code: 'INVALID_SERVER_RESPONSE'
      })
    }
    return accounts.map((raw) => {
      const account = toPublicAccount(raw)
      account.selected = this.selections.get(account.provider)?.account.id === account.id
      return account
    })
  }

  async select(provider: DevnxControlProvider, accountId?: string): Promise<DevnxSelection> {
    const payload = await this.request(API.select, {
      method: 'POST',
      body: { provider, ...(accountId ? { account_id: accountId } : {}) }
    })
    const selection = toSelection(this.paths, provider, payload)
    this.selections.set(provider, selection)
    this.materialize(selection)
    return selection
  }

  /** Asks the panel for the best account of every provider and writes each session. */
  async bootstrap({ syncUsage = false } = {}): Promise<DevnxControlStatus> {
    if (!this.connection) {
      return this.status()
    }
    const warnings: string[] = []
    if (syncUsage) {
      await this.request(API.syncUsage, {
        method: 'POST',
        body: {},
        timeoutMs: 120_000
      }).catch((error: unknown) => warnings.push(publicErrorMessage(error)))
    }
    const results = await Promise.allSettled(
      DEVNX_CONTROL_PROVIDERS.map((provider) => this.select(provider))
    )
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        warnings.push(`${DEVNX_CONTROL_PROVIDERS[index]}: ${publicErrorMessage(result.reason)}`)
      }
    })
    this.warnings = warnings
    this.lastSyncAt = new Date().toISOString()
    return this.status()
  }

  /** Refresh brokered by the panel; rewrites the account's auth.json in place. */
  async refreshOpenAi(accountId: string): Promise<OpenAiClient> {
    const payload = await this.request(API.refresh(accountId), {
      method: 'POST',
      body: {},
      timeoutMs: 45_000
    })
    if (!isRecord(payload) || accountIdOf(payload.account) !== accountId) {
      throw new DevnxControlError('Refresh retornou uma conta diferente da solicitada.', {
        code: 'INVALID_SERVER_RESPONSE'
      })
    }
    const client = parseOpenAiClient(payload.client)
    const home = codexAccountHome(this.paths, accountId)
    writeCodexAuth(this.paths.codexRoot, home, client, this.openAiCapability(accountId))
    const selected = this.getSelection('openai')
    if (selected?.account.id === accountId) {
      this.selections.set('openai', { ...selected, client })
    }
    return client
  }

  /** Recovers from a 401: refresh the selected Claude account, or let the panel pick another. */
  async recoverClaude(failedToken: string): Promise<void> {
    const current = this.getSelection('claude')
    if (current && current.client.oauthToken !== failedToken) {
      return
    }
    if (current) {
      try {
        const payload = await this.request(API.refresh(current.account.id), {
          method: 'POST',
          body: {},
          timeoutMs: 45_000
        })
        this.selections.set('claude', toSelection(this.paths, 'claude', payload))
        return
      } catch {
        // The refresh token may be revoked; fall through to a new selection.
      }
    }
    await this.select('claude')
  }

  openAiCapability(accountId: string): string {
    let capability = this.runtime.openAiCapabilities[accountId]
    if (!capability) {
      capability = makeOpenAiCapability(accountId)
      this.runtime.openAiCapabilities[accountId] = capability
      saveRuntimeState(this.paths, this.runtime)
    }
    return capability
  }

  accountForOpenAiCapability(capability: string): string | null {
    for (const [accountId, known] of Object.entries(this.runtime.openAiCapabilities)) {
      if (known === capability) {
        return accountId
      }
    }
    return null
  }

  rememberPort(port: number): void {
    if (this.runtime.port !== port) {
      this.runtime.port = port
      saveRuntimeState(this.paths, this.runtime)
    }
  }

  private materialize(selection: DevnxSelection): void {
    if (selection.provider === 'openai') {
      prepareCodexHome(selection.home)
      const capability = this.openAiCapability(selection.account.id)
      writeCodexAuth(this.paths.codexRoot, selection.home, selection.client, capability)
    } else if (selection.provider === 'gemini') {
      writeGeminiSession(this.paths.geminiRoot, selection.home, selection.client)
    } else {
      prepareClaudeHome(this.paths.claudeHome)
    }
  }

  private clearSessions(): void {
    removeBrokeredSessions(this.paths)
    this.selections.clear()
    this.warnings = []
    this.lastSyncAt = null
  }
}
