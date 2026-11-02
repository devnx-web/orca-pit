import { hostname } from 'node:os'
import { getAppEnvironment } from '../../shared/app-environment'
import { admitConnectorAgent, CONNECTOR_AGENTS } from '../external-conversations/connector-agents'
import { runtimeConversationHost } from '../external-conversations/external-conversation-seam'
import { getOrcaCloudAuthConfig } from '../orca-profiles/profile-cloud-auth-config'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { ConnectorCloud } from './connector-cloud'
import { resolveConnectorOrigin } from './connector-origin'
import { connectorProjects, type ConnectorPlacesStore } from './connector-places'
import { connectorAccount, desktopConnectorTokenMint } from './connector-token-mint'
import { orcaPitConnectorOrigin } from '../devnx-control/orca-pit-orca-cloud'

export type ConnectorCloudStore = ConnectorPlacesStore &
  Pick<RuntimeStore, 'getSettings' | 'onSettingsChanged'>

/** Desktop only: the connector acts as the desktop's Orca account; `orca serve` has no sign-in yet. */
export function createDesktopConnectorCloud(
  runtime: OrcaRuntimeService,
  store: ConnectorCloudStore,
  userDataPath: string,
  isFenced: () => boolean
): ConnectorCloud | null {
  const auth = getOrcaCloudAuthConfig()
  const environment = getAppEnvironment()
  // Orca-Pit: never connector.onorca.dev; only our own server once set. See orca-pit-orca-cloud.
  const origin = orcaPitConnectorOrigin(
    resolveConnectorOrigin(process.env, environment.isPackaged())
  )
  if (!auth.configured || !origin) {
    return null
  }
  return new ConnectorCloud({
    userDataPath,
    origin,
    isFenced,
    account: () => connectorAccount(userDataPath),
    mintFor: (account) => desktopConnectorTokenMint(auth.config, userDataPath, account),
    machine: {
      runtime: 'desktop',
      orcaVersion: environment.getVersion(),
      hostName: hostname(),
      seam: () => runtime.getExternalConversationSeam(),
      conversationHost: () => runtimeConversationHost(runtime),
      agents: () =>
        CONNECTOR_AGENTS.filter((agent) => admitConnectorAgent(store.getSettings(), agent)),
      projects: () => connectorProjects(store),
      onConnectorsToggled: (listener) => {
        store.onSettingsChanged?.((updates) => {
          if ('experimentalConnectors' in updates) {
            listener()
          }
        })
      }
    }
  })
}
