// Orca-Pit: in the "Agents" view a workspace row draws only its agent rows, so the project
// header sits right above its agents; see orca-pit-agents-view.
import type React from 'react'
import WorktreeCardAgents from './WorktreeCardAgents'
import { useAgentsOnlyView } from './orca-pit-agents-view'
import { getFlushWorktreeCardPaddingLeft } from './worktree-list/rows/indentation'

type Props = {
  worktreeId: string
  contentIndent: number
  /** The workspace card, drawn whenever the "Agents" view is off. */
  children: React.ReactNode
}

export function OrcaPitWorkspaceCardSlot({
  worktreeId,
  contentIndent,
  children
}: Props): React.JSX.Element {
  const agentsOnly = useAgentsOnlyView()
  if (!agentsOnly) {
    return <>{children}</>
  }
  return (
    <div
      className="pb-0.5 pr-1.5"
      style={{ paddingLeft: getFlushWorktreeCardPaddingLeft(contentIndent) }}
    >
      <WorktreeCardAgents worktreeId={worktreeId} className="mt-0" />
    </div>
  )
}
