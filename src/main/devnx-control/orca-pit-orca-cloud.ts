// Orca-Pit: what this fork keeps off from Orca's own cloud (onorca.dev). People sign in to the
// DevNX Control, never to an Orca account, so the services that act as that account (sign-in,
// artifact links, shared skills, connector) and the reports sent to Stably (feedback, crash,
// telemetry) stay off. Relay and push are keyed by machine, not by account, and stay as they are.
// Off only in the installed app, like orca-pit-updater-gate: dev runs and Orca's tests keep its code.
import { app } from 'electron'
import type { OrcaProfileAuthStatus } from '../../shared/orca-profiles'
import { readOrcaPitRelayToken } from './orca-pit-relay'

export const ORCA_PIT_NO_ORCA_ACCOUNT =
  'O Orca-Pit não usa a conta do Orca. Quem identifica a pessoa é o login do DevNX Control.'
export const ORCA_PIT_NO_STABLY_REPORTS =
  'O Orca-Pit não envia feedback nem relatórios de falha para os servidores do Orca original.'

/**
 * The connector's server (the Slack/Discord/Linear conversations that become agents). Null keeps
 * it off; the DevNX Control is meant to serve the same contract later (WhatsApp).
 */
export const ORCA_PIT_CONNECTOR_ORIGIN: string | null = null

export function isOrcaCloudOff(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    // Why: tests that mock electron without `app` throw on access; they run Orca's code.
    return false
  }
}

/** Ours when set, none in the installed app, Orca's own in dev runs and tests. */
export function orcaPitConnectorOrigin(upstream: string): string | null {
  if (ORCA_PIT_CONNECTOR_ORIGIN) {
    return ORCA_PIT_CONNECTOR_ORIGIN
  }
  return isOrcaCloudOff() ? null : upstream
}

/**
 * What the app shows as the "Orca account": never an account. A machine with the relay device
 * token reads as connected, so mobile Relay works; without it Relay reads as unavailable and no
 * sign-in button is offered anywhere (Settings, mobile pairing, artifacts, sign-out card).
 */
export function orcaPitProfileAuthStatus(activeProfileId: string): OrcaProfileAuthStatus {
  if (readOrcaPitRelayToken()) {
    return { activeProfileId, configured: true, state: 'connected', persistence: 'none' }
  }
  return {
    activeProfileId,
    configured: false,
    state: 'unconfigured',
    persistence: 'none',
    setupMessage: ORCA_PIT_NO_ORCA_ACCOUNT
  }
}
