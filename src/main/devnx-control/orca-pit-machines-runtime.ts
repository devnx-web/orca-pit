// Orca-Pit: wires the company machine directory into the desktop: this machine's registration,
// heartbeat and managed tunnel, the company list for Settings, and the local-network fallback for
// saved servers. Headless orcad never calls this.
import { app } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { OrcaPitMachineSelfState } from '../../shared/orca-pit-machines'
import {
  readPersistedEnvironmentStore,
  writeEnvironmentStore
} from '../../shared/runtime-environment-store-file'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { getRuntimeEnvironmentRegistryRoot } from '../ipc/runtime-environments/runtime-environment-registry-root'
import { invalidateRuntimeEnvironmentTransport } from '../ipc/runtime-environments/runtime-environments'
import { getOrcaPitAppSession, getOrcaPitCentral, orcaPitPublicAddressFile } from './orca-pit-app'
import { createOrcaPitCloudflared } from './orca-pit-cloudflared'
import { setOrcaPitManagedOrigin } from './orca-pit-managed-origin'
import { OrcaPitFailoverTracker } from './orca-pit-endpoint-failover'
import { OrcaPitMachineAgent } from './orca-pit-machine-agent'
import { OrcaPitMachineDirectory, runOrcaPitFailoverRound } from './orca-pit-machine-directory'
import { orcaPitLanEndpoints } from './orca-pit-machine-lan'
import { readOrcaPitPublicAddress, writeOrcaPitPublicAddress } from './orca-pit-public-address'
import { getInstalledRelease } from './orca-pit-updates'
import { ORCA_PIT_MACHINES_HOST } from '../../shared/orca-pit-machines'

// Why 60 s: the same beat as the heartbeat; a failover needs two misses, so about two minutes.
const FAILOVER_INTERVAL_MS = 60_000

let agent: OrcaPitMachineAgent | null = null
let directory: OrcaPitMachineDirectory | null = null

export function getOrcaPitMachineDirectory(): OrcaPitMachineDirectory {
  directory ??= new OrcaPitMachineDirectory({
    controlSession: () => getOrcaPitCentral().currentSession(),
    personToken: () => getOrcaPitAppSession().controlToken()
  })
  return directory
}

export function getOrcaPitMachineState(): OrcaPitMachineSelfState {
  return agent?.current() ?? { kind: 'idle' }
}

/** After a sign-in in the app: register now instead of at the next heartbeat. */
export function kickOrcaPitMachineAgent(): void {
  void agent?.tick()
}

/** Fills "this computer's address" with the directory's one, unless someone typed another host. */
function adoptPublicUrl(url: string): void {
  const file = orcaPitPublicAddressFile()
  const current = readOrcaPitPublicAddress(file)
  let currentHost: string | null = null
  try {
    currentHost = current ? new URL(current).host : null
  } catch {
    currentHost = null
  }
  if (current !== url && (current === null || currentHost === ORCA_PIT_MACHINES_HOST)) {
    try {
      writeOrcaPitPublicAddress(file, url)
    } catch (error) {
      console.warn('[orca-pit] could not save the machine address:', (error as Error).message)
    }
  }
}

export function installOrcaPitMachines(rpc: OrcaRuntimeRpcServer): void {
  if (agent) {
    return
  }
  const userData = app.getPath('userData')
  const central = getOrcaPitCentral()
  const session = getOrcaPitAppSession()
  const binding = (): { host: string; port: number } | null => rpc.getOrcaPitWebSocketBinding()
  let machineAgent: OrcaPitMachineAgent | null = null
  const tunnel = createOrcaPitCloudflared({
    binDir: join(userData, 'bin'),
    tokenFile: join(userData, 'devnx-control', 'orca-pit-tunnel-token'),
    onState: (state) => machineAgent?.setTunnelState(state)
  })
  machineAgent = new OrcaPitMachineAgent({
    controlSession: () => central.currentSession(),
    personToken: () => session.controlToken(),
    binding,
    publicKey: () => rpc.getE2EEPublicKey(),
    version: getInstalledRelease,
    lanEndpoints: () => orcaPitLanEndpoints(binding()),
    hostname: hostname(),
    platform: `${process.platform}-${process.arch}`,
    stateFile: join(userData, 'devnx-control', 'orca-pit-machine.json'),
    secretsFile: join(userData, 'devnx-control', 'orca-pit-machine-secrets.json'),
    managedOrigin: setOrcaPitManagedOrigin,
    tunnel,
    onPublicUrl: adoptPublicUrl,
    onState: () => {}
  })
  agent = machineAgent
  machineAgent.start()

  const machines = getOrcaPitMachineDirectory()
  const tracker = new OrcaPitFailoverTracker()
  const registry = getRuntimeEnvironmentRegistryRoot()
  const failover = setInterval(() => {
    void machines
      .list()
      .then(() =>
        runOrcaPitFailoverRound({
          machines: () => machines.cached(),
          selfMachineId: () => {
            const state = machineAgent?.current()
            return state?.kind === 'registered' ? state.machine.id : null
          },
          readEnvironments: () => readPersistedEnvironmentStore(registry).environments,
          writeEnvironments: (changed) => {
            const store = readPersistedEnvironmentStore(registry)
            const byId = new Map(changed.map((environment) => [environment.id, environment]))
            writeEnvironmentStore(registry, {
              version: 1,
              environments: store.environments.map((entry) => byId.get(entry.id) ?? entry)
            })
          },
          invalidate: invalidateRuntimeEnvironmentTransport,
          tracker
        })
      )
      .catch((error: unknown) => {
        console.warn('[orca-pit] local-network fallback round failed:', (error as Error).message)
      })
  }, FAILOVER_INTERVAL_MS)
  failover.unref()
  app.on('will-quit', () => {
    clearInterval(failover)
    machineAgent?.stop()
  })
}
