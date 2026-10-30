// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrcaPitCreateWorkspaceButton } from './OrcaPitCreateWorkspaceButton'

vi.mock('./worktree-list/rows/repo-header-project-actions', () => ({
  RepoHeaderCreateWorkspaceButton: ({ repo }: { repo: Repo }) => (
    <button type="button">{`create ${repo.id}`}</button>
  )
}))
vi.mock('./OrcaPitMachineChip', () => ({ OrcaPitMachineChip: () => null }))

const central = { id: 'momento-central', displayName: 'Momento' } as Repo
const nitro = {
  id: 'momento-nitro',
  displayName: 'Momento',
  executionHostId: 'runtime:n5'
} as unknown as Repo

afterEach(() => cleanup())

describe('OrcaPitCreateWorkspaceButton', () => {
  it('creates right away when the project lives on one machine', () => {
    render(
      <OrcaPitCreateWorkspaceButton
        repo={central}
        repos={[central]}
        label="Momento"
        onCreateForRepo={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'create momento-central' })).toBeTruthy()
  })

  it('asks for the machine when the project lives on several', () => {
    render(
      <OrcaPitCreateWorkspaceButton
        repo={central}
        repos={[central, nitro]}
        label="Momento"
        onCreateForRepo={vi.fn()}
      />
    )
    const trigger = screen.getByRole('button', { name: /Momento/ })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  })
})
