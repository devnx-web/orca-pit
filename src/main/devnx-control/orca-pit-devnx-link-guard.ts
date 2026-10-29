// Orca-Pit: who may change an Orca project's DevNX Control link. The link decides where the
// whole team's activity is counted, so only admins of the Control company (and this machine's
// own window and CLI) change it; a member sees it read-only.
import type { RpcContext } from '../runtime/rpc/core'
import { callerDeviceId } from './orca-pit-control-reader'
import { orcaPitUserForDevice } from './orca-pit-identity'

export type OrcaPitCallerContext = Pick<RpcContext, 'caller' | 'pairedDeviceId'>

export function orcaPitMayLinkDevnxProject(context: OrcaPitCallerContext): boolean {
  const deviceId = callerDeviceId(context)
  return !deviceId || orcaPitUserForDevice(deviceId)?.orcaRole !== 'member'
}

/** repo.update guard; every other field of the update keeps upstream permissions. */
export function assertOrcaPitMayChangeRepoLink(
  updates: Record<string, unknown> | null | undefined,
  context: OrcaPitCallerContext
): void {
  if (updates?.devnxControlProject !== undefined && !orcaPitMayLinkDevnxProject(context)) {
    throw new Error(
      'Only an administrator of the company in DevNX Control may change the DevNX Control project link.'
    )
  }
}
