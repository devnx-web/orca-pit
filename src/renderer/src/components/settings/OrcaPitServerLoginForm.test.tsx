// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaPitAppApi } from '../../../../shared/orca-pit-app-session'
import {
  resetOrcaPitAppSessionForTests,
  setOrcaPitAppSession
} from '../orca-pit-login/orca-pit-app-session-store'
import { OrcaPitServerLoginForm } from './OrcaPitServerLoginForm'

const loginToServer = vi.fn<OrcaPitAppApi['loginToServer']>()

beforeEach(() => {
  resetOrcaPitAppSessionForTests()
  Object.assign(window, {
    api: { orcaPit: { getSession: vi.fn(), loginToServer } as Partial<OrcaPitAppApi> }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderForm(onPairingUrl = vi.fn()) {
  render(
    <OrcaPitServerLoginForm
      name=""
      busy={false}
      failure={null}
      onNameChange={vi.fn()}
      onCancel={vi.fn()}
      onUseLink={vi.fn()}
      onPairingUrl={onPairingUrl}
    />
  )
  return onPairingUrl
}

describe('OrcaPitServerLoginForm', () => {
  it('asks only for the address when someone is signed in to the app', async () => {
    setOrcaPitAppSession({
      kind: 'signed-in',
      offline: false,
      person: { id: 7, name: 'Ana', email: 'a@x', avatarUrl: null, orcaRole: 'member' }
    })
    loginToServer.mockResolvedValue({
      ok: true,
      pairingUrl: 'orca://pair?code=x',
      suggestedName: 'orca.devnx.com.br'
    })
    const onPairingUrl = renderForm()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.getByText('You enter as Ana')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'orca.devnx.com.br' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Sign in and add/ }))
    await waitFor(() =>
      expect(onPairingUrl).toHaveBeenCalledWith('orca://pair?code=x', 'orca.devnx.com.br')
    )
    expect(loginToServer).toHaveBeenCalledWith({ address: 'orca.devnx.com.br' })
  })

  it('asks for e-mail and password without a session and explains a refusal', async () => {
    setOrcaPitAppSession({ kind: 'not-required' })
    loginToServer.mockResolvedValue({ ok: false, reason: 'no-login' })
    const onPairingUrl = renderForm()
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'x.test' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@x' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in and add/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Update Orca-Pit there')
    expect(loginToServer).toHaveBeenCalledWith({ address: 'x.test', email: 'a@x', password: 's' })
    expect(onPairingUrl).not.toHaveBeenCalled()
  })
})
