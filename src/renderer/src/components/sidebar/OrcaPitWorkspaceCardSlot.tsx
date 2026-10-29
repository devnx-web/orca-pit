// Orca-Pit: in the "Agents" view a workspace row draws only its agent rows, so the project
// header sits right above its agents; see orca-pit-agents-view. With "Mine" or a person picked,
// only that person's agents are drawn. The machine chip lives on the rows and headers now
// (OrcaPitMachineChip).
import type React from 'react'
import { useMemo } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import WorktreeCardAgents from './WorktreeCardAgents'
import { useAgentsOnlyView } from './orca-pit-agents-view'
import {
  orcaPitPaneBelongsTo,
  orcaPitPeopleFilterKeys,
  useOrcaPitAgentFilters
} from './orca-pit-agent-filters'
import { getOrcaPitHostPresences, useOrcaPitPresenceRevision } from './orca-pit-sidebar-presence'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'
import {
  getFlushWorktreeCardPaddingLeft,
  getWorktreeCardContentIndent
} from './worktree-list/rows/indentation'

// Why one indent: nested projects fold into their top-level header in this view, so every agent
// sits one step under it whatever depth its workspace had in the Project view.
const AGENT_ROW_CONTENT_INDENT = getWorktreeCardContentIndent({
  isGrouped: true,
  groupDepth: 0,
  lineageDepth: 0
})

type Props = {
  worktree: Worktree
  repo: Repo | undefined
  /** The workspace card, drawn whenever the "Agents" view is off. */
  children: React.ReactNode
}

function AgentRows({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const filters = useOrcaPitAgentFilters()
  const personFiltered = filters.mine || filters.person !== null
  const agents = useWorktreeAgentRows(worktreeId, personFiltered)
  const revision = useOrcaPitPresenceRevision(personFiltered)
  const shown = useMemo(() => {
    void revision
    const hosts = getOrcaPitHostPresences()
    const people = personFiltered ? orcaPitPeopleFilterKeys(filters, hosts) : null
    // A child agent goes with its parent: it has no author of its own.
    return people
      ? agents.filter((agent) =>
          orcaPitPaneBelongsTo(agent.activationPaneKey ?? agent.paneKey, people, hosts)
        )
      : undefined
  }, [agents, filters, personFiltered, revision])
  return (
    <WorktreeCardAgents worktreeId={worktreeId} agents={shown} className="mt-0" listEveryAgent />
  )
}

export function OrcaPitWorkspaceCardSlot({ worktree, children }: Props): React.JSX.Element {
  const agentsOnly = useAgentsOnlyView()
  if (!agentsOnly) {
    return <>{children}</>
  }
  return (
    <div
      className="pb-0.5 pr-1.5"
      style={{ paddingLeft: getFlushWorktreeCardPaddingLeft(AGENT_ROW_CONTENT_INDENT) }}
    >
      <AgentRows worktreeId={worktree.id} />
    </div>
  )
}
