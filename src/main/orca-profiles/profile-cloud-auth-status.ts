import type { OrcaProfileAuthStatus } from '../../shared/orca-profiles'
import type { ActiveOrcaProfileState } from './profile-index-store'
import { getOrcaCloudAuthConfig, isOrcaCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { readCloudSession } from './profile-cloud-session-owner'
import { readOrcaPitRelayToken } from '../devnx-control/orca-pit-relay'

export function getOrcaProfileAuthStatusFromProfile(
  active: ActiveOrcaProfileState,
  userDataPath: string
): OrcaProfileAuthStatus {
  const configState = getOrcaCloudAuthConfig()
  const devAuthEnabled = isOrcaCloudDevAuthEnabled()
  const configured = configState.configured || devAuthEnabled
  const cloud = active.profile.cloud
  if (!cloud) {
    return {
      activeProfileId: active.profile.id,
      configured,
      // Orca-Pit: a device token makes Relay usable without an Orca account; see orca-pit-relay.
      state: configured ? (readOrcaPitRelayToken() ? 'connected' : 'local') : 'unconfigured',
      persistence: 'none',
      setupMessage: configured ? undefined : configState.setupMessage
    }
  }

  const session = readCloudSession(active.profile.id, userDataPath)
  if (!configured) {
    return {
      activeProfileId: active.profile.id,
      configured: false,
      state: 'unconfigured',
      persistence: session.status === 'found' ? session.persistence : 'none',
      cloud,
      credentialError:
        session.status === 'decrypt-failed' || session.status === 'unreadable'
          ? session.error
          : undefined,
      setupMessage: configState.setupMessage
    }
  }
  if (session.status === 'found') {
    return {
      activeProfileId: active.profile.id,
      configured,
      state: 'connected',
      persistence: session.persistence,
      cloud,
      organizations: session.session.organizations,
      capabilities: session.session.capabilities
    }
  }

  return {
    activeProfileId: active.profile.id,
    configured,
    state: 'reconnect-required',
    persistence: 'none',
    cloud,
    credentialError:
      session.status === 'decrypt-failed' || session.status === 'unreadable'
        ? session.error
        : undefined
  }
}
