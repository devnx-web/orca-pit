// What DevNX Control persists: the paired device token, and the loopback
// capabilities that terminals hold. Capabilities must survive an app restart
// because Orca's PTY daemon keeps panes alive across it.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeSecureJsonFile } from '../../shared/secure-file'
import { isRecord } from './devnx-control-http'
import type { DevnxControlPaths } from './devnx-control-paths'

/** `cockpit`: the pairing this machine already has in the Cockpit, borrowed read-only. */
export type DevnxConnectionSource = 'orca' | 'cockpit'

export type DevnxConnection = {
  baseUrl: string
  deviceToken: string
  source: DevnxConnectionSource
}

// Why the Cockpit's file: a machine paired there should not need a second login here.
const COCKPIT_TEAM_AUTH_PATH = join(homedir(), '.cockpit', 'team-auth.json')

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

function parseConnection(
  stored: Record<string, unknown> | null,
  source: DevnxConnectionSource
): DevnxConnection | null {
  if (
    !stored ||
    typeof stored.baseUrl !== 'string' ||
    typeof stored.deviceToken !== 'string' ||
    !stored.deviceToken.trim()
  ) {
    return null
  }
  return { baseUrl: stored.baseUrl, deviceToken: stored.deviceToken.trim(), source }
}

export function loadCockpitConnection(): DevnxConnection | null {
  return parseConnection(readJson(COCKPIT_TEAM_AUTH_PATH), 'cockpit')
}

/** Own pairing first; otherwise the Cockpit's, unless the user signed out of it here. */
export function loadConnection(paths: DevnxControlPaths): DevnxConnection | null {
  const stored = readJson(paths.connectionFile)
  const own = parseConnection(stored, 'orca')
  if (own) {
    return own
  }
  return stored?.cockpitDeclined === true ? null : loadCockpitConnection()
}

export function saveConnection(paths: DevnxControlPaths, connection: DevnxConnection): void {
  writeSecureJsonFile(paths.connectionFile, {
    baseUrl: connection.baseUrl,
    deviceToken: connection.deviceToken
  })
}

// Why a marker instead of deleting: without it the next start would borrow the Cockpit pairing again.
export function clearConnection(paths: DevnxControlPaths): void {
  writeSecureJsonFile(paths.connectionFile, { cockpitDeclined: true })
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
