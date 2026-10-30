// Orca-Pit: a saved server that is a machine of the company directory also gets that machine's
// local-network addresses, with the same device token and the same pinned key (the server is the
// same runtime, so identity verification is unchanged). Orca connects only to the preferred
// endpoint; this flips the preference to a local address while the internet route is down and
// back once it answers again, two checks in a row either way so a blip does not drop sessions.
import type { PersistedRuntimeEnvironment } from '../../shared/runtime-environments'
import { isOrcaPitMachineEndpoint, type OrcaPitMachine } from '../../shared/orca-pit-machines'

export const ORCA_PIT_LAN_ENDPOINT_PREFIX = 'orca-pit-lan:'
const LAN_LABEL = 'Rede local'
// Why 2: one failed probe is often a blip; two minutes down is an outage worth switching for.
const CONFIRMATIONS = 2

type Endpoint = PersistedRuntimeEnvironment['endpoints'][number]

export function orcaPitPrimaryEndpoint(
  environment: PersistedRuntimeEnvironment,
  machine: OrcaPitMachine
): Endpoint | null {
  return (
    environment.endpoints.find((endpoint) =>
      isOrcaPitMachineEndpoint(endpoint.endpoint, machine)
    ) ?? null
  )
}

/** The environment with exactly the machine's LAN endpoints next to its public one, or null if unchanged. */
export function withOrcaPitLanEndpoints(
  environment: PersistedRuntimeEnvironment,
  machine: OrcaPitMachine
): PersistedRuntimeEnvironment | null {
  const primary = orcaPitPrimaryEndpoint(environment, machine)
  if (!primary) {
    return null
  }
  const others = environment.endpoints.filter(
    (endpoint) => !endpoint.id.startsWith(ORCA_PIT_LAN_ENDPOINT_PREFIX)
  )
  const lan: Endpoint[] = machine.lanEndpoints.map((address) => ({
    id: `${ORCA_PIT_LAN_ENDPOINT_PREFIX}${address}`,
    kind: 'websocket',
    label: LAN_LABEL,
    endpoint: address,
    deviceToken: primary.deviceToken,
    publicKeyB64: primary.publicKeyB64
  }))
  const endpoints = [...others, ...lan]
  const preferredEndpointId = endpoints.some(
    (entry) => entry.id === environment.preferredEndpointId
  )
    ? environment.preferredEndpointId
    : primary.id
  const same =
    preferredEndpointId === environment.preferredEndpointId &&
    endpoints.length === environment.endpoints.length &&
    endpoints.every(
      (entry, index) =>
        entry.id === environment.endpoints[index]?.id &&
        entry.deviceToken === environment.endpoints[index]?.deviceToken
    )
  return same ? null : { ...environment, endpoints, preferredEndpointId }
}

/** Probe URL for an endpoint: the login route answers on every Orca-Pit server. */
export function orcaPitProbeUrl(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return null
    }
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/orca-pit/login`
    return url.toString()
  } catch {
    return null
  }
}

/** Reachable when the Orca behind it answers; a 5xx is the edge saying the origin is gone. */
export async function probeOrcaPitEndpoint(endpoint: string, timeoutMs = 4_000): Promise<boolean> {
  const url = orcaPitProbeUrl(endpoint)
  if (!url) {
    return false
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual'
    })
    return response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export type OrcaPitFailoverDecision = { switchTo: string } | null

/** Remembers consecutive probe results per environment and decides when to switch. */
export class OrcaPitFailoverTracker {
  private readonly streaks = new Map<string, { onPrimary: boolean; count: number }>()

  /**
   * `primaryUp`: the public route answered. `firstLanUp`: id of the first local endpoint that
   * answered (only probed while the primary is down), or null.
   */
  decide(
    environment: PersistedRuntimeEnvironment,
    primaryId: string,
    primaryUp: boolean,
    firstLanUp: string | null
  ): OrcaPitFailoverDecision {
    const onPrimary = environment.preferredEndpointId === primaryId
    const wantsSwitch = onPrimary ? !primaryUp && firstLanUp !== null : primaryUp
    const previous = this.streaks.get(environment.id)
    if (!wantsSwitch) {
      this.streaks.delete(environment.id)
      return null
    }
    const count = previous && previous.onPrimary === onPrimary ? previous.count + 1 : 1
    if (count < CONFIRMATIONS) {
      this.streaks.set(environment.id, { onPrimary, count })
      return null
    }
    this.streaks.delete(environment.id)
    return { switchTo: onPrimary ? (firstLanUp as string) : primaryId }
  }
}
