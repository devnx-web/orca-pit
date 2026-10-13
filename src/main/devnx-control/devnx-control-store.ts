// What DevNX Control persists: the paired device token, and the loopback
// capabilities that terminals hold. Capabilities must survive an app restart
// because Orca's PTY daemon keeps panes alive across it.
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { writeSecureJsonFile } from '../../shared/secure-file'
import { isRecord } from './devnx-control-http'
import type { DevnxControlPaths } from './devnx-control-paths'

export type DevnxConnection = { baseUrl: string; deviceToken: string }

export type DevnxRuntimeState = {
  port: number | null
  claudeCapability: string
  /** accountId → capability written as the Codex refresh token of that account's home. */
  openAiCapabilities: Record<string, string>
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Why the "cc-" prefix: the Anthropic SDK only sends Authorization: Bearer for OAuth-shaped
// tokens, and the proxy reads exactly that header.
export function makeClaudeCapability(): string {
  return `cc-orcapit-${randomBytes(24).toString('base64url')}`
}

export function makeOpenAiCapability(accountId: string): string {
  return `cockpit:${accountId}:${randomBytes(16).toString('base64url')}`
}

export function loadConnection(paths: DevnxControlPaths): DevnxConnection | null {
  const stored = readJson(paths.connectionFile)
  if (
    !stored ||
    typeof stored.baseUrl !== 'string' ||
    typeof stored.deviceToken !== 'string' ||
    !stored.deviceToken.trim()
  ) {
    return null
  }
  return { baseUrl: stored.baseUrl, deviceToken: stored.deviceToken.trim() }
}

export function saveConnection(paths: DevnxControlPaths, connection: DevnxConnection): void {
  writeSecureJsonFile(paths.connectionFile, connection)
}

export function clearConnection(paths: DevnxControlPaths): void {
  rmSync(paths.connectionFile, { force: true })
}

export function loadRuntimeState(paths: DevnxControlPaths): DevnxRuntimeState {
  const stored = readJson(paths.runtimeFile)
  const port = Number(stored?.port)
  const capabilities: Record<string, string> = {}
  if (isRecord(stored?.openAiCapabilities)) {
    for (const [accountId, capability] of Object.entries(stored.openAiCapabilities)) {
      if (typeof capability === 'string' && capability.startsWith('cockpit:')) {
        capabilities[accountId] = capability
      }
    }
  }
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
    claudeCapability:
      typeof stored?.claudeCapability === 'string' && stored.claudeCapability.startsWith('cc-')
        ? stored.claudeCapability
        : makeClaudeCapability(),
    openAiCapabilities: capabilities
  }
}

export function saveRuntimeState(paths: DevnxControlPaths, state: DevnxRuntimeState): void {
  writeSecureJsonFile(paths.runtimeFile, state)
}
