// Orca-Pit: the row inputs of the sidebar's "Agents" view; see orca-pit-agents-view. The rows
// themselves are organized in orca-pit-project-rows.
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
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
