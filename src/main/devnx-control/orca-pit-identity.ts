// Orca-Pit: maps a paired device to the DevNX Control user who signed in on it.
import type { OrcaPitUser } from './orca-pit-identity-types'

/**
 * The person behind a request's paired device (RpcContext.pairedDeviceId); null for a device
 * paired without the Control login, and for local callers.
 */
export function orcaPitUserForDevice(_deviceId: string | null | undefined): OrcaPitUser | null {
  return null
}
