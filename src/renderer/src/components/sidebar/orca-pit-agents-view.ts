// Orca-Pit: "Agents" in the sidebar's Group by. It is the project grouping cut down to what
// the user works from: every project keeps its header, a workspace with no agent row leaves the
// list, a workspace that stays shows only its agent rows, and projects nested in a group fold
// into it, so each project reads as one header over its agents.
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { collectActiveDashboardWorkspaces } from '../dashboard/dashboard-snapshot-workspaces'
import { selectDashboardOrchestration } from '../dashboard/dashboard-orchestration-selection'
import {
  selectAgentBucketCountState,
  type AgentBucketCountState
} from '../dashboard/useAgentBucketCounts'
import {
  createWorktreeAgentRowsCache,
  finishWorktreeAgentRowsCachePass,
  selectWorktreeAgentRowsCached,
  startWorktreeAgentRowsCachePass
} from '../dashboard/worktree-agent-rows-cache'
import { EMPTY_WORKTREE_AGENT_ORCHESTRATION } from './worktree-agent-orchestration-batch'

import {
  scopeRowInputsToAgents,
  type AgentsOnlyRowInputs
} from './worktree-list/grouping/agents-only-inputs'
import type { Repo } from '../../../../shared/repo-types'

export {
  flattenAgentsOnlyRows,
  scopeRowInputsToAgents
} from './worktree-list/grouping/agents-only-inputs'

const STORAGE_KEY = 'orca-pit.agents-view.v1'

function loadAgentsOnly(): boolean {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'false') === true
  } catch {
    return false
  }
}

const agentsViewStore = createStore<{ agentsOnly: boolean }>(() => ({
  agentsOnly: loadAgentsOnly()
}))

agentsViewStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.agentsOnly))
  } catch {
    // The view still switches for this session when device storage is unavailable.
  }
})

/** Picks "Agents" (true) or one of Orca's own groupings (false) in the Group by control. */
export function setAgentsOnlyView(enabled: boolean): void {
  agentsViewStore.setState({ agentsOnly: enabled })
}

// Why it also needs the project grouping: "Agents" is drawn on top of it, and a groupBy
// changed elsewhere (command palette, another window) must win over a stale flag.
export function useAgentsOnlyView(): boolean {
  const agentsOnly = useStore(agentsViewStore, (state) => state.agentsOnly)
  const groupBy = useAppStore((s) => s.groupBy)
  return agentsOnly && groupBy === 'repo'
}

export function isAgentsOnlyView(state: Pick<AppState, 'groupBy'>): boolean {
  return agentsViewStore.getState().agentsOnly && state.groupBy === 'repo'
}

// Why the dashboard's row pipeline: it is the one the worktree card renders from, so a
// workspace is kept exactly when its card would have shown at least one agent row.
const rowsCache = createWorktreeAgentRowsCache()
let lastInputs: AgentBucketCountState | null = null
let lastIds: ReadonlySet<string> = new Set()

function selectWorkspaceIdsWithAgents(state: AgentBucketCountState): ReadonlySet<string> {
  if (state === lastInputs) {
    return lastIds
  }
  const workspaces = collectActiveDashboardWorkspaces(state, false)
  const { singletonOrchestration, orchestrationByWorktree } = selectDashboardOrchestration(
    state,
    workspaces
  )
  const now = Date.now()
  const ids = new Set<string>()
  startWorktreeAgentRowsCachePass(rowsCache)
  for (const { worktree } of workspaces) {
    const rows = selectWorktreeAgentRowsCached({
      state,
      worktreeId: worktree.id,
      orchestration:
        singletonOrchestration ??
        orchestrationByWorktree?.get(worktree.id) ??
        EMPTY_WORKTREE_AGENT_ORCHESTRATION,
      now,
      generation: state.agentStatusEpoch,
      cache: rowsCache
    })
    if (rows.length > 0) {
      ids.add(worktree.id)
    }
  }
  finishWorktreeAgentRowsCachePass(rowsCache)
  lastInputs = state
  // Why keep the old set when nothing moved: agent pings arrive every few seconds and a new
  // identity would rebuild the whole sidebar row model each time.
  if (ids.size !== lastIds.size || [...ids].some((id) => !lastIds.has(id))) {
    lastIds = ids
  }
  return lastIds
}

export function useWorkspaceIdsWithAgents(enabled: boolean): ReadonlySet<string> | undefined {
  const state = useAppStore((s) => (enabled ? selectAgentBucketCountState(s) : null))
  return useMemo(() => (state ? selectWorkspaceIdsWithAgents(state) : undefined), [state])
}

export function getWorkspaceIdsWithAgents(state: AppState): ReadonlySet<string> {
  return selectWorkspaceIdsWithAgents(selectAgentBucketCountState(state))
}

/** The row inputs for the sidebar, narrowed to agents while the "Agents" view is on. */
export function useAgentsViewRowInputs<Imported, Inbox>(
  inputs: AgentsOnlyRowInputs<Imported, Inbox>,
  visibleRepos: readonly Repo[]
): { agentsOnly: boolean; rowInputs: AgentsOnlyRowInputs<Imported, Inbox> } {
  const agentsOnly = useAgentsOnlyView()
  const workspaceIdsWithAgents = useWorkspaceIdsWithAgents(agentsOnly)
  const {
    worktrees,
    folderWorkspaces,
    projectGroups,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo
  } = inputs
  const rowInputs = useMemo(() => {
    const unscoped = {
      worktrees,
      folderWorkspaces,
      projectGroups,
      placeholderRepoIds,
      importedWorktreesByRepo,
      newExternalWorktreesInboxByRepo
    }
    return workspaceIdsWithAgents
      ? scopeRowInputsToAgents(
          unscoped,
          workspaceIdsWithAgents,
          visibleRepos.map((repo) => repo.id)
        )
      : unscoped
  }, [
    worktrees,
    folderWorkspaces,
    projectGroups,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    workspaceIdsWithAgents,
    visibleRepos
  ])
  return { agentsOnly, rowInputs }
}
