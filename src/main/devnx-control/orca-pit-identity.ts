// Orca-Pit: maps a paired device to the DevNX Control user who signed in on it.
// The user and that user's Control JWT live on the device row in orca-devices.json; no client
// ever receives a row, only the projections below.
import type { DeviceEntry } from '../runtime/device-entry'
import type { OrcaPitUser } from './orca-pit-identity-types'

/** What a browser login stamps on the row it mints. */
export type OrcaPitDeviceIdentity = { user: OrcaPitUser; controlToken: string }

type OrcaPitIdentitySource = {
  getDevice: (deviceId: string) => DeviceEntry | null
  /** The owner of this machine's own Control session, once /api/orca/me answered for it. */
  centralUser: () => OrcaPitUser | null
}

// Why a bound: parent links come from a file an admin can edit; a cycle must not hang a request.
const MAX_PARENT_HOPS = 8

let source: OrcaPitIdentitySource | null = null

export function setOrcaPitIdentitySource(next: OrcaPitIdentitySource | null): void {
  source = next
}

/**
 * The person behind a request's paired device (RpcContext.pairedDeviceId). A local caller (no
 * device: this machine's desktop or CLI) is the owner of the central Control session. Null for a
 * device paired without the Control login, and before that session is known.
 */
export function orcaPitUserForDevice(deviceId: string | null | undefined): OrcaPitUser | null {
  if (!source) {
    return null
  }
  if (!deviceId) {
    return source.centralUser()
  }
  return resolveOrcaPitUser(deviceId, source.getDevice)
}

/** A row's own user, else the user of the row it was derived from (relayed phone or device key). */
export function resolveOrcaPitUser(
  deviceId: string,
  getDevice: (deviceId: string) => DeviceEntry | null
): OrcaPitUser | null {
  let current = getDevice(deviceId)
  for (let hop = 0; current && hop <= MAX_PARENT_HOPS; hop += 1) {
    if (current.orcaPitUser) {
      return current.orcaPitUser
    }
    const parentId = current.parentDeviceId ?? current.forkedFrom
    current = parentId ? getDevice(parentId) : null
  }
  return null
}

/**
 * The role that narrows a paired client's scope; null keeps upstream behaviour. A relayed phone
 * has no user of its own and takes its parent's, read live so a role change reaches it too.
 */
export function orcaPitRoleOf(device: DeviceEntry): OrcaPitUser['orcaRole'] | null {
  if (device.orcaPitUser) {
    return device.orcaPitUser.orcaRole
  }
  const parentId = device.parentDeviceId ?? device.forkedFrom
  return parentId && source
    ? (resolveOrcaPitUser(parentId, source.getDevice)?.orcaRole ?? null)
    : null
}

/** Fields a derived row (device-key fork) copies, so it keeps its person if the source is revoked. */
export function inheritedOrcaPitIdentity(
  device: DeviceEntry
): Pick<DeviceEntry, 'orcaPitUser' | 'orcaPitControlToken'> {
  return {
    ...(device.orcaPitUser ? { orcaPitUser: { ...device.orcaPitUser } } : {}),
    ...(device.orcaPitControlToken ? { orcaPitControlToken: device.orcaPitControlToken } : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null
}

/** Strict parse of a stored or freshly fetched user; anything but an exact 'admin' is a member. */
export function parseOrcaPitUser(value: unknown): OrcaPitUser | null {
  if (!isRecord(value)) {
    return null
  }
  const id = positiveInteger(value.id)
  const tenantId = positiveInteger(value.tenantId)
  if (id === null || tenantId === null) {
    return null
  }
  // Rows stored before "Todas as empresas" have only tenantId.
  const listed = Array.isArray(value.tenantIds) ? value.tenantIds.map(positiveInteger) : []
  const others = listed.filter((other): other is number => other !== null && other !== tenantId)
  return {
    id,
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : '',
    email: typeof value.email === 'string' ? value.email.slice(0, 254) : '',
    tenantId,
    tenantIds: [tenantId, ...new Set(others)],
    orcaRole: value.orcaRole === 'admin' ? 'admin' : 'member'
  }
}

// Why: a damaged user on a row that had one must not turn into "no user", which keeps every
// upstream permission. It stays a member until revalidation fixes or revokes it.
const UNREADABLE_USER: OrcaPitUser = {
  id: 0,
  name: '',
  email: '',
  tenantId: 0,
  tenantIds: [],
  orcaRole: 'member'
}

/** Load-time sanitizer for orca-devices.json rows (device-registry-row-validation). */
export function loadedOrcaPitIdentityFields(
  row: Record<string, unknown>
): Pick<DeviceEntry, 'orcaPitUser' | 'orcaPitControlToken'> {
  const controlToken =
    typeof row.orcaPitControlToken === 'string' && row.orcaPitControlToken.length > 0
      ? row.orcaPitControlToken
      : undefined
  if (row.orcaPitUser === undefined && controlToken === undefined) {
    return { orcaPitUser: undefined, orcaPitControlToken: undefined }
  }
  return {
    orcaPitUser: parseOrcaPitUser(row.orcaPitUser) ?? UNREADABLE_USER,
    orcaPitControlToken: controlToken
  }
}

/** What Settings shows about the person behind an access grant. Never the JWT. */
export function publicOrcaPitUser(
  device: DeviceEntry
): { name: string; email: string; orcaRole: OrcaPitUser['orcaRole'] } | undefined {
  const user = device.orcaPitUser
  return user ? { name: user.name, email: user.email, orcaRole: user.orcaRole } : undefined
}
