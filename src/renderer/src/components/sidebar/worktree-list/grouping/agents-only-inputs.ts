// Orca-Pit: the row inputs and rows of the sidebar's "Agents" view; see orca-pit-agents-view.
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { isProjectActivitySectionKey } from './activity-sections'
import type { GroupHeaderRow, Row } from './row-types'

export type AgentsOnlyRowInputs<Imported, Inbox> = {
  worktrees: Worktree[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  placeholderRepoIds: ReadonlySet<string>
  importedWorktreesByRepo: Imported
  newExternalWorktreesInboxByRepo: Inbox
}

/**
 * Narrows buildRows' inputs to the workspaces with agents. Every project still gets its header
 * (`everyRepoId` become placeholders), so a project with nothing running stays one click away.
 */
export function scopeRowInputsToAgents<Imported, Inbox>(
  inputs: AgentsOnlyRowInputs<Imported, Inbox>,
  workspaceIdsWithAgents: ReadonlySet<string>,
  everyRepoId?: Iterable<string>
): AgentsOnlyRowInputs<Imported, Inbox> {
  return {
    worktrees: inputs.worktrees.filter((worktree) => workspaceIdsWithAgents.has(worktree.id)),
    folderWorkspaces: inputs.folderWorkspaces.filter((folder) =>
      workspaceIdsWithAgents.has(folderWorkspaceKey(folder.id))
    ),
    projectGroups: inputs.projectGroups,
    placeholderRepoIds: everyRepoId ? new Set(everyRepoId) : inputs.placeholderRepoIds,
    // Why empty: these only add rows about workspaces, never about agents.
    importedWorktreesByRepo: new Map() as Imported,
    newExternalWorktreesInboxByRepo: new Map() as Inbox
  }
}

/**
 * Keeps one header per top-level project: the headers of the projects and groups nested in it
 * go, and their agents read as the top project's. A group header takes over the first nested
 * project's "+" (`orcaPitCreateRepo`), since the nested header that carried it is gone.
 *
 * `rows` must be built with nothing collapsed: collapse is applied here, to the headers that
 * remain, so a nested header collapsed in the Project view cannot hide agents behind it.
 */
export function flattenAgentsOnlyRows(
  rows: readonly Row[],
  collapsedGroups: ReadonlySet<string>
): Row[] {
  const result: Row[] = []
  let topHeaderIndex = -1
  let skipSection = false
  let skipProject = false
  for (const row of rows) {
    if (row.type !== 'header') {
      if (!skipSection && !skipProject) {
        result.push(row)
      }
      continue
    }
    if (isProjectActivitySectionKey(row.key)) {
      result.push(row)
      skipSection = collapsedGroups.has(row.key)
      skipProject = false
      topHeaderIndex = -1
      continue
    }
    if (skipSection) {
      continue
    }
    if ((row.projectGroupDepth ?? 0) === 0) {
      topHeaderIndex = result.length
      result.push(row)
      skipProject = collapsedGroups.has(row.key)
      continue
    }
    const top = result[topHeaderIndex] as GroupHeaderRow | undefined
    if (top && row.repo && !top.repo && !top.orcaPitCreateRepo) {
      result[topHeaderIndex] = { ...top, orcaPitCreateRepo: row.repo }
    }
  }
  return result
}
