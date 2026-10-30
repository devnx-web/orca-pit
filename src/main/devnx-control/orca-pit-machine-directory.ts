// Orca-Pit: the company's machines as the Control lists them, cached for Settings and for the
// local-network fallback, and that fallback's round over the saved servers.
import type { OrcaPitMachine, OrcaPitMachineListResult } from '../../shared/orca-pit-machines'
import type { PersistedRuntimeEnvironment } from '../../shared/runtime-environments'
import { DevnxControlError } from './devnx-control-http'
import type { OrcaPitCentralSession } from './orca-pit-control-me'
import {
  type OrcaPitFailoverTracker,
  orcaPitPrimaryEndpoint,
  probeOrcaPitEndpoint,
  withOrcaPitLanEndpoints
} from './orca-pit-endpoint-failover'
import { ORCA_PIT_MACHINE_CALLS, type OrcaPitMachineCalls } from './orca-pit-machines-api'

// Why 30 s: Settings re-asks on open; online flags only move each heartbeat (60 s) anyway.
const LIST_MAX_AGE_MS = 30_000

export type OrcaPitMachineDirectoryDeps = {
  controlSession: () => OrcaPitCentralSession | null
  personToken: () => string | null
  calls?: OrcaPitMachineCalls
  now?: () => number
}

export class OrcaPitMachineDirectory {
  private cache: { at: number; machines: OrcaPitMachine[] } | null = null
  private readonly calls: OrcaPitMachineCalls
  private readonly now: () => number

  constructor(private readonly deps: OrcaPitMachineDirectoryDeps) {
    this.calls = deps.calls ?? ORCA_PIT_MACHINE_CALLS
    this.now = deps.now ?? Date.now
  }

  cached(): OrcaPitMachine[] {
    return this.cache?.machines ?? []
  }

  async list(force = false): Promise<OrcaPitMachineListResult> {
    const session = this.deps.controlSession()
    const person = this.deps.personToken()
    if (!session) {
      return { ok: false, reason: 'signed-out' }
    }
    if (!force && this.cache && this.now() - this.cache.at < LIST_MAX_AGE_MS) {
      return { ok: true, machines: this.cache.machines }
    }
    // The person's own view (private machines hide from others); the machine's token as fallback.
    const tokens = [person, session.token].filter((token): token is string => !!token)
    let lastError: unknown = null
    for (const token of tokens) {
      try {
        const machines = await this.calls.list(session.baseUrl, token)
        this.cache = { at: this.now(), machines }
        return { ok: true, machines }
      } catch (error) {
        lastError = error
        if (!(error instanceof DevnxControlError && error.status === 401)) {
          break
        }
      }
    }
    return { ok: false, reason: 'unavailable', message: (lastError as Error | null)?.message }
  }
}

export type OrcaPitFailoverRoundDeps = {
  machines: () => OrcaPitMachine[]
  /** This computer's own entry, which is never a saved server here. */
  selfMachineId: () => number | null
  readEnvironments: () => PersistedRuntimeEnvironment[]
  /** Saves the changed environments in one write. */
  writeEnvironments: (changed: PersistedRuntimeEnvironment[]) => void
  /** Drops the old transport after the preferred endpoint moved. */
  invalidate: (environmentId: string) => Promise<void>
  tracker: OrcaPitFailoverTracker
  probe?: (endpoint: string) => Promise<boolean>
}

/** One pass: keep each machine server's LAN endpoints current and fail over when needed. */
export async function runOrcaPitFailoverRound(deps: OrcaPitFailoverRoundDeps): Promise<void> {
  const machines = deps.machines()
  if (machines.length === 0) {
    return
  }
  const probe = deps.probe ?? probeOrcaPitEndpoint
  const changed: PersistedRuntimeEnvironment[] = []
  const moved: string[] = []
  for (const saved of deps.readEnvironments()) {
    if (saved.connectionDependency) {
      continue
    }
    const machine = machines.find((entry) => orcaPitPrimaryEndpoint(saved, entry) !== null)
    if (!machine || machine.id === deps.selfMachineId()) {
      continue
    }
    const synced = withOrcaPitLanEndpoints(saved, machine)
    const environment = synced ?? saved
    const primary = orcaPitPrimaryEndpoint(environment, machine)
    if (!primary) {
      continue
    }
    const lan = environment.endpoints.filter((endpoint) => endpoint.id !== primary.id)
    let next = environment
    if (lan.length > 0) {
      const primaryUp = await probe(primary.endpoint)
      let firstLanUp: string | null = null
      if (!primaryUp) {
        for (const endpoint of lan) {
          if (await probe(endpoint.endpoint)) {
            firstLanUp = endpoint.id
            break
          }
        }
      }
      const decision = deps.tracker.decide(environment, primary.id, primaryUp, firstLanUp)
      if (decision) {
        next = { ...environment, preferredEndpointId: decision.switchTo }
        moved.push(environment.id)
      }
    }
    if (synced || next !== environment) {
      changed.push(next)
    }
  }
  if (changed.length > 0) {
    deps.writeEnvironments(changed)
  }
  for (const environmentId of moved) {
    await deps.invalidate(environmentId)
  }
}
