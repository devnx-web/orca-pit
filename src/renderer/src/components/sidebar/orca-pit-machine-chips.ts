// Orca-Pit: where the "Agents" view names machines. With one machine in play nothing is named.
// With more, a project whose agents all run on one machine names it once on its header, and a
// project spread over several names it on every agent row.
import { useEffect, useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import {
  getWorktreeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { isProjectActivitySectionKey } from '../../../../shared/sidebar-list/orca-pit-activity-sections'
import type { Row } from '../../../../shared/sidebar-list/row-types'
import { flattenAgentsOnlyRows } from './worktree-list/grouping/agents-only-inputs'

export type OrcaPitMachinePlan = {
  /** Header key → the one machine all of that project's agents run on. */
  hostByHeaderKey: ReadonlyMap<string, ExecutionHostId>
  /** Workspace id → its machine, for workspaces in projects spread over several machines. */
  hostByWorkspaceId: ReadonlyMap<string, ExecutionHostId>
}

export const EMPTY_ORCA_PIT_MACHINE_PLAN: OrcaPitMachinePlan = Object.freeze({
  hostByHeaderKey: new Map(),
  hostByWorkspaceId: new Map()
})

const NO_HEADER = '\u0000'

/** `rows` are the "Agents" view's flattened rows, with nothing collapsed. */
export function planOrcaPitMachineChips(
  rows: readonly Row[],
  defaultHostId: ExecutionHostId
): OrcaPitMachinePlan {
  const groups = new Map<string, { workspaceId: string; hostId: ExecutionHostId }[]>()
  const allHosts = new Set<ExecutionHostId>()
  let headerKey = NO_HEADER
  for (const row of rows) {
    if (row.type === 'header') {
      if (!isProjectActivitySectionKey(row.key)) {
        headerKey = row.key
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
    const group = groups.get(headerKey) ?? []
    group.push({ workspaceId: worktree.id, hostId })
    groups.set(headerKey, group)
  }
  if (allHosts.size <= 1) {
    return EMPTY_ORCA_PIT_MACHINE_PLAN
  }
  const hostByHeaderKey = new Map<string, ExecutionHostId>()
  const hostByWorkspaceId = new Map<string, ExecutionHostId>()
  for (const [key, members] of groups) {
    const hosts = new Set(members.map((member) => member.hostId))
    const [only] = hosts
    if (hosts.size === 1 && only && key !== NO_HEADER) {
      hostByHeaderKey.set(key, only)
      continue
    }
    for (const member of members) {
      hostByWorkspaceId.set(member.workspaceId, member.hostId)
    }
  }
  return { hostByHeaderKey, hostByWorkspaceId }
}

function samePlan(a: OrcaPitMachinePlan, b: OrcaPitMachinePlan): boolean {
  const sameMap = (x: ReadonlyMap<string, string>, y: ReadonlyMap<string, string>): boolean =>
    x.size === y.size && [...x].every(([key, value]) => y.get(key) === value)
  return (
    sameMap(a.hostByHeaderKey, b.hostByHeaderKey) &&
    sameMap(a.hostByWorkspaceId, b.hostByWorkspaceId)
  )
}

const planStore = createStore<{ plan: OrcaPitMachinePlan }>(() => ({
  plan: EMPTY_ORCA_PIT_MACHINE_PLAN
}))

/** The sidebar list publishes its plan; rows and headers read their own entry. */
export function publishOrcaPitMachinePlan(plan: OrcaPitMachinePlan): void {
  if (!samePlan(plan, planStore.getState().plan)) {
    planStore.setState({ plan })
  }
}

function useMachineFrom(pick: (plan: OrcaPitMachinePlan) => ExecutionHostId | null) {
  const read = (): ExecutionHostId | null => pick(planStore.getState().plan)
  return useSyncExternalStore(planStore.subscribe, read, read)
}

export function useOrcaPitRowMachine(workspaceId: string | null | undefined) {
  return useMachineFrom((plan) =>
    workspaceId ? (plan.hostByWorkspaceId.get(workspaceId) ?? null) : null
  )
}

export function useOrcaPitHeaderMachine(headerKey: string) {
  return useMachineFrom((plan) => plan.hostByHeaderKey.get(headerKey) ?? null)
}

const NOTHING_COLLAPSED = new Set<string>()

/** Publishes the "Agents" view's plan from its uncollapsed rows; empty in every other view. */
export function usePublishOrcaPitMachinePlan(
  agentsOnly: boolean,
  rowPlan: { render: (collapsed: Set<string>) => Row[] },
  defaultHostId: ExecutionHostId
): void {
  useEffect(() => {
    publishOrcaPitMachinePlan(
      agentsOnly
        ? planOrcaPitMachineChips(
            flattenAgentsOnlyRows(rowPlan.render(NOTHING_COLLAPSED), NOTHING_COLLAPSED),
            defaultHostId
          )
        : EMPTY_ORCA_PIT_MACHINE_PLAN
    )
  }, [agentsOnly, rowPlan, defaultHostId])
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
