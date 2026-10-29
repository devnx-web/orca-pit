// Orca-Pit: the runtime rows a browser login mints, one per sign-in, carrying the person.
import type { DeviceRegistry, TokenDeviceEntry } from '../runtime/device-registry'
import type { OrcaPitDeviceIdentity } from './orca-pit-identity'
import type { OrcaPitUser } from './orca-pit-identity-types'

const DEVICE_NAME_MAX_CHARS = 120

export function orcaPitBrowserDeviceName(user: OrcaPitUser): string {
  return `${user.name.trim() || user.email} · navegador`.slice(0, DEVICE_NAME_MAX_CHARS)
}

/**
 * A fresh runtime row for this person, never a reused pending offer: that offer may already be
 * in someone else's hands. It is stamped as seen so New Link and rotation leave it alone.
 */
export function mintOrcaPitUserDevice(
  registry: DeviceRegistry,
  identity: OrcaPitDeviceIdentity
): TokenDeviceEntry {
  const minted = registry.addDevice(orcaPitBrowserDeviceName(identity.user), 'runtime', 'network')
  const stamped: TokenDeviceEntry = {
    ...minted,
    lastSeenAt: Date.now(),
    orcaPitUser: { ...identity.user },
    orcaPitControlToken: identity.controlToken
  }
  if (!registry.replaceRow(minted.deviceId, () => stamped)) {
    throw new Error('orca_pit_device_unavailable')
  }
  return stamped
}

/** Revalidation found a new name or role for the same person. */
export function updateOrcaPitUser(
  registry: DeviceRegistry,
  deviceId: string,
  user: OrcaPitUser
): boolean {
  return registry.replaceRow(deviceId, (device) => ({ ...device, orcaPitUser: { ...user } }))
}
