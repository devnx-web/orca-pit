// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaPitAppApi } from '../../../../shared/orca-pit-app-session'
import type { OrcaPitMachine } from '../../../../shared/orca-pit-machines'
import {
  resetOrcaPitAppSessionForTests,
  setOrcaPitAppSession
} from '../orca-pit-login/orca-pit-app-session-store'
import { OrcaPitCompanyMachines } from './OrcaPitCompanyMachines'

function machine(overrides: Partial<OrcaPitMachine>): OrcaPitMachine {
  return {
    id: 9,
    tenant: { id: 1, name: 'DEVNX' },
    owner: { id: 1, name: 'Fabio', avatarUrl: null },
    name: 'Nitro5',
    slug: 'nitro5',
    status: 'approved',
    private: false,
    platform: 'linux-x64',
    version: '1.4.214-pit14',
    online: true,
    lastSeenAt: null,
    publicUrl: 'wss://orca.devnx.com.br/nitro5',
    webUrl: 'https://orca.devnx.com.br/nitro5/',
    lanEndpoints: [],
    isMine: false,
    canManage: false,
    originHost: null,
    ...overrides
  }
}

const loginToServer = vi.fn<OrcaPitAppApi['loginToServer']>()
const listMachines = vi.fn<OrcaPitAppApi['listMachines']>()
const getMachineState = vi.fn<OrcaPitAppApi['getMachineState']>()

beforeEach(() => {
  resetOrcaPitAppSessionForTests()
  Object.assign(window, {
    api: {
      orcaPit: { getSession: vi.fn(), loginToServer, listMachines, getMachineState },
      shell: { openUrl: vi.fn() }
    }
  })
  setOrcaPitAppSession({
    kind: 'signed-in',
    offline: false,
    person: { id: 1, name: 'Fabio', email: 'f@x', avatarUrl: null, orcaRole: 'admin' }
  })
  getMachineState.mockResolvedValue({
    kind: 'registered',
    machine: machine({
      id: 4,
      name: 'ftgkNote',
      slug: 'ftgknote',
      status: 'pending',
      publicUrl: 'wss://orca.devnx.com.br/ftgknote'
    }),
    tunnel: { kind: 'off' }
  })
  listMachines.mockResolvedValue({
    ok: true,
    machines: [
      machine({}),
      machine({
        id: 4,
        name: 'ftgkNote',
        slug: 'ftgknote',
        status: 'pending',
        publicUrl: 'wss://orca.devnx.com.br/ftgknote'
      }),
      machine({
        id: 5,
        name: 'Mirella',
        slug: 'mirella',
        publicUrl: 'wss://orca.devnx.com.br/mirella',
        online: false,
        version: '1.4.214-pit9'
      })
    ]
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OrcaPitCompanyMachines', () => {
  it('lists the company machines with this computer first and its approval state', async () => {
    render(<OrcaPitCompanyMachines servers={[]} busy={false} onPairingUrl={vi.fn()} />)
    await screen.findByText('Nitro5')
    const names = screen.getAllByText(/^(ftgkNote|Nitro5|Mirella)$/).map((node) => node.textContent)
    expect(names).toEqual(['ftgkNote', 'Nitro5', 'Mirella'])
    expect(screen.getByText('Waiting for an administrator to approve it')).toBeTruthy()
    expect(screen.getByText(/needs update/)).toBeTruthy()
  })

  it('connects with the session login at the machine address and hands the link on', async () => {
    loginToServer.mockResolvedValue({
      ok: true,
      pairingUrl: 'orca://pair?code=x',
      suggestedName: 'x'
    })
    const onPairingUrl = vi.fn()
    render(<OrcaPitCompanyMachines servers={[]} busy={false} onPairingUrl={onPairingUrl} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(onPairingUrl).toHaveBeenCalledWith('orca://pair?code=x', 'Nitro5'))
    expect(loginToServer).toHaveBeenCalledWith({ address: 'https://orca.devnx.com.br/nitro5' })
  })

  it('shows why a connection failed on that row', async () => {
    loginToServer.mockResolvedValue({ ok: false, reason: 'no-login' })
    render(<OrcaPitCompanyMachines servers={[]} busy={false} onPairingUrl={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/has no DevNX Control login/)).toBeTruthy()
  })

  it('marks a machine already saved as a server', async () => {
    render(
      <OrcaPitCompanyMachines
        servers={[{ id: 'env-1', endpoints: [{ endpoint: 'wss://orca.devnx.com.br/nitro5' }] }]}
        busy={false}
        onPairingUrl={vi.fn()}
      />
    )
    expect(await screen.findByText('Added')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('stays hidden while nobody is signed in to the app', () => {
    setOrcaPitAppSession({ kind: 'signed-out', rememberedEmail: null })
    const { container } = render(
      <OrcaPitCompanyMachines servers={[]} busy={false} onPairingUrl={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
    expect(listMachines).not.toHaveBeenCalled()
  })
})
