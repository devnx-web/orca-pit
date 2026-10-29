import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { normalizeDevnxControlProjectReference } from '../../shared/orca-pit-devnx-tasks'
import { createRepoUpdateSchema } from '../../shared/rpc-contract/repo-update-params'
import { normalizeWorkspaceAttachment } from '../../shared/workspace-attachment-normalization'
import { normalizeWorkspaceLinkedItem } from '../../shared/workspace-linked-item'
import { sanitizeRepoUpdatesForPersistence } from '../persistence/tracking-repos/repo-sanitization'
import { hydrateRepo } from '../persistence/tracking-repos/repo-hydration'

const BASE_REPO = {
  id: 'repo-1',
  path: '/src/soulog',
  displayName: 'soulog',
  badgeColor: '#000000',
  addedAt: 1
} as Repo

describe('Repo.devnxControlProject', () => {
  it('normalizes like the Jira default: null clears, malformed is dropped', () => {
    expect(normalizeDevnxControlProjectReference(null)).toBeNull()
    expect(normalizeDevnxControlProjectReference({ id: 24, name: ' SouLog ' })).toEqual({
      id: 24,
      name: 'SouLog'
    })
    expect(normalizeDevnxControlProjectReference({ id: '24', name: 'x' })).toBeUndefined()
    expect(normalizeDevnxControlProjectReference({ id: 0, name: 'x' })).toBeUndefined()
    expect(normalizeDevnxControlProjectReference({ id: 1, name: ' ' })).toBeUndefined()
    expect(normalizeDevnxControlProjectReference(undefined)).toBeUndefined()
  })

  it('sanitizes updates before they are persisted', () => {
    expect(
      sanitizeRepoUpdatesForPersistence({ devnxControlProject: { id: 24, name: 'SouLog' } })
    ).toEqual({ devnxControlProject: { id: 24, name: 'SouLog' } })
    expect(sanitizeRepoUpdatesForPersistence({ devnxControlProject: null })).toEqual({
      devnxControlProject: null
    })
    expect(
      'devnxControlProject' in
        sanitizeRepoUpdatesForPersistence({
          devnxControlProject: { id: -1, name: 'x' } as Repo['devnxControlProject']
        })
    ).toBe(false)
  })

  it('hydrates the stored link and drops a corrupt one', () => {
    const linked = hydrateRepo(
      { ...BASE_REPO, devnxControlProject: { id: 24, name: 'SouLog' } },
      new Map()
    )
    expect(linked.devnxControlProject).toEqual({ id: 24, name: 'SouLog' })
    const corrupt = hydrateRepo(
      { ...BASE_REPO, devnxControlProject: { id: 'x' } as unknown as Repo['devnxControlProject'] },
      new Map()
    )
    expect('devnxControlProject' in corrupt).toBe(false)
  })

  it('crosses the runtime RPC update schema', () => {
    const schema = createRepoUpdateSchema({})
    const parsed = schema.parse({ updates: { devnxControlProject: { id: 24, name: 'SouLog' } } })
    expect(parsed.updates.devnxControlProject).toEqual({ id: 24, name: 'SouLog' })
  })
})

describe('DevNX Control task links on a workspace', () => {
  it('keeps a Control task as a linked item and as an attachment', () => {
    const item = {
      provider: 'devnx',
      type: 'issue',
      number: 311,
      title: 'SAC',
      url: 'https://control.devnx.com.br/tarefas/311'
    }
    expect(normalizeWorkspaceLinkedItem(item)).toEqual(item)
    expect(normalizeWorkspaceAttachment(item)).toMatchObject({ provider: 'devnx', number: 311 })
    expect(normalizeWorkspaceAttachment({ ...item, type: 'pr' })).toBeNull()
  })
})
