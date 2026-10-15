// Orca-Pit: the row inputs of the sidebar's "Agents" view; see orca-pit-agents-view.
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'

export type AgentsOnlyRowInputs<Imported, Inbox> = {
  worktrees: Worktree[]
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  placeholderRepoIds: ReadonlySet<string>
  importedWorktreesByRepo: Imported
  newExternalWorktreesInboxByRepo: Inbox
}

/** Narrows buildRows' inputs to the workspaces with agents and the groups that hold them. */
export function scopeRowInputsToAgents<Imported, Inbox>(
  inputs: AgentsOnlyRowInputs<Imported, Inbox>,
  workspaceIdsWithAgents: ReadonlySet<string>,
  repoMap: ReadonlyMap<string, Repo>
): AgentsOnlyRowInputs<Imported, Inbox> {
  const worktrees = inputs.worktrees.filter((worktree) => workspaceIdsWithAgents.has(worktree.id))
  const folderWorkspaces = inputs.folderWorkspaces.filter((folder) =>
    workspaceIdsWithAgents.has(folderWorkspaceKey(folder.id))
  )
  const parentById = new Map(inputs.projectGroups.map((group) => [group.id, group.parentGroupId]))
  const keptGroupIds = new Set<string>()
  const keepWithAncestors = (groupId: string | null | undefined): void => {
    // Why the has() guard: a corrupt parent chain must not hang the sidebar.
    while (groupId && parentById.has(groupId) && !keptGroupIds.has(groupId)) {
      keptGroupIds.add(groupId)
      groupId = parentById.get(groupId)
    }
  }
  for (const worktree of worktrees) {
    keepWithAncestors(repoMap.get(worktree.repoId)?.projectGroupId)
  }
  for (const folder of folderWorkspaces) {
    keepWithAncestors(folder.projectGroupId)
  }
  return {
    worktrees,
    folderWorkspaces,
    projectGroups: inputs.projectGroups.filter((group) => keptGroupIds.has(group.id)),
    // Why empty: these only ever add rows for projects with nothing running in them.
    placeholderRepoIds: new Set(),
    importedWorktreesByRepo: new Map() as Imported,
    newExternalWorktreesInboxByRepo: new Map() as Inbox
  }
}
