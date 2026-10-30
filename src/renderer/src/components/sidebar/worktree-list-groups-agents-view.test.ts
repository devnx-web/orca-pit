import { describe, expect, it } from 'vitest'
import { buildRows } from './worktree-list/grouping/build-rows.test-fixture'
import { scopeRowInputsToAgents } from './worktree-list/grouping/agents-only-inputs'
import {
  collapseAgentsViewRows,
  organizeAgentsViewRows
} from './worktree-list/grouping/orca-pit-project-rows'
import { repo, worktree } from './worktree-list-groups-test-fixtures'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  IDLE_PROJECTS_OPEN_KEY,
  IDLE_PROJECTS_SECTION_KEY
} from '../../../../shared/sidebar-list/orca-pit-activity-sections'

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
    undefined
  )
  const recency = new Map(workspaceIdsWithAgents.map((id, index) => [id, 1000 - index]))
  const rows = collapseAgentsViewRows(organizeAgentsViewRows(built, recency), new Set(collapsed))
  return {
    headers: rows.flatMap((row) =>
      row.type === 'header' ? [row.key === IDLE_PROJECTS_SECTION_KEY ? 'idle' : row.label] : []
    ),
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
  it('puts projects with agents first and folds the rest, closed', () => {
    expect(rowsFor(['wt-repo-app'])).toMatchObject({
      headers: ['ailiv', 'idle'],
      items: ['wt-repo-app']
    })
    expect(rowsFor(['wt-repo-app'], [IDLE_PROJECTS_OPEN_KEY]).headers).toEqual([
      'ailiv',
      'idle',
      'wb',
      'loose'
    ])
  })

  it('orders projects by their newest agent', () => {
    expect(rowsFor(['folder:wb-folder', 'wt-repo-loose'])).toMatchObject({
      headers: ['wb', 'loose', 'idle'],
      items: ['wb-folder', 'wt-repo-loose']
    })
    expect(rowsFor(['wt-repo-loose', 'folder:wb-folder']).headers).toEqual(['loose', 'wb', 'idle'])
  })

  it('lists every project, without a fold, when no agent is running anywhere', () => {
    expect(rowsFor([])).toMatchObject({ headers: ['ailiv', 'wb', 'loose'], items: [] })
  })

  it("gives a group header its first nested project's +", () => {
    expect(rowsFor([]).createRepos).toEqual(['repo-app', 'repo-wb', 'repo-loose'])
  })

  it('shows the nested projects of a group only when two of them have agents', () => {
    // The group keeps its "+"; each nested project with agents gets its own header under it.
    expect(rowsFor(['wt-repo-app', 'wt-repo-site']).createRepos).toEqual([
      'repo-app',
      'repo-app',
      'repo-site',
      null
    ])
    expect(rowsFor(['wt-repo-app']).createRepos).toEqual(['repo-app', null])
  })

  it('collapses a project on its own header', () => {
    expect(rowsFor(['wt-repo-app', 'wt-repo-loose'], ['repo:repo-app'])).toMatchObject({
      items: ['wt-repo-app', 'wt-repo-loose']
    })
  })
})
