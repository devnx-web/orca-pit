import { describe, expect, it } from 'vitest'
import { buildRows } from './worktree-list/grouping/build-rows'
import {
  ACTIVE_PROJECTS_SECTION_KEY,
  INACTIVE_PROJECTS_SECTION_KEY
} from './worktree-list/grouping/activity-sections'
import { repo, worktree } from './worktree-list-groups-test-fixtures'
import type { ProjectActivity } from './orca-pit-project-activity'
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
const wbRepo: Repo = { ...repo, id: 'repo-wb', displayName: 'wb', projectGroupId: wb.id }
const looseRepo: Repo = { ...repo, id: 'repo-loose', displayName: 'loose', projectGroupId: null }
const worktrees: Worktree[] = [appRepo, wbRepo, looseRepo].map((owner) => ({
  ...worktree,
  id: `wt-${owner.id}`,
  repoId: owner.id
}))

function headerKeys(
  projectActivity: ProjectActivity | undefined,
  collapsed: string[] = []
): string[] {
  const rows = buildRows(
    'repo',
    worktrees,
    new Map([appRepo, wbRepo, looseRepo].map((owner) => [owner.id, owner])),
    null,
    new Set(collapsed),
    undefined,
    undefined,
    undefined,
    {},
    new Map(worktrees.map((entry) => [entry.id, entry])),
    false,
    undefined,
    [ailiv, legacy, wb],
    new Set(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    projectActivity
  )
  return rows.filter((row) => row.type === 'header').map((row) => row.key)
}

const activity = (repoIds: string[]): ProjectActivity => ({
  activeRepoIds: new Set(repoIds),
  activeFolderWorkspaceIds: new Set()
})

describe('Orca-Pit: active and inactive projects', () => {
  it('moves the whole top-level group of a nested active repo to Active', () => {
    expect(headerKeys(activity([appRepo.id])).filter((key) => !key.startsWith('repo:'))).toEqual([
      ACTIVE_PROJECTS_SECTION_KEY,
      `project-group:${ailiv.id}`,
      `project-group:${legacy.id}`,
      INACTIVE_PROJECTS_SECTION_KEY,
      `project-group:${wb.id}`
    ])
  })

  it('treats an ungrouped repo as its own project', () => {
    const keys = headerKeys(activity([looseRepo.id]))
    expect(keys.slice(0, 2)).toEqual([ACTIVE_PROJECTS_SECTION_KEY, `repo:${looseRepo.id}`])
    expect(keys.indexOf(INACTIVE_PROJECTS_SECTION_KEY)).toBe(2)
  })

  it('keeps the Orca layout while every project is on the same side', () => {
    for (const keys of [
      headerKeys(activity([])),
      headerKeys(activity([appRepo.id, wbRepo.id, looseRepo.id]))
    ]) {
      expect(keys).not.toContain(ACTIVE_PROJECTS_SECTION_KEY)
      expect(keys).not.toContain(INACTIVE_PROJECTS_SECTION_KEY)
    }
  })

  it('hides a collapsed section body but keeps its header', () => {
    expect(headerKeys(activity([wbRepo.id]), [INACTIVE_PROJECTS_SECTION_KEY]).at(-1)).toBe(
      INACTIVE_PROJECTS_SECTION_KEY
    )
  })

  it('keeps the Orca layout when the split is off', () => {
    const keys = headerKeys(undefined)
    expect(keys).not.toContain(ACTIVE_PROJECTS_SECTION_KEY)
    expect(keys).not.toContain(INACTIVE_PROJECTS_SECTION_KEY)
  })
})
