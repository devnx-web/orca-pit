import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import {
  devnxControlLinkForWorkspace,
  resolveOrcaPitControlLink,
  type OrcaPitWorkspaceLinkStore
} from './orca-pit-workspace-link'

const TASK_URL = 'https://control.devnx.com.br/tarefas/311'

const repo = {
  id: 'repo-1',
  path: '/src/soulog',
  devnxControlProject: { id: 24, name: 'SouLog' }
} as Repo

function store(
  meta: Partial<WorktreeMeta> | undefined,
  folder?: Partial<FolderWorkspace>
): OrcaPitWorkspaceLinkStore {
  return {
    getRepo: (id) => (id === 'repo-1' ? repo : undefined),
    getWorktreeMeta: (id) => (id === 'repo-1::/src/soulog-wt' ? (meta as WorktreeMeta) : undefined),
    getFolderWorkspace: (id) => (id === 'f1' ? (folder as FolderWorkspace) : undefined)
  }
}

describe('devnxControlLinkForWorkspace', () => {
  it('reads the project from the repo link and the task from the linked work item', () => {
    const link = devnxControlLinkForWorkspace(
      'repo-1::/src/soulog-wt',
      store({
        linkedWorkItem: {
          provider: 'devnx',
          type: 'issue',
          number: 311,
          title: 'SAC',
          url: TASK_URL
        }
      })
    )
    expect(link).toEqual({ projectId: 24, taskId: 311 })
  })

  it('finds a Control task among several attachments and accepts workspace keys', () => {
    const meta: Partial<WorktreeMeta> = {
      linkedWorkItem: {
        provider: 'github',
        type: 'issue',
        number: 5,
        title: 'Bug',
        url: 'https://github.com/devnx/soulog/issues/5'
      },
      linkedItems: [
        {
          provider: 'github',
          type: 'issue',
          number: 5,
          url: 'https://github.com/devnx/soulog/issues/5'
        },
        { provider: 'devnx', type: 'issue', number: 312, url: TASK_URL }
      ]
    }
    expect(devnxControlLinkForWorkspace('worktree:repo-1::/src/soulog-wt', store(meta))).toEqual({
      projectId: 24,
      taskId: 312
    })
  })

  it('knows only the task of a folder workspace, and nothing for unknown ids', () => {
    const folder = {
      linkedTask: {
        provider: 'devnx' as const,
        type: 'issue' as const,
        number: 9,
        title: 'T',
        url: TASK_URL
      }
    }
    expect(devnxControlLinkForWorkspace('folder:f1', store(undefined, folder))).toEqual({
      projectId: null,
      taskId: 9
    })
    expect(devnxControlLinkForWorkspace('other::/x', store(undefined))).toEqual({
      projectId: null,
      taskId: null
    })
    expect(devnxControlLinkForWorkspace('repo-1::/x', null)).toEqual({
      projectId: null,
      taskId: null
    })
  })

  it('reports the project even before any task is linked', () => {
    expect(resolveOrcaPitControlLink(repo, {})).toEqual({ projectId: 24, taskId: null })
    expect(resolveOrcaPitControlLink({ devnxControlProject: null }, null)).toEqual({
      projectId: null,
      taskId: null
    })
  })
})
