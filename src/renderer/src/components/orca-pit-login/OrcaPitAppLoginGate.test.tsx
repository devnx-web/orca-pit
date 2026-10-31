// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaPitAppApi } from '../../../../shared/orca-pit-app-session'
import { OrcaPitAppLoginGate } from './OrcaPitAppLoginGate'
import {
  installOrcaPitLoginKeyGuard,
  resetOrcaPitAppSessionForTests
} from './orca-pit-app-session-store'

const api = {
  getSession: vi.fn<OrcaPitAppApi['getSession']>(),
  login: vi.fn<OrcaPitAppApi['login']>(),
  logout: vi.fn<OrcaPitAppApi['logout']>(),
  resume: vi.fn<OrcaPitAppApi['resume']>(),
  onSessionChanged: vi.fn<OrcaPitAppApi['onSessionChanged']>(() => () => {})
}

beforeEach(() => {
  resetOrcaPitAppSessionForTests()
  Object.assign(window, { api: { orcaPit: api } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OrcaPitAppLoginGate', () => {
  it('opens straight into the app on a machine without the Control', async () => {
    api.getSession.mockResolvedValue({ kind: 'not-required' })
    render(<OrcaPitAppLoginGate>app</OrcaPitAppLoginGate>)
    await waitFor(() => expect(screen.queryByText('Who is using Orca-Pit?')).toBeNull())
    expect(screen.getByText('app')).toBeTruthy()
  })

  it('covers the app until the person signs in, and blocks app shortcuts meanwhile', async () => {
    api.getSession.mockResolvedValue({ kind: 'signed-out', rememberedEmail: 'ana@x' })
    api.login.mockResolvedValue({
      ok: true,
      state: {
        kind: 'signed-in',
        offline: false,
        person: { id: 7, name: 'Ana', email: 'ana@x', avatarUrl: null, orcaRole: 'member' }
      }
    })
    const shortcut = vi.fn()
    const disposeGuard = installOrcaPitLoginKeyGuard()
    window.addEventListener('keydown', shortcut, { capture: true })
    render(<OrcaPitAppLoginGate>app</OrcaPitAppLoginGate>)
    expect(await screen.findByText('Who is using Orca-Pit?')).toBeTruthy()
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@x')
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true })
    expect(shortcut).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'certa' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    await waitFor(() => expect(screen.queryByText('Who is using Orca-Pit?')).toBeNull())
    expect(api.login).toHaveBeenCalledWith('ana@x', 'certa')
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true })
    expect(shortcut).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', shortcut, { capture: true })
    disposeGuard()
  })

  it('shows why a sign-in failed', async () => {
    api.getSession.mockResolvedValue({ kind: 'signed-out', rememberedEmail: null })
    api.login.mockResolvedValue({ ok: false, reason: 'bad-credentials' })
    render(<OrcaPitAppLoginGate>app</OrcaPitAppLoginGate>)
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'a@x' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong e-mail or password.')
  })

  it('covers the app with "Are you still there?" when main says the person stepped away', async () => {
    const ana = {
      id: 7,
      name: 'Ana Souza',
      email: 'ana@x',
      avatarUrl: null,
      orcaRole: 'member' as const
    }
    api.getSession.mockResolvedValue({ kind: 'signed-in', offline: false, person: ana })
    api.resume.mockResolvedValue({ kind: 'signed-in', offline: false, person: ana, away: null })
    const shortcut = vi.fn()
    const disposeGuard = installOrcaPitLoginKeyGuard()
    window.addEventListener('keydown', shortcut, { capture: true })
    render(<OrcaPitAppLoginGate>app</OrcaPitAppLoginGate>)
    await waitFor(() => expect(api.onSessionChanged).toHaveBeenCalled())
    const push = api.onSessionChanged.mock.calls[0][0]

    act(() => push({ kind: 'signed-in', offline: false, person: ana, away: 1_000 }))
    expect(screen.getByText('Are you still there?')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true })
    expect(shortcut).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue as Ana' }))
    await waitFor(() => expect(screen.queryByText('Are you still there?')).toBeNull())
    expect(api.resume).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true })
    expect(shortcut).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', shortcut, { capture: true })
    disposeGuard()
  })
})
