import { describe, expect, it } from 'vitest'
import { buildRows } from './worktree-list/grouping/build-rows'
import {
  flattenAgentsOnlyRows,
  scopeRowInputsToAgents
} from './worktree-list/grouping/agents-only-inputs'
import { repo, worktree } from './worktree-list-groups-test-fixtures'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

function projectGroup(id: string, parentGroupId: string | null, tabOrder = 0): ProjectGroup {
  return {
    id,
    name: id,
    parentPath: `/${id}`,
    parentGroupId,
    createdFrom: 'folder-scan',
    tabOrder,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1
  }
}

const ailiv = projectGroup('ailiv', null, 0)
const legacy = projectGroup('legado', ailiv.id)
const wb = projectGroup('wb', null, 1)
const appRepo: Repo = { ...repo, id: 'repo-app', displayName: 'app', projectGroupId: legacy.id }
const siteRepo: Repo = { ...repo, id: 'repo-site', displayName: 'site', projectGroupId: legacy.id }
const wbRepo: Repo = { ...repo, id: 'repo-wb', displayName: 'wb', projectGroupId: wb.id }
const looseRepo: Repo = { ...repo, id: 'repo-loose', displayName: 'loose', projectGroupId: null }
const repos = [appRepo, siteRepo, wbRepo, looseRepo]
const repoMap = new Map(repos.map((owner) => [owner.id, owner]))
const worktrees: Worktree[] = repos.map((owner) => ({
  ...worktree,
  id: `wt-${owner.id}`,
  repoId: owner.id,
  path: `/${owner.id}`
}))
const wbFolder = {
  id: 'wb-folder',
  name: 'wb workspace',
  projectGroupId: wb.id
} as unknown as FolderWorkspace

function rowsFor(workspaceIdsWithAgents: string[], collapsed: string[] = []) {
  const inputs = scopeRowInputsToAgents(
    {
      worktrees,
      folderWorkspaces: [wbFolder],
      projectGroups: [ailiv, legacy, wb],
      placeholderRepoIds: new Set(),
      importedWorktreesByRepo: new Map(),
      newExternalWorktreesInboxByRepo: new Map()
    },
    new Set(workspaceIdsWithAgents),
    repos.map((owner) => owner.id)
  )
  const built = buildRows(
    'repo',
    inputs.worktrees,
    repoMap,
    null,
    new Set(),
    undefined,
    undefined,
    undefined,
    {},
    new Map(worktrees.map((entry) => [entry.id, entry])),
    false,
    undefined,
    inputs.projectGroups,
    inputs.placeholderRepoIds,
    inputs.importedWorktreesByRepo,
    inputs.newExternalWorktreesInboxByRepo,
    undefined,
    undefined,
    inputs.folderWorkspaces,
    undefined,
    undefined,
    undefined,
    false
  )
  const rows = flattenAgentsOnlyRows(built, new Set(collapsed))
  return {
    headers: rows.filter((row) => row.type === 'header').map((row) => row.label),
    createRepos: rows.flatMap((row) =>
      row.type === 'header' ? [(row.repo ?? row.orcaPitCreateRepo)?.id ?? null] : []
    ),
    items: rows.flatMap((row) =>
      row.type === 'item'
        ? [row.worktree.id]
        : row.type === 'folder-workspace'
          ? [row.folderWorkspace.id]
          : []
    )
  }
}

describe('Orca-Pit: agents view', () => {
  const everyProject = ['ailiv', 'wb', 'loose']

  it('lists every top-level project, with only the workspaces that have agents', () => {
    expect(rowsFor(['wt-repo-app'])).toMatchObject({
      headers: everyProject,
      items: ['wt-repo-app']
    })
  })

  it('folds a folder workspace with agents into its group', () => {
    expect(rowsFor(['folder:wb-folder', 'wt-repo-loose'])).toMatchObject({
      headers: everyProject,
      items: ['wb-folder', 'wt-repo-loose']
    })
  })

  it('keeps every project header when no agent is running anywhere', () => {
    expect(rowsFor([])).toMatchObject({ headers: everyProject, items: [] })
  })

  it("gives a group header its first nested project's +", () => {
    expect(rowsFor([]).createRepos).toEqual(['repo-app', 'repo-wb', 'repo-loose'])
  })

  it('collapses on the remaining headers only', () => {
    expect(rowsFor(['wt-repo-app', 'wt-repo-loose'], ['repo:repo-app'])).toMatchObject({
      items: ['wt-repo-app', 'wt-repo-loose']
    })
  })
})
