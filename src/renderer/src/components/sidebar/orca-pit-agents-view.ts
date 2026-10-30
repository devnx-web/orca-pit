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

import type { AgentsOnlyRowInputs } from './worktree-list/grouping/agents-only-inputs'
import type { Repo } from '../../../../shared/repo-types'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { orcaPitAgentFilterCount, useOrcaPitAgentFilters } from './orca-pit-agent-filters'
import { getOrcaPitHostPresences, useOrcaPitPresenceRevision } from './orca-pit-sidebar-presence'
import { scopeOrcaPitRowInputs } from './orca-pit-row-scope'

export { scopeRowInputsToAgents } from './worktree-list/grouping/agents-only-inputs'

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
let lastPanes: ReadonlyMap<string, readonly string[]> = new Map()
let lastRecency: ReadonlyMap<string, number> = new Map()
// Why a minute: the order by newest agent needs no finer clock, and status pings would
// otherwise reorder (and rebuild) the list every few seconds.
const RECENCY_STEP_MS = 60_000

function sameRecency(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([id, at]) => b.get(id) === at)
}

function samePanes(
  a: ReadonlyMap<string, readonly string[]>,
  b: ReadonlyMap<string, readonly string[]>
): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [id, panes] of a) {
    const other = b.get(id)
    if (!other || other.length !== panes.length || panes.some((pane, i) => other[i] !== pane)) {
      return false
    }
  }
  return true
}

/** Workspace id → the pane keys of its agent rows, for workspaces that have any. */
function selectWorkspaceAgentPanes(
  state: AgentBucketCountState
): ReadonlyMap<string, readonly string[]> {
  if (state === lastInputs) {
    return lastPanes
  }
  const workspaces = collectActiveDashboardWorkspaces(state, false)
  const { singletonOrchestration, orchestrationByWorktree } = selectDashboardOrchestration(
    state,
    workspaces
  )
  const now = Date.now()
  const panes = new Map<string, readonly string[]>()
  const recency = new Map<string, number>()
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
      panes.set(
        worktree.id,
        rows.map((row) => row.paneKey)
      )
      const newest = Math.max(...rows.map((row) => row.entry.updatedAt || row.startedAt))
      recency.set(worktree.id, Math.floor(newest / RECENCY_STEP_MS) * RECENCY_STEP_MS)
    }
  }
  finishWorktreeAgentRowsCachePass(rowsCache)
  lastInputs = state
  if (!sameRecency(recency, lastRecency)) {
    lastRecency = recency
  }
  // Why keep the old map when nothing moved: agent pings arrive every few seconds and a new
  // identity would rebuild the whole sidebar row model each time.
  if (!samePanes(panes, lastPanes)) {
    lastPanes = panes
  }
  return lastPanes
}

export function useWorkspaceAgentPanes(
  enabled: boolean
): ReadonlyMap<string, readonly string[]> | undefined {
  const state = useAppStore((s) => (enabled ? selectAgentBucketCountState(s) : null))
  return useMemo(() => (state ? selectWorkspaceAgentPanes(state) : undefined), [state])
}

export function getWorkspaceAgentPanes(state: AppState): ReadonlyMap<string, readonly string[]> {
  return selectWorkspaceAgentPanes(selectAgentBucketCountState(state))
}

/** Workspace id → when its newest agent last changed (by the minute), from the same pass. */
export function getWorkspaceAgentRecency(state: AppState): ReadonlyMap<string, number> {
  selectWorkspaceAgentPanes(selectAgentBucketCountState(state))
  return lastRecency
}

const NO_RECENCY: ReadonlyMap<string, number> = new Map()

export function useWorkspaceAgentRecency(enabled: boolean): ReadonlyMap<string, number> {
  const state = useAppStore((s) => (enabled ? selectAgentBucketCountState(s) : null))
  // The pass keeps the map's identity while no minute moved, so the list rebuilds only then.
  return useMemo(() => {
    if (!state) {
      return NO_RECENCY
    }
    selectWorkspaceAgentPanes(state)
    return lastRecency
  }, [state])
}

/**
 * The row inputs for the sidebar: narrowed to agents while the "Agents" view is on, and to the
 * workspaces the Orca-Pit filters (mine, person, machine) keep.
 */
export function useAgentsViewRowInputs<Imported, Inbox>(
  inputs: AgentsOnlyRowInputs<Imported, Inbox>,
  visibleRepos: readonly Repo[]
): { agentsOnly: boolean; rowInputs: AgentsOnlyRowInputs<Imported, Inbox> } {
  const agentsOnly = useAgentsOnlyView()
  const filters = useOrcaPitAgentFilters()
  const filtering = orcaPitAgentFilterCount(filters) > 0
  const panesByWorkspace = useWorkspaceAgentPanes(agentsOnly || filtering)
  // Why: "Mine" and the person filter read the hosts' replies, which change without the store.
  const presenceRevision = useOrcaPitPresenceRevision(filtering)
  const defaultHostId = useAppStore((s) => getSettingsFocusedExecutionHostId(s.settings))
  const {
    worktrees,
    folderWorkspaces,
    projectGroups,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo
  } = inputs
  const rowInputs = useMemo(() => {
    void presenceRevision
    const repoById = new Map(visibleRepos.map((repo) => [repo.id, repo]))
    return scopeOrcaPitRowInputs({
      inputs: {
        worktrees,
        folderWorkspaces,
        projectGroups,
        placeholderRepoIds,
        importedWorktreesByRepo,
        newExternalWorktreesInboxByRepo
      },
      agentsOnly,
      panesByWorkspace,
      filters,
      hosts: getOrcaPitHostPresences(),
      repoOf: (repoId) => repoById.get(repoId),
      defaultHostId,
      everyRepoId: visibleRepos.map((repo) => repo.id)
    })
  }, [
    worktrees,
    folderWorkspaces,
    projectGroups,
    placeholderRepoIds,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    agentsOnly,
    panesByWorkspace,
    filters,
    presenceRevision,
    defaultHostId,
    visibleRepos
  ])
  return { agentsOnly, rowInputs }
}
