import { describe, expect, it, vi } from 'vitest'

vi.mock('./devnx-control-service', () => ({ getDevnxControlService: () => null }))
vi.mock('../startup/main-process-state', () => ({ mainProcessState: { store: null } }))

import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { EMPTY_WORKSPACE_CONTEXT, workspaceContext } from './orca-pit-activity-context'
import type { OrcaPitWorkspaceLinkStore } from './orca-pit-workspace-link'

const WORKTREE = 'repo-1::/src/soulog-wt'
const TASK_URL = 'https://control.devnx.com.br/tarefas/311'

function storeWith(
  repo: Partial<Repo>,
  meta: Partial<WorktreeMeta> | Record<string, unknown>
): OrcaPitWorkspaceLinkStore {
  return {
    getRepo: (id) =>
      id === 'repo-1' ? ({ id: 'repo-1', path: '/src/soulog', ...repo } as Repo) : undefined,
    getWorktreeMeta: (id) => (id === WORKTREE ? (meta as WorktreeMeta) : undefined)
  }
}

describe('diary workspace context', () => {
  it("takes project_id from the project's link and task_id from the workspace's card", () => {
    const store = storeWith(
      { displayName: 'SouLog', devnxControlProject: { id: 24, name: 'SouLog' } },
      {
        displayName: 'relatorio-sac',
        linkedWorkItem: { provider: 'devnx', type: 'issue', number: 311, title: 'T', url: TASK_URL }
      }
    )
    expect(workspaceContext(WORKTREE, store)).toEqual({
      orca_project: 'SouLog',
      workspace: 'relatorio-sac',
      project_id: 24,
      task_id: 311
    })
  })

  it('finds the card among the linked items when the selected one is from another source', () => {
    const store = storeWith(
      { devnxControlProject: { id: 24, name: 'SouLog' } },
      {
        linkedWorkItem: {
          provider: 'github',
          type: 'issue',
          number: 9,
          title: 'gh',
          url: 'https://github.com/o/r/issues/9'
        },
        linkedItems: [{ provider: 'devnx', type: 'issue', number: 312, title: 'T', url: TASK_URL }]
      }
    )
    expect(workspaceContext(WORKTREE, store)).toMatchObject({ project_id: 24, task_id: 312 })
  })

  it('no longer guesses ids from other field names', () => {
    const store = storeWith({ orcaPitControlProjectId: 99 } as Partial<Repo>, {
      devnxControlTaskId: 98,
      orcaPitControlTask: { id: 97 }
    })
    expect(workspaceContext(WORKTREE, store)).toMatchObject({
      orca_project: 'soulog',
      workspace: 'soulog-wt',
      project_id: null,
      task_id: null
    })
  })

  it('is empty without a store or a worktree id', () => {
    expect(workspaceContext(WORKTREE, null)).toEqual(EMPTY_WORKSPACE_CONTEXT)
    expect(workspaceContext(null, storeWith({}, {}))).toEqual(EMPTY_WORKSPACE_CONTEXT)
  })
})
