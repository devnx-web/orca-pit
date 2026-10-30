// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrcaPitControlProjectChip, controlProjectUrl } from './OrcaPitControlProjectChip'

const connection = vi.hoisted(() => ({
  value: { connected: true, canLink: true, viewer: null, needsLogin: false, checking: false }
}))
vi.mock('@/lib/orca-pit-devnx-status', () => ({
  useOrcaPitDevnxConnection: () => connection.value
}))

const openUrl = vi.fn(async () => undefined)
vi.stubGlobal('window', Object.assign(window, { api: { shell: { openUrl } } }))

function repo(link: Repo['devnxControlProject']): Repo {
  return {
    id: 'repo-1',
    path: '/work/portal',
    displayName: 'portal',
    devnxControlProject: link
  } as Repo
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  connection.value = { ...connection.value, connected: true, canLink: true }
})

describe('OrcaPitControlProjectChip', () => {
  it('opens the linked project in the Control without toggling the header', () => {
    const headerClick = vi.fn()
    render(
      <div onClick={headerClick}>
        <OrcaPitControlProjectChip
          repo={repo({ id: 42, name: 'Site Jacarei' })}
          onOpenRepoSettings={vi.fn()}
        />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: /Site Jacarei/ }))
    expect(openUrl).toHaveBeenCalledWith(controlProjectUrl(42))
    expect(controlProjectUrl(42)).toBe('https://control.devnx.com.br/projetos/42')
    expect(headerClick).not.toHaveBeenCalled()
  })

  it('sends an administrator to the project link setting when unlinked', () => {
    const onOpenRepoSettings = vi.fn()
    render(<OrcaPitControlProjectChip repo={repo(null)} onOpenRepoSettings={onOpenRepoSettings} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenRepoSettings).toHaveBeenCalledWith('repo-1', 'repo-repo-1-devnx-project')
  })

  it('only tells a member that the project is unlinked', () => {
    connection.value = { ...connection.value, canLink: false }
    render(<OrcaPitControlProjectChip repo={repo(null)} onOpenRepoSettings={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTitle(/administrator/)).toBeTruthy()
  })

  it('shows nothing without a Control connection', () => {
    connection.value = { ...connection.value, connected: false }
    const { container } = render(
      <OrcaPitControlProjectChip repo={repo(null)} onOpenRepoSettings={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })
})
