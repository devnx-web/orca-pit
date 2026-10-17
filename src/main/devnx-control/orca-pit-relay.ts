// Orca-Pit's own relay. Instead of signing in to an Orca account, each computer holds a fixed
// device token in ORCA_PIT_RELAY_TOKEN_FILE; the relay's token issuer (cloud/apps/relay/devnx)
// trades it for the relay JWT. Without the file, Orca's own relay and sign-in stay as they were.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RelayAuthContext } from '../runtime/relay/relay-auth-identity'

export const ORCA_PIT_RELAY_URL = 'https://orca-relay.ndlyrz.easypanel.host'
export const ORCA_PIT_RELAY_TOKEN_URL =
  'https://orca-relay-auth.ndlyrz.easypanel.host/v1/desktop/auth/relay-token'
export const ORCA_PIT_RELAY_TOKEN_FILE = join(homedir(), '.config', 'orca-pit', 'relay-token')

/** The device token (`ftgk`, `nitro5`, …), or null when this computer has none. */
export function readOrcaPitRelayToken(): string | null {
  try {
    return readFileSync(ORCA_PIT_RELAY_TOKEN_FILE, 'utf8').trim() || null
  } catch {
    return null
  }
}

export function readOrcaPitRelayAuthContext(): RelayAuthContext | null {
  const token = readOrcaPitRelayToken()
  if (!token) {
    return null
  }
  return {
    // Why the token as identity: it names the computer, and the relay keys demand by it.
    identity: { userId: `devnx:${token}`, profileId: token, organizationId: '' },
    accessToken: token,
    relayEntitled: true
  }
}

/** Points the relay endpoints at ours when this computer has a device token. */
export function withOrcaPitRelay<
  T extends { relayTokenEndpoint: string; relayDirectorUrl: string }
>(config: T): T {
  if (!readOrcaPitRelayToken()) {
    return config
  }
  return {
    ...config,
    relayTokenEndpoint: ORCA_PIT_RELAY_TOKEN_URL,
    relayDirectorUrl: ORCA_PIT_RELAY_URL
  }
}
