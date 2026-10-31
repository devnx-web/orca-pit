// Orca-Pit: the fork's pieces of a sidebar section header, kept here so SectionHeader (an Orca
// file at its line budget) only calls them.
import type React from 'react'
import type {
  GroupHeaderRow,
  WorktreeGroupBy
} from '../../../../../../shared/sidebar-list/row-types'
import { isProjectActivitySectionKey } from '../../../../../../shared/sidebar-list/orca-pit-activity-sections'
import { OrcaPitControlProjectChip } from '../../OrcaPitControlProjectChip'
import type { RepoHeaderProjectActions } from './repo-header-project-actions'

/** The idle fold starts closed, so for it a key in the collapsed set means open. */
export function isHeaderCollapsed(
  collapsedGroups: ReadonlySet<string>,
  collapseKey: string,
  row: GroupHeaderRow
): boolean {
  return collapsedGroups.has(collapseKey) !== (row.orcaPitOpenWhenSet === true)
}

/** The DevNX Control project this header's project (or a group's nested one) counts toward. */
export function ControlChip({
  row,
  ctx
}: {
  row: GroupHeaderRow
  ctx: {
    groupBy: WorktreeGroupBy
    projectActions: Pick<RepoHeaderProjectActions, 'onOpenRepoSettings'>
  }
}): React.JSX.Element {
  return (
    <OrcaPitControlProjectChip
      repo={ctx.groupBy === 'repo' ? (row.repo ?? row.orcaPitCreateRepo) : undefined}
      onOpenRepoSettings={ctx.projectActions.onOpenRepoSettings}
    />
  )
}

/** Orca's collapse affordance, also on the idle fold ("No agent right now"). */
export function withFold(row: GroupHeaderRow, orcaCollapsible: boolean): boolean {
  return row.count > 0 && (orcaCollapsible || isProjectActivitySectionKey(row.key))
}
