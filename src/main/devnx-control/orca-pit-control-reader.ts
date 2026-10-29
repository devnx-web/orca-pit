// Orca-Pit: whose Control login answers a read. A paired device whose person signed in through
// the DevNX Control login reads with that person's JWT, so "Mine" is that person and their own
// company permissions apply. Local callers (this machine's window and CLI) and devices paired
// without the login read with the central session. A person's rejected JWT never falls back to
// the central session: the read fails and the client asks them to sign in again.
import type { DeviceEntry } from '../runtime/device-entry'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import { DevnxControlError, requestDevnxControl } from './devnx-control-http'
import type { OrcaPitCentralSession } from './orca-pit-control-me'
import type { DevnxControlReader } from './orca-pit-control-tasks'
import type { OrcaPitUser } from './orca-pit-identity-types'

export type OrcaPitControlViewer =
  | { kind: 'central' }
  | { kind: 'user'; token: string; user: OrcaPitUser | null }
  /** A person is known for the device but no JWT is: the read must not run as anyone else. */
  | { kind: 'relogin' }

export type OrcaPitDeviceLookup = (deviceId: string) => DeviceEntry | null

export type OrcaPitControlRequest = (
  baseUrl: string,
  apiPath: string,
  token: string
) => Promise<unknown>

export const RELOGIN_CODE = 'ORCA_PIT_RELOGIN'

// Why a bound: parent links come from a file an admin can edit; a cycle must not hang a request.
const MAX_PARENT_HOPS = 8

let deviceLookup: OrcaPitDeviceLookup | null = null

/** Installed with the multi-user wiring; without it no device has a person. */
export function setOrcaPitControlDeviceLookup(next: OrcaPitDeviceLookup | null): void {
  deviceLookup = next
}

export function orcaPitControlDeviceLookup(): OrcaPitDeviceLookup | null {
  return deviceLookup
}

export function reloginError(): DevnxControlError {
  return new DevnxControlError('Sua sessão do DevNX Control acabou. Entre de novo.', {
    code: RELOGIN_CODE,
    status: 401
  })
}

/** The paired device behind a request, or null for a local caller. */
export function callerDeviceId(context: {
  caller?: RpcCallerIdentity
  pairedDeviceId?: string
}): string | null {
  if (context.caller?.kind === 'paired-device') {
    return context.caller.deviceId
  }
  return context.pairedDeviceId?.trim() || null
}

/**
 * The first row in the device's chain (itself, then the row it was relayed or forked from) that
 * carries a person or a JWT. Both are stamped together by the login and copied together by a fork.
 */
export function resolveDeviceCredential(
  deviceId: string,
  getDevice: OrcaPitDeviceLookup
): { user: OrcaPitUser | null; token: string | null } | null {
  let current = getDevice(deviceId)
  for (let hop = 0; current && hop <= MAX_PARENT_HOPS; hop += 1) {
    if (current.orcaPitUser || current.orcaPitControlToken) {
      return {
        user: current.orcaPitUser ?? null,
        token: current.orcaPitControlToken || null
      }
    }
    const parentId = current.parentDeviceId ?? current.forkedFrom
    current = parentId ? getDevice(parentId) : null
  }
  return null
}

export function viewerForDevice(
  deviceId: string | null,
  getDevice: OrcaPitDeviceLookup | null = deviceLookup
): OrcaPitControlViewer {
  if (!deviceId || !getDevice) {
    return { kind: 'central' }
  }
  const credential = resolveDeviceCredential(deviceId, getDevice)
  if (!credential) {
    // Paired before (or without) the Control login: the machine's own session, as upstream.
    return { kind: 'central' }
  }
  return credential.token
    ? { kind: 'user', token: credential.token, user: credential.user }
    : { kind: 'relogin' }
}

const defaultRequest: OrcaPitControlRequest = (baseUrl, apiPath, token) =>
  requestDevnxControl(baseUrl, apiPath, { token })

/**
 * A reader for the viewer, against the central session's panel. Null when this machine has no
 * Control session at all: the person's JWT is only good on the panel the central talks to.
 */
export function readerForViewer(
  viewer: OrcaPitControlViewer,
  session: OrcaPitCentralSession | null,
  request: OrcaPitControlRequest = defaultRequest
): DevnxControlReader | null {
  if (!session) {
    return null
  }
  switch (viewer.kind) {
    case 'central':
      return { getJson: (apiPath) => request(session.baseUrl, apiPath, session.token) }
    case 'relogin':
      return {
        getJson: () => Promise.reject(reloginError())
      }
    case 'user':
      return {
        getJson: async (apiPath) => {
          try {
            return await request(session.baseUrl, apiPath, viewer.token)
          } catch (error) {
            // 403 is the Control refusing the role (admin and programmer only), not the login.
            if (error instanceof DevnxControlError && error.status === 401) {
              throw reloginError()
            }
            throw error
          }
        }
      }
  }
}
