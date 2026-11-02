import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }))
const relayToken = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('electron', () => electron)
vi.mock('./orca-pit-relay', () => ({ readOrcaPitRelayToken: () => relayToken.value }))

import {
  isOrcaCloudOff,
  ORCA_PIT_NO_ORCA_ACCOUNT,
  orcaPitConnectorOrigin,
  orcaPitProfileAuthStatus
} from './orca-pit-orca-cloud'

describe('Orca cloud in the installed Orca-Pit', () => {
  beforeEach(() => {
    electron.app.isPackaged = true
    relayToken.value = null
  })

  it('never reaches connector.onorca.dev; dev runs keep the upstream origin', () => {
    expect(isOrcaCloudOff()).toBe(true)
    expect(orcaPitConnectorOrigin('https://connector.onorca.dev')).toBeNull()
    electron.app.isPackaged = false
    expect(isOrcaCloudOff()).toBe(false)
    expect(orcaPitConnectorOrigin('https://connector.onorca.dev')).toBe(
      'https://connector.onorca.dev'
    )
  })

  it('offers no Orca sign-in without the relay device token', () => {
    expect(orcaPitProfileAuthStatus('p1')).toEqual({
      activeProfileId: 'p1',
      configured: false,
      state: 'unconfigured',
      persistence: 'none',
      setupMessage: ORCA_PIT_NO_ORCA_ACCOUNT
    })
  })

  it('keeps mobile Relay usable with the device token, with no account behind it', () => {
    relayToken.value = 'ftgk'
    expect(orcaPitProfileAuthStatus('p1')).toEqual({
      activeProfileId: 'p1',
      configured: true,
      state: 'connected',
      persistence: 'none'
    })
  })
})
