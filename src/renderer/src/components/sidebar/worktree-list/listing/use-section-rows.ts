import { useCallback, useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { persistedUIValuesEqual } from '../../../../../../shared/persisted-ui-equality'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getLocalExecutionHostLabel,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../../../shared/host-setting-overrides'
import { planSidebarRows } from '../../../../../../shared/sidebar-list/sidebar-row-plan'
import { createHostScopedRepoOf } from '../../../../../../shared/sidebar-list/sidebar-feed-index'
import { createSidebarPRGroupReader } from '../grouping/pr-group-key'
import { useEffectiveCollapsedGroups } from './use-collapsed-groups'
import type { Row } from '../../../../../../shared/sidebar-list/row-types'
import type { SectionRowsArgs } from './sidebar-list-model'
import { getLogicalRepoOrderRankById } from '../../../../../../shared/project-section-order'
import { getEmptyProjectPlaceholderRepoIds } from '../../../../../../shared/sidebar-list/empty-project-placeholder-repos'
import {
  deferHostSectionCollapse,
  scopeHostSectionCollapse
} from '../../../../../../shared/sidebar-list/host-section-collapse'
import { addHostSectionRows } from '../../../../../../shared/sidebar-list/host-section-rows'
import { collectRenderedSidebarRowKeys } from './rendered-row-keys'
import {
  mergeDraggedHostSectionOrder,
  orderHostSectionOptions
} from '../../../../../../shared/sidebar-list/host-section-order'
import type { ExecutionHostRegistryEntry } from '../../../../../../shared/execution-host-registry'
import {
  type SidebarHostOption,
  buildSidebarHostOptions,
  sidebarHostSemantics,
  createSidebarHostLabelsSelector
} from '../../sidebar-host-options'
import { selectPendingWorktreeCreationKeys } from './pending-worktree-creation-keys'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { useProjectActivity } from '../../orca-pit-project-activity'
import { useAgentsViewRowInputs, useWorkspaceAgentRecency } from '../../orca-pit-agents-view'
import { collapseAgentsViewRows, organizeAgentsViewRows } from '../grouping/orca-pit-project-rows'
import { usePublishOrcaPitMachinePlan } from '../../orca-pit-machine-chips'

// Why a Set nobody writes to: render takes a mutable Set.
const NOTHING_COLLAPSED = new Set<string>()

function createSidebarHostOptionsSelector() {
  let inputs: readonly unknown[] = []
  let result: SidebarHostOption[] = []
  return (
    state: AppState,
    repos: readonly Repo[],
    settings: AppState['settings'],
    hostLabelOverrides: Parameters<typeof buildSidebarHostOptions>[0]['hostLabelOverrides']
  ): SidebarHostOption[] => {
    const nextInputs = [
      repos,
      state.sshTargetLabels,
      state.sshConnectionStates,
      settings,
      state.runtimeStatusByEnvironmentId,
      state.runtimeEnvironments,
      hostLabelOverrides,
      state.wslHostStatuses,
      settings?.experimentalWslHosts === true,
      state.wslHostServerFiles === 'missing'
    ]
    if (shallow(inputs, nextInputs)) {
      return result
    }
    inputs = nextInputs
    const next = buildSidebarHostOptions({
      repos,
      sshTargetLabels: state.sshTargetLabels,
      sshConnectionStates: state.sshConnectionStates,
      settings,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      hostLabelOverrides,
      wslHostStatuses: state.wslHostStatuses,
      wslHostsEnabled: settings?.experimentalWslHosts === true,
      wslHostServerFilesMissing: state.wslHostServerFiles === 'missing'
    })
    if (!persistedUIValuesEqual(result.map(sidebarHostSemantics), next.map(sidebarHostSemantics))) {
      result = next
    }
    return result
  }
}

export function useSidebarSectionRows(args: SectionRowsArgs) {
  const { repos, worktrees, repoMap, defaultHostId } = args
  const worktreesByRepo = useAppStore((s) => selectWorktreesByRepo(s))
  const workspaceHostOrder = useAppStore((s) => s.workspaceHostOrder)
  const setWorkspaceHostOrder = useAppStore((s) => s.setWorkspaceHostOrder)

  // Why: manual header order is bound to state.repos; Recent/Smart derive order from the sorted worktree stream.
  const repoOrder = useMemo(
    () => getLogicalRepoOrderRankById(repos.map((repo) => repo.id)),
    [repos]
  )
  const allRepoIds = useMemo(() => repos.map((r) => r.id), [repos])
  const placeholderRepoIds = useMemo(
    () =>
      getEmptyProjectPlaceholderRepoIds({
        groupBy: args.groupBy,
        repos: args.visibleReposForRows,
        worktreesByRepo,
        visibleWorktrees: worktrees,
        filterRepoIds: args.filterRepoIds
      }),
    [args.filterRepoIds, args.groupBy, args.visibleReposForRows, worktrees, worktreesByRepo]
  )

  // Why: subscribe on a flat key array (useShallow) so progress ticks don't rebuild the whole row model.
  const pendingCreationKeys = useAppStore(
    useShallow((s) => selectPendingWorktreeCreationKeys(s.pendingWorktreeCreations))
  )
  const pendingCreations = useMemo(
    () =>
      pendingCreationKeys.map((key) => {
        const separator = key.indexOf(' ')
        return {
          creationId: key.slice(0, separator),
          repoId: key.slice(separator + 1)
        }
      }),
    [pendingCreationKeys]
  )
  const hostLabelOverrides = useMemo(
    () => getHostDisplayLabelOverrides(args.settings),
    [args.settings]
  )
  const selectHostOptions = useMemo(() => createSidebarHostOptionsSelector(), [])
  const selectHostLabels = useMemo(() => createSidebarHostLabelsSelector(), [])
  const hostOptions = useAppStore((state) =>
    selectHostOptions(state, repos, args.settings, hostLabelOverrides)
  )
  const hostLabelById = useMemo(
    () => selectHostLabels(hostOptions),
    [hostOptions, selectHostLabels]
  )

  const hostScopedGroups =
    args.workspaceHostScope !== 'all' || args.visibleWorkspaceHostIds !== null
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const projectActivity = useProjectActivity()
  const { agentsOnly, rowInputs } = useAgentsViewRowInputs(
    {
      worktrees,
      folderWorkspaces: args.visibleFolderWorkspacesForRows,
      projectGroups: args.visibleProjectGroupsForRows,
      placeholderRepoIds,
      importedWorktreesByRepo: args.importedWorktreesByRepo,
      newExternalWorktreesInboxByRepo: args.newExternalWorktreesInboxByRepo
    },
    args.visibleReposForRows
  )
  // Same-id registrations on two hosts: each row and project header needs its own host's.
  const repoOfWorktree = useMemo(() => createHostScopedRepoOf(repos, repoMap), [repos, repoMap])
  const rowPlan = useMemo(
    () =>
      planSidebarRows({
        groupBy: args.groupBy,
        worktrees: rowInputs.worktrees,
        repoMap,
        repoOfWorktree,
        prGroupOf: createSidebarPRGroupReader(repoMap, args.prCache),
        repoOrder,
        workspaceStatuses: args.workspaceStatuses,
        projectOrderBy: args.projectOrderBy,
        lineageById: args.worktreeLineageById,
        worktreeMap: args.worktreeMap,
        // Orca-Pit: agent rows replace the card, so a child workspace cannot nest inside one.
        nestLineage: !agentsOnly,
        projectGroups: rowInputs.projectGroups,
        placeholderRepoIds: rowInputs.placeholderRepoIds,
        importedWorktreesByRepo: rowInputs.importedWorktreesByRepo,
        newExternalWorktreesInboxByRepo: rowInputs.newExternalWorktreesInboxByRepo,
        pendingCreations,
        projectGrouping: args.projectGrouping,
        folderWorkspaces: rowInputs.folderWorkspaces,
        hostLabelById,
        defaultHostId,
        pinnedDisplayPolicy: args.pinnedDisplayPolicy,
        filterRepoIds: args.filterRepoIds,
        hideEmptyProjectGroupRepos: hideDefaultBranchWorkspace && !agentsOnly,
        // Orca-Pit: the "Agents" view orders by its newest agent instead of Active/Inactive.
        projectActivity: agentsOnly ? undefined : projectActivity
      }),
    [
      args.groupBy,
      rowInputs,
      agentsOnly,
      hideDefaultBranchWorkspace,
      projectActivity,
      repoMap,
      repoOfWorktree,
      args.prCache,
      defaultHostId,
      repoOrder,
      args.workspaceStatuses,
      args.projectOrderBy,
      args.worktreeLineageById,
      args.worktreeMap,
      args.projectGrouping,
      pendingCreations,
      hostLabelById,
      args.pinnedDisplayPolicy,
      args.filterRepoIds
    ]
  )
  const effectiveCollapsedGroups = useEffectiveCollapsedGroups({
    occurrencePlan: rowPlan.occurrencePlan,
    hostScopedGroups,
    collapsedGroups: args.effectiveCollapsedGroups,
    agentSendTargetWorktreeId: args.agentSendTargetWorktreeId ?? null,
    groupBy: args.groupBy,
    pinnedDisplayPolicy: args.pinnedDisplayPolicy,
    worktrees,
    visibleWorktrees: worktrees,
    filterRepoIds: args.filterRepoIds,
    repoMap,
    worktreeMap: args.worktreeMap,
    worktreeLineageById: args.worktreeLineageById,
    prCache: args.prCache,
    workspaceStatuses: args.workspaceStatuses,
    projectGroups: args.visibleProjectGroupsForRows,
    projectGrouping: args.projectGrouping,
    folderWorkspaces: args.visibleFolderWorkspacesForRows,
    defaultHostId
  })
  const rowCollapsedGroups = useMemo(
    () =>
      hostScopedGroups
        ? deferHostSectionCollapse(effectiveCollapsedGroups)
        : effectiveCollapsedGroups,
    [effectiveCollapsedGroups, hostScopedGroups]
  )
  // Orca-Pit: the "Agents" view is organized by project first, then collapsed.
  const agentRecency = useWorkspaceAgentRecency(agentsOnly)
  const agentsViewRows = useMemo(
    () =>
      agentsOnly ? organizeAgentsViewRows(rowPlan.render(NOTHING_COLLAPSED), agentRecency) : null,
    [agentsOnly, rowPlan, agentRecency]
  )
  const rows: Row[] = useMemo(
    () =>
      agentsViewRows
        ? collapseAgentsViewRows(agentsViewRows, rowCollapsedGroups)
        : rowPlan.render(rowCollapsedGroups),
    [agentsViewRows, rowPlan, rowCollapsedGroups]
  )
  // Orca-Pit: which machine chips the "Agents" view draws, from its uncollapsed rows.
  usePublishOrcaPitMachinePlan(agentsViewRows, defaultHostId)
  const orderedHostOptions = useMemo(
    () => orderHostSectionOptions(hostOptions, workspaceHostOrder),
    [hostOptions, workspaceHostOrder]
  )
  const [hostDragActive, setHostDragActive] = useState(false)
  const handleReorderHostSections = useCallback(
    (orderedVisibleHostIds: ExecutionHostId[]) =>
      setWorkspaceHostOrder(
        mergeDraggedHostSectionOrder(
          orderedVisibleHostIds,
          workspaceHostOrder,
          orderedHostOptions.map((host) => host.id)
        )
      ),
    [orderedHostOptions, setWorkspaceHostOrder, workspaceHostOrder]
  )
  const sectionRows = useMemo(() => {
    const sectioned = addHostSectionRows({
      rows,
      hostOptions: orderedHostOptions,
      workspaceHostScope: args.workspaceHostScope,
      visibleWorkspaceHostIds: args.visibleWorkspaceHostIds,
      defaultHostId,
      localHostLabel: getLocalExecutionHostLabel(),
      collapsedHostKeys: effectiveCollapsedGroups,
      forceCollapseHosts: hostDragActive,
      // Why: projects/workspaces are the primary sidebar object; host sections are only an explicit host-filter view.
      preferProjectGrouping: true
    })
    return hostScopedGroups
      ? scopeHostSectionCollapse({
          rows: sectioned,
          collapsedGroups: effectiveCollapsedGroups
        })
      : sectioned
  }, [
    args.visibleWorkspaceHostIds,
    args.workspaceHostScope,
    defaultHostId,
    effectiveCollapsedGroups,
    hostDragActive,
    hostScopedGroups,
    orderedHostOptions,
    rows
  ])
  const renderedSidebarRowKeys = useMemo(
    () => collectRenderedSidebarRowKeys(sectionRows),
    [sectionRows]
  )

  const headerHostOptions: readonly ExecutionHostRegistryEntry[] = hostOptions
  return {
    occurrencePlan: rowPlan.occurrencePlan,
    hostOptions: headerHostOptions,
    effectiveCollapsedGroups,
    rows,
    sectionRows,
    renderedSidebarRowKeys,
    allRepoIds,
    placeholderRepoIds,
    handleReorderHostSections,
    setHostDragActive
  }
}
