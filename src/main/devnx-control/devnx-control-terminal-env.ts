// Points a local terminal at the DevNX Control session. Runs last in
// buildPtyHostEnv so Orca's own account routing cannot override it.
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import { CLAUDE_PROXY_PATH, CODEX_REFRESH_PATH } from './devnx-control-broker-server'
import { applyGeminiShim, prepareClaudeHome } from './devnx-control-homes'
import { geminiShimDir } from './devnx-control-paths'
import { getDevnxControlService } from './devnx-control-service'

// Why: Orca's shell `claude` function swaps CLAUDE_CONFIG_DIR when these say it injected one.
const ORCA_CLAUDE_ROUTING_KEYS = [
  'ORCA_CLAUDE_INJECTED_CONFIG_DIR',
  'ORCA_CLAUDE_USER_CONFIG_DIR',
  'ORCA_CLAUDE_PROFILE_POINTER'
]

function withLoopbackNoProxy(value: string | undefined): string {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const host of ['127.0.0.1', 'localhost']) {
    if (!entries.includes(host)) {
      entries.push(host)
    }
  }
  return entries.join(',')
}

/**
 * Resolves CODEX_HOME through Orca's own resolver so its shell wrappers and Codex
 * hooks treat our home like a managed one. Returns undefined when DevNX Control
 * is not in charge (disconnected, or a WSL target it does not serve).
 */
export async function resolveDevnxControlCodexHome(
  target?: CodexAccountSelectionTarget
): Promise<string | undefined> {
  const service = getDevnxControlService()
  if (!service?.client.isConnected() || target?.runtime === 'wsl') {
    return undefined
  }
  await service.ensureFresh()
  return service.codexHome()
}

export function applyDevnxControlTerminalEnv(
  baseEnv: Record<string, string>,
  opts: { isWsl?: boolean }
): void {
  const service = getDevnxControlService()
  const brokerUrl = service?.broker.baseUrl()
  if (!service?.client.isConnected() || opts.isWsl || !brokerUrl) {
    return
  }
  const { client } = service
  const { paths } = client

  // Claude: the proxy swaps the capability for the selected account's token per request,
  // so a rotated or replaced account reaches running terminals without a restart.
  prepareClaudeHome(paths.claudeHome)
  for (const key of ORCA_CLAUDE_ROUTING_KEYS) {
    delete baseEnv[key]
  }
  delete baseEnv.ANTHROPIC_API_KEY
  delete baseEnv.ANTHROPIC_AUTH_TOKEN
  baseEnv.CLAUDE_CONFIG_DIR = paths.claudeHome
  baseEnv.CLAUDE_CODE_OAUTH_TOKEN = client.runtime.claudeCapability
  baseEnv.ANTHROPIC_BASE_URL = `${brokerUrl}${CLAUDE_PROXY_PATH}`

  // Codex: CODEX_HOME already came from resolveDevnxControlCodexHome; refresh goes through us.
  delete baseEnv.OPENAI_API_KEY
  baseEnv.CODEX_REFRESH_TOKEN_URL_OVERRIDE = `${brokerUrl}${CODEX_REFRESH_PATH}`

  // Antigravity: the shim swaps HOME for the CLI process only.
  const gemini = client.getSelection('gemini')
  baseEnv.PATH = applyGeminiShim(
    baseEnv.PATH ?? process.env.PATH ?? '',
    paths.geminiBinRoot,
    geminiShimDir(paths, gemini?.account.id ?? null),
    gemini?.home ?? paths.geminiUnavailableHome
  )

  // Why: a configured Orca network proxy rewrites NO_PROXY and would route loopback through it.
  baseEnv.NO_PROXY = withLoopbackNoProxy(baseEnv.NO_PROXY)
  baseEnv.no_proxy = withLoopbackNoProxy(baseEnv.no_proxy)
}
