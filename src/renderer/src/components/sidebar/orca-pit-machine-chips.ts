// Orca-Pit: where the "Agents" view names machines. The chip is on each agent's row, never on
// the project header, since one project may run on several machines. With one machine in play
// nothing is named; otherwise a row names its machine when that is not this computer, and every
// row of a project spread over several machines names its own, this computer included.
import { useEffect, useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import {
  getWorktreeExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { isProjectActivitySectionKey } from '../../../../shared/sidebar-list/orca-pit-activity-sections'
import type { Row } from '../../../../shared/sidebar-list/row-types'

export type OrcaPitMachinePlan = {
  /** Workspace id → the machine its row names. */
  hostByWorkspaceId: ReadonlyMap<string, ExecutionHostId>
}

export const EMPTY_ORCA_PIT_MACHINE_PLAN: OrcaPitMachinePlan = Object.freeze({
  hostByWorkspaceId: new Map()
})

const NO_HEADER = '\u0000'

/** `rows` are the "Agents" view's organized rows, with nothing collapsed. */
export function planOrcaPitMachineChips(
  rows: readonly Row[],
  defaultHostId: ExecutionHostId
): OrcaPitMachinePlan {
  const projects = new Map<string, { workspaceId: string; hostId: ExecutionHostId }[]>()
  const allHosts = new Set<ExecutionHostId>()
  let projectKey = NO_HEADER
  for (const row of rows) {
    if (row.type === 'header') {
      // A nested project header belongs to its top-level project; a section starts none.
      if (isProjectActivitySectionKey(row.key)) {
        projectKey = NO_HEADER
      } else if ((row.projectGroupDepth ?? 0) === 0) {
        projectKey = row.key
      }
      continue
    }
    const worktree =
      row.type === 'item'
        ? row.worktree
        : row.type === 'folder-workspace'
          ? folderWorkspaceToWorktree(row.folderWorkspace)
          : null
    if (!worktree) {
      continue
    }
    const repo = row.type === 'item' ? row.repo : undefined
    const hostId = getWorktreeExecutionHostId(worktree, repo, defaultHostId)
    allHosts.add(hostId)
    const members = projects.get(projectKey) ?? []
    members.push({ workspaceId: worktree.id, hostId })
    projects.set(projectKey, members)
  }
  if (allHosts.size <= 1) {
    return EMPTY_ORCA_PIT_MACHINE_PLAN
  }
  const hostByWorkspaceId = new Map<string, ExecutionHostId>()
  for (const members of projects.values()) {
    const spread = new Set(members.map((member) => member.hostId)).size > 1
    for (const member of members) {
      if (spread || member.hostId !== LOCAL_EXECUTION_HOST_ID) {
        hostByWorkspaceId.set(member.workspaceId, member.hostId)
      }
    }
  }
  return { hostByWorkspaceId }
}

function samePlan(a: OrcaPitMachinePlan, b: OrcaPitMachinePlan): boolean {
  const x = a.hostByWorkspaceId
  const y = b.hostByWorkspaceId
  return x.size === y.size && [...x].every(([key, value]) => y.get(key) === value)
}

const planStore = createStore<{ plan: OrcaPitMachinePlan }>(() => ({
  plan: EMPTY_ORCA_PIT_MACHINE_PLAN
}))

/** The sidebar list publishes its plan; rows read their own entry. */
export function publishOrcaPitMachinePlan(plan: OrcaPitMachinePlan): void {
  if (!samePlan(plan, planStore.getState().plan)) {
    planStore.setState({ plan })
  }
}

export function useOrcaPitRowMachine(workspaceId: string | null | undefined) {
  const read = (): ExecutionHostId | null =>
    workspaceId ? (planStore.getState().plan.hostByWorkspaceId.get(workspaceId) ?? null) : null
  return useSyncExternalStore(planStore.subscribe, read, read)
}

/** Publishes the "Agents" view's plan from its organized, uncollapsed rows; empty elsewhere. */
export function usePublishOrcaPitMachinePlan(
  agentsViewRows: readonly Row[] | null,
  defaultHostId: ExecutionHostId
): void {
  useEffect(() => {
    publishOrcaPitMachinePlan(
      agentsViewRows
        ? planOrcaPitMachineChips(agentsViewRows, defaultHostId)
        : EMPTY_ORCA_PIT_MACHINE_PLAN
    )
  }, [agentsViewRows, defaultHostId])
}

// Why: a browser pairing that was never named gets this; the machine's own name says more.
const DEFAULT_SERVER_NAMES = new Set(['orca server', ''])

/**
 * A machine's readable name: the user's override, then the paired server's name (unless it is
 * the unnamed default), then the name the machine reports for itself, never a bare "Local".
 */
export function resolveOrcaPitMachineLabel(input: {
  hostId: ExecutionHostId
  override?: string | null
  sshLabel?: string | null
  environmentName?: string | null
  machineName?: string | null
  localFallback: string
}): string {
  const override = input.override?.trim()
  if (override) {
    return override
  }
  const reported = input.machineName?.trim()
  const parsed = parseExecutionHostId(input.hostId)
  if (parsed?.kind === 'ssh') {
    return input.sshLabel?.trim() || parsed.targetId
  }
  if (parsed?.kind === 'runtime') {
    const named = input.environmentName?.trim() ?? ''
    const preferred = DEFAULT_SERVER_NAMES.has(named.toLowerCase()) ? reported || named : named
    return preferred || parsed.environmentId
  }
  return reported || input.localFallback
}
