// Orca-Pit: a project is "active" while the user sent one of its agents a prompt in the
// last 12 hours. Orca has no such clock — `lastActivityAt` moves on terminal output, not
// on what the user sends — so the fork keeps its own, per device, beside Orca's state.
import { useMemo } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '../../store'
import { getTabIdToWorktreeId } from './worktree-agent-row-selectors'

export const PROJECT_ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000
// Why a month: older stamps can never make a project active again, they only grow the file.
const PROMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
// Why 5 minutes: the 12h boundary needs no finer resolution than this.
const ACTIVE_WINDOW_TICK_MS = 5 * 60 * 1000
const STORAGE_KEY = 'orca-pit.project-activity.v1'

export type ProjectActivity = {
  activeRepoIds: ReadonlySet<string>
  activeFolderWorkspaceIds: ReadonlySet<string>
}

type ProjectActivityState = {
  /** Worktree id (or `folder:<id>` key) → when the user last sent its agent a prompt. */
  lastPromptAtByWorkspace: Record<string, number>
  splitByActivity: boolean
}

function loadState(): ProjectActivityState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      const stored = parsed as Partial<ProjectActivityState>
      const stamps: Record<string, number> = {}
      for (const [key, at] of Object.entries(stored.lastPromptAtByWorkspace ?? {})) {
        if (typeof at === 'number' && Number.isFinite(at)) {
          stamps[key] = at
        }
      }
      return { lastPromptAtByWorkspace: stamps, splitByActivity: stored.splitByActivity !== false }
    }
  } catch {
    // Unreadable device storage only means every project starts inactive.
  }
  return { lastPromptAtByWorkspace: {}, splitByActivity: true }
}

const projectActivityStore = createStore<ProjectActivityState>(loadState)

projectActivityStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The split keeps working for this session when device storage is unavailable.
  }
})

function recordPrompts(stamps: ReadonlyMap<string, number>): void {
  const current = projectActivityStore.getState().lastPromptAtByWorkspace
  const cutoff = Date.now() - PROMPT_RETENTION_MS
  let next: Record<string, number> | null = null
  for (const [workspaceId, at] of stamps) {
    if (at > (current[workspaceId] ?? 0) && at > cutoff) {
      next ??= { ...current }
      next[workspaceId] = at
    }
  }
  if (next) {
    for (const [workspaceId, at] of Object.entries(next)) {
      if (at <= cutoff) {
        delete next[workspaceId]
      }
    }
    projectActivityStore.setState({ lastPromptAtByWorkspace: next })
  }
}

// Why turnStartedAt: the hook server stamps it only when the user submits a prompt, and a
// replayed row carries the original time, so taking the max is safe across restarts.
function collectPromptStamps(
  agentStatusByPaneKey: Record<string, AgentStatusEntry>,
  tabsByWorktree: Parameters<typeof getTabIdToWorktreeId>[0]
): Map<string, number> {
  const stamps = new Map<string, number>()
  let tabIdToWorktreeId: Map<string, string> | null = null
  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
    if (typeof entry.turnStartedAt !== 'number' || !entry.prompt) {
      continue
    }
    tabIdToWorktreeId ??= getTabIdToWorktreeId(tabsByWorktree)
    const workspaceId =
      entry.worktreeId ?? tabIdToWorktreeId.get(entry.tabId ?? paneKey.split(':')[0] ?? '')
    if (workspaceId) {
      stamps.set(workspaceId, Math.max(stamps.get(workspaceId) ?? 0, entry.turnStartedAt))
    }
  }
  return stamps
}

/** Records prompt times from the agent status feed; installed once by main.tsx. */
export function installProjectActivityTracking(): () => void {
  const initial = useAppStore.getState()
  recordPrompts(collectPromptStamps(initial.agentStatusByPaneKey, initial.tabsByWorktree))
  return useAppStore.subscribe((state, previous) => {
    if (state.agentStatusByPaneKey !== previous.agentStatusByPaneKey) {
      recordPrompts(collectPromptStamps(state.agentStatusByPaneKey, state.tabsByWorktree))
    }
  })
}

function computeProjectActivity(
  lastPromptAtByWorkspace: Record<string, number>,
  now: number
): ProjectActivity {
  const activeRepoIds = new Set<string>()
  const activeFolderWorkspaceIds = new Set<string>()
  for (const [workspaceId, at] of Object.entries(lastPromptAtByWorkspace)) {
    if (now - at > PROJECT_ACTIVE_WINDOW_MS) {
      continue
    }
    const scope = parseWorkspaceKey(workspaceId)
    if (scope?.type === 'folder') {
      activeFolderWorkspaceIds.add(scope.folderWorkspaceId)
    } else {
      activeRepoIds.add(
        getRepoIdFromWorktreeId(scope?.type === 'worktree' ? scope.worktreeId : workspaceId)
      )
    }
  }
  return { activeRepoIds, activeFolderWorkspaceIds }
}

/** The split for the rendered sidebar, or undefined while the user turned it off. */
export function useProjectActivity(): ProjectActivity | undefined {
  const { lastPromptAtByWorkspace, splitByActivity } = useStore(projectActivityStore)
  const now = useNow(ACTIVE_WINDOW_TICK_MS, splitByActivity)
  return useMemo(
    () => (splitByActivity ? computeProjectActivity(lastPromptAtByWorkspace, now) : undefined),
    [lastPromptAtByWorkspace, splitByActivity, now]
  )
}

/** Same split outside React, for the keyboard order that must match the rendered rows. */
export function getProjectActivity(): ProjectActivity | undefined {
  const { lastPromptAtByWorkspace, splitByActivity } = projectActivityStore.getState()
  return splitByActivity ? computeProjectActivity(lastPromptAtByWorkspace, Date.now()) : undefined
}

export function useSplitProjectsByActivity(): [boolean, (enabled: boolean) => void] {
  const enabled = useStore(projectActivityStore, (state) => state.splitByActivity)
  return [enabled, (next) => projectActivityStore.setState({ splitByActivity: next })]
}
