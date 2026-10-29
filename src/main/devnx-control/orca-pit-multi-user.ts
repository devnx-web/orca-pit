// Orca-Pit: wires the multi-user pieces to the desktop's runtime server: who a device belongs
// to, the browser login on the web client's server, and the periodic revalidation. Headless
// orcad never calls this, so there the login answers 404 and no device has a person.
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { getDevnxControlService } from './devnx-control-service'
import { OrcaPitCentral } from './orca-pit-control-me'
import { setOrcaPitIdentitySource } from './orca-pit-identity'
import { setOrcaPitControlDeviceLookup } from './orca-pit-control-reader'
import { performOrcaPitLogin } from './orca-pit-login'
import { OrcaPitLoginRateLimit, setOrcaPitLoginHandler } from './orca-pit-login-route'
import { OrcaPitRevalidator } from './orca-pit-revalidation'
import { mintOrcaPitUserDevice, updateOrcaPitUser } from './orca-pit-user-devices'
import { recordOrcaPitLogin } from './orca-pit-activity-hooks'

let revalidator: OrcaPitRevalidator | null = null

export function installOrcaPitMultiUser(rpc: OrcaRuntimeRpcServer): void {
  const central = new OrcaPitCentral(() => getDevnxControlService()?.client.session() ?? null)
  const getDevice = (deviceId: string) => rpc.getDeviceRegistry()?.getDevice(deviceId) ?? null
  setOrcaPitIdentitySource({ getDevice, centralUser: () => central.cachedUser() })
  // Control reads (projects, tasks) go out with the person's own JWT when the device has one.
  setOrcaPitControlDeviceLookup(getDevice)
  setOrcaPitLoginHandler({
    rateLimit: new OrcaPitLoginRateLimit(),
    isActive: () => central.currentSession() !== null && rpc.getDeviceRegistry() !== null,
    login: (input) =>
      performOrcaPitLogin(
        {
          central,
          createOffer: (identity, endpoint) => {
            const offer = rpc.createPairingOffer({
              address: endpoint,
              scope: 'runtime',
              mintDevice: (registry) => {
                const device = mintOrcaPitUserDevice(registry, identity)
                // Why here: the device id exists only once minted, and the diary signs by device.
                recordOrcaPitLogin(device.deviceId)
                return device
              }
            })
            return offer.available ? offer.pairingUrl : null
          }
        },
        input
      )
  })
  revalidator?.stop()
  revalidator = new OrcaPitRevalidator({
    central,
    listDevices: () => rpc.getDeviceRegistry()?.listDevices() ?? [],
    revoke: (deviceId) => rpc.revokeRuntimeAccess(deviceId),
    updateUser: (deviceId, user) => {
      const registry = rpc.getDeviceRegistry()
      return registry ? updateOrcaPitUser(registry, deviceId, user) : false
    }
  })
  revalidator.start()
  // Local callers are the central's owner; learn who that is without waiting for a login.
  void central.me().catch(() => null)
}
