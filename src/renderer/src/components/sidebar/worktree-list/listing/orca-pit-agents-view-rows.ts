// Orca-Pit: the "Agents" view's rows, organized by project first (merged over machines, busiest
// on top, idle ones folded). Kept out of use-section-rows, an Orca file at its line budget.
import { useMemo } from 'react'
import type { Row } from '../../../../../../shared/sidebar-list/row-types'
import { useWorkspaceAgentRecency } from '../../orca-pit-agents-view'
import { organizeAgentsViewRows } from '../grouping/orca-pit-project-rows'

// Why a Set nobody writes to: render takes a mutable Set.
const NOTHING_COLLAPSED = new Set<string>()

/** Null outside the "Agents" view; there Orca's own render stays in charge. */
export function useOrcaPitAgentsViewRows(
  agentsOnly: boolean,
  rowPlan: { render: (collapsedGroups: Set<string>) => Row[] }
): Row[] | null {
  const agentRecency = useWorkspaceAgentRecency(agentsOnly)
  return useMemo(
    () =>
      agentsOnly ? organizeAgentsViewRows(rowPlan.render(NOTHING_COLLAPSED), agentRecency) : null,
    [agentsOnly, rowPlan, agentRecency]
  )
}
