// Orca-Pit: one narrowing of the sidebar's row inputs for the rendered list and the keyboard
// order alike: the Orca-Pit filters first (mine, person, machine), then the "Agents" view.
import { getWorktreeExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { OrcaPitHostPresence } from '../../../../shared/orca-pit-presence'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { orcaPitWorkspaceFilter, type OrcaPitAgentFilters } from './orca-pit-agent-filters'
import {
  scopeRowInputsToAgents,
  type AgentsOnlyRowInputs
} from './worktree-list/grouping/agents-only-inputs'

export function scopeOrcaPitRowInputs<Imported, Inbox>(args: {
  inputs: AgentsOnlyRowInputs<Imported, Inbox>
  agentsOnly: boolean
  /** Workspace id → its agent rows' pane keys; required when a filter or the view is on. */
  panesByWorkspace: ReadonlyMap<string, readonly string[]> | undefined
  filters: OrcaPitAgentFilters
  hosts: readonly OrcaPitHostPresence[]
  repoOf: (repoId: string) => Repo | undefined
  defaultHostId: ExecutionHostId
  everyRepoId?: Iterable<string>
}): AgentsOnlyRowInputs<Imported, Inbox> {
  const { inputs, agentsOnly, panesByWorkspace } = args
  if (!panesByWorkspace) {
    return inputs
  }
  const keep = orcaPitWorkspaceFilter({
    filters: args.filters,
    panesByWorkspace,
    hosts: args.hosts,
    hostOf: (worktree: Worktree) =>
      getWorktreeExecutionHostId(worktree, args.repoOf(worktree.repoId), args.defaultHostId)
  })
  const filtered = keep
    ? {
        ...inputs,
        worktrees: inputs.worktrees.filter(keep),
        folderWorkspaces: inputs.folderWorkspaces.filter((folder) =>
          keep(folderWorkspaceToWorktree(folder))
        )
      }
    : inputs
  return agentsOnly
    ? scopeRowInputsToAgents(filtered, new Set(panesByWorkspace.keys()), args.everyRepoId)
    : filtered
}
