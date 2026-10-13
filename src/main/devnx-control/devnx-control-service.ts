// Process-wide DevNX Control: one client, one loopback broker and a
// single-flight refresh that new terminals wait on before they spawn.
import { mkdirSync } from 'node:fs'
import type {
  DevnxControlAccount,
  DevnxControlConnectInput,
  DevnxControlProvider,
  DevnxControlStatus
} from '../../shared/devnx-control-types'
import { claudeHookService } from '../claude/hook-service'
import { isAgentStatusHooksEnabledForAgent } from '../agent-hooks/managed-agent-hook-controls'
import { mainProcessState as state } from '../startup/main-process-state'
import { DevnxControlBrokerServer } from './devnx-control-broker-server'
import { DevnxControlClient } from './devnx-control-client'
import { removeCodexAuth } from './devnx-control-homes'
import { publicErrorMessage } from './devnx-control-http'
import { getDevnxControlPaths } from './devnx-control-paths'

// Why 60s: the panel balances accounts by usage, so a new terminal should not reuse a stale pick.
const SELECTION_MAX_AGE_MS = 60_000
const BACKGROUND_REFRESH_MS = 10 * 60_000

export class DevnxControlService {
  readonly client: DevnxControlClient
  readonly broker: DevnxControlBrokerServer
  private lastBootstrapAt = 0
  private inflight: Promise<DevnxControlStatus> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(userDataPath: string, isPackaged: boolean) {
    this.client = new DevnxControlClient(getDevnxControlPaths(userDataPath), isPackaged)
    this.broker = new DevnxControlBrokerServer(this.client)
  }

  async start(): Promise<void> {
    await this.broker.start()
    if (this.client.isConnected()) {
      void this.refresh().catch(() => {})
    }
    this.timer = setInterval(() => {
      if (this.client.isConnected()) {
        void this.refresh().catch(() => {})
      }
    }, BACKGROUND_REFRESH_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = null
    this.broker.stop()
  }

  status(): DevnxControlStatus {
    return this.client.status()
  }

  refresh({ syncUsage = false } = {}): Promise<DevnxControlStatus> {
    this.inflight ??= this.client
      .bootstrap({ syncUsage })
      .then((status) => {
        this.lastBootstrapAt = Date.now()
        this.installClaudeHooks()
        return status
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  /** Called before every local terminal spawn; a panel outage keeps the last good pick. */
  async ensureFresh(): Promise<void> {
    if (!this.client.isConnected() || Date.now() - this.lastBootstrapAt < SELECTION_MAX_AGE_MS) {
      return
    }
    try {
      await this.refresh()
    } catch (error) {
      console.warn('[devnx-control] refresh before spawn failed:', publicErrorMessage(error))
    }
  }

  async connect(input: DevnxControlConnectInput): Promise<DevnxControlStatus> {
    const status = await this.client.connect(input)
    this.lastBootstrapAt = Date.now()
    this.installClaudeHooks()
    return status
  }

  async logout(): Promise<DevnxControlStatus> {
    this.lastBootstrapAt = 0
    return this.client.logout()
  }

  listAccounts(): Promise<DevnxControlAccount[]> {
    return this.client.listAccounts()
  }

  async selectAccount(
    provider: DevnxControlProvider,
    accountId: string
  ): Promise<DevnxControlStatus> {
    await this.client.select(provider, accountId)
    this.installClaudeHooks()
    return this.status()
  }

  /** CODEX_HOME for a new local pane: the selected account, or an empty home that fails closed. */
  codexHome(): string {
    const selection = this.client.getSelection('openai')
    if (selection) {
      return selection.home
    }
    const home = this.client.paths.codexUnavailableHome
    mkdirSync(home, { recursive: true, mode: 0o700 })
    removeCodexAuth(home)
    return home
  }

  // Why: Orca's agent status comes from hooks in the active Claude config dir, which is ours here.
  private installClaudeHooks(): void {
    if (!isAgentStatusHooksEnabledForAgent(state.store?.getSettings(), 'claude')) {
      return
    }
    try {
      claudeHookService.install({ configDir: this.client.paths.claudeHome })
    } catch (error) {
      console.warn('[devnx-control] Claude hook install failed:', error)
    }
  }
}

let service: DevnxControlService | null = null

export function getDevnxControlService(): DevnxControlService | null {
  return service
}

export async function startDevnxControlService(
  userDataPath: string,
  isPackaged: boolean
): Promise<void> {
  if (service) {
    return
  }
  service = new DevnxControlService(userDataPath, isPackaged)
  try {
    await service.start()
  } catch (error) {
    console.warn('[devnx-control] broker failed to start:', error)
  }
}

export function stopDevnxControlService(): void {
  service?.stop()
}
