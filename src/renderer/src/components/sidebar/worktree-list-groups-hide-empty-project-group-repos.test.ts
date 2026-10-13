import { describe, expect, it } from 'vitest'
import { buildRows } from './worktree-list/grouping/build-rows'
import { repo, worktree } from './worktree-list-groups-test-fixtures'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

function projectGroup(id: string, parentGroupId: string | null): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: `/${id}`,
    parentGroupId,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

const parent = projectGroup('ailiv', null)
const legacy = projectGroup('legado', parent.id)
const activeRepo: Repo = {
  ...repo,
  id: 'repo-active',
  displayName: 'app',
  projectGroupId: parent.id
}
const idleRepo: Repo = { ...repo, id: 'repo-idle', displayName: 'idle', projectGroupId: parent.id }
const legacyRepo: Repo = {
  ...repo,
  id: 'repo-legacy',
  displayName: 'old',
  projectGroupId: legacy.id
}
const activeWorktree: Worktree = { ...worktree, id: 'wt-active', repoId: activeRepo.id }

function headerKeys(hideEmptyProjectGroupRepos: boolean): string[] {
  const rows = buildRows(
    'repo',
    [activeWorktree],
    new Map([
      [activeRepo.id, activeRepo],
      [idleRepo.id, idleRepo],
      [legacyRepo.id, legacyRepo]
    ]),
    null,
    new Set(),
    undefined,
    undefined,
    undefined,
    {},
    new Map([[activeWorktree.id, activeWorktree]]),
    false,
    undefined,
    [parent, legacy],
    new Set([idleRepo.id, legacyRepo.id]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hideEmptyProjectGroupRepos
  )
  return rows.filter((row) => row.type === 'header').map((row) => row.key)
}

describe('Orca-Pit: empty project-group members', () => {
  it('drops empty members and empty child groups while the default branch is hidden', () => {
    expect(headerKeys(true)).toEqual([`project-group:${parent.id}`, `repo:${activeRepo.id}`])
  })

  it('keeps Orca empty headers when the default branch is shown', () => {
    expect(headerKeys(false)).toEqual(
      expect.arrayContaining([
        `repo:${idleRepo.id}`,
        `project-group:${legacy.id}`,
        `repo:${legacyRepo.id}`
      ])
    )
  })
})
