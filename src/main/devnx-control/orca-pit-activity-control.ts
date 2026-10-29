// Orca-Pit: the diary's side of the Control. The central machine talks with its own session
// (the one Configurações → Contas paired), never with a person's JWT. Who owns that session
// comes from orcaPitUserForDevice(null), kept by the identity module.
import { mainProcessState as state } from '../startup/main-process-state'
import { getDevnxControlService } from './devnx-control-service'
import { loadConnection, type DevnxConnection } from './devnx-control-store'

// Why our own map: devnx-control-http.ts holds the account routes and is edited elsewhere.
export const ORCA_PIT_ACTIVITY_API_PATHS = {
  ingest: '/api/orca/activity/ingest'
} as const

/** The central machine's Control session, or null when it is not paired. */
export function centralConnection(): DevnxConnection | null {
  const service = getDevnxControlService()
  if (!service?.client.isConnected()) {
    return null
  }
  return loadConnection(service.client.paths)
}

/** The name the pairing gave a device ("Fabio · navegador"), if the registry knows it. */
export function pairedDeviceName(deviceId: string): string | null {
  return state.runtimeRpc?.getDeviceRegistry()?.getDevice(deviceId)?.name ?? null
}
